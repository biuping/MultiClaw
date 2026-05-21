import { Modal, Form, Input, Select, Button, message, Space, Spin, Avatar } from 'antd';
import { RobotOutlined, PlusOutlined } from '@ant-design/icons';
import { useEffect, useState, useRef } from 'react';
import { Agent, Skill } from '../types';
import { agentApi } from '../services/api';

const { TextArea } = Input;
const { Option } = Select;

interface AgentFormModalProps {
  visible: boolean;
  agent: Agent | null;
  skills: Skill[];
  onCancel: () => void;
  onSubmit: (values: any) => Promise<void>;
}

export default function AgentFormModal({
  visible,
  agent,
  skills,
  onCancel,
  onSubmit,
}: AgentFormModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<{id: string, alias?: string, name?: string}[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEdit = !!agent;

  // 加载可用模型
  useEffect(() => {
    if (visible) {
      loadAvailableModels();
    }
  }, [visible]);

  const loadAvailableModels = async () => {
    setLoadingModels(true);
    try {
      const response = await agentApi.getAvailableModels();
      const models = response.data.data || [];
      console.log('Loaded models:', models);
      setAvailableModels(models);
    } catch (error) {
      console.error('Failed to load models:', error);
      message.error('加载模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (visible) {
      if (agent) {
        form.setFieldsValue({
          name: agent.name,
          role: agent.role,
          tags: agent.tags,
          persona: agent.persona,
          skills: agent.skills,
          workspace: agent.workspace,
          model: agent.model || 'default',
        });
        setAvatarUrl(agent.avatar || '');
      } else {
        setTimeout(() => {
          form.resetFields();
          setAvatarUrl('');
        }, 0);
      }
    }
  }, [visible, agent, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      values.avatar = avatarUrl;
      setLoading(true);
      await onSubmit(values);
      message.success(isEdit ? 'Agent 更新成功' : 'Agent 创建成功');
      form.resetFields();
      setAvatarUrl('');
      onCancel();
    } catch (error) {
      console.error('Form submission error:', error);
      message.error(isEdit ? 'Agent 更新失败' : 'Agent 创建失败');
    } finally {
      setLoading(false);
    }
  };

  // 处理本地图片上传
  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const response = await fetch('/api/upload/avatar', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setAvatarUrl(result.data.url);
        message.success('头像上传成功');
      } else {
        message.error(result.error || '上传失败');
      }
    } catch (error) {
      message.error('头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        message.error('图片大小不能超过 2MB');
        return;
      }
      handleAvatarUpload(file);
    }
  };

  // 判断当前头像是否为本地上传（/uploads/ 开头）
  const isUploadedAvatar = avatarUrl.startsWith('/uploads/');

  return (
    <Modal
      title={isEdit ? '编辑 Agent' : '新建 Agent'}
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          {isEdit ? '保存' : '创建'}
        </Button>,
      ]}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          tags: [],
          skills: [],
        }}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="name"
          label="Agent 名称"
          rules={[{ required: true, message: '请输入 Agent 名称' }]}
        >
          <Input placeholder="例如：代码助手" />
        </Form.Item>

        <Form.Item
          name="avatar"
          label="头像"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Avatar
              size={64}
              src={avatarUrl || undefined}
              icon={!avatarUrl && <RobotOutlined />}
              style={{ backgroundColor: '#1677ff', flexShrink: 0 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <Button
                  icon={<PlusOutlined />}
                  loading={avatarUploading}
                  onClick={() => fileInputRef.current?.click()}
                  size="small"
                >
                  选择图片
                </Button>
                {isUploadedAvatar && (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={() => setAvatarUrl('')}
                    style={{ marginLeft: 8 }}
                  >
                    移除
                  </Button>
                )}
              </div>
              <Input
                placeholder="或输入图片 URL"
                value={isUploadedAvatar ? '' : avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                size="small"
              />
            </div>
          </div>
        </Form.Item>

        <Form.Item
          name="role"
          label="角色标签"
        >
          <Input placeholder="例如：程序员、写手、调度秘书" />
        </Form.Item>

        <Form.Item
          name="tags"
          label="标签"
        >
          <Select
            mode="tags"
            placeholder="添加标签"
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          name="model"
          label="使用模型"
          tooltip="从 OpenClaw 配置中加载可用模型"
        >
          <Select 
            placeholder="选择模型" 
            loading={loadingModels}
            notFoundContent={loadingModels ? <Spin size="small" /> : '暂无可用模型'}
          >
            {availableModels.map((model) => (
              <Option key={model.id} value={model.id}>
                {model.alias || model.id}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="persona"
          label="性格 / 角色设定 (Persona)"
        >
          <TextArea
            rows={4}
            placeholder="描述这个 Agent 的性格、专业领域和行为方式..."
          />
        </Form.Item>

        <Form.Item
          name="skills"
          label="技能"
        >
          <Select
            mode="multiple"
            placeholder="选择技能"
            style={{ width: '100%' }}
          >
            {skills.map((skill) => (
              <Option key={skill.id} value={skill.id}>
                <Space>
                  {skill.name}
                  <span className="text-gray-400 text-xs">({skill.riskLevel})</span>
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="workspace"
          label="工作区路径"
        >
          <Input placeholder="例如：/Users/username/workspace/project" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
