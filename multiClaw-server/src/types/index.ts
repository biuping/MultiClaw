// OpenClaw 类型定义

export interface OpenClawAgent {
  id: string;
  name: string;
  status: 'ready' | 'chatting' | 'error';
  config?: AgentConfig;
}

export interface AgentConfig {
  persona?: string;
  skills?: string[];
  workspace?: string;
  model?: string;
  [key: string]: any;
}

export interface OpenClawSkill {
  id: string;
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  category: string;
  source?: string;
  status?: string;
}

// 平台类型定义

export interface PlatformAgent {
  id: string;
  openclawId: string;
  name: string;
  avatar: string;
  role: string;
  tags: string[];
  status: 'ready' | 'chatting' | 'error';
  persona: string;
  skills: string[];
  workspace: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: 'visible' | 'trusted' | 'subordinate' | 'supervisor';
  rules: RelationRules;
  collaborationCount: number;
  trustScore: number;
  collaborationLog: CollaborationEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface RelationRules {
  taskTypes?: string[];
  requireReport?: boolean;
  timeout?: number;
  keywords?: string[];
}

export interface CollaborationEntry {
  taskId: string;
  task: string;
  result: string;
  timestamp: string;
  success: boolean;
}

export interface DelegationRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  task: string;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    skillCalls?: SkillCall[];
    tokens?: number;
    model?: string;
  };
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  skillType: 'persona' | 'tool' | 'knowledge';
  name: string;
  description?: string;
  source: 'custom' | 'github' | 'local-path';
  sourceUrl?: string;
  version?: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface SkillCall {
  skill: string;
  params: any;
  result: any;
  duration: number;
  timestamp: string;
}

export interface CanvasPosition {
  x: number;
  y: number;
}

export interface AgentNode {
  id: string;
  position: CanvasPosition;
  data: PlatformAgent;
}

// 任务类型
export type TaskType = 'standard' | 'iterative' | 'scheduled';

// 任务状态
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review' | 'revising' | 'accepted' | 'paused' | 'scheduled';

// 定时调度类型
export type ScheduleType = 'once' | 'interval' | 'cron';