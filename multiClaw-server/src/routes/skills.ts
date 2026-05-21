import { Router } from 'express';
import { openclawService } from '../services/openclaw';

const router = Router();

// 获取所有技能
router.get('/', async (req, res) => {
  try {
    const skills = await openclawService.listSkills();
    res.json({ success: true, data: skills });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取技能详情
router.get('/:id', async (req, res) => {
  try {
    const skills = await openclawService.listSkills();
    const skill = skills.find(s => s.id === req.params.id);
    
    if (!skill) {
      return res.status(404).json({ success: false, error: 'Skill not found' });
    }
    
    res.json({ success: true, data: skill });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;