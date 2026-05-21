import { getDb } from '../db';
import { v4 as uuidv4 } from 'uuid';

export interface Task {
  id: string;
  title: string;
  description: string;
  coordinatorId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'review' | 'revising' | 'accepted' | 'paused';
  priority: 'low' | 'medium' | 'high';
  taskType: 'standard' | 'iterative';
  reviewerId?: string;
  iteration: number;
  reviewComment?: string;
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

    await db.runAsync(
      `INSERT INTO tasks (id, title, description, coordinator_id, status, priority, task_type, reviewer_id, iteration, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.title || '未命名任务',
        data.description || '',
        data.coordinatorId || '',
        data.status || 'pending',
        data.priority || 'medium',
        data.taskType || 'standard',
        data.reviewerId || data.coordinatorId || '',
        data.iteration || 1,
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
