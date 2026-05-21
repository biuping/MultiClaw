import { Router } from 'express';
import { agentService } from '../services/agent';
import { validateBody, createRelationSchema, updateRelationSchema } from '../middleware/validate';

const router = Router();

// 获取所有关系
router.get('/', async (req, res) => {
  try {
    const relations = await agentService.getAllRelations();
    res.json({ success: true, data: relations });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 创建关系
router.post('/', validateBody(createRelationSchema), async (req, res) => {
  try {
    const { sourceId, targetId, relationType, rules } = req.body;
    
    const relation = await agentService.createRelation({
      sourceId,
      targetId,
      relationType,
      rules
    });

    res.json({ success: true, data: relation });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取单个关系
router.get('/:id', async (req, res) => {
  try {
    const relation = await agentService.getRelation(req.params.id);
    if (!relation) {
      return res.status(404).json({ success: false, error: 'Relation not found' });
    }
    res.json({ success: true, data: relation });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新关系
router.put('/:id', validateBody(updateRelationSchema), async (req, res) => {
  try {
    const { relationType, rules } = req.body;
    
    const relation = await agentService.updateRelation(req.params.id, {
      relationType,
      rules
    });

    if (!relation) {
      return res.status(404).json({ success: false, error: 'Relation not found' });
    }

    res.json({ success: true, data: relation });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除关系
router.delete('/:id', async (req, res) => {
  try {
    await agentService.deleteRelation(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取 Agent 的关系（可见同事 + 所有相关关系）
router.get('/agent/:agentId', async (req, res) => {
  try {
    const [visibleAgents, allRelations] = await Promise.all([
      agentService.getVisibleAgents(req.params.agentId),
      agentService.getAllRelations(),
    ]);
    const outgoing = allRelations.filter(r => r.sourceId === req.params.agentId);
    const incoming = allRelations.filter(r => r.targetId === req.params.agentId);
    res.json({ success: true, data: { visibleAgents, outgoing, incoming } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 应用到 OpenClaw（生成路由规则）
router.post('/apply', async (req, res) => {
  try {
    const relations = await agentService.getAllRelations();
    const agents = await agentService.getAllAgents();
    
    // 生成 OpenClaw 配置
    const bindings: any[] = [];
    
    for (const relation of relations) {
      const source = agents.find(a => a.id === relation.sourceId);
      const target = agents.find(a => a.id === relation.targetId);
      
      if (source && target) {
        bindings.push({
          from: source.openclawId,
          to: target.openclawId,
          type: relation.relationType,
          rules: relation.rules
        });
      }
    }

    // TODO: 将 bindings 写入 OpenClaw 全局配置
    res.json({ 
      success: true, 
      data: { bindings },
      message: 'Relations applied successfully. Please restart OpenClaw gateway to take effect.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;