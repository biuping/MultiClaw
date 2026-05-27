import axios from 'axios';
import { Agent, AgentNode, AgentRelation, Skill, AgentSkill, ChatMessage, GatewayStatus, Task, TaskReview } from '../types';

// ========== API Key 管理 ==========
const API_KEY_STORAGE = 'multiclaw_api_key';

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE);
}

export async function verifyApiKey(key: string): Promise<boolean> {
  try {
    const resp = await fetch('/api/auth/verify', {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    const data = await resp.json();
    return data.success === true;
  } catch {
    return false;
  }
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：自动附加 API Key
api.interceptors.request.use((config) => {
  const key = getApiKey();
  if (key) {
    config.headers.Authorization = `Bearer ${key}`;
  }
  return config;
});

// 响应拦截器：处理 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // 触发全局事件，让 App 层处理认证弹窗
      window.dispatchEvent(new CustomEvent('multiclaw:auth-required'));
    }
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Agent API
export const agentApi = {
  getAll: () => api.get<{ success: boolean; data: Agent[] }>('/agents'),
  getById: (id: string) => api.get<{ success: boolean; data: Agent }>(`/agents/${id}`),
  create: (data: Partial<Agent>) => api.post<{ success: boolean; data: Agent }>('/agents', data),
  update: (id: string, data: Partial<Agent>) => api.put<{ success: boolean; data: Agent }>(`/agents/${id}`, data),
  delete: (id: string) => api.delete<{ success: boolean }>(`/agents/${id}`),
  getNodes: () => api.get<{ success: boolean; data: AgentNode[] }>('/agents/nodes/all'),
  updatePosition: (id: string, x: number, y: number) => 
    api.put<{ success: boolean }>(`/agents/${id}/position`, { x, y }),
  sync: () => api.post<{ success: boolean; data: any }>('/agents/sync'),
  getAvailableModels: () => api.get<{ success: boolean; data: {id: string, alias?: string}[] }>('/agents/models/available'),
};

// Relation API
export const relationApi = {
  getAll: () => api.get<{ success: boolean; data: AgentRelation[] }>('/relations'),
  create: (data: Partial<AgentRelation>) => api.post<{ success: boolean; data: AgentRelation }>('/relations', data),
  update: (id: string, data: Partial<AgentRelation>) => api.put<{ success: boolean; data: AgentRelation }>(`/relations/${id}`, data),
  delete: (id: string) => api.delete<{ success: boolean }>(`/relations/${id}`),
  getByAgent: (agentId: string) => api.get<{ success: boolean; data: { incoming: AgentRelation[]; outgoing: AgentRelation[] } }>(`/relations/agent/${agentId}`),
  apply: () => api.post<{ success: boolean; data: any }>('/relations/apply'),
};

// Skill API
export const skillApi = {
  getAll: () => api.get<{ success: boolean; data: Skill[] }>('/skills'),
  getById: (id: string) => api.get<{ success: boolean; data: Skill }>(`/skills/${id}`),
};

// Agent Skill API (私有技能)
export const agentSkillApi = {
  getAll: (agentId: string) => api.get<{ success: boolean; data: AgentSkill[] }>(`/agents/${agentId}/skills`),
  getOne: (agentId: string, skillId: string) => api.get<{ success: boolean; data: AgentSkill }>(`/agents/${agentId}/skills/${skillId}`),
  install: (agentId: string, data: {
    source: 'local-path' | 'github' | 'custom';
    path?: string;
    url?: string;
    skillId?: string;
    name?: string;
    description?: string;
    skillType?: AgentSkill['skillType'];
    content?: string;
  }) => api.post<{ success: boolean; data: AgentSkill }>(`/agents/${agentId}/skills`, data),
  toggle: (agentId: string, skillId: string, enabled: boolean) =>
    api.put<{ success: boolean; data: AgentSkill }>(`/agents/${agentId}/skills/${skillId}`, { enabled }),
  setPersonaMode: (agentId: string, skillId: string, personaMode: 'on' | 'off') =>
    api.put<{ success: boolean; data: AgentSkill }>(`/agents/${agentId}/skills/${skillId}`, { personaMode }),
  uninstall: (agentId: string, skillId: string) =>
    api.delete<{ success: boolean }>(`/agents/${agentId}/skills/${skillId}`),
  refresh: (agentId: string, skillId: string) =>
    api.post<{ success: boolean; data: AgentSkill }>(`/agents/${agentId}/skills/${skillId}/refresh`),
};

// Gateway API
export const gatewayApi = {
  getStatus: () => api.get<{ success: boolean; data: GatewayStatus }>('/gateway/status'),
  restart: () => api.post<{ success: boolean }>('/gateway/restart'),
  getConfig: () => api.get<{ success: boolean; data: any }>('/gateway/config'),
  updateConfig: (config: any) => api.put<{ success: boolean }>('/gateway/config', config),
};

// Chat API
export const chatApi = {
  getMessages: (agentId: string, limit?: number) => 
    api.get<{ success: boolean; data: ChatMessage[] }>(`/chat/${agentId}`, { params: { limit } }),
  sendMessage: (agentId: string, message: string) => 
    api.post<{ success: boolean; data: ChatMessage }>(`/chat/${agentId}`, { message }),
  clear: (agentId: string) => api.delete<{ success: boolean }>(`/chat/${agentId}`),
};

// Task API
export const taskApi = {
  getAll: (params?: { status?: string; coordinatorId?: string; taskType?: string }) => 
    api.get<{ success: boolean; data: Task[] }>('/tasks', { params }),
  getById: (id: string) => 
    api.get<{ success: boolean; data: Task }>(`/tasks/${id}`),
  create: (data: { title: string; description?: string; coordinatorId: string; priority?: string; taskType?: 'standard' | 'iterative' | 'scheduled'; reviewerId?: string; scheduleType?: 'once' | 'interval' | 'cron'; scheduleExpr?: string; scheduleIntervalMs?: number; scheduleAnchor?: string }) => 
    api.post<{ success: boolean; data: Task }>('/tasks', data),
  update: (id: string, data: any) => 
    api.put<{ success: boolean; data: Task }>(`/tasks/${id}`, data),
  delete: (id: string) => 
    api.delete<{ success: boolean }>(`/tasks/${id}`),
  execute: (id: string, mode: 'restart' | 'resume' | 'restart-from-phase' = 'restart', options?: { guidance?: string; restartFromPhase?: string }) => 
    api.post<{ success: boolean; data: any }>(`/tasks/${id}/execute`, { mode, ...options }),
  getCheckpoint: (id: string) => 
    api.get<{ success: boolean; data: any }>(`/tasks/${id}/checkpoint`),
  getMessages: (id: string) => 
    api.get<{ success: boolean; data: any[] }>(`/tasks/${id}/messages`),
  // 迭代审阅 API
  getReviews: (id: string) => 
    api.get<{ success: boolean; data: TaskReview[] }>(`/tasks/${id}/reviews`),
  submitReview: (id: string, data: { reviewerId: string; comment: string; action: 'approve' | 'revise' | 'pause' }) => 
    api.post<{ success: boolean; data: Task }>(`/tasks/${id}/review`, data),
  submitForReview: (id: string, data: { result: string }) => 
    api.post<{ success: boolean; data: Task }>(`/tasks/${id}/submit-for-review`, data),
  // 定时任务 API
  trigger: (id: string) => 
    api.post<{ success: boolean; message: string }>(`/tasks/${id}/trigger`),
  pauseSchedule: (id: string) => 
    api.post<{ success: boolean; data: Task }>(`/tasks/${id}/pause-schedule`),
  resumeSchedule: (id: string) => 
    api.post<{ success: boolean; data: Task }>(`/tasks/${id}/resume-schedule`),
};

export default api;