import { useState, useEffect } from 'react';
import { 
  Card, 
  Form, 
  Input, 
  Button, 
  message, 
  Space,
  Typography,
  Alert,
  Spin,
  Divider
} from 'antd';
import { SaveOutlined, ReloadOutlined, KeyOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { gatewayApi, getApiKey, setApiKey, clearApiKey, verifyApiKey } from '../services/api';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
  const [keyVerified, setKeyVerified] = useState<boolean | null>(null);
  const [keyVerifying, setKeyVerifying] = useState(false);

  const fetchConfig = async () => {
    setFetching(true);
    try {
      const response = await gatewayApi.getConfig();
      setConfig(response.data.data);
      form.setFieldsValue(response.data.data);
    } catch (error) {
      message.error('获取配置失败');
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      await gatewayApi.updateConfig(values);
      message.success('配置已保存，请重启网关使配置生效');
    } catch (error) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyKey = async () => {
    setKeyVerifying(true);
    const valid = await verifyApiKey(apiKeyInput);
    setKeyVerified(valid);
    setKeyVerifying(false);
    if (valid) {
      setApiKey(apiKeyInput);
      message.success('API Key 验证通过，已保存');
    } else {
      message.error('API Key 验证失败');
    }
  };

  const handleClearKey = () => {
    clearApiKey();
    setApiKeyInput('');
    setKeyVerified(null);
    message.success('API Key 已清除');
  };

  if (fetching) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Title level={4}>系统设置</Title>

      {/* API Key 认证配置 */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyOutlined />
          <Title level={5} className="m-0">API 认证</Title>
        </div>
        <Paragraph className="text-gray-500 mb-3">
          配置服务端 API Key 以启用认证保护。未配置时服务端跳过鉴权。
        </Paragraph>
        <Space.Compact style={{ width: '100%' }}>
          <Input.Password
            value={apiKeyInput}
            onChange={e => { setApiKeyInput(e.target.value); setKeyVerified(null); }}
            placeholder="输入 API Key"
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<CheckCircleOutlined />}
            loading={keyVerifying}
            onClick={handleVerifyKey}
          >
            验证并保存
          </Button>
          <Button onClick={handleClearKey}>清除</Button>
        </Space.Compact>
        {keyVerified === true && <Alert type="success" message="Key 有效" className="mt-2" showIcon />}
        {keyVerified === false && <Alert type="error" message="Key 无效" className="mt-2" showIcon />}
      </Card>

      <Divider />

      <Paragraph className="text-gray-500 mb-4">
        配置 OpenClaw 全局设置，修改后需要重启网关才能生效。
      </Paragraph>

      <Alert
        message="配置说明"
        description="此处修改的是 OpenClaw 的全局配置文件，请谨慎操作。错误的配置可能导致网关无法启动。"
        type="info"
        showIcon
        className="mb-4"
      />
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="models"
            label="模型配置 (JSON)"
            extra="配置可用的 AI 模型"
          >
            <TextArea
              rows={6}
              placeholder='{"default": "openai/gpt-4", "backup": "anthropic/claude-3"}'
            />
          </Form.Item>

          <Form.Item
            name="gateway"
            label="网关配置 (JSON)"
            extra="配置网关监听地址和端口"
          >
            <TextArea
              rows={4}
              placeholder='{"host": "0.0.0.0", "port": 8080}'
            />
          </Form.Item>

          <Form.Item
            name="plugins"
            label="插件配置 (JSON)"
            extra="配置启用的插件"
          >
            <TextArea
              rows={4}
              placeholder='{"enabled": ["shell", "file", "web-search"]}'
            />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={loading}
              >
                保存配置
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchConfig}
              >
                刷新
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {config && (
        <Card title="当前配置预览" className="mt-4">
          <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(config, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}