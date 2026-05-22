/**
 * 任务看板视图
 * 
 * 三列看板：待办 → 执行中 → 已完成
 * 支持拖拽切换任务状态
 */

import { useState, useCallback } from 'react';
import {
  Card,
  Tag,
  Typography,
  message,
  Avatar,
  Tooltip,
} from 'antd';
import {
  RobotOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskApi } from '../services/api';

const { Text } = Typography;

// 看板列定义
const columns = [
  { id: 'pending', title: '📋 待办', color: '#faad14', status: 'pending' },
  { id: 'running', title: '⚡ 执行中', color: '#1677ff', status: 'running' },
  { id: 'scheduled', title: '⏰ 定时中', color: '#722ed1', status: 'scheduled' },
  { id: 'review', title: '🔍 待审阅', color: '#722ed1', status: 'review' },
  { id: 'revising', title: '✏️ 修改中', color: '#eb2f96', status: 'revising' },
  { id: 'completed', title: '✅ 已完成', color: '#52c41a', status: 'completed' },
  { id: 'accepted', title: '🎯 已验收', color: '#13c2c2', status: 'accepted' },
] as const;

// 额外状态列（折叠显示）
const extraColumns = [
  { id: 'failed', title: '❌ 失败', color: '#f5222d', status: 'failed' },
  { id: 'cancelled', title: '🚫 已取消', color: '#8c8c8c', status: 'cancelled' },
  { id: 'paused', title: '⏸️ 已暂停', color: '#8c8c8c', status: 'paused' },
] as const;

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  coordinatorId: string;
  coordinatorName?: string;
  status: string;
  priority: string;
  taskType?: string;
  iteration?: number;
  createdAt: string;
}

interface SortableTaskCardProps {
  task: TaskItem;
  onTaskClick?: (task: TaskItem) => void;
}

function SortableTaskCard({ task, onTaskClick }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityColor = task.priority === 'high' ? 'red' : task.priority === 'low' ? 'default' : 'blue';
  const priorityLabel = task.priority === 'high' ? '高' : task.priority === 'low' ? '低' : '中';

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card
        size="small"
        className="mb-2 cursor-pointer hover:shadow-md transition-shadow"
        onClick={() => onTaskClick?.(task)}
      >
        <div className="flex items-start gap-2">
          <div {...listeners} className="text-gray-300 hover:text-gray-500 mt-1 cursor-grab">
            <HolderOutlined />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{task.title}</div>
            {task.description && (
              <Text type="secondary" className="text-xs line-clamp-2">{task.description.slice(0, 60)}</Text>
            )}
            <div className="flex items-center gap-2 mt-2">
              <Tag color={priorityColor} style={{ margin: 0, fontSize: 11 }}>{priorityLabel}</Tag>
              {task.taskType === 'iterative' && (
                <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>🔄 迭代</Tag>
              )}
              {task.taskType === 'scheduled' && (
                <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>⏰ 定时</Tag>
              )}
              {task.taskType === 'iterative' && (task.iteration ?? 0) > 1 && (
                <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>第{task.iteration}轮</Tag>
              )}
              {task.coordinatorName && (
                <Tooltip title={task.coordinatorName}>
                  <Avatar size={18} icon={<RobotOutlined />} style={{ fontSize: 10 }} />
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

interface TaskBoardProps {
  tasks: TaskItem[];
  onRefresh: () => void;
  onTaskClick?: (task: TaskItem) => void;
}

export default function TaskBoard({ tasks, onRefresh, onTaskClick }: TaskBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = String(active.id);
    const targetColumnId = String(over.id);

    // 找到目标状态
    const allCols = [...columns, ...extraColumns];
    const targetCol = allCols.find(c => c.id === targetColumnId);
    if (!targetCol) return;

    // 找到当前任务
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === targetCol.status) return;

    // 更新任务状态
    try {
      await taskApi.update(taskId, { status: targetCol.status });
      message.success('任务状态已更新为: ' + targetCol.title.replace(/[^\u4e00-\u9fa5]/g, '').trim());
      onRefresh();
    } catch (e: any) {
      message.error('更新失败: ' + e.message);
    }
  }, [tasks, onRefresh]);

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full overflow-x-auto pb-4">
        {columns.map(col => {
          const colTasks = tasks.filter(t => t.status === col.status);
          return (
            <div
              key={col.id}
              id={col.id}
              className="flex-shrink-0 w-80 bg-gray-50 rounded-lg p-3 flex flex-col"
              style={{ minHeight: 300 }}
            >
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                <Text strong>{col.title}</Text>
                <Tag style={{ margin: 0 }}>{colTasks.length}</Tag>
              </div>
              <div className="flex-1 overflow-auto">
                {colTasks.map(task => (
                  <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
                ))}
                {colTasks.length === 0 && (
                  <div className="text-center text-gray-300 text-sm py-8">
                    拖拽任务到此处
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* 额外列（可折叠） */}
        {showExtra && extraColumns.map(col => {
          const colTasks = tasks.filter(t => t.status === col.status);
          return (
            <div
              key={col.id}
              id={col.id}
              className="flex-shrink-0 w-80 bg-gray-50 rounded-lg p-3 flex flex-col"
              style={{ minHeight: 200 }}
            >
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: col.color }} />
                <Text strong>{col.title}</Text>
                <Tag style={{ margin: 0 }}>{colTasks.length}</Tag>
              </div>
              <div className="flex-1 overflow-auto">
                {colTasks.map(task => (
                  <SortableTaskCard key={task.id} task={task} onTaskClick={onTaskClick} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 折叠/展开额外列 */}
      <div className="mt-2">
        <Text
          className="text-xs cursor-pointer text-gray-400 hover:text-blue-500"
          onClick={() => setShowExtra(!showExtra)}
        >
          {showExtra ? '收起' : '显示失败/取消列 ▸'}
        </Text>
      </div>

      <DragOverlay>
        {activeTask ? (
          <Card size="small" className="shadow-lg w-72">
            <Text strong className="text-sm">{activeTask.title}</Text>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
