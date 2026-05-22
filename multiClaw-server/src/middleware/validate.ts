import { z, ZodType } from 'zod';

// ========== Agent Schemas ==========

export const createAgentSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(50, '名称不能超过50字'),
  persona: z.string().max(2000, '性格描述不能超过2000字').optional(),
  skills: z.array(z.string()).optional(),
  workspace: z.string().optional(),
  role: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
  model: z.string().optional(),
  createInOpenClaw: z.boolean().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  persona: z.string().max(2000).optional(),
  skills: z.array(z.string()).optional(),
  workspace: z.string().optional(),
  role: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
  avatar: z.string().optional(),
  status: z.enum({
    ready: 'ready',
    chatting: 'chatting',
    error: 'error',
  }).optional(),
  model: z.string().optional(),
});

// ========== Relation Schemas ==========

export const createRelationSchema = z.object({
  sourceId: z.string().min(1, '来源 Agent 不能为空'),
  targetId: z.string().min(1, '目标 Agent 不能为空'),
  relationType: z.enum({
    visible: 'visible',
    trusted: 'trusted',
    subordinate: 'subordinate',
    supervisor: 'supervisor',
  }),
  rules: z.object({
    taskTypes: z.array(z.string()).optional(),
    requireReport: z.boolean().optional(),
    timeout: z.number().min(0).optional(),
    keywords: z.array(z.string()).optional(),
  }).optional(),
});

export const updateRelationSchema = z.object({
  relationType: z.enum({
    visible: 'visible',
    trusted: 'trusted',
    subordinate: 'subordinate',
    supervisor: 'supervisor',
  }).optional(),
  rules: z.object({
    taskTypes: z.array(z.string()).optional(),
    requireReport: z.boolean().optional(),
    timeout: z.number().min(0).optional(),
    keywords: z.array(z.string()).optional(),
  }).optional(),
});

// ========== Task Schemas ==========

export const createTaskSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200, '标题不能超过200字'),
  description: z.string().max(2000, '描述不能超过2000字').optional(),
  coordinatorId: z.string().min(1, '协调者不能为空'),
  priority: z.enum({
    low: 'low',
    medium: 'medium',
    high: 'high',
  }).optional(),
  taskType: z.enum({
    standard: 'standard',
    iterative: 'iterative',
    scheduled: 'scheduled',
  }).optional(),
  reviewerId: z.string().optional(),
  // 定时任务字段
  scheduleType: z.enum({
    once: 'once',
    interval: 'interval',
    cron: 'cron',
  }).optional(),
  scheduleExpr: z.string().max(200).optional(),
  scheduleIntervalMs: z.number().int().min(60000).optional(), // 最少1分钟
  scheduleAnchor: z.string().optional(), // ISO 时间戳
  metadata: z.record(z.string(), z.any()).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum({
    pending: 'pending',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    review: 'review',
    revising: 'revising',
    accepted: 'accepted',
    paused: 'paused',
    scheduled: 'scheduled',
  }).optional(),
  priority: z.enum({
    low: 'low',
    medium: 'medium',
    high: 'high',
  }).optional(),
  result: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  taskType: z.enum({
    standard: 'standard',
    iterative: 'iterative',
    scheduled: 'scheduled',
  }).optional(),
  reviewerId: z.string().optional(),
  iteration: z.number().int().min(1).optional(),
  reviewComment: z.string().optional(),
  // 定时任务字段
  scheduleType: z.enum({
    once: 'once',
    interval: 'interval',
    cron: 'cron',
  }).optional(),
  scheduleExpr: z.string().max(200).optional(),
  scheduleIntervalMs: z.number().int().min(60000).optional(),
  scheduleAnchor: z.string().optional(),
  nextRunAt: z.string().optional(),
  lastRunAt: z.string().optional(),
  runCount: z.number().int().min(0).optional(),
});

// ========== Chat Schema ==========

export const sendMessageSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(10000, '消息不能超过10000字'),
});

// ========== Team Dispatch Schema ==========

export const teamDispatchSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(5000),
  coordinatorId: z.string().min(1, '协调者不能为空'),
});

// ========== Helper ==========

import { Request, Response, NextFunction } from 'express';

/**
 * Zod 验证中间件工厂
 * 用法: validateBody(createAgentSchema)
 */
export function validateBody(schema: ZodType<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((i: any) => i.path.join('.') + ': ' + i.message).join('; ');
      res.status(400).json({ success: false, error: '参数校验失败: ' + errors });
      return;
    }
    req.body = result.data;
    next();
  };
}
