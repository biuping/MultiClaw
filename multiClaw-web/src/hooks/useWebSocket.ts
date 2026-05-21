import { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage, SkillCall } from '../types';
import { chatApi } from '../services/api';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

// Tool call 状态
export interface ToolCallInfo {
  itemId: string;
  kind: string;
  name: string;
  title: string;
  status: 'running' | 'completed' | 'failed';
  phase: 'start' | 'update' | 'end';
  duration?: number;
  output?: string;
}

// 命令输出
export interface CommandOutput {
  itemId: string;
  phase: 'delta' | 'end';
  output: string;
  exitCode?: number | null;
  durationMs?: number;
}

export function useWebSocket(agentId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [commandOutputs, setCommandOutputs] = useState<Map<string, string>>(new Map());
  const [delegationState, setDelegationState] = useState<{
    active: boolean;
    progress: Array<{from: string; to: string; task: string}>;
    results: Array<{to: string; task: string; result: string; success: boolean}>;
  }>({ active: false, progress: [], results: [] });
  const [planInfo, setPlanInfo] = useState<{ title: string; explanation?: string; steps?: string[] } | null>(null);
  const [skillCalls, setSkillCalls] = useState<SkillCall[]>([]);

  useEffect(() => {
    if (!agentId) return;

    const apiKey = localStorage.getItem('multiclaw_api_key') || '';
    const wsBase = `ws://${window.location.host}/ws`;
    const wsUrl = apiKey ? `${wsBase}?token=${encodeURIComponent(apiKey)}` : wsBase;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setIsConnected(true);
      // 订阅 Agent
      ws.current?.send(JSON.stringify({ type: 'subscribe', agentId }));
    };

    ws.current.onmessage = (event) => {
      const data: WebSocketMessage = JSON.parse(event.data);
      handleMessage(data);
    };

    ws.current.onclose = () => {
      setIsConnected(false);
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    return () => {
      ws.current?.close();
    };
  }, [agentId]);

  const handleMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case 'connected':
        console.log('WebSocket connected:', data.clientId);
        break;

      case 'subscribed':
        console.log('Subscribed to agent:', data.agentId);
        break;

      case 'history':
        setMessages(data.messages || []);
        const historySkillCalls: SkillCall[] = [];
        (data.messages || []).forEach((msg: ChatMessage) => {
          if (msg.metadata?.skillCalls) {
            historySkillCalls.push(...msg.metadata.skillCalls);
          }
        });
        setSkillCalls(prev => [...historySkillCalls, ...prev]);
        break;

      case 'message':
        if (data.role && data.content) {
          const newMessage: ChatMessage = {
            id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 6),
            agentId: agentId || '',
            role: data.role,
            content: data.content,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => {
            // 去重：如果最后一条消息内容和角色相同，跳过
            const last = prev[prev.length - 1];
            if (last && last.role === newMessage.role && last.content === newMessage.content) {
              return prev;
            }
            return [...prev, newMessage];
          });
        }
        break;

      case 'skill_call':
        if (data.skillCall) {
          setSkillCalls((prev) => [...prev, data.skillCall]);
        }
        break;

      // ========== 新的流式事件 ==========

      case 'stream_start':
        setIsStreaming(true);
        setStreamContent('');
        setToolCalls([]);
        setCommandOutputs(new Map());
        setPlanInfo(null);
        break;

      case 'stream_chunk':
        // Token 级别的流式输出
        setStreamContent((prev) => prev + (data.chunk || ''));
        break;

      case 'stream_end': {
        // 服务端已通过 type:'message' 发送了完整的 assistant 消息，
        // 这里只需清除流式状态，不再重复添加消息
        setStreamContent('');
        setIsStreaming(false);
        setToolCalls([]);
        setCommandOutputs(new Map());
        setPlanInfo(null);
        break;
      }

      case 'tool_call': {
        const tc: ToolCallInfo = {
          itemId: data.itemId,
          kind: data.kind || 'tool',
          name: data.name || data.kind || 'tool',
          title: data.title || '',
          status: data.status || (data.phase === 'end' ? 'completed' : 'running'),
          phase: data.phase,
          duration: data.duration,
        };

        setToolCalls((prev) => {
          const idx = prev.findIndex(t => t.itemId === tc.itemId);
          if (idx >= 0) {
            // 更新已有的
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...tc };
            return updated;
          }
          // 新增
          return [...prev, tc];
        });
        break;
      }

      case 'command_output': {
        const itemId = data.itemId;
        const output = data.output || '';
        const phase = data.phase;

        setCommandOutputs((prev) => {
          const next = new Map(prev);
          const existing = next.get(itemId) || '';
          if (phase === 'delta') {
            next.set(itemId, existing + output);
          } else {
            // end - 可能还有最后的输出
            next.set(itemId, existing + output);
          }
          return next;
        });
        break;
      }

      case 'plan':
        setPlanInfo({
          title: data.title,
          explanation: data.explanation,
          steps: data.steps,
        });
        break;

      case 'step': {
        // 旧模式的步骤事件（CLI 回退时使用）
        // 转换为 tool call 格式显示
        const stepToKind: Record<string, string> = {
          'start': 'lifecycle',
          'agent_start': 'lifecycle',
          'agent_end': 'lifecycle',
          'tool_start': 'tool',
          'tool_end': 'tool',
          'done': 'lifecycle',
        };
        
        if (data.step === 'tool_start' || data.step === 'tool_end') {
          const stepTc: ToolCallInfo = {
            itemId: `step-${data.tool || Date.now()}`,
            kind: stepToKind[data.step] || 'tool',
            name: data.tool || 'tool',
            title: data.text || '',
            status: data.step === 'tool_end' ? 'completed' : 'running',
            phase: data.step === 'tool_start' ? 'start' : 'end',
          };

          setToolCalls((prev) => {
            if (data.step === 'tool_end') {
              // 更新最后一个同名的
              let lastIdx = -1;
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].name === stepTc.name) { lastIdx = i; break; }
              }
              if (lastIdx >= 0) {
                const updated = [...prev];
                updated[lastIdx] = { ...updated[lastIdx], status: 'completed', phase: 'end' };
                return updated;
              }
            }
            return [...prev, stepTc];
          });
        }
        break;
      }

      case 'delegation_start':
        setDelegationState({ active: true, progress: [], results: [] });
        break;

      case 'delegation_progress':
        setDelegationState(prev => ({
          ...prev,
          progress: [...prev.progress, { from: data.from, to: data.to, task: data.task }],
        }));
        break;

      case 'delegation_results':
        setDelegationState(prev => ({
          ...prev,
          results: data.delegations || [],
          active: false,
        }));
        break;

      case 'error':
        console.error('WebSocket error message:', data.error);
        setIsStreaming(false);
        setToolCalls([]);
        break;
    }
  }, [agentId]);

  const sendMessage = useCallback((content: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'chat', content }));
      
      // 乐观更新用户消息
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        agentId: agentId || '',
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }
  }, [agentId]);

  const clearMessages = useCallback(async () => {
    setMessages([]);
    setSkillCalls([]);
    setToolCalls([]);
    setCommandOutputs(new Map());
    setPlanInfo(null);
    // 同步清空后端数据库
    if (agentId) {
      try {
        await chatApi.clear(agentId);
      } catch (e) {
        console.error('Failed to clear chat history on server:', e);
      }
    }
  }, [agentId]);

  const clearSkillCalls = useCallback(() => {
    setSkillCalls([]);
  }, []);

  return {
    isConnected,
    messages,
    isStreaming,
    streamContent,
    toolCalls,
    commandOutputs,
    planInfo,
    delegationState,
    skillCalls,
    sendMessage,
    clearMessages,
    clearSkillCalls,
  };
}
