import { useState, useRef, useEffect } from 'react';
import {
  Drawer,
  Input,
  Button,
  Space,
  Select,
  Tag,
  Empty,
  Steps,
  Card,
  Typography,
} from 'antd';
import {
  CloseOutlined,
  TeamOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Agent } from '../types';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface TeamTaskPanelProps {
  visible: boolean;
  onClose: () => void;
  agents: Agent[];
}

interface DelegationResult {
  to: string;
  task: string;
  result: string;
  success: boolean;
}

interface TaskStep {
  title: string;
  description: string;
  status: 'wait' | 'process' | 'finish' | 'error';
}

export default function TeamTaskPanel({ visible, onClose, agents }: TeamTaskPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [coordinatorId, setCoordinatorId] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [finalResult, setFinalResult] = useState('');
  const [delegationResults, setDelegationResults] = useState<DelegationResult[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps, finalResult]);

  const handleSend = async () => {
    if (!inputValue.trim() || !coordinatorId || isRunning) return;

    const task = inputValue.trim();
    setInputValue('');
    setIsRunning(true);
    setDelegationResults([]);
    setFinalResult('');

    const coordinator = agents.find(a => a.id === coordinatorId);
    if (!coordinator) return;

    setSteps([
      { title: '分析任务', description: `${coordinator.name} 正在理解任务并拆分...`, status: 'process' },
      { title: '分发执行', description: '委派子任务给团队成员', status: 'wait' },
      { title: '整合结果', description: '汇总团队成员的输出', status: 'wait' },
    ]);

    try {
      // 调用后端团队任务 API
      const response = await fetch('/api/team/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinatorId,
          task,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setSteps(prev => [
          { ...prev[0], status: 'error' },
          ...prev.slice(1),
        ]);
        setFinalResult(`❌ 任务执行失败: ${data.error}`);
        setIsRunning(false);
        return;
      }

      const result = data.data;

      // 更新步骤状态
      setSteps([
        { title: '分析任务', description: `${coordinator.name} 已分析任务`, status: 'finish' },
        {
          title: '分发执行',
          description: `已委派 ${result.delegations?.length || 0} 个子任务`,
          status: result.delegations?.some((d: DelegationResult) => !d.success) ? 'error' : 'finish',
        },
        { title: '整合结果', description: '已整合所有回复', status: 'finish' },
      ]);

      setDelegationResults(result.delegations || []);
      setFinalResult(result.finalReply || '（无最终回复）');
    } catch (err) {
      setSteps(prev => [
        { ...prev[0], status: 'error' },
        ...prev.slice(1),
      ]);
      setFinalResult(`❌ 请求失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Drawer
      title={
        <Space>
          <TeamOutlined />
          <span>团队任务</span>
        </Space>
      }
      placement="right"
      width={700}
      onClose={onClose}
      open={visible}
      closable={false}
      extra={
        <Button icon={<CloseOutlined />} size="small" onClick={onClose} />
      }
    >
      <div className="flex flex-col h-full">
        {/* 结果区域 */}
        <div className="flex-1 overflow-auto mb-4 p-2">
          {steps.length === 0 && !finalResult ? (
            <Empty
              description="选择协调者，输入任务，团队会协作完成"
              className="mt-20"
            />
          ) : (
            <>
              {/* 执行步骤 */}
              <Steps
                className="mb-6"
                current={steps.findIndex(s => s.status === 'process' || s.status === 'error')}
                items={steps.map((step) => ({
                  title: step.title,
                  description: step.description,
                  status: step.status,
                  icon: step.status === 'process' ? <LoadingOutlined spin /> : undefined,
                }))}
              />

              {/* 委派结果 */}
              {delegationResults.length > 0 && (
                <div className="mb-4">
                  <Title level={5}>🤝 委派详情</Title>
                  {delegationResults.map((d) => (
                    <Card
                      key={d.to + d.task.slice(0, 20)}
                      size="small"
                      className="mb-2"
                      title={
                        <Space>
                          {d.success ? (
                            <CheckCircleOutlined className="text-green-500" />
                          ) : (
                            <ExclamationCircleOutlined className="text-red-500" />
                          )}
                          <span>{d.to}</span>
                          <Tag color={d.success ? 'green' : 'red'}>
                            {d.success ? '成功' : '失败'}
                          </Tag>
                        </Space>
                      }
                    >
                      <div className="text-xs text-gray-500 mb-2">
                        任务: {d.task.slice(0, 100)}{d.task.length > 100 ? '...' : ''}
                      </div>
                      {d.success && (
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {`${d.result.slice(0, 500)}${d.result.length > 500 ? '...' : ''}`}
                          </ReactMarkdown>
                        </div>
                      )}
                      {!d.success && (
                        <div className="text-red-500 text-sm">{d.result}</div>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {/* 最终整合结果 */}
              {finalResult && (
                <div className="mb-4">
                  <Title level={5}>📋 整合结果</Title>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {finalResult}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* 输入区域 */}
        <div className="border-t pt-4">
          <div className="mb-3">
            <Text className="mb-1 block text-sm text-gray-500">协调者</Text>
            <Select
              value={coordinatorId}
              onChange={setCoordinatorId}
              placeholder="选择协调者 Agent"
              className="w-full"
              disabled={isRunning}
            >
              {agents.map(agent => (
                <Select.Option key={agent.id} value={agent.id}>
                  <Space>
                    <span>{agent.name}</span>
                    {agent.role && <Tag>{agent.role}</Tag>}
                  </Space>
                </Select.Option>
              ))}
            </Select>
            <div className="text-xs text-gray-400 mt-1">
              💡 协调者会分析任务、拆分子任务、委派给合适的成员、并整合最终结果
            </div>
          </div>

          <Space.Compact className="w-full">
            <TextArea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入团队任务... (例如：写一篇关于 AI Agent 协作的技术博客)"
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={isRunning || !coordinatorId}
              className="flex-1"
            />
            <Button
              type="primary"
              icon={<RocketOutlined />}
              onClick={handleSend}
              disabled={isRunning || !inputValue.trim() || !coordinatorId}
              loading={isRunning}
              className="h-auto"
            >
              下达
            </Button>
          </Space.Compact>
        </div>
      </div>
    </Drawer>
  );
}
