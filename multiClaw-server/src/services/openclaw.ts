import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { OpenClawAgent, AgentConfig, OpenClawSkill } from '../types';

const execAsync = promisify(exec);

const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_CONFIG_DIR, 'agents');

/**
 * 获取 workspace 根目录（统一入口）
 */
function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT || path.join(os.homedir(), '.multiclaw', 'workspace');
}

// 清理 ANSI 颜色代码
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * MultiClaw Agent 服务 (方案 A - 独立隔离架构)
 * 
 * 核心概念：
 * - MultiClaw 的 Agent 是虚拟实体，存储在本地数据库
 * - 对话时通过 spawn 执行 `openclaw agent` 创建临时执行环境
 * - 完全独立于 OpenClaw 的 Agent 系统
 */
export class OpenClawService {
  // ==================== 技能管理 ====================
  
  async listSkills(): Promise<OpenClawSkill[]> {
    try {
      const { stdout } = await execAsync('openclaw skills list 2>/dev/null');
      console.log('Skills list raw output length:', stdout.length);
      const skills = this.parseSkillsFromTable(stdout);
      if (skills.length > 0) {
        console.log('Parsed ' + skills.length + ' skills from table');
        return skills;
      }
      console.log('No skills parsed from table, using defaults');
      return this.getDefaultSkills();
    } catch (error) {
      console.error('Failed to list skills:', error);
      return this.getDefaultSkills();
    }
  }

  private parseSkillsFromTable(stdout: string): OpenClawSkill[] {
    const skills: OpenClawSkill[] = [];
    const lines = stdout.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.includes('│') || line.includes('Status') || line.includes('Skill') || 
          /^[┌├└─]/.test(line.trim())) {
        i++;
        continue;
      }
      const parts = line.split('│').map(p => p.trim()).filter(p => p);
      if (parts.length >= 4) {
        const statusPart = parts[0];
        const skillPart = stripAnsi(parts[1]);
        let description = parts[2];
        const source = parts[3];
        const isReady = statusPart.includes('✓') || statusPart.includes('✅') || statusPart.includes('ready');
        const isMissing = statusPart.includes('✗') || statusPart.includes('missing');
        const status = isMissing ? 'missing' : (isReady ? 'ready' : 'unknown');
        let id: string;
        const spaceIndex = skillPart.lastIndexOf(' ');
        if (spaceIndex > 0) {
          id = skillPart.substring(spaceIndex + 1).trim();
        } else {
          id = skillPart.trim();
        }
        id = id.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}\u{2705}\u{2708}\u{2709}\u{270A}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2934}\u{2935}\u{2B05}-\u{2B07}\u{2B1B}\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]/gu, '').trim();
        let fullDescription = description;
        i++;
        while (i < lines.length) {
          const contLine = lines[i];
          const contParts = contLine.split('│').map(p => p.trim()).filter(p => p);
          if (contLine.includes('│') && contParts.length >= 1 && contParts.length <= 2 && !contLine.match(/[✓✗✅]/)) {
            const contDesc = contParts[0];
            if (contDesc && contDesc !== description) {
              fullDescription += ' ' + contDesc;
            }
            i++;
          } else {
            i--;
            break;
          }
        }
        const { riskLevel, category } = this.inferSkillMetadata(id, fullDescription);
        skills.push({
          id,
          name: id,
          description: fullDescription || id + ' skill',
          riskLevel,
          category,
          source,
          status
        });
      }
      i++;
    }
    return skills;
  }

  private inferSkillMetadata(id: string, description: string): { riskLevel: 'low' | 'medium' | 'high', category: string } {
    const id_lower = id.toLowerCase();
    const desc_lower = description.toLowerCase();
    if (id_lower.includes('shell') || id_lower.includes('exec') || 
        desc_lower.includes('execute') || desc_lower.includes('run command') ||
        id_lower.includes('file-write') || id_lower.includes('delete')) {
      return { riskLevel: 'high', category: '系统' };
    }
    if (id_lower.includes('file') || id_lower.includes('read') ||
        id_lower.includes('git') || id_lower.includes('browser')) {
      return { riskLevel: 'medium', category: '文件' };
    }
    if (id_lower.includes('feishu')) {
      return { riskLevel: 'medium', category: '飞书' };
    }
    if (id_lower.includes('web') || id_lower.includes('search') ||
        id_lower.includes('http') || id_lower.includes('fetch')) {
      return { riskLevel: 'low', category: '网络' };
    }
    return { riskLevel: 'low', category: '其他' };
  }

  private getDefaultSkills(): OpenClawSkill[] {
    return [
      { id: 'shell', name: 'Shell 执行', description: '执行系统 Shell 命令', riskLevel: 'high', category: '系统' },
      { id: 'file-read', name: '文件读取', description: '读取本地文件内容', riskLevel: 'medium', category: '文件' },
      { id: 'file-write', name: '文件写入', description: '写入或修改本地文件', riskLevel: 'high', category: '文件' },
      { id: 'web-search', name: '网络搜索', description: '搜索互联网信息', riskLevel: 'low', category: '网络' },
      { id: 'code-run', name: '代码运行', description: '执行代码片段', riskLevel: 'high', category: '代码' },
      { id: 'git', name: 'Git 操作', description: '执行 Git 命令', riskLevel: 'medium', category: '版本控制' },
      { id: 'browser', name: '浏览器控制', description: '控制浏览器自动化', riskLevel: 'medium', category: '自动化' },
      { id: 'memory', name: '记忆管理', description: '读取和写入长期记忆', riskLevel: 'low', category: '记忆' },
    ];
  }

  // ==================== Agent 对话核心 (新架构) ====================

  /**
   * 构建 Agent 的系统提示词
   * 包含角色描述、技能说明、团队上下文和委派能力
   */
  buildSystemPrompt(
    agent: {
      name: string;
      persona: string;
      skills?: string[];
      role?: string;
      id?: string;
    },
    skillDetails: OpenClawSkill[],
    visibleAgents?: Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      skills: string[];
      relationType: string;
      trustScore: number;
      collaborationCount: number;
    }>
  ): string {
    const parts: string[] = [];
    
    // 角色设定
    parts.push('你是 ' + agent.name + '。');
    
    if (agent.persona) {
      parts.push('性格特点：' + agent.persona);
    }
    
    if (agent.role) {
      parts.push('职责：' + agent.role);
    }
    
    // 技能说明
    if (agent.skills && agent.skills.length > 0 && skillDetails.length > 0) {
      parts.push('');
      parts.push('你可以使用以下技能：');
      parts.push('');
      
      for (const skill of skillDetails) {
        if (agent.skills.includes(skill.id)) {
          parts.push('- ' + skill.name + ': ' + skill.description);
        }
      }
    }
    
    // 团队上下文 - 你能看到的同事
    if (visibleAgents && visibleAgents.length > 0) {
      parts.push('');
      parts.push('---');
      parts.push('## 你的团队');
      parts.push('');
      parts.push('你可以看到以下同事，必要时可以委派任务给他们：');
      parts.push('');
      
      for (const colleague of visibleAgents) {
        const relationLabel: Record<string, string> = {
          visible: '同事',
          trusted: '信任的同事',
          subordinate: '下属',
          supervisor: '上级',
        };
        const label = relationLabel[colleague.relationType] || '同事';
        const trust = colleague.trustScore > 0 ? '（信任度 ' + colleague.trustScore.toFixed(1) + '/10）' : '';
        const exp = colleague.collaborationCount > 0 ? '（合作' + colleague.collaborationCount + '次）' : '';
        
        parts.push('### ' + colleague.name + ' [' + label + ']' + trust + exp);
        if (colleague.role) parts.push('- 职责：' + colleague.role);
        if (colleague.persona) parts.push('- 特点：' + colleague.persona);
        if (colleague.skills && colleague.skills.length > 0) {
          parts.push('- 技能：' + colleague.skills.join(', '));
        }
        parts.push('');
      }
      
      parts.push('---');
      parts.push('');
      parts.push('## 委派能力');
      parts.push('');
      parts.push('当你遇到超出自己职责或能力范围的任务，或者需要其他同事协助时，你可以委派任务。');
      parts.push('');
      parts.push('委派格式：在回复中使用以下标记：');
      parts.push('```');
      parts.push('DELEGATE: {"to": "同事名字", "task": "具体任务描述"}');
      parts.push('```');
      parts.push('');
      parts.push('委派规则：');
      parts.push('- 只能委派给你能看到的同事');
      parts.push('- 任务描述要清晰具体，包含足够的上下文');
      parts.push('- 委派后等待结果，将结果整合到你的回复中');
      parts.push('- 可以同时委派多个同事并行处理不同子任务');
      parts.push('- 信任度高的同事优先考虑');
      parts.push('- 不要委派自己能轻松完成的简单任务');
      parts.push('');
      parts.push('委派示例：');
      parts.push('```');
      parts.push('DELEGATE: {"to": "Liu", "task": "审查这段代码的安全性问题"}');
      parts.push('```');
    }
    
    return parts.join('\n');
  }

  /**
   * 检测并截断 LLM 重复循环输出
   * 如果同一段内容重复出现 3 次以上，只保留第一次
   */
  private deduplicateOutput(text: string): string {
    if (!text || text.length < 100) return text;
    
    const lines = text.split('\n');
    
    for (let windowSize = Math.min(50, Math.floor(lines.length / 3)); windowSize >= 3; windowSize--) {
      for (let start = 0; start <= lines.length - windowSize * 3; start++) {
        const block = lines.slice(start, start + windowSize).join('\n');
        if (block.trim().length < 50) continue;
        
        let repeatCount = 1;
        let nextStart = start + windowSize;
        while (nextStart + windowSize <= lines.length) {
          const nextBlock = lines.slice(nextStart, nextStart + windowSize).join('\n');
          if (nextBlock.trim() === block.trim()) {
            repeatCount++;
            nextStart += windowSize;
          } else {
            break;
          }
        }
        
        if (repeatCount >= 3) {
          const keptLines = lines.slice(0, start + windowSize);
          const result = keptLines.join('\n').trim();
          console.log('[deduplicateOutput] 检测到重复: ' + windowSize + '行块重复' + repeatCount + '次，截断到' + keptLines.length + '行');
          return result;
        }
      }
    }
    
    return text;
  }

  /**
   * 与 Agent 对话 - 使用 OpenClaw 本地执行
   * @param options.freshSession 是否强制使用全新session（避免记忆污染，默认true）
   */
  async chatWithAgent(
    agentId: string,
    message: string,
    agentConfig: any,
    skillDetails: any,
    onStream?: (chunk: string) => void,
    options?: { freshSession?: boolean; timeoutMs?: number }
  ): Promise<string> {
    console.log('[chatWithAgent] agent=%s model=%s message=%s freshSession=%s', agentConfig.name, agentConfig.model, message.slice(0, 50), options?.freshSession !== false);
    
    try {
      const fullMessage = message;

      // 确定 workspace 路径
      const workspaceRoot = getWorkspaceRoot();
      const agentSlug = agentConfig.name ? agentConfig.name.toLowerCase().replace(/\s+/g, '-') : agentId;
      const workspace = agentConfig.workspace || path.join(workspaceRoot, agentSlug);

      // 默认使用全新 session，避免跨任务记忆污染
      const freshSession = options?.freshSession !== false;

      // 使用本地执行模式，传入 workspace
      const result = await this.executeWithSpawn(agentId, agentSlug, fullMessage, agentConfig.model, workspace, onStream, { freshSession, timeoutMs: options?.timeoutMs });
      
      // 检测并截断重复输出
      const dedupedResult = this.deduplicateOutput(result);
      
      console.log('[chatWithAgent] 对话完成，回复长度=' + result.length + (dedupedResult.length !== result.length ? '，去重后=' + dedupedResult.length : ''));
      return dedupedResult;
      
    } catch (error) {
      console.error('[chatWithAgent] 对话失败:', error);
      throw error;
    }
  }

  /**
   * 使用 spawn 执行 openclaw agent 命令
   * 
   * @param sessionId 会话ID（用于隔离不同任务的对话历史）
   * @param agentSlug Agent 标识
   * @param message 消息内容
   * @param model 模型
   * @param workspace 工作区路径
   * @param onStream 流式回调
   * @param options 可选参数
   * @param options.freshSession 是否强制使用全新session（避免记忆污染）
   */
  private async executeWithSpawn(
    sessionId: string,
    agentSlug: string,
    message: string,
    model: string,
    workspace: string,
    onStream?: (chunk: string) => void,
    options?: { freshSession?: boolean; timeoutMs?: number }
  ): Promise<string> {
    // 检查 workspace 路径合法性：防止数据库中损坏的路径导致 mkdir 失败
    // 路径应该是合理的绝对路径，不包含空格与控制字符
    const looksValid = workspace && path.isAbsolute(workspace) 
      && !/[\s\u0000-\u001f]/.test(workspace.split('/').slice(-1)[0]) // 最后一段不带空格/控制字符
      && (await fs.access(path.dirname(workspace)).then(() => true).catch(() => false));

    if (!looksValid) {
      console.warn('[executeWithSpawn] workspace 路径可疑或不存在: ' + JSON.stringify(workspace) + '，尝试使用 ' + agentSlug + ' 子目录');
      workspace = path.join(getWorkspaceRoot(), agentSlug);
    }

    // 确保 workspace 目录存在，避免 spawn ENOENT
    try {
      await fs.mkdir(workspace, { recursive: true });
    } catch (dirErr) {
      console.warn('[executeWithSpawn] 创建 workspace 目录失败，使用临时目录:', dirErr);
      workspace = os.tmpdir();
    }

    // 生成隔离的 session-id：每个任务对话使用独立的 session，避免跨任务记忆污染
    // 如果 freshSession 为 true 或 sessionId 看起来像是 agentId（非 UUID），则生成新的
    const isolatedSessionId = (options?.freshSession || !sessionId.includes('-'))
      ? agentSlug + '-task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      : sessionId;

    return new Promise((resolve, reject) => {
      const args = [
        'agent',
        '--local',
        '--agent', agentSlug,
        '--session-id', isolatedSessionId,
        '--message', message,
      ];

      if (model && model !== 'default') {
        args.push('--model', model);
      }

      console.log('[executeWithSpawn] agent=%s model=%s session=%s', agentSlug, model, sessionId);

      const env = {
        ...process.env,
        WORKSPACE_ROOT: getWorkspaceRoot(),
      };

      const child = spawn('openclaw', args, {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onStream) {
          onStream(chunk);
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // 超时处理（默认 300s，可配置）
      const timeoutMs = options?.timeoutMs || 300_000;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Agent 执行超时 (' + Math.round(timeoutMs / 1000) + 's)'));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 || code === null) {
          const cleanResult = stripAnsi(stdout).trim();
          if (!cleanResult && stderr) {
            reject(new Error('Agent 执行失败: ' + stripAnsi(stderr).slice(0, 500)));
          } else {
            resolve(cleanResult);
          }
        } else {
          reject(new Error('Agent 进程退出码: ' + code + ', stderr: ' + stripAnsi(stderr).slice(0, 500)));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error('Agent 进程启动失败: ' + err.message));
      });
    });
  }

  // ==================== Agent 管理 ====================

  async addAgent(name: string, options: { model?: string } = {}): Promise<OpenClawAgent | null> {
    console.log('[addAgent] 独立隔离模式：不注册到 OpenClaw，仅返回虚拟 ID');
    // 独立隔离架构：不修改 OpenClaw 配置
    // 只生成一个 openclawId 供对话时使用
    return null;
  }

  async listAgents(): Promise<OpenClawAgent[]> {
    try {
      const { stdout } = await execAsync('openclaw agents list 2>/dev/null');
      return this.parseAgentsFromTable(stdout);
    } catch (error) {
      console.error('Failed to list agents:', error);
      return [];
    }
  }

  private parseAgentsFromTable(stdout: string): OpenClawAgent[] {
    const agents: OpenClawAgent[] = [];
    const lines = stdout.split('\n');
    
    for (const line of lines) {
      if (!line.includes('│') || line.includes('Name') || line.includes('Status') ||
          /^[┌├└─]/.test(line.trim())) {
        continue;
      }
      
      const parts = line.split('│').map(p => stripAnsi(p.trim())).filter(p => p);
      if (parts.length >= 2) {
        agents.push({
          id: parts[0],
          name: parts[0],
          status: (parts[1] || 'unknown') as 'ready' | 'chatting' | 'error',
          config: {
            persona: parts[2] || '',
            skills: [],
          },
        });
      }
    }
    
    return agents;
  }

  async getAvailableModels(): Promise<{ id: string; alias?: string }[]> {
    try {
      const openclawBin = process.env.OPENCLAW_BIN || 'openclaw';
      
      // 优先使用 --json 格式，避免文本解析问题
      const { stdout } = await execAsync(openclawBin + ' models list --json 2>/dev/null', { timeout: 15000 });
      const models: { id: string; alias?: string }[] = [];
      
      try {
        const data = JSON.parse(stdout);
        const modelList = data.models || [];
        
        // 找默认模型
        let defaultModel = 'default';
        for (const m of modelList) {
          if (m.tags && m.tags.includes('default')) {
            defaultModel = m.key;
            break;
          }
        }
        
        // 默认模型放最前
        models.push({ id: defaultModel, alias: '默认 (' + defaultModel + ')' });
        
        // 其余模型
        for (const m of modelList) {
          if (m.key === defaultModel) continue;
          // 检查是否有 alias tag
          let alias: string | undefined;
          if (m.tags) {
            for (const tag of m.tags) {
              if (tag.startsWith('alias:')) {
                alias = tag.slice(6);
                break;
              }
            }
          }
          models.push({ id: m.key, alias });
        }
        
        if (models.length > 1) return models;
      } catch (parseErr) {
        console.warn('[getAvailableModels] JSON 解析失败，尝试文本解析:', parseErr);
      }
      
      // Fallback: 文本解析（兼容旧版本）
      const { stdout: textOutput } = await execAsync(openclawBin + ' models 2>/dev/null', { timeout: 15000 });
      const configuredMatch = textOutput.match(/Configured models\s*\(\d+\)\s*:\s*(.+)/);
      if (configuredMatch) {
        const modelIds = configuredMatch[1].split(',').map(m => m.trim()).filter(Boolean);
        const defaultMatch = textOutput.match(/Default\s*:\s*(.+)/);
        const defaultModel = defaultMatch ? defaultMatch[1].trim() : 'default';
        
        models.push({ id: defaultModel, alias: '默认 (' + defaultModel + ')' });
        for (const mid of modelIds) {
          if (mid !== defaultModel) {
            models.push({ id: mid });
          }
        }
        if (models.length > 1) return models;
      }
      
      // 最终 fallback
      return [{ id: 'default', alias: '默认' }];
    } catch (error) {
      console.error('Failed to get models:', error);
      return [{ id: 'default', alias: '默认' }];
    }
  }

  // ==================== Workspace 管理 ====================

  async setupAgentWorkspace(
    agentSlug: string,
    agentName: string,
    options: {
      persona?: string;
      role?: string;
      skills?: string[];
      tags?: string[];
      emoji?: string;
      model?: string;
      skipIfExists?: boolean;
    } = {}
  ): Promise<string> {
    const workspaceRoot = getWorkspaceRoot();
    const workspacePath = path.join(workspaceRoot, agentSlug);
    
    // 检查 agent 是否已注册，已注册则跳过
    if (options.skipIfExists) {
      try {
        const { stdout } = await execAsync('openclaw agents list --json 2>/dev/null');
        const agents = JSON.parse(stdout);
        const existing = Array.isArray(agents) ? agents : (agents.agents || agents.data || []);
        if (existing.some((a: any) => a.id === agentSlug || a.name === agentSlug)) {
          console.log('[setupAgentWorkspace] Agent "' + agentSlug + '" 已注册，跳过');
          return workspacePath;
        }
      } catch {
        // 查询失败则继续走注册流程
      }
    }
    
    try {
      // 创建 workspace 目录
      await fs.mkdir(workspacePath, { recursive: true });
      
      // 创建 skills 子目录
      await fs.mkdir(path.join(workspacePath, 'skills'), { recursive: true });
      
      // 写入 SOUL.md
      const soulContent = this.generateSoulMd(agentName, options);
      await fs.writeFile(path.join(workspacePath, 'SOUL.md'), soulContent, 'utf-8');
      
      // 写入 AGENTS.md
      const agentsContent = this.generateAgentsMd(agentName, options);
      await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), agentsContent, 'utf-8');
      
      // 写入 TOOLS.md
      const toolsContent = await this.generateToolsMd(options.skills || []);
      await fs.writeFile(path.join(workspacePath, 'TOOLS.md'), toolsContent, 'utf-8');
      
      // 安装技能（仅更新，不重复安装）
      if (options.skills && options.skills.length > 0) {
        for (const skillId of options.skills) {
          try {
            await execAsync('openclaw skills install ' + skillId + ' --force 2>/dev/null');
          } catch (skillError) {
            // 技能安装失败不阻塞启动
          }
        }
      }
      
      // 注册到 OpenClaw
      try {
        const modelArg = options.model && options.model !== 'default' ? ' --model ' + options.model : '';
        const { stdout: addOutput } = await execAsync(
          'openclaw agents add --non-interactive --workspace ' + workspacePath + modelArg + ' ' + agentSlug + ' 2>&1'
        );
        console.log('[setupAgentWorkspace] OpenClaw agent 注册结果:', stripAnsi(addOutput).slice(0, 200));
      } catch (addError) {
        // agent 可能已存在，不阻塞
      }

      console.log('[setupAgentWorkspace] Workspace 创建完成: ' + workspacePath);
      return workspacePath;
      
    } catch (error) {
      console.error('[setupAgentWorkspace] 创建失败:', error);
      throw error;
    }
  }

  private generateSoulMd(
    agentName: string,
    options: { persona?: string; role?: string; emoji?: string }
  ): string {
    const emoji = options.emoji || '🐾';
    const parts: string[] = [
      '# SOUL.md - Who You Are',
      '',
      '_我是' + agentName + '。_',
      '',
      '## 性格',
      '',
    ];
    
    if (options.persona) {
      parts.push('- **特点**：' + options.persona);
    } else {
      parts.push('- **特点**：认真负责，善于合作');
    }
    
    parts.push('');
    parts.push('## 职责');
    parts.push('');
    if (options.role) {
      parts.push(options.role);
    } else {
      parts.push('团队协作成员');
    }
    parts.push('');
    parts.push('## 核心原则');
    parts.push('');
    parts.push('- 认真完成每项任务');
    parts.push('- 与同事积极协作');
    parts.push('- 及时汇报工作进展');
    parts.push('- 遇到困难主动寻求帮助');
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push('_' + emoji + ' ' + agentName + '_');
    
    return parts.join('\n');
  }

  private generateAgentsMd(
    agentName: string,
    options: { persona?: string; role?: string; skills?: string[] }
  ): string {
    const parts: string[] = [
      '# AGENTS.md - Workspace',
      '',
      '## 基本信息',
      '',
      '- **名称**: ' + agentName,
      '- **角色**: ' + (options.role || '团队成员'),
      '',
      '## 技能',
      '',
    ];
    
    if (options.skills && options.skills.length > 0) {
      for (const skill of options.skills) {
        parts.push('- ' + skill);
      }
    } else {
      parts.push('- (暂无)');
    }
    
    parts.push('');
    parts.push('## 工作区说明');
    parts.push('');
    parts.push('这是 ' + agentName + ' 的独立工作区。');
    parts.push('SOUL.md 定义了你的角色和性格。');
    parts.push('TOOLS.md 记录了你的技能详情。');
    
    return parts.join('\n');
  }

  private async generateToolsMd(skillIds: string[]): Promise<string> {
    const allSkills = await this.listSkills();
    const parts: string[] = [
      '# TOOLS.md - Local Notes',
      '',
      'Skills define _how_ tools work. This file is for _your_ specifics.',
      '',
      '## 已安装技能',
      '',
    ];
    
    for (const skillId of skillIds) {
      const skill = allSkills.find(s => s.id === skillId);
      if (skill) {
        parts.push('### ' + skill.name);
        parts.push('- **ID:** ' + skill.id);
        parts.push('- **描述:** ' + skill.description);
        parts.push('- **分类:** ' + skill.category);
        parts.push('- **风险等级:** ' + skill.riskLevel);
        parts.push('');
      }
    }
    
    parts.push('---');
    parts.push('');
    parts.push('Add whatever helps you do your job. This is your cheat sheet.');
    
    return parts.join('\n');
  }

  async deleteAgent(id: string, workspace?: string): Promise<void> {
    console.log('[deleteAgent] 删除 agent（独立隔离模式）: ' + id);
    
    if (workspace) {
      const workspaceRoot = getWorkspaceRoot();
      if (workspace.startsWith(workspaceRoot)) {
        try {
          await fs.rm(workspace, { recursive: true, force: true });
          console.log('[deleteAgent] workspace 已清理: ' + workspace);
        } catch (error) {
          console.warn('[deleteAgent] workspace 清理失败（可能不存在）:', error);
        }
      } else {
        console.warn('[deleteAgent] workspace 路径不在 multiClaw 目录下，跳过删除: ' + workspace);
      }
    }
  }

  async getAgentConfig(id: string): Promise<AgentConfig | null> {
    console.log('[getAgentConfig] 新架构：从数据库读取虚拟 Agent 配置: ' + id);
    return null;
  }

  async updateAgentConfig(id: string, config: AgentConfig): Promise<void> {
    console.log('[updateAgentConfig] 更新 Agent 配置并同步: ' + id);
    
    // 1. 同步更新 openclaw.json 里的 agent 配置（尤其是 model）
    try {
      const configPath = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const globalConfig = JSON.parse(content);
      
      if (globalConfig.agents?.list) {
        const agentEntry = globalConfig.agents.list.find((a: any) => a.id === id);
        if (agentEntry) {
          // 更新 model
          if (config.model && config.model !== 'default') {
            agentEntry.model = config.model;
          } else if (config.model === 'default') {
            // 如果选了 default，移除 model 字段让 OpenClaw 使用全局默认
            delete agentEntry.model;
          }
          // 更新 name
          if (config.name) {
            agentEntry.name = config.name;
          }
          // 更新 workspace
          if (config.workspace) {
            agentEntry.workspace = config.workspace;
          }
          
          await fs.writeFile(configPath, JSON.stringify(globalConfig, null, 2), 'utf-8');
          console.log('[updateAgentConfig] openclaw.json 已同步: model=' + (agentEntry.model || 'default'));
        } else {
          console.warn('[updateAgentConfig] 在 openclaw.json 中未找到 agent: ' + id);
        }
      }
    } catch (err) {
      console.warn('[updateAgentConfig] openclaw.json 同步失败(非致命):', err);
    }
    
    // 2. 同步更新 workspace 的 SOUL.md
    try {
      const workspaceRoot = getWorkspaceRoot();
      const workspacePath = path.join(workspaceRoot, id);
      const soulPath = path.join(workspacePath, 'SOUL.md');
      // 检查 workspace 是否存在
      try { await fs.access(workspacePath); } catch { return; }
      const soulContent = this.generateSoulMd(config.name || id, {
        persona: config.persona,
        role: config.role,
      });
      await fs.writeFile(soulPath, soulContent, 'utf-8');
      console.log('[updateAgentConfig] SOUL.md 已同步: ' + soulPath);
    } catch (err) {
      console.warn('[updateAgentConfig] SOUL.md 同步失败(非致命):', err);
    }
  }

  async getGlobalConfig(): Promise<any> {
    try {
      const configPath = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('[getGlobalConfig] 读取失败:', error);
      return {};
    }
  }

  /**
   * 清除指定 Agent 的所有 OpenClaw session 历史
   * 用于模型变更后避免旧历史污染新模型的回复
   */
  async clearAgentSessions(agentSlug: string): Promise<void> {
    const sessionsDir = path.join(OPENCLAW_CONFIG_DIR, 'agents', agentSlug, 'sessions');
    try {
      await fs.access(sessionsDir);
    } catch {
      // sessions 目录不存在，无需清理
      return;
    }
    
    const files = await fs.readdir(sessionsDir);
    let cleared = 0;
    for (const file of files) {
      // 只删除 .jsonl 和 .jsonl.bak 文件（会话和轨迹数据）
      // 保留 sessions.json（会话索引）
      if (file.endsWith('.jsonl') || file.endsWith('.jsonl.bak') || 
          file.endsWith('.trajectory.jsonl') || file.endsWith('.trajectory-path.json')) {
        await fs.unlink(path.join(sessionsDir, file));
        cleared++;
      }
    }
    console.log('[clearAgentSessions] 已清除 ' + agentSlug + ' 的 ' + cleared + ' 个 session 文件');
  }

  // updateGlobalConfig 已禁用
  async updateGlobalConfig(_config: any): Promise<void> {
    console.warn('[updateGlobalConfig] 此操作已被禁用，multiClaw 不应修改 OpenClaw 全局配置');
    throw new Error('multiClaw 独立隔离架构：不允许修改 OpenClaw 全局配置');
  }

  // ==================== 网关管理 ====================

  async restartGateway(): Promise<void> {
    try {
      await execAsync('openclaw gateway restart');
    } catch (error) {
      console.error('Failed to restart gateway:', error);
      throw error;
    }
  }

  async getGatewayStatus(): Promise<{ status: string; uptime?: string }> {
    try {
      const { stdout } = await execAsync('openclaw gateway status --json 2>/dev/null || openclaw gateway status');
      try {
        return JSON.parse(stdout);
      } catch {
        if (stdout.toLowerCase().includes('running') || stdout.toLowerCase().includes('online')) {
          return { status: 'ready' };
        }
        return { status: 'error' };
      }
    } catch (error) {
      return { status: 'unknown' };
    }
  }
}

export const openclawService = new OpenClawService();
