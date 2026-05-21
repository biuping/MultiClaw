import { EventEmitter } from 'events';

/**
 * 任务事件总线
 * 
 * 路由层通过此总线发射任务进度事件，
 * WebSocket 层监听并转发给前端。
 * 
 * 解耦 HTTP 路由和 WebSocket 连接管理。
 */
export const taskEvents = new EventEmitter();

// 增大监听上限（避免 warning）
taskEvents.setMaxListeners(50);

/** 任务进度事件类型 */
export interface TaskProgressEvent {
  taskId: string;
  phase: 'analysis' | 'delegation' | 'integration' | 'completed' | 'failed' | 'resume';
  message: string;
  detail?: any;
  timestamp: string;
}

/**
 * 发射任务进度事件
 */
export function emitTaskProgress(taskId: string, phase: TaskProgressEvent['phase'], message: string, detail?: any) {
  const event: TaskProgressEvent = {
    taskId,
    phase,
    message,
    detail,
    timestamp: new Date().toISOString(),
  };
  taskEvents.emit('task:progress', event);
  console.log(`[task:${taskId}] ${phase}: ${message}`);
}
