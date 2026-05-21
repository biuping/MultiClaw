import { useState, useEffect } from 'react';
import { 
  Layout, 
  Menu, 
  theme,
  Button,
  Space,
  Badge,
  Tooltip,
  message
} from 'antd';
import {
  TeamOutlined,
  NodeIndexOutlined,
  ToolOutlined,
  SettingOutlined,
  ReloadOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { useHotkeys, hotkeyHints } from '../hooks/useHotkeys';
import { gatewayApi } from '../services/api';
import AgentCanvas from '../components/AgentCanvas';
import AgentList from '../components/AgentList';
import ChatPanel from '../components/ChatPanel';
import SkillsPage from './SkillsPage';
import SettingsPage from './SettingsPage';
import TasksPage from './TasksPage';
import { Agent } from '../types';

const { Header, Sider, Content } = Layout;

type MenuKey = 'canvas' | 'agents' | 'skills' | 'settings' | 'tasks';

export default function MainLayout() {
  const [activeMenu, setActiveMenu] = useState<MenuKey>('canvas');
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<{ status: string } | null>(null);
  
  const fetchAgents = useAppStore((state) => state.fetchAgents);
  const fetchSkills = useAppStore((state) => state.fetchSkills);
  
  const { token } = theme.useToken();

  // 全局快捷键
  useHotkeys({
    onClose: () => {
      if (chatVisible) setChatVisible(false);
    },
    onSearch: () => {
      setActiveMenu('agents');
    },
    onNew: () => {
      setActiveMenu('tasks');
    },
  });

  useEffect(() => {
    fetchAgents();
    fetchSkills();
  }, []);

  const checkGatewayStatus = async () => {
    try {
      const response = await gatewayApi.getStatus();
      setGatewayStatus(response.data.data);
    } catch (error) {
      setGatewayStatus({ status: 'offline' });
    }
  };

  useEffect(() => {
    checkGatewayStatus();
    const interval = setInterval(checkGatewayStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRestartGateway = async () => {
    try {
      await gatewayApi.restart();
      message.success('网关重启中...');
      setTimeout(checkGatewayStatus, 3000);
    } catch (error) {
      message.error('重启失败');
    }
  };

  const handleChat = (agent: Agent) => {
    setChatAgent(agent);
    setChatVisible(true);
  };

  const menuItems = [
    {
      key: 'canvas',
      icon: <NodeIndexOutlined />,
      label: '关系画布',
    },
    {
      key: 'tasks',
      icon: <UnorderedListOutlined />,
      label: '任务管理',
    },
    {
      key: 'agents',
      icon: <TeamOutlined />,
      label: 'Agent 列表',
    },
    {
      key: 'skills',
      icon: <ToolOutlined />,
      label: '技能库',
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '设置',
    },
  ];

  const renderContent = () => {
    switch (activeMenu) {
      case 'canvas':
        return <AgentCanvas />;
      case 'agents':
        return <AgentList onChat={handleChat} />;
      case 'skills':
        return <SkillsPage />;
      case 'tasks':
        return <TasksPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <AgentCanvas />;
    }
  };

  return (
    <Layout className="h-screen">
      <Header className="flex items-center justify-between px-6" style={{ background: token.colorBgContainer }}>
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold text-primary">MultiClaw</div>
          <span className="text-gray-400">|</span>
          <span className="text-gray-600">OpenClaw 多 Agent 协同平台</span>
        </div>
        
        <Space>
          <Tooltip title={hotkeyHints.ctrlK.desc + ' (' + hotkeyHints.ctrlK.label + ')'}>
            <Button type="text" size="small" className="text-gray-400">⌘K</Button>
          </Tooltip>
          <Tooltip title={hotkeyHints.ctrlN.desc + ' (' + hotkeyHints.ctrlN.label + ')'}>
            <Button type="text" size="small" className="text-gray-400">⌘N</Button>
          </Tooltip>
          <Tooltip title="网关状态">
            <Badge
              status={gatewayStatus?.status === 'online' ? 'success' : 'error'}
              text={gatewayStatus?.status === 'online' ? '网关在线' : '网关离线'}
            />
          </Tooltip>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRestartGateway}
          >
            重启网关
          </Button>
        </Space>
      </Header>
      
      <Layout>
        <Sider
          trigger={null}
          collapsible
          collapsed={false}
          theme="light"
          className="border-r"
        >
          <Menu
            mode="inline"
            selectedKeys={[activeMenu]}
            items={menuItems}
            onClick={({ key }) => setActiveMenu(key as MenuKey)}
            className="h-full border-r-0"
          />
        </Sider>
        
        <Content
          className="m-4 p-4 flex-1 min-h-0 overflow-auto"
          style={{
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
          }}
        >
          {renderContent()}
        </Content>
      </Layout>

      <ChatPanel
        agent={chatAgent}
        visible={chatVisible}
        onClose={() => {
          setChatVisible(false);
          setChatAgent(null);
        }}
      />
    </Layout>
  );
}
