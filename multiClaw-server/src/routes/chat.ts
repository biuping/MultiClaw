import { Router } from 'express';
import { chatService } from '../services/chat';
import { agentService } from '../services/agent';
import { agentExecutor, AgentConfig } from '../services/agent-executor';

const router = Router();

// 获取聊天记录
router.get('/:agentId', async (req, res) => {
  try {
    const { limit } = req.query;
    const messages = await chatService.getMessages(
      req.params.agentId,
      limit ? parseInt(limit as string) : 100
    );
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 发送消息
router.post('/:agentId', async (req, res) => {
  try {
    const { message } = req.body;
    const agent = await agentService.getAgent(req.params.agentId);
    
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // 保存用户消息
    await chatService.addMessage(req.params.agentId, 'user', message);

    // 更新 agent 状态为 chatting
    await agentService.updateAgentStatus(req.params.agentId, 'chatting');

    const config: AgentConfig = {
      id: agent.id,
      name: agent.name,
      persona: agent.persona || '',
      skills: agent.skills || [],
      role: agent.role || '',
      model: agent.model || 'default',
      workspace: agent.workspace
    };

    const reply = await agentExecutor.chat(agent.id, message, config);

    // 保存 AI 回复
    const aiMessage = await chatService.addMessage(
      req.params.agentId,
      'assistant',
      reply,
      { model: agent.model || 'default' }
    );

    // 恢复 agent 状态为 ready
    await agentService.updateAgentStatus(req.params.agentId, 'ready');

    res.json({ success: true, data: aiMessage });
  } catch (error) {
    // 出错时恢复状态
    try {
      await agentService.updateAgentStatus(req.params.agentId, 'error');
    } catch {}
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 清空聊天记录
router.delete('/:agentId', async (req, res) => {
  try {
    await chatService.clearMessages(req.params.agentId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;