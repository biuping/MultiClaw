import { openclawService, OpenClawService } from './openclaw';
import { agentService } from './agent';
import { skillService } from './skill';
import { emitTaskProgress } from './task-events';

/**
 * Agent 配置接口
 */
export interface AgentConfig {
  id: string;
  name: string;
  persona: string;
  skills: string[];
  role: string;
  model: string;
  workspace: string;
}

/**
 * 委派结果
 */
export interface DelegationResult {
  to: string;
  task: string;
  result: string;
  success: boolean;
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  analysis: string;
  delegations: DelegationResult[];
  integration: string;
}

/**
 * 断点数据 — 保存任务执行的中间状态，用于断点续传
 */
export interface TaskCheckpoint {
  /** 当前阶段: analysis | delegation | integration */
  phase: string;
  /** 阶段1结果：协调者分析 */
  analysis?: string;
  /** 解析出的委派列表 */
  delegationPlan?: Array<{ to: string; task: string }>;
  /** 阶段2已完成的委派结果 */
  completedDelegations?: DelegationResult[];
  /** 委派计划中下一个要执行的索引 */
  nextDelegationIndex?: number;
}

/**
 * AgentExecutor — 统一封装 Agent 对话和委派逻辑
 * 
 * 消除各路由中重复的 chatWithAgent 调用模式，
 * 提供标准化的任务执行流程（分析→委派→整合）
 * 支持断点续传：任务中断后可从上次断点恢复执行
 */
export class AgentExecutor {
  private service: OpenClawService;

  constructor() {
    this.service = openclawService;
  }

  /**
   * 与单个 Agent 对话
   * @param options.freshSession 是否强制使用全新session
   */
  async chat(
    agentId: string,
    message: string,
    agentConfig: AgentConfig,
    onStream?: (chunk: string) => void,
    options?: { freshSession?: boolean }
  ): Promise<string> {
    const skills = await this.service.listSkills();
    return this.service.chatWithAgent(agentId, message, agentConfig, skills, onStream, options);
  }

  /**
   * 构建协调者系统提示词
   */
  async buildCoordinatorSystemPrompt(coordinator: AgentConfig): Promise<string> {
    const skills = await this.service.listSkills();
    const visibleAgents = await agentService.getVisibleAgents(coordinator.id);
    const allRelations = await agentService.getAllRelations();

    const visibleContext = visibleAgents.map(va => {
      const rel = allRelations.find((r: any) => r.sourceId === coordinator.id && r.targetId === va.id);
      return {
        id: va.id,
        name: va.name,
        role: va.role || '',
        persona: va.persona || '',
        skills: va.skills || [],
        relationType: rel?.relationType || 'visible',
        trustScore: rel?.trustScore || 0,
        collaborationCount: rel?.collaborationCount || 0,
      };
    });

    return this.service.buildSystemPrompt(
      {
        name: coordinator.name,
        persona: coordinator.persona,
        skills: coordinator.skills,
        role: coordinator.role,
        id: coordinator.id,
      },
      skills,
      visibleContext.length > 0 ? visibleContext : undefined
    );
  }

  /**
   * 保存断点到数据库
   */
  private async saveCheckpoint(taskId: string, checkpoint: TaskCheckpoint): Promise<void> {
    try {
      const db = await (await import('../db')).getDb();
      await db.runAsync(
        'UPDATE tasks SET checkpoint = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(checkpoint), new Date().toISOString(), taskId]
      );
    } catch (err) {
      console.warn('[checkpoint] 保存断点失败:', err);
    }
  }

  /**
   * 读取断点
   */
  async getCheckpoint(taskId: string): Promise<TaskCheckpoint | null> {
    try {
      const db = await (await import('../db')).getDb();
      const row = await db.getAsync('SELECT checkpoint FROM tasks WHERE id = ?', [taskId]);
      if (row && row.checkpoint) {
        return JSON.parse(row.checkpoint);
      }
    } catch (err) {
      console.warn('[checkpoint] 读取断点失败:', err);
    }
    return null;
  }

  /**
   * 清除断点
   */
  private async clearCheckpoint(taskId: string): Promise<void> {
    try {
      const db = await (await import('../db')).getDb();
      await db.runAsync('UPDATE tasks SET checkpoint = NULL WHERE id = ?', [taskId]);
    } catch (err) {
      console.warn('[checkpoint] 清除断点失败:', err);
    }
  }

  /**
   * 执行完整的团队任务流程（分析→委派→整合）
   * 
   * @param taskId 任务 ID（用于进度推送和断点存储）
   * @param coordinator 协调者配置
   * @param taskDescription 任务描述
   * @param mode 执行模式: 'restart' 从头开始 | 'resume' 从断点续传 | 'restart-from-phase' 从指定阶段重来
   * @param options 可选参数
   * @param options.guidance 人工定向指导/提示注入
   * @param options.restartFromPhase 从哪个阶段开始重来: 'analysis' | 'delegation' | 'integration'
   * @param onProgress 进度回调（可选，默认使用 emitTaskProgress）
   */
  async executeTeamTask(
    taskId: string,
    coordinator: AgentConfig,
    taskDescription: string,
    mode: 'restart' | 'resume' | 'restart-from-phase' = 'restart',
    options?: { guidance?: string; restartFromPhase?: string },
    onProgress?: (phase: string, message: string, detail?: any) => void
  ): Promise<TaskExecutionResult> {
    const progress = onProgress || ((phase, message, detail) => {
      emitTaskProgress(taskId, phase as any, message, detail);
    });

    const guidance = options?.guidance;
    const restartFromPhase = options?.restartFromPhase || (mode === 'restart-from-phase' ? 'analysis' : undefined);

    // 构建任务描述，注入人工指导
    let effectiveTaskDescription = taskDescription;
    if (guidance) {
      effectiveTaskDescription = taskDescription + '\n\n---\n\n## 人工指导（必须遵循）\n\n' + guidance;
      progress('analysis', '已注入人工指导', { guidanceLength: guidance.length });
    }

    const systemPrompt = await this.buildCoordinatorSystemPrompt(coordinator);

    // 确定是否需要从断点恢复
    let checkpoint: TaskCheckpoint | null = null;
    if (mode === 'resume') {
      checkpoint = await this.getCheckpoint(taskId);
      if (checkpoint) {
        console.log('[checkpoint] 从断点恢复: phase=' + checkpoint.phase + ', nextIndex=' + checkpoint.nextDelegationIndex);
        progress('resume', '从断点恢复执行: 阶段=' + checkpoint.phase, { checkpoint });
      } else {
        console.log('[checkpoint] 无断点数据，从头开始');
        progress('resume', '无断点数据，从头开始执行');
      }
    } else if (mode === 'restart-from-phase' && restartFromPhase) {
      // 从指定阶段重来：读取旧断点获取已有数据，但忽略指定阶段之后的结果
      checkpoint = await this.getCheckpoint(taskId);
      if (checkpoint) {
        // 根据指定重来的阶段，调整断点
        if (restartFromPhase === 'analysis') {
          // 从分析阶段重来 = 完全重来
          checkpoint = null;
          progress('analysis', '从分析阶段重新开始', {});
        } else if (restartFromPhase === 'delegation') {
          // 保留分析结果，从委派阶段重来
          checkpoint = {
            ...checkpoint,
            phase: 'delegation',
            completedDelegations: [],
            nextDelegationIndex: 0,
          };
          progress('delegation', '从委派阶段重新开始（保留分析结果）', {});
        } else if (restartFromPhase === 'integration') {
          // 保留分析和委派结果，从整合阶段重来
          checkpoint = {
            ...checkpoint,
            phase: 'integration',
          };
          progress('integration', '从整合阶段重新开始（保留分析和委派结果）', {});
        }
      }
    }

    // ========== 阶段1：协调者分析任务 ==========
    let analysis: string;
    let delegations: Array<{ to: string; task: string }>;

    if (checkpoint && checkpoint.phase !== 'delegation' && checkpoint.phase !== 'integration') {
      // 需要重新分析
      analysis = await this.runAnalysis(taskId, coordinator, systemPrompt, effectiveTaskDescription, progress);
      delegations = this.parseDelegates(analysis);

      // 保存断点
      const newCheckpoint: TaskCheckpoint = {
        phase: 'delegation',
        analysis,
        delegationPlan: delegations,
        completedDelegations: [],
        nextDelegationIndex: 0,
      };
      await this.saveCheckpoint(taskId, newCheckpoint);
    } else if (checkpoint && (checkpoint.phase === 'delegation' || checkpoint.phase === 'integration')) {
      // 从断点恢复：复用已有分析结果
      analysis = checkpoint.analysis || '';
      delegations = checkpoint.delegationPlan || [];
      progress('analysis', '复用已有分析结果（断点续传）', { delegationsCount: delegations.length });
    } else {
      // 全新执行
      analysis = await this.runAnalysis(taskId, coordinator, systemPrompt, effectiveTaskDescription, progress);
      delegations = this.parseDelegates(analysis);

      const newCheckpoint: TaskCheckpoint = {
        phase: 'delegation',
        analysis,
        delegationPlan: delegations,
        completedDelegations: [],
        nextDelegationIndex: 0,
      };
      await this.saveCheckpoint(taskId, newCheckpoint);
    }

    if (delegations.length === 0) {
      await this.clearCheckpoint(taskId);
      return { analysis, delegations: [], integration: analysis };
    }

    // ========== 阶段2：执行委派 ==========
    progress('delegation', '发现 ' + delegations.length + ' 个委派任务，开始执行...', { delegations });

    const delegationResults: DelegationResult[] = checkpoint?.completedDelegations
      ? [...checkpoint.completedDelegations]
      : [];
    let startIndex = checkpoint?.nextDelegationIndex || 0;

    // 断点恢复时，如果最后一条委派记录是失败的，移除它（将在循环中重新执行）
    // 这是因为失败时我们保存了 nextDelegationIndex = i（不推进），
    // 但失败结果已存入 completedDelegations，需要清理以避免重复
    if (mode === 'resume' && delegationResults.length > 0 && startIndex < delegations.length) {
      const lastResult = delegationResults[delegationResults.length - 1];
      if (!lastResult.success && lastResult.to === delegations[startIndex]?.to) {
        delegationResults.pop();
        console.log('[checkpoint] 移除上次失败的委派记录，将在断点恢复时重试: ' + lastResult.to);
      }
    }

    if (startIndex > 0) {
      progress('delegation', '从第 ' + (startIndex + 1) + '/' + delegations.length + ' 个委派恢复', {
        completedCount: delegationResults.length,
        remainingCount: delegations.length - startIndex,
      });
    }

    const visibleAgents = await agentService.getVisibleAgents(coordinator.id);

    for (let i = startIndex; i < delegations.length; i++) {
      const delegation = delegations[i];
      progress('delegation', '委派 ' + (i + 1) + '/' + delegations.length + ': ' + delegation.to + ' - ' + delegation.task.slice(0, 30));

      const targetAgent = visibleAgents.find(a => a.name === delegation.to);
      if (!targetAgent) {
        delegationResults.push({ to: delegation.to, task: delegation.task, result: '未找到该同事', success: false });
        // 永久性失败（同事不存在），推进索引，不需要重试
        await this.saveCheckpoint(taskId, {
          phase: 'delegation',
          analysis,
          delegationPlan: delegations,
          completedDelegations: delegationResults,
          nextDelegationIndex: i + 1,
        });
        continue;
      }

      const targetConfig: AgentConfig = {
        id: targetAgent.id,
        name: targetAgent.name,
        persona: targetAgent.persona || '',
        skills: targetAgent.skills || [],
        role: targetAgent.role || '',
        model: targetAgent.model || 'default',
        workspace: targetAgent.workspace,
      };
      console.log('[executeTeamTask] 委派到: ' + delegation.to + ', targetAgent.model=' + targetAgent.model + ', targetConfig.model=' + targetConfig.model);

      try {
        const record = await agentService.createDelegationRecord(coordinator.id, targetAgent.id, delegation.task);
        const result = await this.chat(targetAgent.id, delegation.task, targetConfig, undefined, { freshSession: true });
        await agentService.updateDelegationRecord(record.id, result, 'completed');
        delegationResults.push({ to: delegation.to, task: delegation.task, result, success: true });

        // 记录协作
        await agentService.recordCollaboration(coordinator.id, targetAgent.id, {
          taskId: record.id,
          task: delegation.task,
          result: result.slice(0, 200),
          timestamp: new Date().toISOString(),
          success: true,
        });

        progress('delegation', delegation.to + ' 完成委派', { to: delegation.to, success: true });

        // 成功时保存断点，推进索引
        await this.saveCheckpoint(taskId, {
          phase: 'delegation',
          analysis,
          delegationPlan: delegations,
          completedDelegations: delegationResults,
          nextDelegationIndex: i + 1,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        delegationResults.push({ to: delegation.to, task: delegation.task, result: errMsg, success: false });
        progress('delegation', delegation.to + ' 委派失败: ' + errMsg.slice(0, 50), { to: delegation.to, success: false });

        // 失败时保存断点，索引不推进（i 而非 i+1），断点恢复时重新执行该委派
        // 这样用户等待额度恢复后从断点续传，失败的委派会被重试而非跳过
        await this.saveCheckpoint(taskId, {
          phase: 'delegation',
          analysis,
          delegationPlan: delegations,
          completedDelegations: delegationResults,
          nextDelegationIndex: i,
        });

        // 终止当前执行循环，等待用户从断点恢复重试
        progress('delegation', '委派失败，已保存断点。恢复执行时将从失败的委派重试。', {
          failedDelegation: delegation.to,
          nextDelegationIndex: i,
        });
        throw new Error(delegation.to + ' 委派失败: ' + errMsg);
      }
    }

    // ========== 阶段3：协调者整合结果 ==========
    // 如果从整合阶段重来，清除旧整合结果
    if (restartFromPhase === 'integration') {
      progress('integration', '重新整合结果...');
    } else {
      progress('integration', coordinator.name + ' 正在整合结果...');
    }

    const resultsSummary = delegationResults
      .map(r => r.success ? '【' + r.to + '的回复】' + r.result : '【' + r.to + '失败】' + r.result)
      .join('\n\n');

    let integrationPrompt = '你是团队协调者。你之前分析了任务并委派给团队成员，以下是他们的回复：\n\n' +
      resultsSummary + '\n\n请整合以上所有结果，给出最终的完整回复。';
    
    // 注入人工指导到整合阶段
    if (guidance) {
      integrationPrompt += '\n\n---\n\n## 人工指导（整合时必须遵循）\n\n' + guidance;
    }

    const integration = await this.chat(coordinator.id, integrationPrompt, coordinator, undefined, { freshSession: true });

    // 任务完成，清除断点
    await this.clearCheckpoint(taskId);

    return { analysis, delegations: delegationResults, integration };
  }

  /**
   * 执行分析阶段
   */
  private async runAnalysis(
    taskId: string,
    coordinator: AgentConfig,
    systemPrompt: string,
    taskDescription: string,
    progress: (phase: string, message: string, detail?: any) => void
  ): Promise<string> {
    progress('analysis', coordinator.name + ' 正在分析任务...');

    const analysisPrompt = systemPrompt + '\n\n---\n\n## 团队任务\n\n' + taskDescription +
      '\n\n请分析这个任务，确定需要委派给哪些同事，以及各自负责什么。如果你自己也能承担部分工作，直接写出来。使用 DELEGATE 标记来委派任务。' +
      '\n\n## 委派原则（必须遵守）\n\n1. **按能力匹配委派**：仔细阅读每位同事的职责和技能，将任务委派给最合适的人。例如文档/Word/Excel相关任务必须委派给文档编辑手，代码相关任务委派给程序员，产品分析任务委派给产品经理。\n2. **不要跨领域委派**：不要把文档任务委派给程序员，不要把代码任务委派给产品经理。\n3. **覆盖所有子任务**：确保任务的每个环节都有对应的人负责，不要遗漏。';

    return this.chat(coordinator.id, analysisPrompt, coordinator, undefined, { freshSession: true });
  }

  /**
   * 解析 DELEGATE 标记
   */
  /**
   * 解析 DELEGATE 标记
   * 
   * LLM 输出的 DELEGATE JSON 中，task 字段经常包含换行符和大量内容，
   * 导致标准 JSON.parse 和简单正则都容易失败。
   * 使用基于大括号计数的提取方式，配合宽松解析。
   */
  parseDelegates(text: string): Array<{ to: string; task: string }> {
    const results: Array<{ to: string; task: string }> = [];
    let searchIdx = 0;

    while (true) {
      // 找到 DELEGATE: 标记
      const delegateIdx = text.indexOf('DELEGATE:', searchIdx);
      if (delegateIdx === -1) break;
      
      let idx = delegateIdx + 'DELEGATE:'.length;
      // 跳过空白
      while (idx < text.length && ' \t\n'.includes(text[idx])) idx++;
      
      // 找到起始 {
      if (idx >= text.length || text[idx] !== '{') {
        searchIdx = idx;
        continue;
      }
      
      // 用大括号计数找到匹配的 }
      const start = idx;
      let braceCount = 0;
      let inString = false;
      let escape = false;
      let foundEnd = false;
      
      while (idx < text.length) {
        const c = text[idx];
        if (c === '{' && !inString) {
          braceCount++;
        } else if (c === '}' && !inString) {
          braceCount--;
          if (braceCount === 0) {
            foundEnd = true;
            break;
          }
        } else if (c === '"' && !escape) {
          inString = !inString;
        } else if (c === '\\' && inString) {
          escape = !escape;
          idx++;
          continue;
        }
        escape = false;
        idx++;
      }
      
      if (!foundEnd) {
        console.warn('[parseDelegates] 未找到闭合 }, 跳过');
        searchIdx = idx;
        continue;
      }
      
      const rawJson = text.slice(start, idx + 1);
      searchIdx = idx + 1;
      
      // 尝试1：直接 JSON.parse
      try {
        const payload = JSON.parse(rawJson);
        if (payload.to && payload.task) {
          results.push({ to: payload.to, task: payload.task });
          continue;
        }
      } catch {}
      
      // 尝试2：宽松提取 to 和 task 字段
      const toMatch = rawJson.match(/"to"\s*:\s*"([^"]*)"/);
      const taskMatch = rawJson.match(/"task"\s*:\s*"([\s\S]*?)"\s*}/);
      
      if (toMatch) {
        const to = toMatch[1];
        let task = taskMatch ? taskMatch[1] : '';
        task = task.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
        if (to && task) {
          results.push({ to, task });
        }
      } else {
        console.warn('[parseDelegates] 无法提取 to 字段, raw:', rawJson.slice(0, 200));
      }
    }

    return results;
  }
}

/** 全局 AgentExecutor 实例 */
export const agentExecutor = new AgentExecutor();
