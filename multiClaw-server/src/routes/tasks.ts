import { Router } from 'express';
import { taskService } from '../services/task';
import { agentService } from '../services/agent';
import { agentExecutor, AgentConfig } from '../services/agent-executor';
import { emitTaskProgress } from '../services/task-events';
import { getAllTemplates, getCategories, getTemplateById, createTemplate, updateTemplate, deleteTemplate, fillTemplate } from '../services/task-templates';

import { validateBody, createTaskSchema, updateTaskSchema } from '../middleware/validate';

const router = Router();

// 查询任务断点状态
router.get('/:id/checkpoint', async (req, res) => {
  try {
    const checkpoint = await agentExecutor.getCheckpoint(req.params.id);
    res.json({ success: true, data: checkpoint });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取任务模板
router.get('/templates', async (req, res) => {
  try {
    const categories = getCategories();
    const templates = getAllTemplates();
    res.json({ success: true, data: { categories, templates } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 创建自定义模板
router.post('/templates', async (req, res) => {
  try {
    const { name, description, icon, category, titleTemplate, descriptionTemplate, defaultPriority, suggestedCoordinatorRole, agentId, agentName, source } = req.body;
    if (!name || !titleTemplate || !descriptionTemplate) {
      return res.status(400).json({ success: false, error: 'name, titleTemplate, descriptionTemplate 为必填' });
    }
    const template = createTemplate({
      name,
      description: description || '',
      icon: icon || '📋',
      category: category || '自定义',
      titleTemplate,
      descriptionTemplate,
      defaultPriority: defaultPriority || 'medium',
      suggestedCoordinatorRole,
      agentId,
      agentName,
      source: source || 'custom',
    });
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新自定义模板
router.put('/templates/:id', async (req, res) => {
  try {
    const template = updateTemplate(req.params.id, req.body);
    if (!template) {
      return res.status(404).json({ success: false, error: '模板不存在或为内置模板' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除自定义模板
router.delete('/templates/:id', async (req, res) => {
  try {
    const ok = deleteTemplate(req.params.id);
    if (!ok) {
      return res.status(400).json({ success: false, error: '模板不存在或为内置模板不可删除' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取所有任务
router.get('/', async (req, res) => {
  try {
    const { status, coordinatorId } = req.query;
    const tasks = await taskService.getAll({
      status: status as string | undefined,
      coordinatorId: coordinatorId as string | undefined,
    });
    res.json({ success: true, data: tasks });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取单个任务
router.get('/:id', async (req, res) => {
  try {
    const task = await taskService.getById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const messages = await taskService.getMessages(req.params.id);
    res.json({ success: true, data: { ...task, messages } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 创建任务
router.post('/', validateBody(createTaskSchema), async (req, res) => {
  try {
    const { title, description, coordinatorId, priority, taskType, reviewerId, metadata,
      scheduleType, scheduleExpr, scheduleIntervalMs, scheduleAnchor } = req.body;

    // 定时任务校验
    if (taskType === 'scheduled' || scheduleType) {
      if (!scheduleType) {
        return res.status(400).json({ success: false, error: '定时任务必须指定 scheduleType' });
      }
      if (scheduleType === 'cron' && !scheduleExpr) {
        return res.status(400).json({ success: false, error: 'cron 类型必须指定 scheduleExpr' });
      }
      if (scheduleType === 'interval' && !scheduleIntervalMs) {
        return res.status(400).json({ success: false, error: 'interval 类型必须指定 scheduleIntervalMs' });
      }
      if (scheduleType === 'once' && !scheduleAnchor) {
        return res.status(400).json({ success: false, error: 'once 类型必须指定 scheduleAnchor（执行时间）' });
      }
    }

    const task = await taskService.create({
      title,
      description: description || '',
      coordinatorId,
      priority: priority || 'medium',
      taskType: taskType || 'standard',
      reviewerId: reviewerId || coordinatorId,
      metadata,
      scheduleType,
      scheduleExpr,
      scheduleIntervalMs,
      scheduleAnchor,
    });
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新任务
router.put('/:id', validateBody(updateTaskSchema), async (req, res) => {
  try {
    const { title, description, status, priority, result, metadata, taskType, reviewerId, iteration, reviewComment,
      scheduleType, scheduleExpr, scheduleIntervalMs, scheduleAnchor, nextRunAt, lastRunAt, runCount } = req.body;
    const task = await taskService.update(req.params.id, {
      title, description, status, priority, result, metadata, taskType, reviewerId, iteration, reviewComment,
      scheduleType, scheduleExpr, scheduleIntervalMs, scheduleAnchor, nextRunAt, lastRunAt, runCount,
    });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除任务
router.delete('/:id', async (req, res) => {
  try {
    await taskService.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取任务消息
router.get('/:id/messages', async (req, res) => {
  try {
    const messages = await taskService.getMessages(req.params.id);
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ========== 迭代审阅 API ==========

// 获取任务的审阅记录
router.get('/:id/reviews', async (req, res) => {
  try {
    const reviews = await taskService.getReviews(req.params.id);
    res.json({ success: true, data: reviews });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 提交审阅（审阅人给出反馈）
router.post('/:id/review', async (req, res) => {
  try {
    const { reviewerId, comment, action } = req.body;
    if (!reviewerId || !action) {
      return res.status(400).json({ success: false, error: 'reviewerId 和 action 为必填' });
    }
    if (!['approve', 'revise', 'pause'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action 必须为 approve/revise/pause' });
    }
    const task = await taskService.submitReview(req.params.id, reviewerId, comment || '', action);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

// 提交迭代交付（执行人完成一轮修改后提交审阅）
router.post('/:id/submit-for-review', async (req, res) => {
  try {
    const { result } = req.body;
    if (!result) {
      return res.status(400).json({ success: false, error: 'result 为必填' });
    }
    const task = await taskService.submitForReview(req.params.id, result);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

// ========== 定时任务 API ==========

import { triggerScheduledTask, pauseScheduledTask, resumeScheduledTask } from '../services/task-scheduler';

// 立即执行定时任务
router.post('/:id/trigger', async (req, res) => {
  try {
    await triggerScheduledTask(req.params.id);
    res.json({ success: true, message: '定时任务已触发执行' });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

// 暂停定时任务
router.post('/:id/pause-schedule', async (req, res) => {
  try {
    const task = await pauseScheduledTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

// 恢复定时任务
router.post('/:id/resume-schedule', async (req, res) => {
  try {
    const task = await resumeScheduledTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    res.status(400).json({ success: false, error: String(error) });
  }
});

// 执行任务（异步，立即返回 202，通过 WebSocket 推送实时进度）
router.post('/:id/execute', async (req, res) => {
  const taskId = req.params.id;
  const mode: 'restart' | 'resume' | 'restart-from-phase' = req.body.mode === 'resume' ? 'resume' : (req.body.mode === 'restart-from-phase' ? 'restart-from-phase' : 'restart');
  const guidance: string | undefined = req.body.guidance;
  const restartFromPhase: string | undefined = req.body.restartFromPhase;

  try {
    const task = await taskService.getById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    if (task.status === 'running') {
      return res.status(409).json({ success: false, error: '任务正在执行中' });
    }

    // 断点续传模式检查
    if (mode === 'resume') {
      const checkpoint = await agentExecutor.getCheckpoint(taskId);
      if (!checkpoint) {
        return res.status(400).json({ success: false, error: '没有可恢复的断点，请选择从头开始' });
      }
    }

    // 从指定阶段重来检查
    if (mode === 'restart-from-phase' && restartFromPhase) {
      const validPhases = ['analysis', 'delegation', 'integration'];
      if (!validPhases.includes(restartFromPhase)) {
        return res.status(400).json({ success: false, error: '无效的阶段: ' + restartFromPhase + '，有效值: ' + validPhases.join(', ') });
      }
    }

    // 保存 guidance 到任务
    if (guidance) {
      await taskService.update(taskId, { guidance });
    }

    // 从头开始时清理之前的执行结果
    if (mode === 'restart' && (task.status === 'failed' || task.status === 'completed')) {
      await taskService.update(taskId, { status: 'pending', result: undefined, metadata: {}, checkpoint: null, guidance: guidance || null, restartFromPhase: null });
      const db = await (await import('../db')).getDb();
      await db.runAsync('DELETE FROM chat_messages WHERE task_id = ?', [taskId]);
    } else if (mode === 'restart-from-phase') {
      // 从指定阶段重来，保留消息但更新状态
      await taskService.update(taskId, { status: 'pending', result: undefined, guidance: guidance || null, restartFromPhase: restartFromPhase || null });
    } else if (mode === 'resume' && (task.status === 'failed' || task.status === 'completed')) {
      // 续传模式只重置状态，不清除消息和断点
      await taskService.update(taskId, { status: 'pending', result: undefined, guidance: guidance || null });
    }

    // 立即返回 202，后台异步执行
    await taskService.update(taskId, { status: 'running' });
    emitTaskProgress(taskId, mode === 'resume' ? 'resume' : 'analysis', mode === 'resume' ? '从断点恢复执行...' : '任务开始执行...');
    res.status(202).json({ success: true, data: { taskId, status: 'running', mode } });

    // 后台执行
    executeTaskInBackground(taskId, mode).catch((err) => {
      console.error('[task/execute] 后台执行异常:', err);
    });

  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * 后台执行任务（使用 AgentExecutor 统一封装）
 */
async function executeTaskInBackground(taskId: string, mode: 'restart' | 'resume' | 'restart-from-phase' = 'restart') {
  try {
    const task = await taskService.getById(taskId);
    if (!task) return;

    const agent = await agentService.getAgent(task.coordinatorId);
    if (!agent) {
      await taskService.update(taskId, { status: 'failed', result: '协调者 Agent 不存在' });
      emitTaskProgress(taskId, 'failed', '协调者 Agent 不存在');
      return;
    }

    const coordinator: AgentConfig = {
      id: agent.id,
      name: agent.name,
      persona: agent.persona || '',
      skills: agent.skills || [],
      role: agent.role || '',
      model: agent.model || 'default',
      workspace: agent.workspace,
    };

    const taskDescription = task.description || task.title;

    // 保存用户消息（续传模式跳过，避免重复）
    if (mode === 'restart' || mode === 'restart-from-phase') {
      await taskService.addMessage(taskId, task.coordinatorId, 'user', taskDescription);
    }

    // 读取任务上保存的 guidance
    const guidance = task.guidance || undefined;
    const restartFromPhase = task.restartFromPhase || undefined;

    // 使用 AgentExecutor 执行完整流程（支持断点续传 + 人工指导 + 断点重来）
    const result = await agentExecutor.executeTeamTask(
      taskId, coordinator, taskDescription, mode,
      { guidance, restartFromPhase }
    );

    // 保存各阶段消息
    await taskService.addMessage(taskId, task.coordinatorId, 'assistant', result.analysis, { phase: 'analysis' });

    for (const d of result.delegations) {
      if (d.success) {
        await taskService.addMessage(taskId, '', 'assistant', d.result, {
          phase: 'delegation',
          delegateTo: d.to,
          delegatedBy: coordinator.name,
        });
      }
    }

    if (result.delegations.length > 0) {
      await taskService.addMessage(taskId, task.coordinatorId, 'assistant', result.integration, { phase: 'integration' });
    }

    await taskService.update(taskId, { status: 'completed', result: result.integration });
    emitTaskProgress(taskId, 'completed', '任务执行完成', { delegations: result.delegations });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await taskService.update(taskId, { status: 'failed', result: errMsg });
    emitTaskProgress(taskId, 'failed', '任务执行失败: ' + errMsg.slice(0, 100));
  }
}

export default router;
