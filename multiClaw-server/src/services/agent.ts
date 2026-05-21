import { getDb } from '../db';
import { PlatformAgent, AgentNode, AgentRelation, CollaborationEntry, DelegationRecord, AgentSkill } from '../types';
import { v4 as uuidv4 } from 'uuid';

class AgentService {
  // 获取所有 Agent
  async getAllAgents(): Promise<PlatformAgent[]> {
    const db = await getDb();
    const rows = await db.allAsync('SELECT * FROM agents ORDER BY created_at DESC');
    return rows.map(this.rowToAgent);
  }

  // 获取单个 Agent
  async getAgent(id: string): Promise<PlatformAgent | null> {
    const db = await getDb();
    const row = await db.getAsync('SELECT * FROM agents WHERE id = ?', [id]);
    return row ? this.rowToAgent(row) : null;
  }

  // 通过 OpenClaw ID 获取 Agent
  async getAgentByOpenClawId(openclawId: string): Promise<PlatformAgent | null> {
    const db = await getDb();
    const row = await db.getAsync('SELECT * FROM agents WHERE openclaw_id = ?', [openclawId]);
    return row ? this.rowToAgent(row) : null;
  }

  // 创建 Agent
  async createAgent(data: Partial<PlatformAgent>): Promise<PlatformAgent> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO agents (id, openclaw_id, name, avatar, role, tags, status, persona, skills, workspace, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.openclawId || id,
        data.name || 'New Agent',
        data.avatar || '',
        data.role || '',
        JSON.stringify(data.tags || []),
        data.status || 'ready',
        data.persona || '',
        JSON.stringify(data.skills || []),
        data.workspace || '',
        data.model || 'default',
        now,
        now
      ]
    );

    // 初始化位置
    await db.runAsync(
      'INSERT INTO agent_positions (agent_id, x, y) VALUES (?, ?, ?)',
      [id, Math.random() * 400, Math.random() * 300]
    );

    return this.getAgent(id) as Promise<PlatformAgent>;
  }

  // 更新 Agent
  async updateAgent(id: string, data: Partial<PlatformAgent>): Promise<PlatformAgent | null> {
    const db = await getDb();
    const now = new Date().toISOString();
    
    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.avatar !== undefined) {
      updates.push('avatar = ?');
      values.push(data.avatar);
    }
    if (data.role !== undefined) {
      updates.push('role = ?');
      values.push(data.role);
    }
    if (data.tags !== undefined) {
      updates.push('tags = ?');
      values.push(JSON.stringify(data.tags));
    }
    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.persona !== undefined) {
      updates.push('persona = ?');
      values.push(data.persona);
    }
    if (data.skills !== undefined) {
      updates.push('skills = ?');
      values.push(JSON.stringify(data.skills));
    }
    if (data.workspace !== undefined) {
      updates.push('workspace = ?');
      values.push(data.workspace);
    }
    if (data.model !== undefined) {
      updates.push('model = ?');
      values.push(data.model);
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.runAsync(
      `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    return this.getAgent(id);
  }

  // 删除 Agent
  async deleteAgent(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM agent_skills WHERE agent_id = ?', [id]);
    await db.runAsync('DELETE FROM agent_relations WHERE source_id = ? OR target_id = ?', [id, id]);
    await db.runAsync('DELETE FROM agent_positions WHERE agent_id = ?', [id]);
    await db.runAsync('DELETE FROM chat_messages WHERE agent_id = ?', [id]);
    await db.runAsync('DELETE FROM agents WHERE id = ?', [id]);
  }

  // 更新 Agent 状态
  async updateAgentStatus(id: string, status: PlatformAgent['status']): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
      [status, new Date().toISOString(), id]
    );
  }

  // 获取所有 Agent 节点（带位置）
  async getAgentNodes(): Promise<AgentNode[]> {
    const db = await getDb();
    const rows = await db.allAsync(`
      SELECT a.*, p.x, p.y 
      FROM agents a 
      LEFT JOIN agent_positions p ON a.id = p.agent_id
    `);
    
    return rows.map(row => ({
      id: row.id,
      position: {
        x: row.x || 0,
        y: row.y || 0
      },
      data: this.rowToAgent(row)
    }));
  }

  // 更新 Agent 位置
  async updateAgentPosition(agentId: string, x: number, y: number): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO agent_positions (agent_id, x, y, updated_at) VALUES (?, ?, ?, ?)`,
      [agentId, x, y, new Date().toISOString()]
    );
  }

  // 创建关系
  async createRelation(data: Partial<AgentRelation>): Promise<AgentRelation> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO agent_relations (id, source_id, target_id, relation_type, rules, collaboration_count, trust_score, collaboration_log, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, '[]', ?, ?)`,
      [
        id,
        data.sourceId,
        data.targetId,
        data.relationType || 'visible',
        JSON.stringify(data.rules || {}),
        now,
        now
      ]
    );

    return this.getRelation(id) as Promise<AgentRelation>;
  }

  // 获取关系
  async getRelation(id: string): Promise<AgentRelation | null> {
    const db = await getDb();
    const row = await db.getAsync('SELECT * FROM agent_relations WHERE id = ?', [id]);
    return row ? this.rowToRelation(row) : null;
  }

  // 获取所有关系
  async getAllRelations(): Promise<AgentRelation[]> {
    const db = await getDb();
    const rows = await db.allAsync('SELECT * FROM agent_relations');
    return rows.map(this.rowToRelation);
  }

  // 获取 Agent 可见的其他 Agent（从 source 出发的关系）
  async getVisibleAgents(agentId: string): Promise<PlatformAgent[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT a.* FROM agents a
       INNER JOIN agent_relations r ON r.target_id = a.id
       WHERE r.source_id = ?
       ORDER BY r.trust_score DESC, r.collaboration_count DESC`,
      [agentId]
    );
    return rows.map(this.rowToAgent);
  }

  // 记录一次协作，更新关系
  async recordCollaboration(sourceId: string, targetId: string, entry: CollaborationEntry): Promise<void> {
    const db = await getDb();
    const now = new Date().toISOString();
    
    // 获取当前关系
    const row = await db.getAsync(
      'SELECT * FROM agent_relations WHERE source_id = ? AND target_id = ?',
      [sourceId, targetId]
    );
    
    if (!row) return; // 没有关系则忽略
    
    const log: CollaborationEntry[] = JSON.parse(row.collaboration_log || '[]');
    log.push(entry);
    // 只保留最近 50 条
    const trimmedLog = log.slice(-50);
    
    const newCount = (row.collaboration_count || 0) + 1;
    // 信任分计算：成功 +0.1，失败 -0.2，上限 10，下限 0
    const successDelta = entry.success ? 0.1 : -0.2;
    const newTrust = Math.max(0, Math.min(10, (row.trust_score || 0) + successDelta));
    
    // 自动升级关系类型：信任分 >= 5 且协作 >= 5 次，visible → trusted
    let newType = row.relation_type;
    if (newType === 'visible' && newTrust >= 5 && newCount >= 5) {
      newType = 'trusted';
    }
    
    await db.runAsync(
      `UPDATE agent_relations 
       SET collaboration_count = ?, trust_score = ?, collaboration_log = ?, relation_type = ?, updated_at = ?
       WHERE source_id = ? AND target_id = ?`,
      [newCount, newTrust, JSON.stringify(trimmedLog), newType, now, sourceId, targetId]
    );
  }

  // 记录委派任务
  async createDelegationRecord(fromAgentId: string, toAgentId: string, task: string): Promise<DelegationRecord> {
    const db = await getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO delegation_records (id, from_agent_id, to_agent_id, task, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [id, fromAgentId, toAgentId, task, now]
    );
    
    return {
      id,
      fromAgentId,
      toAgentId,
      task,
      status: 'pending',
      createdAt: now,
    };
  }

  // 更新委派任务结果
  async updateDelegationRecord(id: string, result: string, status: DelegationRecord['status']): Promise<void> {
    const db = await getDb();
    const now = status === 'completed' || status === 'failed' ? new Date().toISOString() : undefined;
    
    await db.runAsync(
      `UPDATE delegation_records SET result = ?, status = ?, completed_at = COALESCE(?, completed_at)
       WHERE id = ?`,
      [result, status, now || null, id]
    );
  }

  // 获取 Agent 的委派记录
  async getDelegationRecords(agentId: string, limit: number = 20): Promise<DelegationRecord[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT * FROM delegation_records 
       WHERE from_agent_id = ? OR to_agent_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [agentId, agentId, limit]
    );
    return rows.map(this.rowToDelegation);
  }

  // 更新关系
  async updateRelation(id: string, data: Partial<AgentRelation>): Promise<AgentRelation | null> {
    const db = await getDb();
    const now = new Date().toISOString();
    
    if (data.rules !== undefined) {
      await db.runAsync(
        'UPDATE agent_relations SET rules = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(data.rules), now, id]
      );
    }
    
    if (data.relationType !== undefined) {
      await db.runAsync(
        'UPDATE agent_relations SET relation_type = ?, updated_at = ? WHERE id = ?',
        [data.relationType, now, id]
      );
    }

    return this.getRelation(id);
  }

  // 删除关系
  async deleteRelation(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM agent_relations WHERE id = ?', [id]);
  }

  // 辅助方法
  private rowToAgent(row: any): PlatformAgent {
    return {
      id: row.id,
      openclawId: row.openclaw_id,
      name: row.name,
      avatar: row.avatar,
      role: row.role,
      tags: JSON.parse(row.tags || '[]'),
      status: row.status,
      persona: row.persona,
      skills: JSON.parse(row.skills || '[]'),
      workspace: row.workspace,
      model: row.model || 'default',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private rowToRelation(row: any): AgentRelation {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationType: row.relation_type,
      rules: JSON.parse(row.rules || '{}'),
      collaborationCount: row.collaboration_count || 0,
      trustScore: row.trust_score || 0,
      collaborationLog: JSON.parse(row.collaboration_log || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
    };
  }

  private rowToDelegation(row: any): DelegationRecord {
    return {
      id: row.id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      task: row.task,
      result: row.result,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}

export const agentService = new AgentService();