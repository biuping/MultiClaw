import { Request, Response, NextFunction } from 'express';

/**
 * API Key 认证中间件
 * 
 * 支持两种方式传递 API Key：
 * 1. Header: Authorization: Bearer <api-key>
 * 2. Query: ?apiKey=<api-key>（仅用于 WebSocket 升级场景）
 * 
 * 免认证路径：
 * - /health
 * - /uploads/ (静态资源)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.API_KEY;

  // 如果未配置 API_KEY，跳过认证（开发模式）
  if (!apiKey) {
    next();
    return;
  }

  // 免认证路径
  const exemptPaths = ['/health', '/api/auth/verify'];
  if (exemptPaths.some(p => req.path === p || req.path.startsWith('/uploads/'))) {
    next();
    return;
  }

  // 从 Header 或 Query 获取 token
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query.apiKey) {
    token = req.query.apiKey as string;
  }

  if (!token || token !== apiKey) {
    res.status(401).json({
      success: false,
      error: '未授权访问，请提供有效的 API Key',
    });
    return;
  }

  next();
}

/**
 * Token 验证端点（供前端校验 key 是否有效）
 */
export function verifyToken(req: Request, res: Response): void {
  const authHeader = req.headers.authorization;
  const apiKey = process.env.API_KEY || '';

  let token = '';
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  if (apiKey && token === apiKey) {
    res.json({ success: true, data: { valid: true } });
  } else if (!apiKey) {
    // 未配置 API_KEY，始终通过
    res.json({ success: true, data: { valid: true, noKey: true } });
  } else {
    res.status(401).json({ success: false, error: 'API Key 无效' });
  }
}
