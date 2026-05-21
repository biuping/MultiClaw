import { getDb } from '../db';
import { AgentSkill } from '../types';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import YAML from 'yaml';

const execAsync = promisify(exec);

function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT || path.join(os.homedir(), '.multiclaw', 'workspace');
}

class SkillService {
  // ==================== CRUD ====================

  async getAgentSkills(agentId: string): Promise<AgentSkill[]> {
    const db = await getDb();
    const rows = await db.allAsync(
      'SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY installed_at DESC',
      [agentId]
    );
    return rows.map(this.rowToSkill);
  }

  async getAgentSkill(agentId: string, skillId: string): Promise<AgentSkill | null> {
    const db = await getDb();
    const row = await db.getAsync(
      'SELECT * FROM agent_skills WHERE agent_id = ? AND skill_id = ?',
      [agentId, skillId]
    );
    return row ? this.rowToSkill(row) : null;
  }

  async getSkillById(id: string): Promise<AgentSkill | null> {
    const db = await getDb();
    const row = await db.getAsync('SELECT * FROM agent_skills WHERE id = ?', [id]);
    return row ? this.rowToSkill(row) : null;
  }

  async toggleSkill(agentId: string, skillId: string, enabled: boolean): Promise<AgentSkill | null> {
    const db = await getDb();
    await db.runAsync(
      'UPDATE agent_skills SET enabled = ?, updated_at = ? WHERE agent_id = ? AND skill_id = ?',
      [enabled ? 1 : 0, new Date().toISOString(), agentId, skillId]
    );
    return this.getAgentSkill(agentId, skillId);
  }

  async deleteSkill(agentId: string, skillId: string): Promise<void> {
    // 1. 获取技能记录以找到 agent 信息
    const skill = await this.getAgentSkill(agentId, skillId);
    if (!skill) return;

    // 2. 删除 workspace 中的技能文件
    const agentWorkspace = await this.getAgentWorkspacePath(agentId);
    const skillDir = path.join(agentWorkspace, 'skills', skillId);
    try {
      await fs.rm(skillDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[deleteSkill] 文件删除失败（可能不存在）:', skillDir, e);
    }

    // 3. 删除数据库记录
    const db = await getDb();
    await db.runAsync(
      'DELETE FROM agent_skills WHERE agent_id = ? AND skill_id = ?',
      [agentId, skillId]
    );
  }

  // ==================== 安装 ====================

  /**
   * 从本地路径安装技能
   */
  async installFromLocalPath(
    agentId: string,
    localPath: string,
    options?: { skillType?: AgentSkill['skillType'] }
  ): Promise<AgentSkill> {
    // 1. 验证源路径存在
    const stat = await fs.stat(localPath);
    if (!stat.isDirectory()) {
      throw new Error('路径不是目录: ' + localPath);
    }

    // 2. 读取 SKILL.md 解析元数据
    const skillMdPath = path.join(localPath, 'SKILL.md');
    let metadata: { name: string; description: string; skillId: string };
    try {
      metadata = await this.parseSkillMd(skillMdPath);
    } catch (e) {
      throw new Error('无法解析 SKILL.md: ' + (e instanceof Error ? e.message : String(e)));
    }

    // 3. 复制到 agent workspace
    const agentWorkspace = await this.getAgentWorkspacePath(agentId);
    const targetDir = path.join(agentWorkspace, 'skills', metadata.skillId);
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    // 如果目标已存在，先删除
    try { await fs.rm(targetDir, { recursive: true, force: true }); } catch {}

    await execAsync(`cp -r "${localPath}" "${targetDir}"`);
    // 清理 .git 目录（不需要）
    try { await execAsync(`rm -rf "${path.join(targetDir, '.git')}"`); } catch {}

    // 4. 写入数据库
    return this.upsertSkillRecord({
      agentId,
      skillId: metadata.skillId,
      skillType: options?.skillType || 'persona',
      name: metadata.name,
      description: metadata.description,
      source: 'local-path',
      sourceUrl: localPath,
    });
  }

  /**
   * 从 GitHub URL 安装技能
   */
  async installFromGithub(
    agentId: string,
    githubUrl: string,
    options?: { skillType?: AgentSkill['skillType'] }
  ): Promise<AgentSkill> {
    const tmpDir = path.join(os.tmpdir(), 'multiclaw-skill-install-' + uuidv4());

    try {
      // 1. git clone 到临时目录
      await execAsync(`git clone --depth 1 "${githubUrl}" "${tmpDir}" 2>&1`);

      // 2. 解析 SKILL.md
      const skillMdPath = path.join(tmpDir, 'SKILL.md');
      let metadata: { name: string; description: string; skillId: string };
      try {
        metadata = await this.parseSkillMd(skillMdPath);
      } catch (e) {
        throw new Error('仓库中未找到有效的 SKILL.md: ' + (e instanceof Error ? e.message : String(e)));
      }

      // 3. 复制到 agent workspace
      const agentWorkspace = await this.getAgentWorkspacePath(agentId);
      const targetDir = path.join(agentWorkspace, 'skills', metadata.skillId);
      await fs.mkdir(path.dirname(targetDir), { recursive: true });

      try { await fs.rm(targetDir, { recursive: true, force: true }); } catch {}

      await execAsync(`cp -r "${tmpDir}" "${targetDir}"`);
      try { await execAsync(`rm -rf "${path.join(targetDir, '.git')}"`); } catch {}

      // 4. 写入数据库
      return this.upsertSkillRecord({
        agentId,
        skillId: metadata.skillId,
        skillType: options?.skillType || 'persona',
        name: metadata.name,
        description: metadata.description,
        source: 'github',
        sourceUrl: githubUrl,
      });
    } finally {
      // 清理临时目录
      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  /**
   * 手写自定义技能安装
   */
  async installCustom(
    agentId: string,
    data: {
      skillId: string;
      name: string;
      description?: string;
      skillType?: AgentSkill['skillType'];
      content: string; // SKILL.md 正文
    }
  ): Promise<AgentSkill> {
    const agentWorkspace = await this.getAgentWorkspacePath(agentId);
    const skillDir = path.join(agentWorkspace, 'skills', data.skillId);
    await fs.mkdir(skillDir, { recursive: true });

    // 写入 SKILL.md
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), data.content, 'utf-8');

    return this.upsertSkillRecord({
      agentId,
      skillId: data.skillId,
      skillType: data.skillType || 'persona',
      name: data.name,
      description: data.description || '',
      source: 'custom',
    });
  }

  /**
   * 从源刷新技能内容
   */
  async refreshSkill(agentId: string, skillId: string): Promise<AgentSkill | null> {
    const skill = await this.getAgentSkill(agentId, skillId);
    if (!skill) return null;

    if (skill.source === 'local-path' && skill.sourceUrl) {
      // 从本地路径刷新
      await this.installFromLocalPath(agentId, skill.sourceUrl, { skillType: skill.skillType });
      return this.getAgentSkill(agentId, skillId);
    }

    if (skill.source === 'github' && skill.sourceUrl) {
      // 从 GitHub 刷新
      await this.installFromGithub(agentId, skill.sourceUrl, { skillType: skill.skillType });
      return this.getAgentSkill(agentId, skillId);
    }

    // custom 类型不支持刷新
    return skill;
  }

  // ==================== 内部方法 ====================

  /**
   * 解析 SKILL.md frontmatter 获取元数据
   */
  private async parseSkillMd(skillMdPath: string): Promise<{ name: string; description: string; skillId: string }> {
    const content = await fs.readFile(skillMdPath, 'utf-8');

    // 解析 YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // 没有 frontmatter，用目录名作为 ID
      const dirName = path.basename(path.dirname(skillMdPath));
      return {
        name: dirName,
        description: '',
        skillId: dirName,
      };
    }

    const fm = YAML.parse(frontmatterMatch[1]) || {};
    const skillId = fm.name || path.basename(path.dirname(skillMdPath));
    const description = typeof fm.description === 'string'
      ? fm.description
      : (fm.description?.trim?.() || '');

    return {
      name: fm.name || skillId,
      description,
      skillId,
    };
  }

  /**
   * 获取 Agent 的 workspace 路径，从数据库读取
   */
  private async getAgentWorkspacePath(agentId: string): Promise<string> {
    const db = await getDb();
    const row = await db.getAsync('SELECT name, workspace FROM agents WHERE id = ?', [agentId]);
    if (!row) throw new Error('Agent 不存在: ' + agentId);

    const workspaceRoot = getWorkspaceRoot();
    const agentSlug = (row.name || agentId).toLowerCase().replace(/\s+/g, '-');
    return row.workspace || path.join(workspaceRoot, agentSlug);
  }

  /**
   * 写入或更新 agent_skills 记录
   */
  private async upsertSkillRecord(data: {
    agentId: string;
    skillId: string;
    skillType: AgentSkill['skillType'];
    name: string;
    description: string;
    source: AgentSkill['source'];
    sourceUrl?: string;
    version?: string;
  }): Promise<AgentSkill> {
    const db = await getDb();
    const now = new Date().toISOString();

    // 检查是否已存在
    const existing = await db.getAsync(
      'SELECT id FROM agent_skills WHERE agent_id = ? AND skill_id = ?',
      [data.agentId, data.skillId]
    );

    if (existing) {
      // 更新
      await db.runAsync(
        `UPDATE agent_skills SET name = ?, description = ?, skill_type = ?, source = ?, source_url = ?, version = ?, updated_at = ?
         WHERE agent_id = ? AND skill_id = ?`,
        [data.name, data.description, data.skillType, data.source, data.sourceUrl || null, data.version || null, now, data.agentId, data.skillId]
      );
    } else {
      // 新增
      const id = uuidv4();
      await db.runAsync(
        `INSERT INTO agent_skills (id, agent_id, skill_id, skill_type, name, description, source, source_url, version, enabled, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, data.agentId, data.skillId, data.skillType, data.name, data.description, data.source, data.sourceUrl || null, data.version || null, now, now]
      );
    }

    return this.getAgentSkill(data.agentId, data.skillId) as Promise<AgentSkill>;
  }

  private rowToSkill(row: any): AgentSkill {
    return {
      id: row.id,
      agentId: row.agent_id,
      skillId: row.skill_id,
      skillType: row.skill_type || 'persona',
      name: row.name,
      description: row.description || '',
      source: row.source || 'custom',
      sourceUrl: row.source_url || undefined,
      version: row.version || undefined,
      enabled: row.enabled !== 0,
      installedAt: row.installed_at,
      updatedAt: row.updated_at,
    };
  }
}

export const skillService = new SkillService();
