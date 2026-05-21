import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Avatar, Badge, Tag, Button, Dropdown, Tooltip } from 'antd';
import { 
  MoreOutlined, 
  MessageOutlined, 
  EditOutlined, 
  DeleteOutlined,
  RobotOutlined,
  CodeOutlined,
  SettingOutlined,
  FileTextOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { Agent } from '../types';

interface AgentNodeData {
  agent: Agent;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onChat: (agent: Agent) => void;
}

const statusColors: Record<string, string> = {
  ready: '#52c41a',
  chatting: '#1677ff',
  error: '#f5222d',
  online: '#52c41a',
  offline: '#d9d9d9',
};

const statusText: Record<string, string> = {
  ready: '就绪',
  chatting: '对话中',
  error: '异常',
  online: '就绪',
  offline: '未就绪',
};

// 角色图标映射
const roleIcons: Record<string, React.ReactNode> = {
  技术: <CodeOutlined style={{ fontSize: 16 }} />,
  开发: <CodeOutlined style={{ fontSize: 16 }} />,
  程序: <CodeOutlined style={{ fontSize: 16 }} />,
  产品: <FileTextOutlined style={{ fontSize: 16 }} />,
  设计: <ExperimentOutlined style={{ fontSize: 16 }} />,
  管理: <SettingOutlined style={{ fontSize: 16 }} />,
  秘书: <SettingOutlined style={{ fontSize: 16 }} />,
};

// 角色背景色
const roleColors: Record<string, string> = {
  技术: '#e6f7ff',
  开发: '#e6f7ff',
  程序: '#e6f7ff',
  产品: '#fff7e6',
  设计: '#f9f0ff',
  管理: '#f6ffed',
  秘书: '#f6ffed',
};

// 角色边框色
const roleBorderColors: Record<string, string> = {
  技术: '#91d5ff',
  开发: '#91d5ff',
  程序: '#91d5ff',
  产品: '#ffd591',
  设计: '#d3adf7',
  管理: '#b7eb8f',
  秘书: '#b7eb8f',
};

function getRoleKey(role: string): string {
  for (const key of Object.keys(roleIcons)) {
    if (role.includes(key)) return key;
  }
  return '';
}

const AgentNode = memo(({ data, selected }: NodeProps<AgentNodeData>) => {
  const { agent, onEdit, onDelete, onChat } = data;
  const roleKey = getRoleKey(agent.role || '');
  const bgColor = roleKey ? roleColors[roleKey] : '#ffffff';
  const borderColor = roleKey ? roleBorderColors[roleKey] : (selected ? '#1677ff' : '#e8e8e8');
  const roleIcon = roleKey ? roleIcons[roleKey] : <RobotOutlined style={{ fontSize: 16 }} />;

  const menuItems = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '编辑',
      onClick: () => onEdit(agent),
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: () => onDelete(agent),
    },
  ];

  return (
    <div
      className="agent-node"
      style={{
        background: bgColor,
        border: '2px solid ' + borderColor,
        borderRadius: 12,
        boxShadow: selected
          ? '0 4px 16px rgba(22, 119, 255, 0.25)'
          : '0 2px 8px rgba(0, 0, 0, 0.08)',
        transition: 'all 0.2s ease',
        minWidth: 200,
      }}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <Badge
            dot
            color={statusColors[agent.status]}
            offset={[-5, 40]}
            style={{
              boxShadow: agent.status === 'chatting'
                ? '0 0 0 3px rgba(22, 119, 255, 0.2)'
                : 'none',
              animation: agent.status === 'chatting' ? 'pulse 2s ease-in-out infinite' : 'none',
            }}
          >
            <Avatar
              size={48}
              src={agent.avatar || undefined}
              icon={!agent.avatar && roleIcon}
              style={{
                backgroundColor: roleKey ? roleBorderColors[roleKey] : '#1677ff',
                color: '#fff',
              }}
            />
          </Badge>
          
          <div className="flex gap-1">
            <Tooltip title="对话">
              <Button
                type="text"
                size="small"
                icon={<MessageOutlined />}
                onClick={() => onChat(agent)}
              />
            </Tooltip>
            <Dropdown menu={{ items: menuItems }} placement="bottomRight">
              <Button type="text" size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </div>
        </div>

        <div className="mb-2">
          <h4 className="font-semibold text-base m-0 truncate">{agent.name}</h4>
          {agent.role && (
            <p className="text-gray-500 text-sm m-0 truncate flex items-center gap-1">
              {roleIcon}
              <span>{agent.role}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-1 mb-2">
          <Tag
            color={statusColors[agent.status] === '#52c41a' ? 'success' : statusColors[agent.status] === '#1677ff' ? 'processing' : 'error'}
            style={{ margin: 0 }}
          >
            {statusText[agent.status]}
          </Tag>
          {agent.tags?.slice(0, 2).map((tag) => (
            <Tag key={tag} style={{ margin: 0 }}>{tag}</Tag>
          ))}
        </div>

        {agent.skills?.length > 0 && (
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <CodeOutlined /> {agent.skills.length} 个技能
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});

AgentNode.displayName = 'AgentNode';

export default AgentNode;
