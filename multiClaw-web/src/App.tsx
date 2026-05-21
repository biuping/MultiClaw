import { useEffect, useState } from 'react';
import { Modal, Input, Form, Typography, message } from 'antd';
import MainLayout from './pages/MainLayout';
import { getApiKey, setApiKey, verifyApiKey } from './services/api';

const { Text } = Typography;

function App() {
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    // 如果没有API Key，尝试默认key
    if (!getApiKey()) {
      // 自动尝试默认开发key
      verifyApiKey('multiclaw-dev-key-change-me').then((valid) => {
        if (valid) {
          setApiKey('multiclaw-dev-key-change-me');
        } else {
          setAuthModalVisible(true);
        }
      });
    }

    // 监听认证失效事件
    const handleAuthRequired = () => {
      setAuthModalVisible(true);
    };
    window.addEventListener('multiclaw:auth-required', handleAuthRequired);
    return () => window.removeEventListener('multiclaw:auth-required', handleAuthRequired);
  }, []);

  const handleAuthSubmit = async () => {
    try {
      const key = form.getFieldValue('apiKey');
      const valid = await verifyApiKey(key);
      if (valid) {
        setApiKey(key);
        setAuthModalVisible(false);
        message.success('认证成功');
        window.location.reload();
      } else {
        message.error('API Key 无效');
      }
    } catch {
      message.error('验证失败，请检查服务是否运行');
    }
  };

  return (
    <>
      <MainLayout />
      <Modal
        title="🔑 API Key 认证"
        open={authModalVisible}
        onOk={handleAuthSubmit}
        okText="验证并连接"
        onCancel={() => setAuthModalVisible(false)}
        closable={false}
        maskClosable={false}
      >
        <Form form={form} layout="vertical">
          <Text type="secondary" className="block mb-4">
            请输入 MultiClaw 服务端的 API Key 以访问数据
          </Text>
          <Form.Item name="apiKey" rules={[{ required: true, message: '请输入 API Key' }]}>
            <Input.Password placeholder="输入 API Key..." size="large" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default App;
