import { Router, Request, Response } from 'express';
import { skillService } from '../services/skill';

interface AgentSkillsParams {
  agentId: string;
  skillId?: string;
}

const router = Router({ mergeParams: true });

// 获取 Agent 的私有技能列表
router.get('/', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId } = req.params;
    const skills = await skillService.getAgentSkills(agentId);
    res.json({ success: true, data: skills });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取单个技能详情
router.get('/:skillId', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId, skillId } = req.params;
    const skill = await skillService.getAgentSkill(agentId, skillId!);
    if (!skill) {
      return res.status(404).json({ success: false, error: 'Skill not found' });
    }
    res.json({ success: true, data: skill });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 安装技能
router.post('/', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId } = req.params;
    const { source, path: localPath, url, skillId, name, description, skillType, content } = req.body;

    let skill;
    switch (source) {
      case 'local-path':
        if (!localPath) {
          return res.status(400).json({ success: false, error: '缺少 path 参数' });
        }
        skill = await skillService.installFromLocalPath(agentId, localPath, { skillType });
        break;

      case 'github':
        if (!url) {
          return res.status(400).json({ success: false, error: '缺少 url 参数' });
        }
        skill = await skillService.installFromGithub(agentId, url, { skillType });
        break;

      case 'custom':
        if (!skillId || !name || !content) {
          return res.status(400).json({ success: false, error: '缺少 skillId、name 或 content 参数' });
        }
        skill = await skillService.installCustom(agentId, { skillId, name, description, skillType, content });
        break;

      default:
        return res.status(400).json({ success: false, error: '不支持的 source 类型: ' + source });
    }

    res.json({ success: true, data: skill });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[skills route] 安装失败:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// 更新技能（启用/禁用）
router.put('/:skillId', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId, skillId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled === 'boolean') {
      const skill = await skillService.toggleSkill(agentId, skillId!, enabled);
      return res.json({ success: true, data: skill });
    }

    res.status(400).json({ success: false, error: '仅支持 enabled 字段更新' });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除技能
router.delete('/:skillId', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId, skillId } = req.params;
    await skillService.deleteSkill(agentId, skillId!);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 刷新技能（从源重新安装）
router.post('/:skillId/refresh', async (req: Request<AgentSkillsParams>, res: Response) => {
  try {
    const { agentId, skillId } = req.params;
    const skill = await skillService.refreshSkill(agentId, skillId!);
    if (!skill) {
      return res.status(404).json({ success: false, error: 'Skill not found or not refreshable' });
    }
    res.json({ success: true, data: skill });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
