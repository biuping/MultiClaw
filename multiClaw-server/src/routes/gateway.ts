import { Router } from 'express';
import { openclawService } from '../services/openclaw';

const router = Router();

// 获取网关状态（只读）
router.get('/status', async (req, res) => {
  try {
    const status = await openclawService.getGatewayStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 重启网关 - 已禁用，避免影响 OpenClaw 自身运行
router.post('/restart', async (_req, res) => {
  res.status(403).json({ success: false, error: '独立隔离架构：不允许通过 multiClaw 重启 OpenClaw 网关' });
});

// 获取全局配置（只读）
router.get('/config', async (req, res) => {
  try {
    const config = await openclawService.getGlobalConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新全局配置 - 已禁用，避免修改 OpenClaw 配置
router.put('/config', async (_req, res) => {
  res.status(403).json({ success: false, error: '独立隔离架构：不允许通过 multiClaw 修改 OpenClaw 全局配置' });
});

export default router;