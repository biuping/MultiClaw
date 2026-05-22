import { getDb } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface Task {
  id: string;
  title: string;
  description: string;
  coordinatorId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review' | 'revising' | 'accepted' | 'paused' | 'scheduled';
  priority: 'low' | 'medium' | 'high';
  taskType: 'standard' | 'iterative' | 'scheduled';
  reviewerId?: string;
  iteration: number;
  reviewComment?: string;
  // 定时任务字段
  scheduleType?: 'once' | 'interval' | 'cron';
  scheduleExpr?: string;
  scheduleIntervalMs?: number;
  scheduleAnchor?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  result?: string;
  metadata: any;
  checkpoint?: string | null;
  guidance?: string | null;
  restartFromPhase?: string | null;
  createdAt: string;
  updatedAt: string;
  // 关联信息（查询时填充）
  coordinatorName?: string;
  reviewerName?: string;
  delegationCount?: number;
  messageCount?: number;
}

class TaskService {
  async create(data: Partial<Task>): Promise<Task> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    // 定时任务：计算首次执行时间
    let nextRunAt: string | null = null;
    if (data.taskType === 'scheduled') {
      if (data.scheduleAnchor) {
        nextRunAt = data.scheduleAnchor;
      } else if (data.scheduleType === 'interval' && data.scheduleIntervalMs) {
        nextRunAt = now;
      } else if (data.scheduleType === 'cron' && data.scheduleExpr) {
        nextRunAt = computeNextCronRun(data.scheduleExpr, new Date());
      }
    }

    const status = data.taskType === 'scheduled' ? 'scheduled' : (data.status || 'pending');

    await db.runAsync(
      `INSERT INTO tasks (id, title, description, coordinator_id, status, priority, task_type, reviewer_id, iteration,
        schedule_type, schedule_expr, schedule_interval_ms, schedule_anchor, next_run_at, run_count, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.title || '未命名任务',
        data.description || '',
        data.coordinatorId || '',
        status,
        data.priority || 'medium',
        data.taskType || 'standard',
        data.reviewerId || data.coordinatorId || '',
        data.iteration || 1,
        data.scheduleType || null,
        data.scheduleExpr || null,
        data.scheduleIntervalMs || null,
        data.scheduleAnchor || null,
        nextRunAt,
        data.runCount || 0,
        JSON.stringify(data.metadata || {}),
        now,
        now,
      ]
    );

    return this.getById(id) as Promise<Task>;
  }

  async getById(id: string): Promise<Task | null> {
    const db = await getDb();
    const row = await db.getAsync(
      `SELECT t.*, a.name as coordinator_name, r.name as reviewer_name,
        (SELECT COUNT(*) FROM delegation_records d WHERE d.id IN (
          SELECT dr.id FROM delegation_records dr
        )) as delegation_count,
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.task_id = t.id) as message_count
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.coordinator_id
       LEFT JOIN agents r ON r.id = t.reviewer_id
       WHERE t.id = ?`,
      [id]
    );
    return row ? this.rowToTask(row) : null;
  }

  async getAll(filters?: { status?: string; coordinatorId?: string; taskType?: string }): Promise<Task[]> {
    const db = await getDb();
    let sql = `SELECT t.*, a.name as coordinator_name, r.name as reviewer_name,
      (SELECT COUNT(*) FROM delegation_records dr WHERE dr.from_agent_id = t.coordinator_id OR dr.to_agent_id = t.coordinator_id) as delegation_count,
      (SELECT COUNT(*) FROM chat_messages cm WHERE cm.task_id = t.id) as message_count
     FROM tasks t
     LEFT JOIN agents a ON a.id = t.coordinator_id
     LEFT JOIN agents r ON r.id = t.reviewer_id`;
    
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (filters?.status) {
      conditions.push('t.status = ?');
      params.push(filters.status);
    }
    if (filters?.coordinatorId) {
      conditions.push('t.coordinator_id = ?');
      params.push(filters.coordinatorId);
    }
    if (filters?.taskType) {
      conditions.push('t.task_type = ?');
      params.push(filters.taskType);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY t.created_at DESC';
    
    const rows = await db.allAsync(sql, params);
    return rows.map(this.rowToTask);
  }

  async update(id: string, data: Partial<Task>): Promise<Task | null> {
    const db = await getDb();
    const now = new Date().toISOString();
    
    const updates: string[] = [];
    const values: any[] = [];

    if (data.title !== undefined) { updates.push('title = ?'); values.push(data.title); }
    if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
    if (data.status !== undefined) { updates.push('status = ?'); values.push(data.status); }
    if (data.priority !== undefined) { updates.push('priority = ?'); values.push(data.priority); }
    if (data.result !== undefined) { updates.push('result = ?'); values.push(data.result); }
    if (data.metadata !== undefined) { updates.push('metadata = ?'); values.push(JSON.stringify(data.metadata)); }
    if (data.guidance !== undefined) { updates.push('guidance = ?'); values.push(data.guidance); }
    if (data.restartFromPhase !== undefined) { updates.push('restart_from_phase = ?'); values.push(data.restartFromPhase); }
    if (data.taskType !== undefined) { updates.push('task_type = ?'); values.push(data.taskType); }
    if (data.reviewerId !== undefined) { updates.push('reviewer_id = ?'); values.push(data.reviewerId); }
    if (data.iteration !== undefined) { updates.push('iteration = ?'); values.push(data.iteration); }
    if (data.reviewComment !== undefined) { updates.push('review_comment = ?'); values.push(data.reviewComment); }
    if (data.scheduleType !== undefined) { updates.push('schedule_type = ?'); values.push(data.scheduleType); }
    if (data.scheduleExpr !== undefined) { updates.push('schedule_expr = ?'); values.push(data.scheduleExpr); }
    if (data.scheduleIntervalMs !== undefined) { updates.push('schedule_interval_ms = ?'); values.push(data.scheduleIntervalMs); }
    if (data.scheduleAnchor !== undefined) { updates.push('schedule_anchor = ?'); values.push(data.scheduleAnchor); }
    if (data.nextRunAt !== undefined) { updates.push('next_run_at = ?'); values.push(data.nextRunAt); }
    if (data.lastRunAt !== undefined) { updates.push('last_run_at = ?'); values.push(data.lastRunAt); }
    if (data.runCount !== undefined) { updates.push('run_count = ?'); values.push(data.runCount); }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.runAsync(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const db = await getDb();
    // 删除关联的消息
    await db.runAsync('DELETE FROM chat_messages WHERE task_id = ?', [id]);
    // 删除关联的委派记录（metadata 中记录的）
    await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  }

  // 获取任务的消息
  async getMessages(taskId: string, limit: number = 100): Promise<any[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT * FROM chat_messages WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [taskId, limit]
    );
    return rows.reverse();
  }

  // 添加任务消息
  async addMessage(taskId: string, agentId: string, role: string, content: string, metadata?: any): Promise<any> {
    const db = await getDb();
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO chat_messages (id, agent_id, task_id, role, content, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, agentId, taskId, role, content, metadata ? JSON.stringify(metadata) : null, timestamp]
    );

    return { id, taskId, agentId, role, content, timestamp, metadata };
  }

  // ========== 迭代审阅相关方法 ==========

  // 添加审阅记录
  async addReview(data: { taskId: string; iteration: number; reviewerId: string; comment: string; status: string }): Promise<any> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO task_reviews (id, task_id, iteration, reviewer_id, comment, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.taskId, data.iteration, data.reviewerId, data.comment, data.status, now]
    );

    return { id, ...data, createdAt: now };
  }

  // 获取任务的审阅记录
  async getReviews(taskId: string): Promise<any[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT tr.*, a.name as reviewer_name
       FROM task_reviews tr
       LEFT JOIN agents a ON a.id = tr.reviewer_id
       WHERE tr.task_id = ?
       ORDER BY tr.iteration ASC, tr.created_at ASC`,
      [taskId]
    );
    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      iteration: row.iteration,
      reviewerId: row.reviewer_id,
      reviewerName: row.reviewer_name,
      comment: row.comment,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  // 提交审阅：审阅人对迭代任务给出反馈
  async submitReview(taskId: string, reviewerId: string, comment: string, action: 'approve' | 'revise' | 'pause'): Promise<Task | null> {
    const task = await this.getById(taskId);
    if (!task) return null;
    if (task.taskType !== 'iterative') {
      throw new Error('只有迭代审阅任务才能提交审阅');
    }

    let newStatus: string;
    let newIteration = task.iteration;

    switch (action) {
      case 'approve':
        newStatus = 'accepted';
        break;
      case 'revise':
        newStatus = 'revising';
        newIteration = task.iteration + 1;
        break;
      case 'pause':
        newStatus = 'paused';
        break;
      default:
        throw new Error('无效的审阅操作: ' + action);
    }

    // 记录审阅
    await this.addReview({
      taskId,
      iteration: task.iteration,
      reviewerId,
      comment,
      status: action,
    });

    // 更新任务
    return this.update(taskId, {
      status: newStatus as any,
      iteration: newIteration,
      reviewComment: comment,
    });
  }

  // 提交迭代交付：执行人完成一轮修改后提交审阅
  async submitForReview(taskId: string, result: string): Promise<Task | null> {
    const task = await this.getById(taskId);
    if (!task) return null;
    if (task.taskType !== 'iterative') {
      throw new Error('只有迭代审阅任务才能提交审阅');
    }

    return this.update(taskId, {
      status: 'review',
      result,
    });
  }

  private rowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      coordinatorId: row.coordinator_id,
      status: row.status,
      priority: row.priority,
      taskType: row.task_type || 'standard',
      reviewerId: row.reviewer_id || row.coordinator_id,
      iteration: row.iteration || 1,
      reviewComment: row.review_comment,
      scheduleType: row.schedule_type,
      scheduleExpr: row.schedule_expr,
      scheduleIntervalMs: row.schedule_interval_ms,
      scheduleAnchor: row.schedule_anchor,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      runCount: row.run_count || 0,
      result: row.result,
      metadata: JSON.parse(row.metadata || '{}'),
      checkpoint: row.checkpoint,
      guidance: row.guidance,
      restartFromPhase: row.restart_from_phase,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      coordinatorName: row.coordinator_name,
      reviewerName: row.reviewer_name || row.coordinator_name,
      delegationCount: row.delegation_count || 0,
      messageCount: row.message_count || 0,
    };
  }
}

export const taskService = new TaskService();

/**
 * 简单的 cron 表达式下一次执行时间计算
 * 支持 5 位标准 cron: 分 时 日 月 周
 * 示例: "0 9 * * 1-5" = 每周一到五 9:00
 */
export function computeNextCronRun(expr: string, from: Date): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('cron 表达式必须是5位: 分 时 日 月 周');
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = parts;

  // 解析 cron 字段为数值数组
  function parseField(field: string, min: number, max: number): number[] {
    const values = new Set<number>();
    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.add(i);
      } else if (part.includes('/')) {
        const [base, step] = part.split('/');
        const stepNum = parseInt(step);
        const start = base === '*' ? min : parseInt(base);
        for (let i = start; i <= max; i += stepNum) values.add(i);
      } else if (part.includes('-')) {
        const [s, e] = part.split('-');
        for (let i = parseInt(s); i <= parseInt(e); i++) values.add(i);
      } else {
        values.add(parseInt(part));
      }
    }
    return [...values].sort((a, b) => a - b);
  }

  const minutes = parseField(minuteField, 0, 59);
  const hours = parseField(hourField, 0, 23);
  const days = parseField(dayField, 1, 31);
  const months = parseField(monthField, 1, 12);
  const weekdays = parseField(weekdayField, 0, 6); // 0=Sunday

  // 从 from+1 分钟开始搜索，最多搜索 2 年
  const start = new Date(from.getTime() + 60000);
  start.setSeconds(0, 0);

  const limit = new Date(from.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);

  // 逐月搜索
  const d = new Date(start);
  while (d < limit) {
    const m = d.getMonth() + 1; // 1-12
    if (!months.includes(m)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }

    const day = d.getDate();
    const wd = d.getDay(); // 0=Sunday
    const dayMatch = days.includes(day);
    const wdMatch = weekdays.includes(wd);
    // 日和周都指定时取并集，只有一方指定时取该方
    const dayOk = (dayField !== '*' && weekdayField !== '*') ? (dayMatch || wdMatch) : (dayMatch && wdMatch);

    if (!dayOk) {
      d.setDate(day + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }

    // 检查时和分
    for (const h of hours) {
      if (h < d.getHours()) continue;
      for (const min of minutes) {
        if (h === d.getHours() && min < d.getMinutes()) continue;
        const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0, 0);
        if (candidate >= start) {
          return candidate.toISOString();
        }
      }
    }

    d.setDate(day + 1);
    d.setHours(0, 0, 0, 0);
  }

  // 找不到则返回 from + 1 天
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 计算定时任务的下次执行时间
 */
export function computeNextRun(task: Task): string | null {
  const now = new Date();

  switch (task.scheduleType) {
    case 'once':
      // 一次性任务：返回设定的锚定时间
      return task.scheduleAnchor || null;

    case 'interval':
      // 间隔执行：从上次执行时间 + interval
      if (!task.scheduleIntervalMs) return null;
      const base = task.lastRunAt ? new Date(task.lastRunAt) : (task.scheduleAnchor ? new Date(task.scheduleAnchor) : now);
      let next = new Date(base.getTime() + task.scheduleIntervalMs);
      // 如果计算出的时间已过，从当前时间计算下一个
      while (next <= now) {
        next = new Date(next.getTime() + task.scheduleIntervalMs);
      }
      return next.toISOString();

    case 'cron':
      // cron 表达式
      if (!task.scheduleExpr) return null;
      return computeNextCronRun(task.scheduleExpr, now);

    default:
      return null;
  }
}
