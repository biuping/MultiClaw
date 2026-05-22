import { useState, useEffect, useRef } from 'react';
import {
  Drawer,
  Tag,
  Space,
  Button,
  Spin,
  Empty,
  Descriptions,
  Popconfirm,
  message,
  Typography,
  Steps,
  Modal,
  Input,
  Dropdown,
} from 'antd';
import {
  CloseOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  UserOutlined,
  SwapOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  BulbOutlined,
  RedoOutlined,
  AuditOutlined,
  EditOutlined,
  PauseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { taskApi } from '../services/api';

const { Text } = Typography;

const statusConfig: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待执行' },
  running: { color: 'processing', label: '执行中' },
  completed: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' },
  cancelled: { color: 'default', label: '已取消' },
  review: { color: 'warning', label: '待审阅' },
  revising: { color: 'processing', label: '修改中' },
  accepted: { color: 'success', label: '已验收' },
  paused: { color: 'default', label: '已暂停' },
  scheduled: { color: 'purple', label: '定时中' },
};

const markdownComponents = {
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" {...props}>
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...props}>{children}</code>
    );
  }
};

interface TaskProgressEvent {
  taskId: string;
  phase: string;
  message: string;
  detail?: any;
  timestamp: string;
}

interface TaskDetailPanelProps {
  task: any;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export default function TaskDetailPanel({ task, visible, onClose, onRefresh }: TaskDetailPanelProps) {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [progressEvents, setProgressEvents] = useState<TaskProgressEvent[]>([]);
  const [guidance, setGuidance] = useState('');
  const [showGuidance, setShowGuidance] = useState(false);
  const [reviewComment, setReviewComment] = useState('');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'revise' | 'pause'>('revise');
  const [reviews, setReviews] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchMessages = async () => {
    if (!task) return;
    setLoading(true);
    try {
      const res = await taskApi.getMessages(task.id);
      setMessages(res.data.data || []);
    } catch (e) {
      console.error('Failed to fetch task messages:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && task) {
      fetchMessages();
      setProgressEvents([]);
      // 加载审阅记录
      if (task.taskType === 'iterative') {
        taskApi.getReviews(task.id).then(res => {
          setReviews(res.data.data || []);
        }).catch(() => {});
      }
    }
  }, [visible, task?.id]);

  // 监听 WebSocket 任务进度事件
  useEffect(() => {
    if (!visible || !task) return;

    const apiKey = localStorage.getItem('multiclaw_api_key') || '';
    const wsBase = 'ws://' + window.location.host + '/ws';
    const wsUrl = apiKey ? wsBase + '?token=' + encodeURIComponent(apiKey) : wsBase;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'task_progress' && data.taskId === task.id) {
          setProgressEvents(prev => [...prev, data]);
          // 如果任务完成或失败，刷新消息和任务列表
          if (data.phase === 'completed' || data.phase === 'failed') {
            setExecuting(false);
            fetchMessages();
            onRefresh();
          }
          // 如果任务正在执行且我们还在执行中，自动刷新消息
          if (data.phase === 'delegation' || data.phase === 'integration') {
            fetchMessages();
          }
        }
      } catch {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [visible, task?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, progressEvents]);

  const handleExecute = async (mode: 'restart' | 'resume' | 'restart-from-phase' = 'restart', options?: { guidance?: string; restartFromPhase?: string }) => {
    if (!task) return;
    setExecuting(true);
    setProgressEvents([]);
    try {
      const res = await taskApi.execute(task.id, mode, options);
      // 202 = 异步执行已接受
      if (res.status === 202 || res.data.success) {
        const modeLabel = mode === 'resume' ? '从断点恢复执行...' : mode === 'restart-from-phase' ? '从指定阶段重新执行...' : '任务开始执行';
        message.info(modeLabel + '，请关注实时进度');
        onRefresh();
      } else {
        message.error('执行失败: ' + ((res.data as any)?.error || '未知错误'));
        setExecuting(false);
      }
    } catch (e: any) {
      message.error('执行出错');
      setExecuting(false);
    }
  };

  const handleExecuteClick = async () => {
    if (!task) return;
    // 检查是否有断点可恢复
    try {
      const cpRes = await taskApi.getCheckpoint(task.id);
      const checkpoint = cpRes.data?.data;
      if (checkpoint) {
        const phaseLabel: Record<string, string> = {
          analysis: '分析阶段',
          delegation: '委派阶段',
          integration: '整合阶段',
        };
        const completedCount = checkpoint.completedDelegations?.length || 0;
        const totalCount = checkpoint.delegationPlan?.length || 0;
        Modal.confirm({
          title: '选择执行方式',
          content: (
            <div>
              <p>检测到上次执行断点：<strong>{phaseLabel[checkpoint.phase] || checkpoint.phase}</strong></p>
              {checkpoint.phase === 'delegation' && (
                <p>已完成委派 {completedCount}/{totalCount}</p>
              )}
              <p style={{ marginTop: 12 }}>请选择执行方式：</p>
            </div>
          ),
          okText: '断点续传',
          cancelText: '从头开始',
          onOk: () => handleExecute('resume'),
          onCancel: () => handleExecute('restart'),
        });
      } else {
        handleExecute('restart');
      }
    } catch {
      // 查询断点失败，直接从头开始
      handleExecute('restart');
    }
  };

  const handleCancel = async () => {
    if (!task) return;
    try {
      await taskApi.update(task.id, { status: 'cancelled' });
      message.success('任务已取消');
      setExecuting(false);
      onRefresh();
    } catch (e) {
      message.error('取消失败');
    }
  };

  /**
   * 提交审阅反馈
   */
  const handleSubmitReview = async () => {
    if (!task) return;
    try {
      const reviewerId = task.reviewerId || task.coordinatorId;
      await taskApi.submitReview(task.id, {
        reviewerId,
        comment: reviewComment,
        action: reviewAction,
      });
      const actionLabel = reviewAction === 'approve' ? '验收通过' : reviewAction === 'revise' ? '要求修改' : '暂停';
      message.success(actionLabel);
      setShowReviewModal(false);
      setReviewComment('');
      onRefresh();
      // 刷新审阅记录
      const res = await taskApi.getReviews(task.id);
      setReviews(res.data.data || []);
    } catch (e: any) {
      message.error('审阅失败: ' + (e.response?.data?.error || e.message));
    }
  };

  /**
   * 断点重试：从指定阶段重新执行
   */
  const handleRestartFromPhase = (phase: string, phaseLabel: string) => {
    let localGuidance = guidance;
    Modal.confirm({
      title: '从' + phaseLabel + '重新执行',
      content: (
        <div>
          <p>将从 <strong>{phaseLabel}</strong> 重新开始执行：</p>
          {phase === 'analysis' && <p>• 重新分析任务，重新委派，重新整合</p>}
          {phase === 'delegation' && <p>• 保留分析结果，重新执行委派，重新整合</p>}
          {phase === 'integration' && <p>• 保留分析和委派结果，重新整合</p>}
          <div style={{ marginTop: 12 }}>
            <p><strong>人工指导（可选）：</strong></p>
            <Input.TextArea
              rows={3}
              placeholder="输入指导意见，例如：注意生成Word文档时使用write-word技能，确保格式正确..."
              defaultValue={localGuidance}
              onChange={e => { localGuidance = e.target.value; }}
            />
          </div>
        </div>
      ),
      okText: '重新执行',
      cancelText: '取消',
      onOk: () => {
        handleExecute('restart-from-phase', {
          restartFromPhase: phase,
          guidance: localGuidance || undefined,
        });
        setGuidance('');
      },
    });
  };

  if (!task) return null;

  const st = statusConfig[task.status] || statusConfig.pending;

  const getRoleIcon = (msg: any) => {
    if (msg.metadata?.phase === 'delegation') return <SwapOutlined className="text-orange-500" />;
    if (msg.role === 'user') return <UserOutlined className="text-blue-500" />;
    return <RobotOutlined className="text-green-500" />;
  };

  const getRoleLabel = (msg: any) => {
    if (msg.metadata?.delegatedBy) return (msg.metadata.delegateTo || msg.metadata.delegatedBy) + ' (委派)';
    if (msg.role === 'user') return '用户';
    return task.coordinatorName || '协调者';
  };

  // 判断当前阶段（用于 Steps 组件）
  const phaseOrder = ['analysis', 'delegation', 'integration', 'completed'];
  const currentPhaseIdx = progressEvents.length > 0
    ? phaseOrder.indexOf(progressEvents[progressEvents.length - 1].phase)
    : -1;

  return (
    <>
    <Drawer
      title={
        <Space>
          <span>{task.title}</span>
          <Tag color={st.color}>{st.label}</Tag>
        </Space>
      }
      placement="right"
      width={700}
      onClose={onClose}
      open={visible}
      closable={false}
      extra={
        <Space>
          {(task.status === 'pending' || task.status === 'failed' || task.status === 'revising') && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleExecuteClick}
              loading={executing}
            >
              {task.status === 'failed' ? '重新执行' : task.status === 'revising' ? '继续修改' : '执行'}
            </Button>
          )}
          {/* 迭代审阅：待审阅时显示审阅按钮 */}
          {task.taskType === 'iterative' && task.status === 'review' && (
            <Button
              type="primary"
              icon={<AuditOutlined />}
              onClick={() => { setReviewAction('revise'); setShowReviewModal(true); }}
            >
              审阅
            </Button>
          )}
          {/* 迭代审阅：已暂停时可以恢复 */}
          {task.taskType === 'iterative' && task.status === 'paused' && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => { setReviewAction('revise'); setReviewComment('恢复执行'); setShowReviewModal(true); }}
            >
              恢复
            </Button>
          )}
          {/* 定时任务操作 */}
          {task.taskType === 'scheduled' && task.status === 'scheduled' && (
            <>
              <Button
                icon={<ThunderboltOutlined />}
                onClick={async () => {
                  try {
                    await taskApi.trigger(task.id);
                    message.success('已触发立即执行');
                    onRefresh();
                  } catch (e: any) {
                    message.error('触发失败: ' + (e.response?.data?.error || e.message));
                  }
                }}
              >
                立即执行
              </Button>
              <Button
                icon={<PauseOutlined />}
                onClick={async () => {
                  try {
                    await taskApi.pauseSchedule(task.id);
                    message.success('已暂停定时任务');
                    onRefresh();
                  } catch (e: any) {
                    message.error('暂停失败');
                  }
                }}
              >
                暂停
              </Button>
            </>
          )}
          {task.taskType === 'scheduled' && task.status === 'paused' && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={async () => {
                try {
                  await taskApi.resumeSchedule(task.id);
                  message.success('已恢复定时任务');
                  onRefresh();
                } catch (e: any) {
                  message.error('恢复失败');
                }
              }}
            >
              恢复
            </Button>
          )}
          {/* 迭代审阅：修改中时可以提交审阅 */}
          {task.taskType === 'iterative' && task.status === 'revising' && task.result && (
            <Button
              icon={<AuditOutlined />}
              onClick={async () => {
                try {
                  await taskApi.submitForReview(task.id, { result: task.result });
                  message.success('已提交审阅');
                  onRefresh();
                } catch (e: any) {
                  message.error('提交失败');
                }
              }}
            >
              提交审阅
            </Button>
          )}
          {task.status === 'completed' && task.taskType !== 'iterative' && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'restart-analysis',
                    label: '从分析阶段重来',
                    icon: <RedoOutlined />,
                    onClick: () => handleRestartFromPhase('analysis', '分析阶段'),
                  },
                  {
                    key: 'restart-delegation',
                    label: '从委派阶段重来',
                    icon: <RedoOutlined />,
                    onClick: () => handleRestartFromPhase('delegation', '委派阶段'),
                  },
                  {
                    key: 'restart-integration',
                    label: '从整合阶段重来',
                    icon: <RedoOutlined />,
                    onClick: () => handleRestartFromPhase('integration', '整合阶段'),
                  },
                ],
              }}
            >
              <Button icon={<RedoOutlined />}>断点重试</Button>
            </Dropdown>
          )}
          {task.status === 'running' && (
            <Popconfirm title="确认取消？" onConfirm={handleCancel}>
              <Button danger icon={<CloseCircleOutlined />}>取消</Button>
            </Popconfirm>
          )}
          <Button icon={<CloseOutlined />} size="small" onClick={onClose} />
        </Space>
      }
    >
      {/* 任务信息 */}
      <Descriptions size="small" column={3} className="mb-4">
        <Descriptions.Item label="协调者">{task.coordinatorName}</Descriptions.Item>
        <Descriptions.Item label="优先级">
          <Tag color={task.priority === 'high' ? 'red' : task.priority === 'low' ? 'default' : 'blue'}>
            {task.priority === 'high' ? '高' : task.priority === 'low' ? '低' : '中'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="任务类型">
          {task.taskType === 'iterative' ? (
            <Tag color="purple">🔄 迭代审阅</Tag>
          ) : (
            <Tag color="default">📋 标准</Tag>
          )}
        </Descriptions.Item>
        {task.taskType === 'iterative' && (
          <>
            <Descriptions.Item label="审阅人">{task.reviewerName || task.coordinatorName}</Descriptions.Item>
            <Descriptions.Item label="迭代轮次">
              <Tag color={task.iteration > 1 ? 'orange' : 'default'}>第 {task.iteration} 轮</Tag>
            </Descriptions.Item>
          </>
        )}
        {task.taskType === 'scheduled' && (
          <>
            <Descriptions.Item label="调度方式">
              {task.scheduleType === 'once' ? '🕐 一次性' : task.scheduleType === 'interval' ? '🔁 固定间隔' : '📅 Cron'}
            </Descriptions.Item>
            {task.scheduleType === 'interval' && task.scheduleIntervalMs && (
              <Descriptions.Item label="间隔时间">
                {task.scheduleIntervalMs >= 3600000
                  ? `${(task.scheduleIntervalMs / 3600000).toFixed(1)}小时`
                  : task.scheduleIntervalMs >= 60000
                  ? `${(task.scheduleIntervalMs / 60000).toFixed(0)}分钟`
                  : `${(task.scheduleIntervalMs / 1000).toFixed(0)}秒`}
              </Descriptions.Item>
            )}
            {task.scheduleType === 'cron' && task.scheduleExpr && (
              <Descriptions.Item label="Cron">{task.scheduleExpr}</Descriptions.Item>
            )}
            <Descriptions.Item label="下次执行">
              {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString('zh-CN') : '未设定'}
            </Descriptions.Item>
            <Descriptions.Item label="已执行">{task.runCount || 0} 次</Descriptions.Item>
            {task.lastRunAt && (
              <Descriptions.Item label="上次执行">
                {new Date(task.lastRunAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
            )}
          </>
        )}
        <Descriptions.Item label="创建时间">
          {new Date(task.createdAt).toLocaleString('zh-CN')}
        </Descriptions.Item>
      </Descriptions>

      {task.description && (
        <div className="bg-gray-50 rounded p-3 mb-4 text-sm text-gray-600">
          {task.description}
        </div>
      )}

      {/* 人工指导区域 */}
      <div className="mb-4">
        <div 
          className="flex items-center gap-2 cursor-pointer text-sm text-gray-500 hover:text-blue-500"
          onClick={() => setShowGuidance(!showGuidance)}
        >
          <BulbOutlined />
          <span>{showGuidance ? '收起人工指导' : '添加人工指导'}</span>
        </div>
        {showGuidance && (
          <div className="mt-2">
            <Input.TextArea
              rows={3}
              placeholder="输入指导意见或提示，例如：注意使用write-word技能生成Word文档，不要直接输出文本..."
              value={guidance}
              onChange={e => setGuidance(e.target.value)}
            />
            <div className="text-xs text-gray-400 mt-1">
              指导意见将在下次执行时注入到任务描述中，引导 Agent 的行为方向
            </div>
          </div>
        )}
        {task.guidance && !showGuidance && (
          <div className="mt-2 bg-amber-50 rounded p-2 text-xs text-amber-700">
            💡 当前指导: {task.guidance.slice(0, 100)}{task.guidance.length > 100 ? '...' : ''}
          </div>
        )}
      </div>

      {/* 迭代审阅历史记录 */}
      {task.taskType === 'iterative' && reviews.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AuditOutlined className="text-gray-500" />
            <Text strong className="text-sm">审阅记录</Text>
          </div>
          <div className="space-y-2">
            {reviews.map((review: any, idx: number) => (
              <div key={review.id || idx} className="bg-gray-50 rounded p-3">
                <div className="flex items-center justify-between mb-1">
                  <Space>
                    <Tag color="purple">第{review.iteration}轮</Tag>
                    {review.status === 'approve' && <Tag color="success">验收通过</Tag>}
                    {review.status === 'revise' && <Tag color="processing">要求修改</Tag>}
                    {review.status === 'pause' && <Tag color="default">暂停</Tag>}
                  </Space>
                  <Text type="secondary" className="text-xs">
                    {review.reviewerName || '审阅人'} · {new Date(review.createdAt).toLocaleString('zh-CN')}
                  </Text>
                </div>
                {review.comment && (
                  <div className="text-sm text-gray-600 mt-1">{review.comment}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最新审阅反馈 */}
      {task.taskType === 'iterative' && task.reviewComment && reviews.length === 0 && (
        <div className="mb-4">
          <div className="bg-purple-50 rounded p-3">
            <div className="flex items-center gap-2 mb-1">
              <AuditOutlined className="text-purple-500" />
              <Text strong className="text-sm text-purple-700">最新审阅反馈</Text>
            </div>
            <div className="text-sm text-purple-600">{task.reviewComment}</div>
          </div>
        </div>
      )}

      {/* 实时执行进度 */}
      {(executing || progressEvents.length > 0) && (
        <div className="mb-4">
          {currentPhaseIdx >= 0 && currentPhaseIdx < 3 && (
            <Steps
              size="small"
              current={currentPhaseIdx}
              items={[
                { title: '分析', icon: currentPhaseIdx === 0 ? <LoadingOutlined /> : undefined },
                { title: '委派', icon: currentPhaseIdx === 1 ? <LoadingOutlined /> : undefined },
                { title: '整合', icon: currentPhaseIdx === 2 ? <LoadingOutlined /> : undefined },
              ]}
            />
          )}
          {currentPhaseIdx >= 3 && (
            <Steps
              size="small"
              current={3}
              items={[
                { title: '分析', icon: <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
                { title: '委派', icon: <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
                { title: '整合', icon: <CheckCircleOutlined style={{ color: '#52c41a' }} /> },
              ]}
            />
          )}
          {/* 进度日志 */}
          <div className="mt-2 space-y-1 max-h-32 overflow-auto">
            {progressEvents.map((evt, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {evt.phase === 'completed' ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : evt.phase === 'failed' ? (
                  <ExclamationCircleOutlined style={{ color: '#f5222d' }} />
                ) : (
                  <LoadingOutlined spin style={{ color: '#1677ff' }} />
                )}
                <Text type="secondary">{new Date(evt.timestamp).toLocaleTimeString('zh-CN')}</Text>
                <Text>{evt.message}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 对话流 */}
      <div className="flex-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        {loading ? (
          <div className="flex justify-center items-center h-32">
            <Spin />
          </div>
        ) : messages.length === 0 ? (
          <Empty description="暂无消息，点击「执行」开始任务" className="mt-10" />
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div key={msg.id || idx} className="flex gap-3">
                <div className="mt-1">{getRoleIcon(msg)}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Text strong className="text-sm">{getRoleLabel(msg)}</Text>
                    <Text type="secondary" className="text-xs">
                      {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
                    </Text>
                    {msg.metadata?.phase === 'analysis' && <Tag color="purple" className="text-xs">分析</Tag>}
                    {msg.metadata?.phase === 'delegation' && <Tag color="orange" className="text-xs">委派</Tag>}
                    {msg.metadata?.phase === 'integration' && <Tag color="green" className="text-xs">整合</Tag>}
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {msg.content || ''}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </Drawer>

      {/* 审阅操作模态框 */}
      <Modal
        title={
          <Space>
            <AuditOutlined />
            <span>审阅任务</span>
            {task?.taskType === 'iterative' && <Tag color="purple">第{task?.iteration}轮</Tag>}
          </Space>
        }
        open={showReviewModal}
        onCancel={() => { setShowReviewModal(false); setReviewComment(''); }}
        onOk={handleSubmitReview}
        okText={reviewAction === 'approve' ? '确认验收' : reviewAction === 'revise' ? '要求修改' : '暂停任务'}
        width={560}
      >
        <div className="mb-4">
          <Text className="mb-2 block text-sm font-medium">审阅操作</Text>
          <Space>
            <Tag
              color={reviewAction === 'revise' ? 'blue' : 'default'}
              className="cursor-pointer px-3 py-1"
              onClick={() => setReviewAction('revise')}
            >
              <EditOutlined /> 要求修改
            </Tag>
            <Tag
              color={reviewAction === 'approve' ? 'green' : 'default'}
              className="cursor-pointer px-3 py-1"
              onClick={() => setReviewAction('approve')}
            >
              <CheckCircleOutlined /> 验收通过
            </Tag>
            <Tag
              color={reviewAction === 'pause' ? 'default' : 'default'}
              className="cursor-pointer px-3 py-1"
              onClick={() => setReviewAction('pause')}
            >
              <PauseOutlined /> 暂停
            </Tag>
          </Space>
        </div>
        <div>
          <Text className="mb-2 block text-sm font-medium">
            {reviewAction === 'approve' ? '验收备注（可选）' : reviewAction === 'revise' ? '修改意见' : '暂停原因'}
          </Text>
          <Input.TextArea
            rows={4}
            placeholder={
              reviewAction === 'revise'
                ? '描述需要修改的内容，例如：这部分逻辑不对，改成XXX...'
                : reviewAction === 'pause'
                ? '说明暂停原因...'
                : '备注信息...'
            }
            value={reviewComment}
            onChange={e => setReviewComment(e.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}
