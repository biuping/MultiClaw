/**
 * CLI 模式聊天处理模块
 * 
 * 注入团队上下文 + 处理 DELEGATE 委派
 */

import { chatService } from '../services/chat';
import { agentService } from '../services/agent';
import { openclawService } from '../services/openclaw';
import { agentExecutor, AgentConfig } from '../services/agent-executor';
import { CollaborationEntry } from '../types';
import { sendToClient, broadcastToAgent } from './connection';

/**
 * CLI 模式聊天 - 注入团队上下文 + 处理委派
 */
export async function handleCliChat(
  agentId: string,
  agent: any,
  content: string,
  senderClientId: string
): Promise<void> {
  sendToClient(senderClientId, { type: 'stream_start' });

  const skills = await openclawService.listSkills();

  // 获取可见同事
  const visibleAgents = await agentService.getVisibleAgents(agentId);
  const allRelations = await agentService.getAllRelations();
  const visibleContext = visibleAgents.map(va => {
    const rel = allRelations.find(r => r.sourceId === agentId && r.targetId === va.id);
    return {
      id: va.id,
      name: va.name,
      role: va.role || '',
      persona: va.persona || '',
      skills: va.skills || [],
      relationType: rel?.relationType || 'visible',
      trustScore: rel?.trustScore || 0,
      collaborationCount: rel?.collaborationCount || 0,
    };
  });

  let fullReply = '';
  let currentSteps: { step: string; text: string; tool?: string }[] = [];

  // 构建带团队上下文的消息
  const systemPrompt = openclawService.buildSystemPrompt(
    {
      name: agent.name,
      persona: agent.persona || '',
      skills: agent.skills || [],
      role: agent.role || '',
      id: agent.id,
    },
    skills,
    visibleContext.length > 0 ? visibleContext : undefined
  );

  const fullMessage = visibleContext.length > 0
    ? systemPrompt + '\n\n---\n\n' + content
    : content;

  const agentConfig: AgentConfig = {
    id: agent.id,
    name: agent.name,
    persona: agent.persona || '',
    skills: agent.skills || [],
    role: agent.role || '',
    model: agent.model || 'default',
    workspace: agent.workspace,
  };

  await agentExecutor.chat(agent.id, fullMessage, agentConfig, (chunk: string) => {
    try {
      const stepData = JSON.parse(chunk);
      if (stepData.type === 'step') {
        currentSteps.push({ step: stepData.step, text: stepData.text, tool: stepData.tool });
        sendToClient(senderClientId, { type: 'step', ...stepData });
        return;
      }
    } catch {}
    fullReply += chunk;
    sendToClient(senderClientId, { type: 'stream_chunk', chunk });
  }, { freshSession: false }); // 直接对话模式保留 session 历史

  // 处理 DELEGATE 标记
  const delegations = agentExecutor.parseDelegates(fullReply);

  // 执行委派
  if (delegations.length > 0) {
    sendToClient(senderClientId, { type: 'delegation_start', count: delegations.length });

    const delegationResults: Array<{ to: string; task: string; result: string; success: boolean }> = [];

    for (const delegation of delegations) {
      const targetAgent = visibleAgents.find(a => a.name === delegation.to);
      if (!targetAgent) {
        delegationResults.push({
          to: delegation.to, task: delegation.task,
          result: '未找到名为 "' + delegation.to + '" 的同事', success: false,
        });
        continue;
      }

      sendToClient(senderClientId, {
        type: 'delegation_progress',
        from: agent.name, to: delegation.to, task: delegation.task.slice(0, 50),
      });

      const record = await agentService.createDelegationRecord(agentId, targetAgent.id, delegation.task);

      try {
        let delegateReply = '';
        const targetConfig: AgentConfig = {
          id: targetAgent.id, name: targetAgent.name,
          persona: targetAgent.persona || '', skills: targetAgent.skills || [],
          role: targetAgent.role || '', model: targetAgent.model || 'default',
          workspace: targetAgent.workspace,
        };

        await agentExecutor.chat(targetAgent.id, delegation.task, targetConfig, (chunk: string) => {
          try { const s = JSON.parse(chunk); if (s.type === 'step') return; } catch {}
          delegateReply += chunk;
        }, { freshSession: true }); // 委派任务使用独立 session

        await agentService.updateDelegationRecord(record.id, delegateReply, 'completed');
        delegationResults.push({ to: delegation.to, task: delegation.task, result: delegateReply, success: true });

        await agentService.recordCollaboration(agentId, targetAgent.id, {
          taskId: record.id, task: delegation.task, result: delegateReply.slice(0, 200),
          timestamp: new Date().toISOString(), success: true,
        });

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await agentService.updateDelegationRecord(record.id, errMsg, 'failed');
        delegationResults.push({ to: delegation.to, task: delegation.task, result: errMsg, success: false });

        await agentService.recordCollaboration(agentId, targetAgent.id, {
          taskId: record.id, task: delegation.task, result: errMsg.slice(0, 200),
          timestamp: new Date().toISOString(), success: false,
        });
      }
    }

    sendToClient(senderClientId, { type: 'delegation_results', delegations: delegationResults });

    // 用委派结果让原 Agent 整合回复
    if (delegationResults.some(r => r.success)) {
      const resultsSummary = delegationResults
        .map(r => '【' + r.to + '的回复】' + (r.success ? r.result : '(失败: ' + r.result + ')'))
        .join('\n\n');

      const integrationPrompt = '你委派了任务给同事，以下是他们的回复：\n\n' +
        resultsSummary + '\n\n请整合以上结果，给出最终回复。如果某个委派失败了，说明情况并给出替代方案。';

      let integrationReply = '';
      await agentExecutor.chat(agent.id, integrationPrompt, agentConfig, (chunk: string) => {
        try { const s = JSON.parse(chunk); if (s.type === 'step') return; } catch {}
        integrationReply += chunk;
        sendToClient(senderClientId, { type: 'stream_chunk', chunk });
      }, { freshSession: true }); // 整合使用独立 session

      fullReply += '\n\n' + integrationReply;
    }
  }

  const aiMessage = await chatService.addMessage(agentId, 'assistant', fullReply, {
    model: 'default', steps: currentSteps,
    delegations: delegations.length > 0 ? delegations : undefined,
  });

  await agentService.updateAgentStatus(agentId, 'ready');
  sendToClient(senderClientId, { type: 'message', role: 'assistant', content: fullReply });
  sendToClient(senderClientId, { type: 'stream_end', message: aiMessage });
  broadcastToAgent(agentId, { type: 'message', role: 'assistant', content: fullReply }, senderClientId);
}
