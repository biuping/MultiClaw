/**
 * CLI 模式聊天处理模块
 * 
 * 注入团队上下文 + 处理 DELEGATE 委派
 */

import { chatService } from '../services/chat';
import { agentService } from '../services/agent';
import { openclawService } from '../services/openclaw';
import { skillService } from '../services/skill';
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

  // 加载 Agent 的私有技能，区分人格模式和技能模式
  const privateSkills = await skillService.getAgentSkills(agentId);
  const enabledPersonaSkills = privateSkills.filter(s => s.enabled && s.skillType === 'persona');
  const personaOnSkills = enabledPersonaSkills.filter(s => s.personaMode === 'on');
  const personaOffSkills = enabledPersonaSkills.filter(s => s.personaMode === 'off');

  // 读取人格模式开启的技能内容
  const personaOnContents: Array<{ name: string; content: string }> = [];
  for (const ps of personaOnSkills) {
    const content = await skillService.readSkillContent(agentId, ps.skillId);
    if (content) {
      personaOnContents.push({ name: ps.name, content });
    }
  }

  // 读取人格模式关闭的技能内容（作为普通技能提示）
  const personaOffContents: Array<{ name: string; description: string; content: string }> = [];
  for (const ps of personaOffSkills) {
    const content = await skillService.readSkillContent(agentId, ps.skillId);
    if (content) {
      personaOffContents.push({ name: ps.name, description: ps.description || '', content });
    }
  }

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

  // 拼接人格技能和工具技能提示
  let personaSection = '';
  if (personaOnContents.length > 0) {
    const parts = personaOnContents.map(ps =>
      '### 人格：' + ps.name + '\n\n' + ps.content
    );
    personaSection = '\n\n---\n\n## 活跃人格\n\n你现在正在使用以下人格模式工作，请完全代入这些人格的视角和风格来思考和回复：\n\n' + parts.join('\n\n');
  }

  let toolSkillSection = '';
  if (personaOffContents.length > 0) {
    const parts = personaOffContents.map(ps =>
      '### ' + ps.name + '\n' + (ps.description ? ps.description + '\n\n' : '\n') + ps.content
    );
    toolSkillSection = '\n\n---\n\n## 可用技能\n\n当任务需要时，你可以参考以下技能的知识和方法：\n\n' + parts.join('\n\n');
  }

  const fullMessage = visibleContext.length > 0
    ? systemPrompt + personaSection + toolSkillSection + '\n\n---\n\n' + content
    : (systemPrompt + personaSection + toolSkillSection + '\n\n---\n\n' + content);

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
