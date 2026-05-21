/**
 * Gateway 流式聊天处理模块
 * 
 * 通过 Gateway WS 提供真正的 token 级流式输出
 */

import { chatService } from '../services/chat';
import { agentService } from '../services/agent';
import { openclawService } from '../services/openclaw';
import { sendToClient, broadcastToAgent } from './connection';
import { ensureGatewayClient, activeStreams, waitForStreamCompletion } from './stream';

/**
 * 使用 Gateway WS 的流式聊天模式
 */
export async function handleStreamingChat(
  agentId: string,
  agent: any,
  content: string,
  senderClientId: string
): Promise<void> {
  const gw = await ensureGatewayClient();

  const sessionKey = 'agent:main:multiclaw:' + agentId;

  const skills = await openclawService.listSkills();
  const systemPrompt = openclawService.buildSystemPrompt(
    {
      name: agent.name,
      persona: agent.persona || '',
      skills: agent.skills || [],
      role: agent.role || '',
    },
    skills
  );

  const fullMessage = agent.persona
    ? systemPrompt + '\n\n用户: ' + content
    : content;

  const runId = 'run-' + agentId + '-' + Date.now();
  activeStreams.set(agentId, {
    runId,
    fullText: '',
    items: [],
    sessionKey,
    completed: false,
  });

  try {
    try {
      await gw.sessionsCreate({
        key: sessionKey,
        ...(agent.model && agent.model !== 'default' ? { model: agent.model } : {}),
      });
    } catch (createErr: any) {
      console.log('[handleStreamingChat] sessions.create 结果:', createErr.message || 'ok');
    }

    try {
      await gw.sessionsMessagesSubscribe(sessionKey);
    } catch (subErr: any) {
      console.warn('[handleStreamingChat] sessions.messages.subscribe 失败:', subErr.message);
    }

    const realRunId = await gw.sessionsSend({
      key: sessionKey,
      message: fullMessage,
    });

    console.log('[handleStreamingChat] 已发送消息, runId=' + (realRunId || runId));

    const streamState = activeStreams.get(agentId);
    if (streamState) {
      streamState.runId = realRunId || runId;
    }

    await waitForStreamCompletion(agentId, realRunId || runId, sessionKey, 300000);

    const finalState = activeStreams.get(agentId);
    const fullReply = finalState?.fullText || '';

    if (fullReply) {
      const aiMessage = await chatService.addMessage(agentId, 'assistant', fullReply, {
        model: agent.model || 'default',
        items: finalState?.items || [],
      });
      broadcastToAgent(agentId, { type: 'message', role: 'assistant', content: fullReply }, senderClientId);
      sendToClient(senderClientId, { type: 'message', role: 'assistant', content: fullReply });
    }

    await agentService.updateAgentStatus(agentId, 'ready');
    sendToClient(senderClientId, { type: 'stream_end' });

  } catch (error) {
    console.error('[handleStreamingChat] 失败:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    sendToClient(senderClientId, { type: 'error', error: '对话失败: ' + errorMsg });
    await agentService.updateAgentStatus(agentId, 'error');
  } finally {
    setTimeout(() => {
      activeStreams.delete(agentId);
    }, 3000);
  }
}
