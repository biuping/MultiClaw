import { Router } from 'express';
import { agentService } from '../services/agent';
import { agentExecutor, AgentConfig } from '../services/agent-executor';
import { validateBody, teamDispatchSchema } from '../middleware/validate';

const router = Router();

/**
 * 团队任务分发（使用 AgentExecutor 统一封装）
 */
router.post('/dispatch', validateBody(teamDispatchSchema), async (req, res) => {
  const { coordinatorId } = req.body;
  const task = req.body.message;

  const coordinator = await agentService.getAgent(coordinatorId);
  if (!coordinator) {
    return res.status(404).json({ success: false, error: '协调者 Agent 不存在' });
  }

  try {
    const config: AgentConfig = {
      id: coordinator.id,
      name: coordinator.name,
      persona: coordinator.persona || '',
      skills: coordinator.skills || [],
      role: coordinator.role || '',
      model: coordinator.model || 'default',
      workspace: coordinator.workspace,
    };

    const result = await agentExecutor.executeTeamTask('', config, task);

    res.json({
      success: true,
      data: {
        finalReply: result.integration,
        delegations: result.delegations,
      },
    });

  } catch (error) {
    console.error('[team/dispatch] 失败:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
