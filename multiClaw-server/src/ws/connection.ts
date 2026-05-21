import { WebSocket } from 'ws';

export interface ChatClient {
  ws: WebSocket;
  agentId: string | null;
}

/** 所有连接的客户端 */
export const clients = new Map<string, ChatClient>();

/** 发送消息给指定客户端 */
export function sendToClient(clientId: string, data: any) {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(data));
  }
}

/** 广播给订阅了指定 Agent 的所有客户端 */
export function broadcastToAgent(agentId: string, data: any, excludeClientId?: string) {
  for (const [clientId, client] of clients) {
    if (client.agentId === agentId && clientId !== excludeClientId) {
      sendToClient(clientId, data);
    }
  }
}

/** 广播给订阅了指定 Agent 的所有客户端（无排除） */
export function sendToAgentClients(agentId: string, data: any) {
  broadcastToAgent(agentId, data);
}

/** 生成客户端 ID */
export function generateClientId(): string {
  return 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
