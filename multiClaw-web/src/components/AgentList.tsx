import { useState } from 'react';
import { 
  List, 
  Avatar, 
  Tag, 
  Button, 
  Empty, 
  Input,
  Space,
  Tooltip
} from 'antd';
import { 
  RobotOutlined, 
  MessageOutlined, 
  EditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { Agent } from '../types';
import AgentFormModal from './AgentFormModal';

const { Search } = Input;

interface AgentListProps {
  onChat: (agent: Agent) => void;
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
  ready: { color: 'success', icon: <CheckCircleOutlined />, text: '就绪' },
  chatting: { color: 'processing', icon: <LoadingOutlined />, text: '对话中' },
  error: { color: 'error', icon: <CloseCircleOutlined />, text: '异常' },
  // 兼容旧数据
  online: { color: 'success', icon: <CheckCircleOutlined />, text: '就绪' },
  offline: { color: 'default', icon: <CloseCircleOutlined />, text: '未就绪' },
};

export default function AgentList({ onChat }: AgentListProps) {
  const { agents, skills, isLoadingAgents, fetchAgents, selectAgent } = useAppStore();
  const [searchText, setSearchText] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const filteredAgents = agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(searchText.toLowerCase()) ||
      agent.role?.toLowerCase().includes(searchText.toLowerCase()) ||
      agent.tags?.some((tag) => tag.toLowerCase().includes(searchText.toLowerCase()))
  );

  const handleEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setModalVisible(true);
  };

  const handleSubmit = async (values: any) => {
    if (editingAgent) {
      await useAppStore.getState().updateAgent(editingAgent.id, values);
    }
    setModalVisible(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <Space className="w-full">
          <Search
            placeholder="搜索 Agent..."
            allowClear
            onSearch={setSearchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="flex-1"
          />
          <Button
            icon={<SyncOutlined />}
            onClick={fetchAgents}
            loading={isLoadingAgents}
          />
        </Space>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {filteredAgents.length === 0 ? (
          <Empty description="暂无 Agent" className="mt-8" />
        ) : (
          <List
            dataSource={filteredAgents}
            renderItem={(agent) => {
              const status = statusConfig[agent.status];
              return (
                <List.Item
                  key={agent.id}
                  className="cursor-pointer hover:bg-gray-50 rounded-lg transition-colors"
                  onClick={() => selectAgent(agent)}
                  actions={[
                    <Tooltip title="对话">
                      <Button
                        type="text"
                        icon={<MessageOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChat(agent);
                        }}
                      />
                    </Tooltip>,
                    <Tooltip title="编辑">
                      <Button
                        type="text"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(agent);
                        }}
                      />
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size={48}
                        src={agent.avatar || undefined}
                        icon={!agent.avatar && <RobotOutlined />}
                        className="bg-primary"
                      />
                    }
                    title={
                      <Space>
                        <span className="font-semibold">{agent.name}</span>
                        <Tag color={status.color} icon={status.icon}>
                          {status.text}
                        </Tag>
                      </Space>
                    }
                    description={
                      <div>
                        {agent.role && (
                          <div className="text-gray-500 text-sm mb-1">{agent.role}</div>
                        )}
                        <Space size="small" wrap>
                          {agent.tags?.map((tag) => (
                            <Tag key={tag}>{tag}</Tag>
                          ))}
                        </Space>
                        {agent.skills?.length > 0 && (
                          <div className="mt-1 text-xs text-gray-400">
                            {agent.skills.length} 个技能
                          </div>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </div>

      <AgentFormModal
        visible={modalVisible}
        agent={editingAgent}
        skills={skills}
        onCancel={() => setModalVisible(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}