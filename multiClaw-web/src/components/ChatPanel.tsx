import { useState, useRef, useEffect } from 'react';
import { 
  Drawer, 
  Input, 
  Button, 
  Space, 
  Empty, 
  Spin,
  Badge,
  Tooltip,
  Popconfirm,
  Timeline,
  Tag,
  Tabs
} from 'antd';
import { 
  SendOutlined, 
  ClearOutlined, 
  CloseOutlined,
  HistoryOutlined,
  ToolOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useWebSocket } from '../hooks/useWebSocket';

/** Markdown 代码块语法高亮组件 */
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
import type { ToolCallInfo } from '../hooks/useWebSocket';
import { Agent, ChatMessage, SkillCall } from '../types';
import { chatApi } from '../services/api';
import dayjs from 'dayjs';

const { TextArea } = Input;

interface ChatPanelProps {
  agent: Agent | null;
  visible: boolean;
  onClose: () => void;
}

// Tool call 图标映射
const TOOL_ICONS: Record<string, string> = {
  'exec': '⚙️',
  'read': '📖',
  'write': '✍️',
  'edit': '📝',
  'web_search': '🔍',
  'web_fetch': '🌐',
  'image': '🖼️',
  'memory_search': '🧠',
  'memory_get': '🧠',
  'memory': '🧠',
  'browser': '🌐',
  'bash': '🛠️',
  'process': '🧰',
  'attach': '📎',
  'command': '💻',
  'tool': '🔧',
  'lifecycle': '🚀',
};

function getToolIcon(name: string, kind: string): string {
  return TOOL_ICONS[name] || TOOL_ICONS[kind] || '🔧';
}

// Tool Call 卡片
function ToolCallCard({ toolCall, commandOutput }: { toolCall: ToolCallInfo; commandOutput?: string }) {
  const icon = getToolIcon(toolCall.name, toolCall.kind);
  const isRunning = toolCall.status === 'running';
  const isCompleted = toolCall.status === 'completed';
  const isFailed = toolCall.status === 'failed';

  return (
    <div className={`rounded-lg border mb-2 overflow-hidden transition-all ${
      isRunning ? 'border-blue-300 bg-blue-50' : 
      isFailed ? 'border-red-300 bg-red-50' : 
      'border-gray-200 bg-gray-50'
    }`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-base">{icon}</span>
        <span className="font-medium text-sm flex-1">{toolCall.title || toolCall.name}</span>
        {isRunning && <LoadingOutlined className="text-blue-500" spin />}
        {isCompleted && <CheckCircleOutlined className="text-green-500" />}
        {isFailed && <InfoCircleOutlined className="text-red-500" />}
        {toolCall.duration != null && toolCall.duration > 0 && (
          <span className="text-xs text-gray-400">{(toolCall.duration / 1000).toFixed(1)}s</span>
        )}
      </div>
      {commandOutput && (
        <div className="px-3 pb-2">
          <pre className="text-xs bg-gray-800 text-green-400 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono">
            {commandOutput.slice(-500)}
          </pre>
        </div>
      )}
    </div>
  );
}

// Plan 展示
function PlanDisplay({ plan }: { plan: { title: string; explanation?: string; steps?: string[] } }) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 mb-3 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span>🗺️</span>
        <span className="font-medium text-sm text-purple-800">{plan.title}</span>
      </div>
      {plan.explanation && (
        <p className="text-xs text-purple-600 mb-2">{plan.explanation}</p>
      )}
      {plan.steps && plan.steps.length > 0 && (
        <ol className="text-xs text-purple-700 space-y-1">
          {plan.steps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-purple-400">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// 技能调用日志组件
function SkillCallLog({ skillCall }: { skillCall: SkillCall }) {
  const getStatusIcon = () => {
    if (skillCall.result?.error) {
      return <InfoCircleOutlined className="text-red-500" />;
    }
    return <CheckCircleOutlined className="text-green-500" />;
  };

  return (
    <div className="bg-gray-50 rounded p-3 mb-2">
      <div className="flex items-center justify-between mb-2">
        <Space>
          <ToolOutlined />
          <span className="font-medium">{skillCall.skill}</span>
          {getStatusIcon()}
        </Space>
        <span className="text-xs text-gray-400">
          {skillCall.duration}ms
        </span>
      </div>
      <div className="text-xs text-gray-500">
        <div>参数: {JSON.stringify(skillCall.params).slice(0, 100)}...</div>
        {skillCall.result && (
          <div className="mt-1">
            结果: {typeof skillCall.result === 'string' 
              ? skillCall.result.slice(0, 100) 
              : JSON.stringify(skillCall.result).slice(0, 100)}...
          </div>
        )}
      </div>
    </div>
  );
}

// 历史消息时间线
function MessageTimeline({ messages }: { messages: ChatMessage[] }) {
  const getIcon = (role: string) => {
    switch (role) {
      case 'user': return <ClockCircleOutlined className="text-blue-500" />;
      case 'assistant': return <RobotOutlined className="text-green-500" />;
      case 'system': return <ToolOutlined className="text-orange-500" />;
      default: return <InfoCircleOutlined />;
    }
  };

  return (
    <Timeline mode="left">
      {messages.slice(-20).map((msg) => (
        <Timeline.Item 
          key={msg.id} 
          dot={getIcon(msg.role)}
          label={dayjs(msg.timestamp).format('HH:mm:ss')}
        >
          <div className="text-sm">
            <Tag>{msg.role}</Tag>
            <span className="text-gray-500 ml-2">
              {msg.content.slice(0, 50)}...
            </span>
          </div>
        </Timeline.Item>
      ))}
    </Timeline>
  );
}

export default function ChatPanel({ agent, visible, onClose }: ChatPanelProps) {
  const { 
    isConnected, 
    messages, 
    isStreaming, 
    streamContent, 
    sendMessage, 
    clearMessages,
    toolCalls,
    commandOutputs,
    planInfo,
    delegationState,
    skillCalls
  } = useWebSocket(agent?.id || null);
  
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState<string>('chat');
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载历史消息
  useEffect(() => {
    if (agent && visible) {
      loadHistory();
    }
  }, [agent, visible]);

  const loadHistory = async () => {
    if (!agent) return;
    setLoadingHistory(true);
    try {
      const response = await chatApi.getMessages(agent.id, 50);
      setHistoryMessages(response.data.data || []);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamContent, toolCalls]);

  const handleSend = () => {
    if (!inputValue.trim() || !agent || isStreaming) return;
    sendMessage(inputValue.trim());
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    
    return (
      <div
        key={message.id}
        className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      >
        <div
          className={`max-w-[80%] rounded-lg p-3 ${
            isUser
              ? 'bg-primary text-white rounded-br-none'
              : 'bg-gray-100 text-gray-800 rounded-bl-none'
          }`}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          <div
            className={`text-xs mt-1 ${
              isUser ? 'text-blue-200' : 'text-gray-400'
            }`}
          >
            {dayjs(message.timestamp).format('HH:mm:ss')}
          </div>
        </div>
      </div>
    );
  };

  if (!agent) return null;

  // 当前活跃的 tool calls（正在运行的 + 最近完成的）
  const activeToolCalls = toolCalls.filter(tc => 
    tc.status === 'running' || 
    (tc.status === 'completed' && tc.phase === 'end')
  );

  const tabItems = [
    {
      key: 'chat',
      label: (
        <span>
          💬 对话
        </span>
      ),
      children: (
        <div className="flex flex-col h-full">
          {/* 消息区域 */}
          <div className="flex-1 overflow-auto mb-4 p-2">
            {messages.length === 0 && !isStreaming ? (
              <Empty
                description="开始与 Agent 对话"
                className="mt-20"
              />
            ) : (
              <>
                {messages.map(renderMessage)}
                
                {/* 流式输出区域 */}
                {isStreaming && (
                  <div className="flex justify-start mb-4">
                    <div className="max-w-[80%] bg-gray-100 rounded-lg rounded-bl-none p-3 w-full">
                      {/* 执行计划 */}
                      {planInfo && <PlanDisplay plan={planInfo} />}
                      
                      {/* Tool Call 卡片 */}
                      {activeToolCalls.length > 0 && (
                        <div className="mb-3">
                          {activeToolCalls.map(tc => (
                            <ToolCallCard 
                              key={tc.itemId} 
                              toolCall={tc}
                              commandOutput={commandOutputs.get(tc.itemId)}
                            />
                          ))}
                        </div>
                      )}
                      
                      {/* 委派状态 */}
                      {delegationState.active && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 mb-3 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span>🤝</span>
                            <span className="font-medium text-sm text-amber-800">正在委派任务给同事...</span>
                          </div>
                          {delegationState.progress.map((d, i) => (
                            <div key={i} className="text-xs text-amber-700 ml-6">
                              {d.from} → {d.to}: {d.task}...
                            </div>
                          ))}
                        </div>
                      )}
                      {delegationState.results.length > 0 && !delegationState.active && (
                        <div className="rounded-lg border border-green-200 bg-green-50 mb-3 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span>✅</span>
                            <span className="font-medium text-sm text-green-800">委派结果</span>
                          </div>
                          {delegationState.results.map((r, i) => (
                            <div key={i} className={`text-xs ml-6 mb-1 ${r.success ? 'text-green-700' : 'text-red-600'}`}>
                              {r.success ? '✓' : '✗'} {r.to}: {r.task.slice(0, 40)}... {r.success ? '成功' : '失败'}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* 流式文本 */}
                      {(streamContent || activeToolCalls.filter(tc => tc.status === 'running').length === 0) && (
                        <div className="prose prose-sm max-w-none">
                          {streamContent ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                              {streamContent}
                            </ReactMarkdown>
                          ) : (
                            <div className="flex items-center gap-2 text-gray-400">
                              <LoadingOutlined spin />
                              <span className="text-sm">思考中...</span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* 输入光标动画 */}
                      {streamContent && activeToolCalls.some(tc => tc.status === 'running') && (
                        <div className="flex items-center gap-1 text-gray-400 mt-2">
                          <LoadingOutlined spin />
                          <span className="text-xs">执行工具中...</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* 输入区域 */}
          <div className="border-t pt-4">
            <Space.Compact className="w-full">
              <TextArea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                autoSize={{ minRows: 2, maxRows: 6 }}
                disabled={!isConnected || isStreaming}
                className="flex-1"
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!isConnected || isStreaming || !inputValue.trim()}
                loading={isStreaming}
                className="h-auto"
              >
                发送
              </Button>
            </Space.Compact>
            
            <div className="flex justify-between mt-2 text-xs text-gray-400">
              <span>Agent ID: {agent.openclawId}</span>
              <span>
                {isStreaming ? (
                  <span className="text-blue-500">⏳ 流式输出中</span>
                ) : (
                  <span>{agent.skills?.length || 0} 个技能</span>
                )}
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'history',
      label: (
        <span>
          <HistoryOutlined /> 历史记录
        </span>
      ),
      children: (
        <div className="h-full overflow-auto p-2">
          {loadingHistory ? (
            <div className="flex justify-center items-center h-32">
              <Spin />
            </div>
          ) : historyMessages.length === 0 ? (
            <Empty description="暂无历史消息" />
          ) : (
            <MessageTimeline messages={historyMessages} />
          )}
        </div>
      ),
    },
    {
      key: 'skills',
      label: (
        <span>
          🛠️ 技能调用
        </span>
      ),
      children: (
        <div className="h-full overflow-auto p-2">
          {skillCalls.length === 0 ? (
            <Empty description="暂无技能调用记录" />
          ) : (
            <>
              <div className="mb-4 text-sm text-gray-500">
                共 {skillCalls.length} 次技能调用
              </div>
              {skillCalls.map((call, index) => (
                <SkillCallLog key={index} skillCall={call} />
              ))}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <span>{agent.name}</span>
          <Badge
            status={isConnected ? 'success' : 'error'}
            text={isConnected ? '已连接' : '未连接'}
          />
        </Space>
      }
      placement="right"
      width={700}
      onClose={onClose}
      open={visible}
      closable={false}
      extra={
        <Space>
          <Tooltip title="清空对话">
            <Popconfirm
              title="确认清空"
              description="确定要清空当前对话记录吗？"
              onConfirm={clearMessages}
              okText="清空"
              cancelText="取消"
            >
              <Button icon={<ClearOutlined />} size="small" />
            </Popconfirm>
          </Tooltip>
          <Button icon={<CloseOutlined />} size="small" onClick={onClose} />
        </Space>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        className="h-full"
      />
    </Drawer>
  );
}
