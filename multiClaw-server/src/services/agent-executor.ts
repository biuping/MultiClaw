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
 * 完成度评估结果
 */
export interface CompletionEvaluation {
  /** 任务是否已完成 */
  isComplete: boolean;
  /** 完成或未完成的原因 */
  reason: string;
  /** 未完成时，下一步需要委派的工作 */
  nextSteps: Array<{ to: string; task: string }>;
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  analysis: string;
  delegations: DelegationResult[];
  integration: string;
  /** 迭代执行的轮次数 */
  iterations?: number;
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
  /** 当前迭代轮次 */
  iteration?: number;
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
   * 执行完整的团队任务流程，支持多轮迭代
   * 
   * 每轮：分析→委派→整合→完成度评估
   * 如果协调者判定任务未完成，自动进入下一轮，带上轮产出物作为上下文
   * 
   * @param taskId 任务 ID（用于进度推送和断点存储）
   * @param coordinator 协调者配置
   * @param taskDescription 任务描述
   * @param mode 执行模式: 'restart' | 'resume' | 'restart-from-phase'
   * @param options 可选参数
   * @param options.guidance 人工定向指导
   * @param options.restartFromPhase 从哪个阶段开始重来
   * @param onProgress 进度回调
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
      checkpoint = await this.getCheckpoint(taskId);
      if (checkpoint) {
        if (restartFromPhase === 'analysis') {
          checkpoint = null;
          progress('analysis', '从分析阶段重新开始', {});
        } else if (restartFromPhase === 'delegation') {
          checkpoint = {
            ...checkpoint,
            phase: 'delegation',
            completedDelegations: [],
            nextDelegationIndex: 0,
          };
          progress('delegation', '从委派阶段重新开始（保留分析结果）', {});
        } else if (restartFromPhase === 'integration') {
          checkpoint = {
            ...checkpoint,
            phase: 'integration',
          };
          progress('integration', '从整合阶段重新开始（保留分析和委派结果）', {});
        }
      }
    }

    // ========== 迭代循环 ==========
    let iteration = 0;
    let finalAnalysis = '';
    let allDelegationResults: DelegationResult[] = [];
    let finalIntegration = '';
    let currentTaskDescription = effectiveTaskDescription;
    // 累积的产出物摘要，注入到后续轮次的分析上下文
    let accumulatedDeliverables = '';

    while (iteration < IterationLimits.MAX_ITERATIONS) {
      iteration++;
      progress('iteration', '第 ' + iteration + '/' + IterationLimits.MAX_ITERATIONS + ' 轮迭代开始', { iteration });
      console.log('[executeTeamTask] 第 ' + iteration + ' 轮迭代开始');

      // 如果有前轮产出物，注入到任务描述中
      let roundTaskDescription = currentTaskDescription;
      if (accumulatedDeliverables) {
        roundTaskDescription = currentTaskDescription +
          '\n\n---\n\n## 前几轮已完成的工作\n\n' + accumulatedDeliverables +
          '\n\n请在已有成果基础上继续推进，不要重复已完成的工作，直接规划下一步。';
      }

      // ========== 阶段1：协调者分析任务 ==========
      let analysis: string;
      let delegations: Array<{ to: string; task: string }>;

      const isFirstIteration = iteration === 1;
      const hasCheckpoint = !!(checkpoint && (checkpoint.phase === 'delegation' || checkpoint.phase === 'integration'));

      if (isFirstIteration && hasCheckpoint && checkpoint) {
        // 第一轮且有断点：复用已有分析结果
        analysis = checkpoint.analysis || '';
        delegations = checkpoint.delegationPlan || [];
        progress('analysis', '复用已有分析结果（断点续传）', { delegationsCount: delegations.length });
      } else {
        // 全新分析
        analysis = await this.runAnalysis(taskId, coordinator, systemPrompt, roundTaskDescription, progress, iteration);
        delegations = this.parseDelegates(analysis);

        // 保存断点
        const newCheckpoint: TaskCheckpoint = {
          phase: 'delegation',
          analysis,
          delegationPlan: delegations,
          completedDelegations: [],
          nextDelegationIndex: 0,
          iteration,
        };
        await this.saveCheckpoint(taskId, newCheckpoint);
      }

      // 清除断点引用（第一轮用完就不再需要）
      checkpoint = null;

      if (delegations.length === 0) {
        // 没有委派任务，协调者自己完成了工作
        finalAnalysis = analysis;
        finalIntegration = analysis;
        await this.clearCheckpoint(taskId);
        progress('completed', '任务在第 ' + iteration + ' 轮完成（无需委派）', { iteration });
        return { analysis: finalAnalysis, delegations: allDelegationResults, integration: finalIntegration, iterations: iteration };
      }

      // ========== 阶段2：执行委派 ==========
      progress('delegation', '第 ' + iteration + ' 轮：发现 ' + delegations.length + ' 个委派任务，开始执行...', { delegations, iteration });

      const delegationResults = await this.executeDelegations(
        taskId, coordinator, delegations, progress
      );

      allDelegationResults = allDelegationResults.concat(delegationResults);

      // ========== 阶段3：协调者整合结果 ==========
      progress('integration', coordinator.name + ' 正在整合第 ' + iteration + ' 轮结果...');

      const resultsSummary = delegationResults
        .map(r => r.success ? '【' + r.to + '的回复】' + r.result : '【' + r.to + '失败】' + r.result)
        .join('\n\n');

      let integrationPrompt = '你是团队协调者。你之前分析了任务并委派给团队成员，以下是他们的回复：\n\n' +
        resultsSummary + '\n\n请整合以上所有结果，给出最终的完整回复。';
      
      if (guidance) {
        integrationPrompt += '\n\n---\n\n## 人工指导（整合时必须遵循）\n\n' + guidance;
      }

      const integration = await this.chat(coordinator.id, integrationPrompt, coordinator, undefined, { freshSession: true });

      finalAnalysis = iteration === 1 ? analysis : finalAnalysis + '\n\n---\n\n## 第 ' + iteration + ' 轮分析\n\n' + analysis;
      finalIntegration = integration;

      // ========== 完成度评估 ==========
      const evaluation = await this.evaluateCompletion(
        coordinator, taskDescription, integration, delegationResults, iteration, progress
      );

      progress('evaluation', '完成度评估: ' + (evaluation.isComplete ? '已完成 ✅' : '未完成，需继续 🔄') + ' — ' + evaluation.reason, {
        iteration,
        isComplete: evaluation.isComplete,
        reason: evaluation.reason,
        nextSteps: evaluation.nextSteps,
      });

      if (evaluation.isComplete) {
        // 任务真正完成
        await this.clearCheckpoint(taskId);
        progress('completed', '任务在第 ' + iteration + ' 轮迭代后完成', { iteration, reason: evaluation.reason });
        return { analysis: finalAnalysis, delegations: allDelegationResults, integration: finalIntegration, iterations: iteration };
      }

      // 未完成——更新产出物摘要，准备下一轮
      const successItems = delegationResults
        .filter(r => r.success)
        .map(r => '**' + r.to + '**: ' + r.task.slice(0, 80) + ' — ✅ 已完成')
        .join('\n');
      accumulatedDeliverables += (accumulatedDeliverables ? '\n\n' : '') + '### 第 ' + iteration + ' 轮产出\n' + successItems;

      // 如果评估中包含 nextSteps，直接用它们构建下一轮任务描述
      if (evaluation.nextSteps && evaluation.nextSteps.length > 0) {
        const nextStepsDesc = evaluation.nextSteps
          .map(s => '- 委派 ' + s.to + ': ' + s.task)
          .join('\n');
        accumulatedDeliverables += '\n\n### 下一轮待完成\n' + nextStepsDesc;
      }

      console.log('[executeTeamTask] 第 ' + iteration + ' 轮未完成，继续迭代。原因: ' + evaluation.reason);
    }

    // 达到最大迭代次数
    await this.clearCheckpoint(taskId);
    progress('completed', '已达到最大迭代次数 (' + IterationLimits.MAX_ITERATIONS + ')，任务结束', { iterations: iteration });
    return { analysis: finalAnalysis, delegations: allDelegationResults, integration: finalIntegration, iterations: iteration };
  }

  /**
   * 执行一轮委派任务
   * 
   * 从 executeTeamTask 中抽取，支持断点保存
   */
  private async executeDelegations(
    taskId: string,
    coordinator: AgentConfig,
    delegations: Array<{ to: string; task: string }>,
    progress: (phase: string, message: string, detail?: any) => void
  ): Promise<DelegationResult[]> {
    const delegationResults: DelegationResult[] = [];
    const visibleAgents = await agentService.getVisibleAgents(coordinator.id);

    for (let i = 0; i < delegations.length; i++) {
      const delegation = delegations[i];
      progress('delegation', '委派 ' + (i + 1) + '/' + delegations.length + ': ' + delegation.to + ' - ' + delegation.task.slice(0, 30));

      const targetAgent = visibleAgents.find(a => a.name === delegation.to);
      if (!targetAgent) {
        delegationResults.push({ to: delegation.to, task: delegation.task, result: '未找到该同事', success: false });
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
      console.log('[executeDelegations] 委派到: ' + delegation.to + ', model=' + targetAgent.model);

      try {
        const record = await agentService.createDelegationRecord(coordinator.id, targetAgent.id, delegation.task);
        const result = await this.chat(targetAgent.id, delegation.task, targetConfig, undefined, { freshSession: true });
        await agentService.updateDelegationRecord(record.id, result, 'completed');
        delegationResults.push({ to: delegation.to, task: delegation.task, result, success: true });

        await agentService.recordCollaboration(coordinator.id, targetAgent.id, {
          taskId: record.id,
          task: delegation.task,
          result: result.slice(0, 200),
          timestamp: new Date().toISOString(),
          success: true,
        });

        progress('delegation', delegation.to + ' 完成委派', { to: delegation.to, success: true });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        delegationResults.push({ to: delegation.to, task: delegation.task, result: errMsg, success: false });
        progress('delegation', delegation.to + ' 委派失败: ' + errMsg.slice(0, 50), { to: delegation.to, success: false });
        // 单个委派失败不中断整个流程，继续执行其他委派
      }
    }

    return delegationResults;
  }

  /**
   * 执行分析阶段
   */
  private async runAnalysis(
    taskId: string,
    coordinator: AgentConfig,
    systemPrompt: string,
    taskDescription: string,
    progress: (phase: string, message: string, detail?: any) => void,
    iteration: number = 1
  ): Promise<string> {
    const iterationHint = iteration > 1
      ? '\n\n## 当前迭代\n\n这是第 ' + iteration + ' 轮迭代。前面几轮已完成部分工作，请基于已有成果规划本轮任务，不要重复已完成的工作。'
      : '';

    progress('analysis', coordinator.name + ' 正在分析任务...' + (iteration > 1 ? '（第 ' + iteration + ' 轮）' : ''));

    const analysisPrompt = systemPrompt + '\n\n---\n\n## 团队任务\n\n' + taskDescription +
      iterationHint +
      '\n\n请分析这个任务，确定需要委派给哪些同事，以及各自负责什么。如果你自己也能承担部分工作，直接写出来。使用 DELEGATE 标记来委派任务。' +
      '\n\n## 委派原则（必须遵守）\n\n1. **按能力匹配委派**：仔细阅读每位同事的职责和技能，将任务委派给最合适的人。例如文档/Word/Excel相关任务必须委派给文档编辑手，代码相关任务委派给程序员，产品分析任务委派给产品经理。\n2. **不要跨领域委派**：不要把文档任务委派给程序员，不要把代码任务委派给产品经理。\n3. **覆盖所有子任务**：确保任务的每个环节都有对应的人负责，不要遗漏。' +
      '\n\n## 任务执行原则（必须遵守）\n\n1. **目标导向**：先明确"怎样才算完成"，再分配工作。任务必须推进到用户可使用的最终状态。\n2. **不要停在中间环节**：如果当前产出只是中间产物（比如只写了PRD但任务是"编写项目"），必须规划后续步骤继续推进。\n3. **连续推进**：每个环节的产出应该成为下一个环节的输入，直到任务真正完成。';

    return this.chat(coordinator.id, analysisPrompt, coordinator, undefined, { freshSession: true });
  }

  /**
   * 评估任务完成度——让协调者自己判断任务是否真正完成
   * 
   * 不写死流程，由协调者根据任务性质动态决定。
   * 写文档任务可能一轮就完成，编写项目任务可能需要多轮迭代。
   */
  private async evaluateCompletion(
    coordinator: AgentConfig,
    originalTask: string,
    integration: string,
    delegationResults: DelegationResult[],
    iteration: number,
    progress: (phase: string, message: string, detail?: any) => void
  ): Promise<CompletionEvaluation> {
    progress('evaluation', '第 ' + iteration + ' 轮完成，评估任务完成度...');

    const deliverables = delegationResults
      .filter(r => r.success)
      .map(r => '- ' + r.to + ': ' + r.task.slice(0, 100))
      .join('\n');

    const failedList = delegationResults
      .filter(r => !r.success)
      .map(r => '- ' + r.to + ': ' + r.result.slice(0, 100))
      .join('\n');

    const prompt = '你之前执行了以下任务，请评估任务是否已经完成。\n\n' +
      '## 原始任务\n' + originalTask + '\n\n' +
      '## 当前已完成的工作\n' + (deliverables || '无') + '\n\n' +
      (failedList ? '## 失败的工作\n' + failedList + '\n\n' : '') +
      '## 整合结论摘要\n' + integration.slice(0, 2000) + '\n\n' +
      '---\n\n' +
      '请严格评估：**原始任务的目标是否已经全部达成？**\n\n' +
      '- 如果任务只是产出了中间产物（比如只写了PRD但任务是"编写项目"），则任务未完成\n' +
      '- 如果任务要求可交付的最终产物，必须确认最终产物已产出\n' +
      '- 如果是简单的单步任务（比如写一个文档、查一个信息），一轮可能就够了\n\n' +
      '必须回复以下JSON格式，不要输出其他内容：\n' +
      '```json\n' +
      '{\n' +
      '  "isComplete": true 或 false,\n' +
      '  "reason": "为什么完成或未完成",\n' +
      '  "nextSteps": []\n' +
      '}\n' +
      '```\n\n' +
      '如果 isComplete 为 false，nextSteps 中列出下一步需要委派给谁做什么，格式：\n' +
      '```json\n' +
      '"nextSteps": [{"to": "同事名字", "task": "具体任务描述"}]\n' +
      '```';

    const response = await this.chat(coordinator.id, prompt, coordinator, undefined, { freshSession: true });
    
    return this.parseCompletionEvaluation(response);
  }

  /**
   * 解析完成度评估的 JSON 响应
   */
  private parseCompletionEvaluation(text: string): CompletionEvaluation {
    // 尝试从 markdown 代码块中提取 JSON
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
    
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed.isComplete === 'boolean') {
        return {
          isComplete: parsed.isComplete,
          reason: parsed.reason || '',
          nextSteps: Array.isArray(parsed.nextSteps)
            ? parsed.nextSteps.filter((s: any) => s.to && s.task).map((s: any) => ({ to: String(s.to), task: String(s.task) }))
            : [],
        };
      }
    } catch (err) {
      console.warn('[parseCompletionEvaluation] JSON 解析失败，尝试宽松提取:', err);
    }

    // 宽松提取：如果文本中包含完成/未完成关键词，做简单判断
    const lowerText = text.toLowerCase();
    if (lowerText.includes('"iscomplete": true') || lowerText.includes('"isComplete": true')) {
      return { isComplete: true, reason: '协调者判定任务已完成', nextSteps: [] };
    }

    // 默认：认为完成（避免无限循环）
    console.warn('[parseCompletionEvaluation] 无法解析完成度评估，默认视为完成');
    return { isComplete: true, reason: '无法解析评估结果，默认视为完成', nextSteps: [] };
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

/** 迭代限制常量 */
const IterationLimits = {
  MAX_ITERATIONS: 5,
} as const;

/** 全局 AgentExecutor 实例 */
export const agentExecutor = new AgentExecutor();
