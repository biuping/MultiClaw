import { useState, useEffect } from 'react';
import { 
  Card, 
  List, 
  Tag, 
  Space, 
  Typography, 
  Alert,
  Empty,
  Spin,
  Select,
  Button,
  Modal,
  Form,
  Input,
  Switch,
  Tooltip,
  message,
  Tabs,
  Popconfirm,
} from 'antd';
import { 
  WarningOutlined, 
  SafetyOutlined, 
  ThunderboltOutlined,
  FileTextOutlined,
  GlobalOutlined,
  CodeOutlined,
  PlusOutlined,
  DeleteOutlined,
  SyncOutlined,
  UserOutlined,
  AppstoreOutlined,
  GithubOutlined,
  FolderOpenOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { Skill, AgentSkill } from '../types';

const { Text, Paragraph } = Typography;

const riskConfig = {
  low: { color: 'green', icon: <SafetyOutlined />, text: '低风险' },
  medium: { color: 'orange', icon: <WarningOutlined />, text: '中风险' },
  high: { color: 'red', icon: <ThunderboltOutlined />, text: '高风险' },
};

const categoryIcons: Record<string, React.ReactNode> = {
  '系统': <ThunderboltOutlined />,
  '文件': <FileTextOutlined />,
  '网络': <GlobalOutlined />,
  '代码': <CodeOutlined />,
};

const skillTypeConfig: Record<string, { color: string; label: string }> = {
  persona: { color: 'purple', label: '人格' },
  tool: { color: 'blue', label: '工具' },
  knowledge: { color: 'cyan', label: '知识' },
};

const sourceConfig: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  'local-path': { color: 'geekblue', label: '本地路径', icon: <FolderOpenOutlined /> },
  'github': { color: 'black', label: 'GitHub', icon: <GithubOutlined /> },
  'custom': { color: 'green', label: '自定义', icon: <EditOutlined /> },
};

export default function SkillsPage() {
  const { 
    skills, isLoadingSkills, fetchSkills,
    agents, fetchAgents,
    agentPrivateSkills, selectedSkillAgentId, isLoadingPrivateSkills,
    fetchAgentPrivateSkills, installAgentSkill, uninstallAgentSkill, toggleAgentSkill,
    setPersonaMode,
  } = useAppStore();

  const [installVisible, setInstallVisible] = useState(false);
  const [installForm] = Form.useForm();
  const [installLoading, setInstallLoading] = useState(false);

  useEffect(() => {
    fetchSkills();
    fetchAgents();
  }, []);

  // 全局技能分组
  const groupedSkills = skills.reduce((acc, skill) => {
    if (!acc[skill.category]) {
      acc[skill.category] = [];
    }
    acc[skill.category].push(skill);
    return acc;
  }, {} as Record<string, Skill[]>);

  // 安装技能
  const handleInstall = async () => {
    try {
      const values = await installForm.validateFields();
      if (!selectedSkillAgentId) {
        message.warning('请先选择 Agent');
        return;
      }
      setInstallLoading(true);
      await installAgentSkill(selectedSkillAgentId, values);
      message.success('技能安装成功');
      setInstallVisible(false);
      installForm.resetFields();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error('安装失败: ' + (e.message || String(e)));
    } finally {
      setInstallLoading(false);
    }
  };

  const handleUninstall = async (skillId: string) => {
    if (!selectedSkillAgentId) return;
    try {
      await uninstallAgentSkill(selectedSkillAgentId, skillId);
      message.success('技能已卸载');
    } catch (e: any) {
      message.error('卸载失败: ' + (e.message || String(e)));
    }
  };

  return (
    <div className="h-full overflow-auto">
      <Tabs
        defaultActiveKey="private"
        items={[
          {
            key: 'private',
            label: (
              <span>
                <UserOutlined /> Agent 私有技能
              </span>
            ),
            children: (
              <>
                <div className="flex justify-between items-center mb-4">
                  <Space>
                    <Text type="secondary">选择 Agent 查看其私有技能：</Text>
                    <Select
                      style={{ width: 200 }}
                      placeholder="选择 Agent"
                      value={selectedSkillAgentId || undefined}
                      onChange={(val) => fetchAgentPrivateSkills(val)}
                      options={agents.map((a) => ({ label: a.name, value: a.id }))}
                    />
                  </Space>
                  {selectedSkillAgentId && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setInstallVisible(true)}
                    >
                      安装技能
                    </Button>
                  )}
                </div>

                {!selectedSkillAgentId ? (
                  <Empty description="请选择一个 Agent" className="mt-20" />
                ) : isLoadingPrivateSkills ? (
                  <div className="flex justify-center items-center h-40">
                    <Spin size="large" />
                  </div>
                ) : agentPrivateSkills.length === 0 ? (
                  <Empty description="该 Agent 暂无私有技能，点击「安装技能」添加" className="mt-20" />
                ) : (
                  <List
                    dataSource={agentPrivateSkills}
                    renderItem={(skill: AgentSkill) => {
                      const typeConf = skillTypeConfig[skill.skillType] || skillTypeConfig.persona;
                      const srcConf = sourceConfig[skill.source] || sourceConfig.custom;
                      const isPersona = skill.skillType === 'persona';
                      return (
                        <List.Item
                          actions={[
                            // 人格类技能：人格模式开关
                            isPersona && skill.enabled ? (
                              <Tooltip title={skill.personaMode === 'on' ? '人格模式：以该人格工作（点击切换为技能模式）' : '技能模式：按需使用（点击切换为人格模式）'} key="persona-mode">
                                <Space size={4}>
                                  <Text type="secondary" className="text-xs">人格</Text>
                                  <Switch
                                    size="small"
                                    checked={skill.personaMode === 'on'}
                                    onChange={(checked) => setPersonaMode(selectedSkillAgentId, skill.skillId, checked ? 'on' : 'off')}
                                  />
                                </Space>
                              </Tooltip>
                            ) : null,
                            // 启用/禁用开关
                            <Tooltip title={skill.enabled ? '点击禁用' : '点击启用'} key="toggle">
                              <Switch
                                size="small"
                                checked={skill.enabled}
                                onChange={(checked) => toggleAgentSkill(selectedSkillAgentId, skill.skillId, checked)}
                              />
                            </Tooltip>,
                            // 刷新按钮
                            ...(skill.source !== 'custom' ? [
                              <Tooltip title="从源刷新" key="refresh">
                                <Button type="text" size="small" icon={<SyncOutlined />} />
                              </Tooltip>,
                            ] : []),
                            // 卸载按钮
                            <Popconfirm
                              title="确定卸载此技能？"
                              onConfirm={() => handleUninstall(skill.skillId)}
                              key="delete"
                            >
                              <Tooltip title="卸载">
                                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                              </Tooltip>
                            </Popconfirm>,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                <Text strong>{skill.name}</Text>
                                <Tag color={typeConf.color}>{typeConf.label}</Tag>
                                <Tag color={srcConf.color} icon={srcConf.icon}>{srcConf.label}</Tag>
                                {!skill.enabled && <Tag color="default">已禁用</Tag>}
                                {isPersona && skill.enabled && skill.personaMode === 'on' && <Tag color="volcano">🎭 人格模式</Tag>}
                                {isPersona && skill.enabled && skill.personaMode === 'off' && <Tag color="geekblue">🔧 技能模式</Tag>}
                              </Space>
                            }
                            description={
                              <span>
                                {skill.description || '无描述'}
                                {skill.sourceUrl && (
                                  <Text type="secondary" className="ml-2 text-xs">
                                    来源: {skill.sourceUrl}
                                  </Text>
                                )}
                              </span>
                            }
                          />
                        </List.Item>
                      );
                    }}
                  />
                )}

                <Alert
                  message="隔离说明"
                  description="私有技能仅存储在对应 Agent 的 workspace 目录中，不影响 OpenClaw 全局配置，卸载后完全清除。"
                  type="info"
                  showIcon
                  className="mt-4"
                />
              </>
            ),
          },
          {
            key: 'global',
            label: (
              <span>
                <AppstoreOutlined /> 全局技能
              </span>
            ),
            children: (
              <>
                <Paragraph className="text-gray-500 mb-4">
                  OpenClaw 原生技能，所有 Agent 共享。只读查看。
                </Paragraph>

                {isLoadingSkills ? (
                  <div className="flex justify-center items-center h-64">
                    <Spin size="large" />
                  </div>
                ) : (
                  Object.entries(groupedSkills).map(([category, categorySkills]) => (
                    <Card
                      key={category}
                      title={
                        <Space>
                          {categoryIcons[category] || <CodeOutlined />}
                          <span>{category}</span>
                          <Tag>{categorySkills.length}</Tag>
                        </Space>
                      }
                      className="mb-4"
                    >
                      <List
                        dataSource={categorySkills}
                        renderItem={(skill) => {
                          const risk = riskConfig[skill.riskLevel];
                          return (
                            <List.Item>
                              <List.Item.Meta
                                title={
                                  <Space>
                                    <Text strong>{skill.name}</Text>
                                    <Tag color={risk.color} icon={risk.icon}>
                                      {risk.text}
                                    </Tag>
                                  </Space>
                                }
                                description={skill.description}
                              />
                            </List.Item>
                          );
                        }}
                      />
                    </Card>
                  ))
                )}

                {skills.length === 0 && (
                  <Empty description="暂无全局技能数据" />
                )}
              </>
            ),
          },
        ]}
      />

      {/* 安装技能弹窗 */}
      <Modal
        title="安装私有技能"
        open={installVisible}
        onCancel={() => { setInstallVisible(false); installForm.resetFields(); }}
        onOk={handleInstall}
        okText="安装"
        confirmLoading={installLoading}
        width={560}
      >
        <Form form={installForm} layout="vertical">
          <Form.Item name="source" label="安装来源" initialValue="local-path" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="local-path">
                <Space><FolderOpenOutlined /> 本地路径</Space>
              </Select.Option>
              <Select.Option value="github">
                <Space><GithubOutlined /> GitHub 仓库</Space>
              </Select.Option>
              <Select.Option value="custom">
                <Space><EditOutlined /> 自定义编写</Space>
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.source !== cur.source}
          >
            {({ getFieldValue }) => {
              const source = getFieldValue('source');
              
              if (source === 'local-path') {
                return (
                  <Form.Item name="path" label="技能目录路径" rules={[{ required: true, message: '请输入路径' }]}>
                    <Input placeholder="/Users/xxx/skills/buffett-perspective" />
                  </Form.Item>
                );
              }

              if (source === 'github') {
                return (
                  <Form.Item name="url" label="GitHub 仓库 URL" rules={[{ required: true, message: '请输入 URL' }]}>
                    <Input placeholder="https://github.com/user/skill-name" />
                  </Form.Item>
                );
              }

              // custom
              return (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Form.Item name="skillId" label="技能 ID" rules={[{ required: true, message: '请输入技能 ID' }]}>
                      <Input placeholder="my-custom-skill" />
                    </Form.Item>
                    <Form.Item name="name" label="技能名称" rules={[{ required: true, message: '请输入名称' }]}>
                      <Input placeholder="我的自定义技能" />
                    </Form.Item>
                  </div>
                  <Form.Item name="description" label="描述">
                    <Input placeholder="简要描述技能用途" />
                  </Form.Item>
                  <Form.Item name="content" label="SKILL.md 内容" rules={[{ required: true, message: '请输入技能内容' }]}>
                    <Input.TextArea
                      placeholder={`---\nname: my-skill\ndescription: 技能描述\n---\n\n# 技能标题\n\n技能正文内容...`}
                      rows={10}
                    />
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>

          <Form.Item name="skillType" label="技能类型" initialValue="persona">
            <Select>
              <Select.Option value="persona">人格技能（角色/行为模式）</Select.Option>
              <Select.Option value="tool">工具技能（操作/流程指导）</Select.Option>
              <Select.Option value="knowledge">知识技能（领域知识）</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
