export interface Agent {
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

export interface AgentNode {
  id: string;
  position: { x: number; y: number };
  data: Agent;
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

export interface Skill {
  id: string;
  name: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  category: string;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillId: string;
  skillType: 'persona' | 'tool' | 'knowledge';
  name: string;
  description: string;
  source: 'custom' | 'github' | 'local-path';
  sourceUrl?: string;
  version?: string;
  enabled: boolean;
  personaMode: 'on' | 'off';
  installedAt: string;
  updatedAt: string;
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

export interface SkillCall {
  skill: string;
  params: any;
  result: any;
  duration: number;
  timestamp: string;
}

export interface GatewayStatus {
  status: string;
  uptime?: string;
}

// 任务类型
export type TaskType = 'standard' | 'iterative' | 'scheduled';

// 任务状态（含迭代审阅 + 定时任务状态）
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review' | 'revising' | 'accepted' | 'paused' | 'scheduled';

// 定时调度类型
export type ScheduleType = 'once' | 'interval' | 'cron';

export interface Task {
  id: string;
  title: string;
  description?: string;
  coordinatorId: string;
  coordinatorName?: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  taskType: TaskType;
  reviewerId?: string;
  reviewerName?: string;
  iteration: number;
  reviewComment?: string;
  // 定时任务字段
  scheduleType?: ScheduleType;
  scheduleExpr?: string;
  scheduleIntervalMs?: number;
  scheduleAnchor?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  result?: string;
  metadata?: any;
  guidance?: string;
  restartFromPhase?: string;
  createdAt: string;
  updatedAt: string;
  delegationCount?: number;
  messageCount?: number;
}

export interface TaskReview {
  id: string;
  taskId: string;
  iteration: number;
  reviewerId: string;
  reviewerName?: string;
  comment: string;
  status: 'approve' | 'revise' | 'pause';
  createdAt: string;
}