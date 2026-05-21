/**
 * Gateway 流式处理模块
 * 
 * 管理 Gateway 事件监听、stream 状态、lifecycle 和 item 事件转发
 */

import { getGatewayClient, GatewayClient } from '../services/gateway-client';
import { sendToAgentClients } from './connection';

export interface AgentItem {
  itemId: string;
  kind: string;
  name?: string;
  title: string;
  status: string;
  phase: string;
  inputText?: string;
  outputText?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface StreamState {
  runId: string;
  fullText: string;
  items: AgentItem[];
  sessionKey: string;
  completed: boolean;
}

/** 活跃的 Gateway 事件监听器（按 agentId 索引） */
export const activeStreams = new Map<string, StreamState>();

// Gateway 客户端（懒初始化）
let gwClient: GatewayClient | null = null;

export async function ensureGatewayClient(): Promise<GatewayClient> {
  if (!gwClient || !gwClient.isConnected) {
    gwClient = await getGatewayClient();

    gwClient.on('event', (evt: any) => {
      if (evt.event !== 'agent') return;

      const payload = evt.payload;
      if (!payload) return;

      const sessionKey = payload.sessionKey || '';
      const runId = payload.runId || '';
      const stream = payload.stream;
      const data = payload.data || {};

      // 通过 runId 或 sessionKey 查找对应的 stream
      let streamState: StreamState | undefined;
      let agentId: string | null = null;
      for (const [id, state] of activeStreams) {
        if (runId && state.runId === runId) {
          streamState = state;
          agentId = id;
          break;
        }
      }
      if (!streamState && sessionKey) {
        for (const [id, state] of activeStreams) {
          if (state.sessionKey === sessionKey) {
            streamState = state;
            agentId = id;
            if (runId) state.runId = runId;
            break;
          }
        }
      }
      if (!streamState || !agentId) return;

      switch (stream) {
        case 'lifecycle': {
          if (data.phase === 'start' || data.status === 'running') {
            sendToAgentClients(agentId, { type: 'stream_start' });
          }
          break;
        }

        case 'assistant': {
          if (data.text) {
            streamState.fullText += data.text;
            sendToAgentClients(agentId, { type: 'stream_chunk', chunk: data.text });
          }
          break;
        }

        case 'item': {
          const itemId = data.itemId || '';
          const phase = data.phase;
          const kind = data.kind;
          const title = data.title || '';
          const name = data.name;
          const status = data.status || 'running';

          if (phase === 'start') {
            const item: AgentItem = {
              itemId, kind, name, title, status, phase,
              startedAt: Date.now(),
            };
            streamState.items.push(item);
            sendToAgentClients(agentId, {
              type: 'tool_call', itemId, phase: 'start', kind, name: name || kind, title,
            });
          } else if (phase === 'update') {
            const item = streamState.items.find(i => i.itemId === itemId);
            if (item) {
              item.status = status;
              item.title = title;
              if (data.meta) item.inputText = data.meta;
            }
            sendToAgentClients(agentId, {
              type: 'tool_call', itemId, phase: 'update', kind, name: name || kind, title, status,
            });
          } else if (phase === 'end') {
            const item = streamState.items.find(i => i.itemId === itemId);
            if (item) {
              item.status = status || 'completed';
              item.endedAt = Date.now();
            }
            sendToAgentClients(agentId, {
              type: 'tool_call', itemId, phase: 'end', kind, name: name || kind, title,
              status: status || 'completed',
              duration: item ? item.endedAt! - (item.startedAt || 0) : 0,
            });
          }
          break;
        }

        case 'command_output': {
          const cmdItemId = data.itemId || '';
          const cmdPhase = data.phase;
          const output = data.output || '';
          const exitCode = data.exitCode;

          sendToAgentClients(agentId, {
            type: 'command_output',
            itemId: cmdItemId,
            phase: cmdPhase,
            output,
            exitCode,
            durationMs: data.durationMs,
          });
          break;
        }

        case 'plan': {
          if (data.title) {
            sendToAgentClients(agentId, {
              type: 'plan', title: data.title, explanation: data.explanation, steps: data.steps,
            });
          }
          break;
        }

        case 'error': {
          sendToAgentClients(agentId, {
            type: 'error', error: data.message || data.error || 'Agent 执行出错',
          });
          break;
        }
      }
    });
  }
  return gwClient;
}

/**
 * 等待流式输出完成
 */
export function waitForStreamCompletion(agentId: string, runId: string, sessionKey: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Agent 对话超时'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (gwClient) {
        gwClient.off('event', handler);
      }
    };

    const handler = (evt: any) => {
      if (evt.event !== 'agent') return;
      const payload = evt.payload;
      if (!payload) return;

      const evtSessionKey = payload.sessionKey || '';
      const evtRunId = payload.runId || '';

      const state = activeStreams.get(agentId);
      if (!state) return;

      const matchesRunId = evtRunId && state.runId === evtRunId;
      const matchesSessionKey = evtSessionKey && state.sessionKey === evtSessionKey;
      if (!matchesRunId && !matchesSessionKey) return;

      if (evtRunId && state.runId !== evtRunId && state.runId.startsWith('run-')) {
        state.runId = evtRunId;
      }

      const stream = payload.stream;
      const data = payload.data || {};

      if (stream === 'lifecycle' && (data.phase === 'end' || data.status === 'completed')) {
        state.completed = true;
        cleanup();
        setTimeout(() => resolve(), 1500);
        return;
      }

      if (stream === 'lifecycle' && data.status === 'failed') {
        cleanup();
        reject(new Error(data.error || 'Agent 执行失败'));
        return;
      }

      if (stream === 'error') {
        cleanup();
        reject(new Error(data.message || data.error || 'Agent 执行出错'));
        return;
      }
    };

    const gw = gwClient;
    if (gw) {
      gw.on('event', handler);
    } else {
      const poll = () => {
        const state = activeStreams.get(agentId);
        if (!state || state.completed) {
          cleanup();
          resolve();
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          cleanup();
          reject(new Error('Agent 对话超时'));
          return;
        }
        setTimeout(poll, 500);
      };
      setTimeout(poll, 500);
    }
  });
}
