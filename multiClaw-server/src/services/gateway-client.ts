import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

/**
 * OpenClaw Gateway WebSocket 客户端
 * 
 * 连接到 OpenClaw Gateway 的 WS 端点，完成认证后：
 * - 通过 sessions_send 发送消息给 Agent
 * - 实时接收 agent 事件（流式文本、tool call、命令输出等）
 */
export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connectNonce: string = '';
  private connectSent: boolean = false;
  private pending: Map<string, {
    resolve: (value: any) => void;
    reject: (err: Error) => void;
    timeout: NodeJS.Timeout | null;
  }> = new Map();
  private requestTimeoutMs: number = 300000; // 5 min for agent requests
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastSeq: number | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly clientName: string = 'multiclaw-server',
    private readonly clientDisplayName: string = 'MultiClaw Server',
  ) {
    super();
  }

  /** 连接到 Gateway */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      // Gateway 在 LAN 模式下接受 Bearer token
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      this.ws = new WebSocket(this.url, { 
        headers: {
          ...headers,
          // Gateway requires a valid Origin for Control UI clients to get operator.write scope
          Origin: `http://localhost:${new URL(this.url).port || '18789'}`,
        }
      });
      this.connectSent = false;
      this.connectNonce = '';

      this.ws.on('open', () => {
        console.log('[GatewayClient] WS 连接已建立，等待 challenge...');
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg, resolve, reject);
        } catch (e) {
          console.warn('[GatewayClient] 解析消息失败:', e);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[GatewayClient] 连接关闭: code=${code} reason=${reason.toString()}`);
        this.emit('close', code, reason.toString());
        this.rejectAllPending(new Error(`Gateway connection closed: ${code}`));
        // 自动重连
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[GatewayClient] WS 错误:', err.message);
        this.emit('error', err);
        reject(err);
      });

      // 连接超时
      setTimeout(() => {
        if (!this.connectSent) {
          reject(new Error('Gateway connect timeout'));
        }
      }, 10000);
    });
  }

  /** 创建 session，返回 sessionKey */
  async sessionsCreate(params: {
    key?: string;
    agentId?: string;
    model?: string;
    task?: string;
    message?: string;
  }): Promise<{ key: string; sessionId: string }> {
    return await this.request('sessions.create', {
      ...(params.key ? { key: params.key } : {}),
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.task ? { task: params.task } : {}),
      ...(params.message ? { message: params.message } : {}),
    }, { timeoutMs: 30000 });
  }

  /** 发送消息给 Agent session，返回 runId */
  async sessionsSend(params: {
    key: string;
    message: string;
    thinking?: string;
  }): Promise<string> {
    const result = await this.request('sessions.send', {
      key: params.key,
      message: params.message,
      ...(params.thinking ? { thinking: params.thinking } : {}),
    }, { timeoutMs: 300000 }); // 5 min

    return result?.runId || '';
  }

  /** 订阅 session 消息事件（流式输出）*/
  async sessionsMessagesSubscribe(key: string): Promise<void> {
    await this.request('sessions.messages.subscribe', { key }, { timeoutMs: 10000 });
  }

  /** 取消订阅 session 消息事件 */
  async sessionsMessagesUnsubscribe(key: string): Promise<void> {
    await this.request('sessions.messages.unsubscribe', { key }, { timeoutMs: 10000 });
  }

  /** 请求 session 列表 */
  async sessionsList(): Promise<any[]> {
    const result = await this.request('sessions.list', {});
    return result?.sessions || result || [];
  }

  /** 获取 session 历史 */
  async sessionsResolve(key: string): Promise<any> {
    return await this.request('sessions.resolve', { key }, { timeoutMs: 10000 });
  }

  /** 中止 session 运行 */
  async sessionsAbort(key: string, runId?: string): Promise<void> {
    await this.request('sessions.abort', {
      key,
      ...(runId ? { runId } : {}),
    }, { timeoutMs: 10000 });
  }

  /** 断开连接 */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.connectSent;
  }

  // ==================== 内部方法 ====================

  private handleMessage(msg: any, connectResolve?: (value: void) => void, connectReject?: (err: Error) => void): void {
    // 事件帧
    if (msg.type === 'event') {
      if (msg.event === 'connect.challenge') {
        this.handleChallenge(msg, connectResolve, connectReject);
        return;
      }

      // 更新 seq
      if (typeof msg.seq === 'number') {
        this.lastSeq = msg.seq;
      }

      // 转发所有非 tick 事件
      if (msg.event !== 'tick') {
        this.emit('event', msg);
      }
      return;
    }

    // 响应帧
    if (msg.type === 'res') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;

      this.pending.delete(msg.id);
      if (pending.timeout) clearTimeout(pending.timeout);

      if (msg.ok) {
        pending.resolve(msg.payload);
      } else {
        const err = msg.error || {};
        pending.reject(new Error(`Gateway error [${err.code}]: ${err.message}`));
      }
      return;
    }
  }

  private handleChallenge(msg: any, resolve?: (value: void) => void, reject?: (err: Error) => void): void {
    const nonce = msg.payload?.nonce;
    if (!nonce) {
      reject?.(new Error('Challenge missing nonce'));
      return;
    }

    this.connectNonce = nonce;

    if (this.connectSent) return;
    this.connectSent = true;

    // 发送 connect 请求
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        displayName: this.clientDisplayName,
        version: '1.0.0',
        platform: 'darwin',
        mode: 'backend',
      },
      auth: {
        token: this.token,
      },
      role: 'operator',
      scopes: ['operator.admin'],
      caps: ['tool-events'],
    };

    this.request('connect', params, { timeoutMs: 10000 })
      .then((helloOk) => {
        console.log('[GatewayClient] 认证成功:', helloOk?.auth?.role || 'ok');
        this.emit('connected');
        resolve?.();
      })
      .catch((err) => {
        console.error('[GatewayClient] 认证失败:', err.message);
        reject?.(err);
        this.ws?.close(1008, 'connect failed');
      });
  }

  private request(method: string, params: any, opts?: { timeoutMs?: number | null }): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }

      const id = randomUUID();
      const frame = {
        type: 'req',
        id,
        method,
        params,
      };

      const timeoutMs = opts?.timeoutMs === null ? null : opts?.timeoutMs ?? this.requestTimeoutMs;
      const timeout = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`Gateway request timeout for ${method}`));
          }, timeoutMs)
        : null;

      this.pending.set(id, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[GatewayClient] 尝试重连...');
      this.connect().catch((e) => {
        console.warn('[GatewayClient] 重连失败:', e.message);
      });
    }, 5000);
  }
}

// 单例
let gatewayClient: GatewayClient | null = null;

export async function getGatewayClient(): Promise<GatewayClient> {
  if (gatewayClient?.isConnected) return gatewayClient;

  // 读取 Gateway 配置
  const fs = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  
  let port = 18789;
  let token = '';
  
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    port = config.gateway?.port || 18789;
    token = config.gateway?.auth?.token || '';
  } catch (e) {
    console.warn('[GatewayClient] 读取配置失败，使用默认值');
  }

  const url = `ws://localhost:${port}/ws`;
  console.log(`[GatewayClient] 连接 ${url}`);

  gatewayClient = new GatewayClient(url, token);
  await gatewayClient.connect();

  return gatewayClient;
}
