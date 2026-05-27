/**
 * WebSocket 主模块 — 组装各子模块
 * 
 * 拆分为：
 * - ws/connection.ts: 客户端管理、发送/广播
 * - ws/stream.ts: Gateway 流式处理
 * - ws/chat-handler.ts: CLI 模式聊天 + 委派
 * - websocket.ts: 消息路由 + 组装
 */

import { WebSocketServer, WebSocket } from 'ws';
import { chatService } from './services/chat';
import { agentService } from './services/agent';
import { openclawService } from './services/openclaw';
import { taskEvents, TaskProgressEvent } from './services/task-events';
import { handleCliChat } from './ws/chat-handler';
import { handleStreamingChat } from './ws/stream-handler';
import {
  clients,
  sendToClient,
  generateClientId,
} from './ws/connection';

export function setupWebSocket(wss: WebSocketServer) {
  // 监听任务进度事件，广播给所有连接的客户端
  taskEvents.on('task:progress', (event: TaskProgressEvent) => {
    const message = {
      type: 'task_progress',
      taskId: event.taskId,
      phase: event.phase,
      message: event.message,
      detail: event.detail,
      timestamp: event.timestamp,
    };
    for (const [, client] of clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
      }
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const clientId = generateClientId();
    clients.set(clientId, { ws, agentId: null });

    console.log('WebSocket client connected: ' + clientId);

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(clientId, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        sendToClient(clientId, { type: 'error', error: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log('WebSocket client disconnected: ' + clientId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error for client ' + clientId + ':', error);
    });

    sendToClient(clientId, { type: 'connected', clientId });
  });
}

async function handleMessage(clientId: string, message: any) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'subscribe': {
      client.agentId = message.agentId;
      sendToClient(clientId, { type: 'subscribed', agentId: message.agentId });

      const history = await chatService.getMessages(message.agentId, 50);
      sendToClient(clientId, { type: 'history', messages: history });

      const skillCalls = await chatService.getSkillCalls(message.agentId, 50);
      for (const skillCall of skillCalls) {
        sendToClient(clientId, { type: 'skill_call', skillCall });
      }
      break;
    }

    case 'chat': {
      if (!client.agentId) {
        sendToClient(clientId, { type: 'error', error: 'Not subscribed to any agent' });
        return;
      }

      const { content } = message;
      const agent = await agentService.getAgent(client.agentId);

      if (!agent) {
        sendToClient(clientId, { type: 'error', error: 'Agent not found' });
        return;
      }

      await chatService.addMessage(client.agentId, 'user', content);
      await agentService.updateAgentStatus(client.agentId, 'chatting');

      try {
        await handleCliChat(client.agentId, agent, content, clientId);
      } catch (error) {
        console.error('[chat] 对话失败:', (error as Error).message);
        sendToClient(clientId, { type: 'error', error: '对话失败: ' + (error as Error).message });
        sendToClient(clientId, { type: 'stream_end' }); // 确保前端退出流式状态
        await agentService.updateAgentStatus(client.agentId, 'error');
      }
      break;
    }

    case 'ping':
      sendToClient(clientId, { type: 'pong' });
      break;

    default:
      sendToClient(clientId, { type: 'error', error: 'Unknown message type: ' + message.type });
  }
}
