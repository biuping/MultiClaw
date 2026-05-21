import { Modal, Form, Select, Tag, Space } from 'antd';
import { useEffect } from 'react';
import { AgentRelation, Agent } from '../types';

const { Option } = Select;

interface RelationFormModalProps {
  visible: boolean;
  relation: AgentRelation | null;
  agents: Agent[];
  sourceAgent: Agent | null;
  targetAgent: Agent | null;
  onCancel: () => void;
  onSubmit: (values: any) => Promise<void>;
}

const relationTypeOptions = [
  { value: 'visible', label: '可见（同事）', color: 'default', desc: 'A 能看到 B，必要时可委派任务' },
  { value: 'trusted', label: '信任（熟络同事）', color: 'green', desc: 'A 信任 B，优先委派任务' },
  { value: 'subordinate', label: '下属', color: 'blue', desc: 'B 是 A 的下属，A 可直接分配任务' },
  { value: 'supervisor', label: '上级', color: 'purple', desc: 'B 是 A 的上级，A 需向 B 汇报' },
];

export default function RelationFormModal({
  visible,
  relation,
  agents,
  sourceAgent,
  targetAgent,
  onCancel,
  onSubmit,
}: RelationFormModalProps) {
  const [form] = Form.useForm();
  const isEdit = !!relation;

  useEffect(() => {
    if (visible) {
      if (relation) {
        form.setFieldsValue({
          sourceId: relation.sourceId,
          targetId: relation.targetId,
          relationType: relation.relationType,
          taskTypes: relation.rules?.taskTypes || [],
          requireReport: relation.rules?.requireReport || false,
          timeout: relation.rules?.timeout || 300,
          keywords: relation.rules?.keywords?.join(', ') || '',
        });
      } else if (sourceAgent && targetAgent) {
        form.setFieldsValue({
          sourceId: sourceAgent.id,
          targetId: targetAgent.id,
          relationType: 'command',
          requireReport: true,
          timeout: 300,
        });
      }
    }
  }, [visible, relation, sourceAgent, targetAgent, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const formattedValues = {
        ...values,
        rules: {
          taskTypes: values.taskTypes || [],
          requireReport: values.requireReport,
          timeout: values.timeout,
          keywords: values.keywords ? values.keywords.split(',').map((k: string) => k.trim()) : [],
        },
      };
      await onSubmit(formattedValues);
      form.resetFields();
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={isEdit ? '编辑关系规则' : '新建关系'}
      open={visible}
      onCancel={handleCancel}
      onOk={handleSubmit}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="sourceId"
          label="发起方 Agent"
          rules={[{ required: true, message: '请选择 Agent' }]}
        >
          <Select placeholder="选择发起方 Agent" disabled={isEdit}>
            {agents.map((agent) => (
              <Option key={agent.id} value={agent.id}>
                <Space>
                  <span>{agent.name}</span>
                  {agent.role && <Tag>{agent.role}</Tag>}
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="targetId"
          label="对方 Agent"
          rules={[{ required: true, message: '请选择 Agent' }]}
        >
          <Select placeholder="选择对方 Agent" disabled={isEdit}>
            {agents.map((agent) => (
              <Option key={agent.id} value={agent.id}>
                <Space>
                  <span>{agent.name}</span>
                  {agent.role && <Tag>{agent.role}</Tag>}
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="relationType"
          label="关系类型"
          rules={[{ required: true, message: '请选择关系类型' }]}
        >
          <Select placeholder="选择关系类型">
            {relationTypeOptions.map((type) => (
              <Option key={type.value} value={type.value}>
                <Space direction="vertical" size={0}>
                  <Tag color={type.color}>{type.label}</Tag>
                  <span className="text-xs text-gray-400">{type.desc}</span>
                </Space>
              </Option>
            ))}
          </Select>
        </Form.Item>

        <div className="bg-blue-50 rounded p-3 mb-4 text-xs text-blue-700">
          💡 提示：关系建立后，发起方 Agent 在对话时能看到对方，并可委派任务。协作越多，信任度越高，关系会自动升级。
        </div>

        {/* 旧的关键词/任务类型匹配已移除，现在由 Agent 自主理解关系 */}
      </Form>
    </Modal>
  );
}
