import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import multer from 'multer';

import { initDatabase } from './db';
import { agentService } from './services/agent';
import { openclawService } from './services/openclaw';
import agentsRouter from './routes/agents';
import relationsRouter from './routes/relations';
import skillsRouter from './routes/skills';
import gatewayRouter from './routes/gateway';
import chatRouter from './routes/chat';
import teamRouter from './routes/team';
import tasksRouter from './routes/tasks';
import agentSkillsRouter from './routes/agent-skills';
import { setupWebSocket } from './websocket';
import { authMiddleware, verifyToken } from './middleware/auth';
import { generalLimiter, chatLimiter } from './middleware/rateLimit';

const app = express();
const server = createServer(app);

const PORT = process.env.PORT || 3010;

// CORS 白名单配置
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin(origin, callback) {
    // 允许无 origin 的请求（如 curl、服务器间调用）
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin) || corsOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('CORS 不允许的来源: ' + origin));
    }
  },
  credentials: true,
}));

// 通用速率限制
app.use(generalLimiter);

// JSON 解析
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Key 认证中间件（在路由之前）
app.use(authMiddleware);

// 静态文件
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// 头像上传配置
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const avatarDir = path.join(uploadsDir, 'avatars');
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }
    cb(null, avatarDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 jpg/png/gif/webp/svg 格式'));
    }
  }
});

// 头像上传接口
app.post('/api/upload/avatar', avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '请选择图片' });
  }
  const url = `/uploads/avatars/${req.file.filename}`;
  res.json({ success: true, data: { url } });
});

// Token 验证端点
app.get('/api/auth/verify', verifyToken);

// API 路由
app.use('/api/agents', agentsRouter);
app.use('/api/relations', relationsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/gateway', gatewayRouter);
app.use('/api/chat', chatLimiter, chatRouter);
app.use('/api/team', chatLimiter, teamRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/agents/:agentId/skills', agentSkillsRouter);

// 健康检查（免认证）
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket 设置 — 使用 verifyClient 进行鉴权
const wss = new WebSocketServer({
  server,
  verifyClient: (info, callback) => {
    const apiKey = process.env.API_KEY;
    // 未配置 API_KEY 时跳过鉴权
    if (!apiKey) {
      callback(true);
      return;
    }
    // 从 URL query 或 sec-websocket-protocol 获取 token
    const url = new URL(info.req.url || '', 'http://localhost');
    const token = url.searchParams.get('token') || url.searchParams.get('apiKey');
    if (token === apiKey) {
      callback(true);
    } else {
      callback(false, 401, 'Unauthorized');
    }
  },
});

setupWebSocket(wss);

// 初始化数据库并启动服务器
async function start() {
  try {
    await initDatabase();
    console.log('Database initialized');

    // 同步所有数据库 agent 到 OpenClaw（注册新 agent + 同步已有 agent 的 model）
    try {
      const agents = await agentService.getAllAgents();
      for (const agent of agents) {
        try {
          const agentSlug = agent.openclawId || agent.name.toLowerCase().replace(/\s+/g, '-');
          await openclawService.setupAgentWorkspace(
            agentSlug,
            agent.name,
            {
              persona: agent.persona,
              role: agent.role,
              skills: agent.skills,
              model: agent.model,
              skipIfExists: true,
            }
          );
          // 启动时同步 model 到 openclaw.json（setupAgentWorkspace 的 skipIfExists 会跳过已存在的 agent）
          if (agent.model && agent.model !== 'default') {
            await openclawService.updateAgentConfig(agentSlug, { model: agent.model } as any);
          }
        } catch (syncErr) {
          console.warn('[startup] Agent ' + agent.name + ' 同步失败:', String(syncErr).slice(0, 100));
        }
      }
      console.log('[startup] 已同步 ' + agents.length + ' 个 Agent 到 OpenClaw');
    } catch (syncErr) {
      console.warn('[startup] Agent 同步失败:', String(syncErr).slice(0, 100));
    }
    
    server.listen(PORT, () => {
      console.log(`MultiClaw Server running on port ${PORT}`);
      console.log(`API available at http://localhost:${PORT}/api`);
      console.log(`CORS origins: ${corsOrigins.join(', ')}`);
      console.log(`Auth: ${process.env.API_KEY ? 'enabled' : 'disabled (no API_KEY set)'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
