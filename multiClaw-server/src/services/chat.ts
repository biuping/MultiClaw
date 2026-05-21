import { getDb } from '../db';
import { ChatMessage, SkillCall } from '../types';
import { v4 as uuidv4 } from 'uuid';

class ChatService {
  // 获取聊天记录
  async getMessages(agentId: string, limit: number = 100): Promise<ChatMessage[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT * FROM chat_messages 
       WHERE agent_id = ? 
       ORDER BY timestamp DESC 
       LIMIT ?`,
      [agentId, limit]
    );
    return rows.reverse().map(this.rowToMessage);
  }

  // 添加消息
  async addMessage(agentId: string, role: ChatMessage['role'], content: string, metadata?: any): Promise<ChatMessage> {
    const db = await getDb();
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    
    await db.runAsync(
      `INSERT INTO chat_messages (id, agent_id, role, content, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, agentId, role, content, metadata ? JSON.stringify(metadata) : null, timestamp]
    );

    return {
      id,
      agentId,
      role,
      content,
      timestamp,
      metadata
    };
  }

  // 清空聊天记录
  async clearMessages(agentId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM chat_messages WHERE agent_id = ?', [agentId]);
  }

  // 记录技能调用
  async recordSkillCall(agentId: string, skillCall: SkillCall): Promise<void> {
    const db = await getDb();
    const id = uuidv4();
    
    await db.runAsync(
      `INSERT INTO chat_messages (id, agent_id, role, content, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        agentId,
        'system',
        `Skill called: ${skillCall.skill}`,
        JSON.stringify({ skillCall }),
        skillCall.timestamp
      ]
    );
  }

  // 获取技能调用记录
  async getSkillCalls(agentId: string, limit: number = 50): Promise<SkillCall[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      `SELECT metadata FROM chat_messages 
       WHERE agent_id = ? AND role = 'system' AND metadata LIKE '%skillCall%'
       ORDER BY timestamp DESC 
       LIMIT ?`,
      [agentId, limit]
    );
    
    const skillCalls: SkillCall[] = [];
    for (const row of rows) {
      try {
        const metadata = JSON.parse(row.metadata);
        if (metadata.skillCall) {
          skillCalls.push(metadata.skillCall);
        }
      } catch (e) {
        console.error('Failed to parse skill call:', e);
      }
    }
    return skillCalls.reverse();
  }

  // 辅助方法
  private rowToMessage(row: any): ChatMessage {
    return {
      id: row.id,
      agentId: row.agent_id,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }
}

export const chatService = new ChatService();
