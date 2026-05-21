import { useState, useEffect, useRef } from 'react';
import {
  List,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Empty,
  Dropdown,
  Typography,
  message,
  Tabs,
  Card,
  Spin,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  MoreOutlined,
  ReloadOutlined,
  FilterOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SendOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  ImportOutlined,
  ExportOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { taskApi, agentApi } from '../services/api';
import TaskDetailPanel from '../components/TaskDetailPanel';
import TaskBoard from '../components/TaskBoard';

const { Title, Text } = Typography;

const statusConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  pending: { color: 'default', label: '待执行', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', label: '执行中', icon: <LoadingOutlined spin /> },
  completed: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <ExclamationCircleOutlined /> },
  cancelled: { color: 'default', label: '已取消', icon: <CloseCircleOutlined /> },
  review: { color: 'warning', label: '待审阅', icon: <ExclamationCircleOutlined /> },
  revising: { color: 'processing', label: '修改中', icon: <EditOutlined /> },
  accepted: { color: 'success', label: '已验收', icon: <CheckCircleOutlined /> },
  paused: { color: 'default', label: '已暂停', icon: <CloseCircleOutlined /> },
};

const priorityConfig: Record<string, { color: string; label: string }> = {
  low: { color: 'default', label: '低' },
  medium: { color: 'blue', label: '中' },
  high: { color: 'red', label: '高' },
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [createVisible, setCreateVisible] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('list');
  // 快速分发状态
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateCategories, setTemplateCategories] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  // 模板编辑/创建
  const [templateFormVisible, setTemplateFormVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [templateForm] = Form.useForm();
  // 导入
  const importRef = useRef<HTMLInputElement>(null);

  const [dispatchForm] = Form.useForm();
  const [form] = Form.useForm();

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await taskApi.getAll(statusFilter ? { status: statusFilter } : undefined);
      setTasks(res.data.data || []);
    } catch (e) {
      console.error('Failed to fetch tasks:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const res = await agentApi.getAll();
      setAgents(res.data.data || []);
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    }
  };

  const fetchTemplates = async () => {
    try {
      const templateRes = await fetch('/api/tasks/templates', {
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('multiclaw_api_key') || '') },
      });
      const data = await templateRes.json();
      if (data.success) {
        setTemplates(data.data.templates || []);
        setTemplateCategories(data.data.categories || []);
      }
    } catch (e) {
      console.error('Failed to fetch templates:', e);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchTemplates();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [statusFilter]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      await taskApi.create({
        title: values.title,
        description: values.description,
        coordinatorId: values.coordinatorId,
        priority: values.priority,
        taskType: values.taskType || 'standard',
        reviewerId: values.taskType === 'iterative' ? (values.reviewerId || values.coordinatorId) : undefined,
      });
      message.success('任务创建成功');
      form.resetFields();
      setCreateVisible(false);
      fetchTasks();
    } catch (e) {
      // form validation error
    }
  };

  const handleExecute = async (taskId: string, mode: 'restart' | 'resume' = 'restart') => {
    try {
      message.loading({ content: mode === 'resume' ? '从断点恢复执行...' : '任务执行中...', key: taskId, duration: 0 });
      const res = await taskApi.execute(taskId, mode);
      message.destroy(taskId);
      if (res.data.success) {
        message.success(mode === 'resume' ? '断点续传已启动' : '任务执行完成');
      } else {
        message.error('执行失败');
      }
      fetchTasks();
    } catch (e: any) {
      message.destroy(taskId);
      message.error('执行出错');
      fetchTasks();
    }
  };

  const handleExecuteClick = async (taskId: string) => {
    try {
      const cpRes = await taskApi.getCheckpoint(taskId);
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
          onOk: () => handleExecute(taskId, 'resume'),
          onCancel: () => handleExecute(taskId, 'restart'),
        });
      } else {
        handleExecute(taskId, 'restart');
      }
    } catch {
      handleExecute(taskId, 'restart');
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await taskApi.delete(taskId);
      message.success('任务已删除');
      fetchTasks();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await taskApi.update(taskId, { status: 'cancelled' });
      message.success('任务已取消');
      fetchTasks();
    } catch (e) {
      message.error('取消失败');
    }
  };

  const openDetail = (task: any) => {
    setSelectedTask(task);
    setDetailVisible(true);
  };

  // 快速分发（原 TeamTaskPanel 功能）
  const handleQuickDispatch = async () => {
    try {
      const values = await dispatchForm.validateFields();
      setDispatchLoading(true);
      setDispatchResult(null);

      // 创建任务并执行
      const createRes = await taskApi.create({
        title: values.message.slice(0, 50),
        description: values.message,
        coordinatorId: values.coordinatorId,
        priority: values.priority || 'medium',
        taskType: values.taskType || 'standard',
        reviewerId: values.taskType === 'iterative' ? (values.reviewerId || values.coordinatorId) : undefined,
      });

      const taskId = createRes.data.data.id;
      message.loading({ content: '团队分发中...', key: 'dispatch', duration: 0 });

      const execRes = await taskApi.execute(taskId, 'restart');
      message.destroy('dispatch');

      if (execRes.data.success) {
        setDispatchResult(execRes.data.data);
        message.success('任务分发完成');
        fetchTasks();
      } else {
        message.error('分发失败: ' + ((execRes.data as any).error || '未知错误'));
      }
    } catch (e: any) {
      message.destroy('dispatch');
      if (e.errorFields) return; // form validation
      message.error('分发出错: ' + e.message);
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleCreateFromTemplate = async (template: any) => {
    // 优先使用模板指定的 agentId
    let coordinatorId = '';
    if (template.agentId) {
      const found = agents.find((a: any) => a.id === template.agentId);
      if (found) {
        coordinatorId = template.agentId;
      } else {
        // 模板指定的 agent 不存在，提示用户
        Modal.confirm({
          title: 'Agent 不存在',
          content: `模板指定的 Agent「${template.agentName || template.agentId}」不存在，请选择其他 Agent 或取消。`,
          okText: '选择其他 Agent',
          cancelText: '取消',
          onOk: () => {
            // 打开新建任务弹窗，预填模板内容
            form.setFieldsValue({
              title: template.titleTemplate,
              description: template.descriptionTemplate,
              priority: template.defaultPriority || 'medium',
              coordinatorId: agents.length > 0 ? agents[0].id : '',
            });
            setCreateVisible(true);
          },
        });
        return;
      }
    }

    // 没有 agentId 时，按 suggestedCoordinatorRole 匹配
    if (!coordinatorId && template.suggestedCoordinatorRole) {
      const suggested = agents.find((a: any) => a.role?.includes(template.suggestedCoordinatorRole));
      if (suggested) coordinatorId = suggested.id;
    }

    // 还是没有，取第一个 agent
    if (!coordinatorId && agents.length > 0) {
      coordinatorId = agents[0].id;
    }

    if (!coordinatorId) {
      message.warning('没有可用的 Agent，请先创建 Agent');
      return;
    }

    try {
      const res = await taskApi.create({
        title: template.titleTemplate,
        description: template.descriptionTemplate,
        coordinatorId,
        priority: template.defaultPriority || 'medium',
      });
      if (res.data.success) {
        message.success('已从模板创建任务: ' + template.name);
        fetchTasks();
        setActiveTab('list');
        // 自动执行
        const taskId = res.data.data.id;
        taskApi.execute(taskId, 'restart').catch(() => {});
      }
    } catch (e: any) {
      message.error('创建失败: ' + e.message);
    }
  };

  // ========== 模板分享/导入 ==========

  // 导出模板为 JSON 文件
  const handleExportTemplate = (template: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const exportData = {
      multiclawTemplateVersion: 1,
      template: {
        name: template.name,
        description: template.description,
        icon: template.icon,
        category: template.category,
        titleTemplate: template.titleTemplate,
        descriptionTemplate: template.descriptionTemplate,
        defaultPriority: template.defaultPriority,
        suggestedCoordinatorRole: template.suggestedCoordinatorRole,
        agentId: template.agentId || undefined,
        agentName: template.agentName || undefined,
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `multiclaw-template-${template.id || template.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('模板已导出');
  };

  // 导入 JSON 模板文件
  const handleImportTemplate = () => {
    importRef.current?.click();
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.multiclawTemplateVersion || !data.template) {
        message.error('无效的模板文件格式');
        return;
      }

      const t = data.template;
      // 通过 API 保存为自定义模板
      const res = await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + (localStorage.getItem('multiclaw_api_key') || ''),
        },
        body: JSON.stringify({
          ...t,
          id: undefined, // 让后端生成新 ID
          source: 'imported',
        }),
      });

      const result = await res.json();
      if (result.success) {
        message.success('模板导入成功: ' + t.name);
        fetchTemplates();
      } else {
        message.error('导入失败: ' + (result.error || '未知错误'));
      }
    } catch (err: any) {
      message.error('导入失败: ' + err.message);
    }

    // 重置 input
    if (importRef.current) importRef.current.value = '';
  };

  // ========== 模板创建/编辑 ==========

  const openTemplateForm = (template?: any) => {
    setEditingTemplate(template || null);
    if (template) {
      templateForm.setFieldsValue(template);
    } else {
      templateForm.resetFields();
      templateForm.setFieldsValue({ defaultPriority: 'medium', icon: '📋', category: '自定义' });
    }
    setTemplateFormVisible(true);
  };

  const handleSaveTemplate = async () => {
    try {
      const values = await templateForm.validateFields();
      const agentObj = agents.find((a: any) => a.id === values.agentId);

      const templateData = {
        ...values,
        agentName: agentObj?.name,
        source: 'custom',
      };

      if (editingTemplate?.id) {
        // 更新
        const res = await fetch(`/api/tasks/templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (localStorage.getItem('multiclaw_api_key') || ''),
          },
          body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) {
          message.success('模板已更新');
        } else {
          message.error('更新失败');
          return;
        }
      } else {
        // 创建
        const res = await fetch('/api/tasks/templates', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (localStorage.getItem('multiclaw_api_key') || ''),
          },
          body: JSON.stringify(templateData),
        });
        const result = await res.json();
        if (result.success) {
          message.success('模板已创建');
        } else {
          message.error('创建失败');
          return;
        }
      }

      setTemplateFormVisible(false);
      fetchTemplates();
    } catch (e) {
      // form validation
    }
  };

  const handleDeleteTemplate = async (template: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (template.source === 'builtin') {
      message.warning('内置模板不可删除');
      return;
    }
    Modal.confirm({
      title: '删除模板',
      content: `确定删除模板「${template.name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await fetch(`/api/tasks/templates/${template.id}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + (localStorage.getItem('multiclaw_api_key') || '') },
          });
          const result = await res.json();
          if (result.success) {
            message.success('模板已删除');
            fetchTemplates();
          } else {
            message.error('删除失败');
          }
        } catch (err) {
          message.error('删除失败');
        }
      },
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* 隐藏的导入 input */}
      <input
        ref={importRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImportFileChange}
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'list',
            label: '📋 任务列表',
            children: (
              <>
                {/* 头部 */}
                <div className="flex justify-between items-center mb-4">
                  <Space>
                    <Space>
                      <FilterOutlined />
                      {['全部', 'pending', 'running', 'review', 'revising', 'completed', 'accepted', 'paused', 'failed', 'cancelled'].map(s => (
                        <Tag
                          key={s}
                          color={(s === '全部' ? !statusFilter : statusFilter === s) ? 'blue' : 'default'}
                          className="cursor-pointer"
                          onClick={() => setStatusFilter(s === '全部' ? undefined : s)}
                        >
                          {s === '全部' ? '全部' : statusConfig[s]?.label || s}
                        </Tag>
                      ))}
                    </Space>
                  </Space>
                  <Space>
                    <Button
                      icon={<UnorderedListOutlined />}
                      type={viewMode === 'list' ? 'primary' : 'default'}
                      onClick={() => setViewMode('list')}
                      size="small"
                    />
                    <Button
                      icon={<AppstoreOutlined />}
                      type={viewMode === 'board' ? 'primary' : 'default'}
                      onClick={() => setViewMode('board')}
                      size="small"
                    />
                    <Button icon={<ReloadOutlined />} onClick={fetchTasks} loading={loading}>
                      刷新
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
                      新建任务
                    </Button>
                  </Space>
                </div>

                {/* 任务列表/看板 */}
                <div className="flex-1 overflow-auto">
                  {tasks.length === 0 && !loading ? (
                    <Empty description="暂无任务，点击「新建任务」开始" className="mt-20" />
                  ) : viewMode === 'board' ? (
                    <TaskBoard
                      tasks={tasks}
                      onRefresh={fetchTasks}
                      onTaskClick={openDetail}
                    />
                  ) : (
                    <List
                      loading={loading}
                      dataSource={tasks}
                      renderItem={(task) => {
                        const st = statusConfig[task.status] || statusConfig.pending;
                        const pr = priorityConfig[task.priority] || priorityConfig.medium;
                        return (
                          <List.Item
                            className="cursor-pointer hover:bg-gray-50 rounded px-3"
                            onClick={() => openDetail(task)}
                            actions={[
                              <Dropdown
                                key="actions"
                                menu={{
                                  items: [
                                    ...(task.status === 'pending' || task.status === 'failed' ? [{
                                      key: 'execute',
                                      icon: <PlayCircleOutlined />,
                                      label: task.status === 'failed' ? '重新执行' : '执行',
                                      onClick: () => handleExecuteClick(task.id),
                                    }] : []),
                                    ...(task.status === 'running' ? [{
                                      key: 'cancel',
                                      icon: <CloseCircleOutlined />,
                                      label: '取消',
                                      danger: true as const,
                                      onClick: () => handleCancel(task.id),
                                    }] : []),
                                    {
                                      key: 'delete',
                                      icon: <DeleteOutlined />,
                                      label: '删除',
                                      danger: true as const,
                                      onClick: () => handleDelete(task.id),
                                    },
                                  ],
                                }}
                              >
                                <Button type="text" icon={<MoreOutlined />} size="small" />
                              </Dropdown>,
                            ]}
                          >
                            <List.Item.Meta
                              title={
                                <Space>
                                  <span className="font-medium">{task.title}</span>
                                  <Tag color={st.color} icon={st.icon}>{st.label}</Tag>
                                  <Tag color={pr.color}>{pr.label}优先</Tag>
                                  {task.taskType === 'iterative' && (
                                    <Tag color="purple">🔄 迭代</Tag>
                                  )}
                                  {task.taskType === 'iterative' && task.iteration > 1 && (
                                    <Tag color="orange">第{task.iteration}轮</Tag>
                                  )}
                                </Space>
                              }
                              description={
                                <Space size={16} className="text-gray-500 text-xs">
                                  <span>协调者: {task.coordinatorName || '未知'}</span>
                                  {task.taskType === 'iterative' && task.reviewerName && (
                                    <span>审阅人: {task.reviewerName}</span>
                                  )}
                                  <span>消息: {task.messageCount || 0}</span>
                                  <span>创建: {new Date(task.createdAt).toLocaleString('zh-CN')}</span>
                                  {task.description && <span className="max-w-[200px] truncate">{task.description}</span>}
                                </Space>
                              }
                            />
                          </List.Item>
                        );
                      }}
                    />
                  )}
                </div>
              </>
            ),
          },
          {
            key: 'dispatch',
            label: '🚀 快速分发',
            children: (
              <div className="max-w-2xl">
                <Card className="mb-4">
                  <Form form={dispatchForm} layout="vertical">
                    <Form.Item name="coordinatorId" label="协调者" rules={[{ required: true, message: '请选择协调者' }]}>
                      <Select placeholder="选择协调者 Agent">
                        {agents.map((a: any) => (
                          <Select.Option key={a.id} value={a.id}>
                            <Space>
                              <span>{a.name}</span>
                              {a.role && <Tag>{a.role}</Tag>}
                            </Space>
                          </Select.Option>
                        ))}
                      </Select>
                    </Form.Item>
                    <Form.Item name="message" label="任务描述" rules={[{ required: true, message: '请输入任务描述' }]}>
                      <Input.TextArea placeholder="描述你要分配给团队的任务..." rows={4} />
                    </Form.Item>
                    <Form.Item name="priority" label="优先级" initialValue="medium">
                      <Select>
                        <Select.Option value="low">低</Select.Option>
                        <Select.Option value="medium">中</Select.Option>
                        <Select.Option value="high">高</Select.Option>
                      </Select>
                    </Form.Item>
                    <Form.Item name="taskType" label="任务类型" initialValue="standard">
                      <Select>
                        <Select.Option value="standard">📋 标准任务</Select.Option>
                        <Select.Option value="iterative">🔄 迭代审阅</Select.Option>
                      </Select>
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, cur) => prev.taskType !== cur.taskType}>
                      {({ getFieldValue }) =>
                        getFieldValue('taskType') === 'iterative' ? (
                          <Form.Item name="reviewerId" label="审阅人" tooltip="默认为协调者">
                            <Select placeholder="默认为协调者" allowClear>
                              {agents.map((a: any) => (
                                <Select.Option key={a.id} value={a.id}>
                                  <Space>
                                    <span>{a.name}</span>
                                    {a.role && <Tag>{a.role}</Tag>}
                                  </Space>
                                </Select.Option>
                              ))}
                            </Select>
                          </Form.Item>
                        ) : null
                      }
                    </Form.Item>
                    <Form.Item>
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleQuickDispatch}
                        loading={dispatchLoading}
                        size="large"
                      >
                        分发任务
                      </Button>
                    </Form.Item>
                  </Form>
                </Card>

                {dispatchLoading && (
                  <Card className="text-center py-8">
                    <Spin size="large" />
                    <div className="mt-4 text-gray-500">协调者正在分析任务并委派给团队成员...</div>
                  </Card>
                )}

                {dispatchResult && !dispatchLoading && (
                  <Card title="分发结果">
                    {dispatchResult.delegations?.length > 0 && (
                      <div className="mb-4">
                        <Title level={5}>委派详情</Title>
                        {dispatchResult.delegations.map((d: any, i: number) => (
                          <Card key={i} size="small" className="mb-2" type="inner">
                            <Space>
                              <Tag color={d.success ? 'success' : 'error'}>{d.to}</Tag>
                              <span className="text-gray-500">{d.task}</span>
                              {d.success ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <CloseCircleOutlined style={{ color: '#f5222d' }} />}
                            </Space>
                          </Card>
                        ))}
                      </div>
                    )}
                    <div className="text-gray-500 text-sm">任务已创建并执行，可在「任务列表」中查看详情</div>
                  </Card>
                )}
              </div>
            ),
          },
          {
            key: 'templates',
            label: '📑 任务模板',
            children: (
              <div className="overflow-auto">
                {/* 模板页头部操作栏 */}
                <div className="flex justify-between items-center mb-4">
                  <Text type="secondary">点击模板卡片快速创建任务</Text>
                  <Space>
                    <Button icon={<ImportOutlined />} onClick={handleImportTemplate}>
                      导入模板
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openTemplateForm()}>
                      创建模板
                    </Button>
                  </Space>
                </div>

                {templateCategories.map(cat => (
                  <div key={cat} className="mb-6">
                    <Title level={5}>{cat}</Title>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {templates.filter((t: any) => t.category === cat).map((t: any) => (
                        <Card
                          key={t.id}
                          hoverable
                          className="cursor-pointer min-w-0"
                          styles={{ body: { padding: '16px' } }}
                          onClick={() => handleCreateFromTemplate(t)}
                          actions={[
                            <Tooltip title="导出 JSON" key="export">
                              <ExportOutlined onClick={(e) => handleExportTemplate(t, e)} />
                            </Tooltip>,
                            ...(t.source !== 'builtin' ? [
                              <Tooltip title="编辑" key="edit">
                                <EditOutlined onClick={(e) => { e.stopPropagation(); openTemplateForm(t); }} />
                              </Tooltip>,
                              <Tooltip title="删除" key="delete">
                                <DeleteOutlined onClick={(e) => handleDeleteTemplate(t, e)} style={{ color: '#ff4d4f' }} />
                              </Tooltip>,
                            ] : []),
                          ]}
                        >
                          <div className="text-2xl mb-2">{t.icon}</div>
                          <div className="font-semibold mb-1 truncate" title={t.name}>{t.name}</div>
                          <Text
                            type="secondary"
                            className="text-xs block min-h-[2.5em]"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {t.description}
                          </Text>
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            <Tag color={t.defaultPriority === 'high' ? 'red' : t.defaultPriority === 'low' ? 'default' : 'blue'}>
                              {t.defaultPriority === 'high' ? '高优' : t.defaultPriority === 'low' ? '低优' : '中优'}
                            </Tag>
                            {t.agentId && agents.find((a: any) => a.id === t.agentId) && (
                              <Tag color="purple">{agents.find((a: any) => a.id === t.agentId)?.name}</Tag>
                            )}
                            {t.agentId && !agents.find((a: any) => a.id === t.agentId) && (
                              <Tooltip title="指定的 Agent 不存在，创建任务时需重新选择">
                                <Tag color="warning">⚠ Agent 缺失</Tag>
                              </Tooltip>
                            )}
                            {t.source === 'builtin' && <Tag color="cyan">内置</Tag>}
                            {t.source === 'custom' && <Tag color="geekblue">自定义</Tag>}
                            {t.source === 'imported' && <Tag color="lime">导入</Tag>}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
                {templates.length === 0 && (
                  <Empty description="暂无模板，点击「创建模板」或「导入模板」开始" className="mt-10" />
                )}
              </div>
            ),
          },
        ]}
      />

      {/* 新建任务弹窗 */}
      <Modal
        title="新建任务"
        open={createVisible}
        onCancel={() => { setCreateVisible(false); form.resetFields(); }}
        onOk={handleCreate}
        okText="创建"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="例如：写一篇 AI Agent 协作技术博客" />
          </Form.Item>
          <Form.Item name="description" label="任务描述">
            <Input.TextArea placeholder="详细描述任务需求..." rows={4} />
          </Form.Item>
          <Form.Item name="coordinatorId" label="协调者" rules={[{ required: true, message: '请选择协调者' }]}>
            <Select placeholder="选择协调者 Agent">
              {agents.map((a: any) => (
                <Select.Option key={a.id} value={a.id}>
                  <Space>
                    <span>{a.name}</span>
                    {a.role && <Tag>{a.role}</Tag>}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue="medium">
            <Select>
              <Select.Option value="low">低</Select.Option>
              <Select.Option value="medium">中</Select.Option>
              <Select.Option value="high">高</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="taskType" label="任务类型" initialValue="standard">
            <Select>
              <Select.Option value="standard">📋 标准任务</Select.Option>
              <Select.Option value="iterative">🔄 迭代审阅</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.taskType !== cur.taskType}>
            {({ getFieldValue }) =>
              getFieldValue('taskType') === 'iterative' ? (
                <Form.Item name="reviewerId" label="审阅人" tooltip="审阅任务交付的人，默认为协调者">
                  <Select placeholder="默认为协调者" allowClear>
                    {agents.map((a: any) => (
                      <Select.Option key={a.id} value={a.id}>
                        <Space>
                          <span>{a.name}</span>
                          {a.role && <Tag>{a.role}</Tag>}
                        </Space>
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 任务详情面板 */}
      <TaskDetailPanel
        task={selectedTask}
        visible={detailVisible}
        onClose={() => { setDetailVisible(false); setSelectedTask(null); }}
        onRefresh={fetchTasks}
      />

      {/* 模板创建/编辑弹窗 */}
      <Modal
        title={editingTemplate ? '编辑模板' : '创建模板'}
        open={templateFormVisible}
        onCancel={() => { setTemplateFormVisible(false); setEditingTemplate(null); }}
        onOk={handleSaveTemplate}
        okText={editingTemplate ? '保存' : '创建'}
        width={600}
      >
        <Form form={templateForm} layout="vertical">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
              <Input placeholder="例如：代码审查" />
            </Form.Item>
            <Form.Item name="icon" label="图标" initialValue="📋">
              <Input placeholder="emoji 图标" maxLength={4} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入模板描述' }]}>
            <Input placeholder="简要描述模板用途" />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="category" label="分类" initialValue="自定义" rules={[{ required: true }]}>
              <Input placeholder="例如：开发、文档、研究" />
            </Form.Item>
            <Form.Item name="defaultPriority" label="默认优先级" initialValue="medium">
              <Select>
                <Select.Option value="low">低</Select.Option>
                <Select.Option value="medium">中</Select.Option>
                <Select.Option value="high">高</Select.Option>
              </Select>
            </Form.Item>
          </div>
          <Form.Item name="titleTemplate" label="任务标题模板" rules={[{ required: true, message: '请输入标题模板' }]}>
            <Input placeholder="例如：代码审查: {项目/模块名}，{变量}会被替换" />
          </Form.Item>
          <Form.Item name="descriptionTemplate" label="任务描述模板" rules={[{ required: true, message: '请输入描述模板' }]}>
            <Input.TextArea placeholder="详细描述任务内容，支持 {变量名} 占位符" rows={6} />
          </Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="agentId" label="指定 Agent">
              <Select placeholder="选择要执行此任务的 Agent" allowClear>
                {agents.map((a: any) => (
                  <Select.Option key={a.id} value={a.id}>
                    <Space>
                      <span>{a.name}</span>
                      {a.role && <Tag>{a.role}</Tag>}
                    </Space>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="suggestedCoordinatorRole" label="建议角色（备选）">
              <Input placeholder="当指定 Agent 不存在时按角色匹配" />
            </Form.Item>
          </div>
          <Text type="secondary" className="text-xs">
            💡 提示：指定 Agent 后，创建任务时优先使用该 Agent；若 Agent 不存在则按建议角色匹配或提示选择。
          </Text>
        </Form>
      </Modal>
    </div>
  );
}
