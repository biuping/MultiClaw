/**
 * 定时任务调度器
 * 
 * 启动时加载所有活跃的定时任务，每 30 秒检查一次是否有需要执行的任务。
 * 执行完成后更新 lastRunAt、runCount，并计算下次执行时间。
 */

import { taskService, computeNextRun, Task } from './task';
import { agentExecutor, AgentConfig } from './agent-executor';
import { agentService } from './agent';
import { emitTaskProgress } from './task-events';

const CHECK_INTERVAL_MS = 30_000; // 30秒检查一次

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动定时任务调度器
 */
export function startScheduler(): void {
  if (timer) return; // 防止重复启动

  console.log('[scheduler] 定时任务调度器启动，检查间隔: ' + (CHECK_INTERVAL_MS / 1000) + 's');

  // 立即检查一次
  checkAndRun().catch(err => {
    console.error('[scheduler] 初始检查失败:', err);
  });

  timer = setInterval(async () => {
    try {
      await checkAndRun();
    } catch (err) {
      console.error('[scheduler] 检查失败:', err);
    }
  }, CHECK_INTERVAL_MS);
}

/**
 * 停止调度器
 */
export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[scheduler] 定时任务调度器已停止');
  }
}

/**
 * 检查并执行到期的定时任务
 */
async function checkAndRun(): Promise<void> {
  const now = new Date().toISOString();

  // 查找所有状态为 scheduled 且 next_run_at <= now 的任务
  const allScheduled = await taskService.getAll({ taskType: 'scheduled' });
  const due = allScheduled.filter(t => 
    t.status === 'scheduled' && t.nextRunAt && t.nextRunAt <= now
  );

  if (due.length === 0) return;

  console.log('[scheduler] 发现 ' + due.length + ' 个到期定时任务');

  for (const task of due) {
    try {
      await executeScheduledTask(task);
    } catch (err) {
      console.error('[scheduler] 执行定时任务失败: ' + task.id, err);
      // 更新状态为 failed 但不取消定时（下次还会继续）
      const nextRun = computeNextRun(task);
      await taskService.update(task.id, {
        status: 'scheduled',
        lastRunAt: now,
        runCount: task.runCount + 1,
        nextRunAt: nextRun || undefined,
        result: '执行失败: ' + String(err).slice(0, 200),
      });
    }
  }
}

/**
 * 执行单个定时任务
 */
async function executeScheduledTask(task: Task): Promise<void> {
  const now = new Date().toISOString();
  console.log('[scheduler] 执行定时任务: ' + task.title + ' (第' + (task.runCount + 1) + '次)');

  // 先标记为 running
  await taskService.update(task.id, { status: 'running' });
  emitTaskProgress(task.id, 'analysis', '定时任务自动执行...');

  try {
    const agent = await agentService.getAgent(task.coordinatorId);
    if (!agent) {
      throw new Error('协调者 Agent 不存在');
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

    // 保存用户消息
    await taskService.addMessage(task.id, task.coordinatorId, 'user', '[定时执行] ' + taskDescription, {
      phase: 'scheduled',
      runCount: task.runCount + 1,
    });

    const result = await agentExecutor.executeTeamTask(
      task.id, coordinator, taskDescription, 'restart'
    );

    // 保存执行结果
    await taskService.addMessage(task.id, task.coordinatorId, 'assistant', result.analysis, { phase: 'analysis' });
    for (const d of result.delegations) {
      if (d.success) {
        await taskService.addMessage(task.id, '', 'assistant', d.result, {
          phase: 'delegation',
          delegateTo: d.to,
          delegatedBy: coordinator.name,
        });
      }
    }
    if (result.delegations.length > 0) {
      await taskService.addMessage(task.id, task.coordinatorId, 'assistant', result.integration, { phase: 'integration' });
    }

    // 计算下次执行时间
    const updatedTask = { ...task, runCount: task.runCount + 1, lastRunAt: now } as Task;
    const nextRun = computeNextRun(updatedTask);

    // once 类型执行完就 completed，其他类型继续 scheduled
    const newStatus = (task.scheduleType === 'once') ? 'completed' : 'scheduled';

    await taskService.update(task.id, {
      status: newStatus,
      result: result.integration,
      lastRunAt: now,
      runCount: task.runCount + 1,
      nextRunAt: nextRun || undefined,
    });

    if (newStatus === 'completed') {
      emitTaskProgress(task.id, 'completed', '一次性定时任务执行完成');
    } else {
      emitTaskProgress(task.id, 'completed', '定时任务执行完成，下次执行: ' + (nextRun ? new Date(nextRun).toLocaleString('zh-CN') : '未设定'));
    }

    console.log('[scheduler] 定时任务完成: ' + task.title + (nextRun ? '，下次: ' + new Date(nextRun).toLocaleString() : ''));

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // 计算下次执行时间（即使失败也继续）
    const updatedTask = { ...task, runCount: task.runCount + 1, lastRunAt: now } as Task;
    const nextRun = computeNextRun(updatedTask);

    await taskService.update(task.id, {
      status: 'scheduled',
      result: '执行失败: ' + errMsg.slice(0, 200),
      lastRunAt: now,
      runCount: task.runCount + 1,
      nextRunAt: nextRun || undefined,
    });

    emitTaskProgress(task.id, 'failed', '定时任务执行失败: ' + errMsg.slice(0, 100));
    console.error('[scheduler] 定时任务失败: ' + task.title, errMsg);
  }
}

/**
 * 手动触发指定定时任务（立即执行）
 */
export async function triggerScheduledTask(taskId: string): Promise<void> {
  const task = await taskService.getById(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.taskType !== 'scheduled') throw new Error('不是定时任务');

  await taskService.update(taskId, { nextRunAt: new Date().toISOString() });
  await executeScheduledTask(task);
}

/**
 * 暂停定时任务
 */
export async function pauseScheduledTask(taskId: string): Promise<Task | null> {
  return taskService.update(taskId, { status: 'paused' });
}

/**
 * 恢复定时任务（重新计算下次执行时间）
 */
export async function resumeScheduledTask(taskId: string): Promise<Task | null> {
  const task = await taskService.getById(taskId);
  if (!task) return null;

  const nextRun = computeNextRun(task);
  return taskService.update(taskId, {
    status: 'scheduled',
    nextRunAt: nextRun || undefined,
  });
}
