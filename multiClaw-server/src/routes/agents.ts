import { Router } from 'express';
import path from 'path';
import os from 'os';
import { openclawService } from '../services/openclaw';
import { agentExecutor, AgentConfig } from '../services/agent-executor';
import { agentService } from '../services/agent';
import { validateBody, createAgentSchema, updateAgentSchema } from '../middleware/validate';

const router = Router();

// 获取所有 Agents
router.get('/', async (req, res) => {
  try {
    const agents = await agentService.getAllAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取单个 Agent
router.get('/:id', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.json({ success: true, data: agent });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 创建 Agent
router.post('/', validateBody(createAgentSchema), async (req, res) => {
  try {
    const { name, persona, skills, workspace, role, tags, model, createInOpenClaw } = req.body;
    
    console.log('Creating agent:', { name, persona, skills, workspace, role, tags, model });
    
    let openclawAgentId: string | undefined;
    if (createInOpenClaw !== false) {
      openclawAgentId = name.toLowerCase().replace(/\s+/g, '-');
      console.log('Agent running in isolated mode, openclawId:', openclawAgentId);
    }

    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(os.homedir(), '.multiclaw', 'workspace');
    const agentSlug = name.toLowerCase().replace(/\s+/g, '-');
    // 规则：agent workspace 必须在 WORKSPACE_ROOT 下，且以 agent 名（slug）命名
    // 如果用户传了不合规的 workspace，忽略并改用默认路径
    const defaultWorkspace = path.join(workspaceRoot, agentSlug);
    let resolvedWorkspace = defaultWorkspace;
    if (workspace && typeof workspace === 'string') {
      const normalized = path.resolve(workspace);
      const inRoot = normalized.startsWith(path.resolve(workspaceRoot) + path.sep) || normalized === path.resolve(workspaceRoot);
      if (inRoot) {
        resolvedWorkspace = normalized;
      } else {
        console.warn('[agents/create] 用户指定的 workspace 不在 ' + workspaceRoot + ' 内，已重置为默认: ' + defaultWorkspace);
      }
    }
    
    try {
      await openclawService.setupAgentWorkspace(agentSlug, name, {
        persona,
        role,
        skills,
        tags,
        emoji: '🐾',
        model
      });
      console.log('Agent workspace created:', resolvedWorkspace);
    } catch (wsError) {
      console.warn('Agent workspace creation failed (non-fatal):', wsError);
    }

    console.log('Creating agent in platform database...');
    const agent = await agentService.createAgent({
      name,
      openclawId: openclawAgentId || agentSlug,
      persona,
      skills,
      workspace: resolvedWorkspace,
      role,
      tags,
      model
    });
    
    console.log('Agent created successfully:', agent);

    res.json({ success: true, data: agent });
  } catch (error) {
    console.error('Failed to create agent:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新 Agent
router.put('/:id', validateBody(updateAgentSchema), async (req, res) => {
  try {
    const { name, persona, skills, workspace, role, tags, avatar, status, model } = req.body;

    // 获取原 agent，检查是否需要重命名 workspace 目录
    const oldAgent = await agentService.getAgent(req.params.id);
    if (!oldAgent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(os.homedir(), '.multiclaw', 'workspace');
    const fs = await import('fs/promises');
    let finalWorkspace = workspace;

    // 如果改名了且没有显式指定新 workspace，自动重命名 workspace 目录
    if (name && name !== oldAgent.name && !workspace) {
      const newSlug = name.toLowerCase().replace(/\s+/g, '-');
      const newWorkspace = path.join(workspaceRoot, newSlug);
      const oldWorkspace = oldAgent.workspace;

      // 仅在旧路径在 workspaceRoot 内且存在时重命名
      if (oldWorkspace && oldWorkspace.startsWith(workspaceRoot) && oldWorkspace !== newWorkspace) {
        try {
          await fs.access(oldWorkspace);
          await fs.rename(oldWorkspace, newWorkspace);
          console.log('[agents/update] workspace 目录已重命名: ' + oldWorkspace + ' -> ' + newWorkspace);
          finalWorkspace = newWorkspace;
        } catch (renameErr) {
          console.warn('[agents/update] workspace 重命名失败，使用新路径并创建:', renameErr);
          await fs.mkdir(newWorkspace, { recursive: true });
          finalWorkspace = newWorkspace;
        }
      } else if (!oldWorkspace || !oldWorkspace.startsWith(workspaceRoot)) {
        // 旧路径不在规则内，直接赋为新路径
        finalWorkspace = newWorkspace;
        await fs.mkdir(newWorkspace, { recursive: true }).catch(() => {});
      }
    }

    // 如果用户显式指定了 workspace，校验必须在 WORKSPACE_ROOT 下
    if (workspace && typeof workspace === 'string') {
      const normalized = path.resolve(workspace);
      const root = path.resolve(workspaceRoot);
      if (!normalized.startsWith(root + path.sep) && normalized !== root) {
        return res.status(400).json({
          success: false,
          error: 'workspace 必须在 ' + workspaceRoot + ' 下'
        });
      }
      finalWorkspace = normalized;
    }

    const agent = await agentService.updateAgent(req.params.id, {
      name,
      persona,
      skills,
      workspace: finalWorkspace,
      role,
      tags,
      avatar,
      status,
      model
    });

    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    // 同步更新 OpenClaw 配置
    if (persona || skills || finalWorkspace || model) {
      const currentConfig = await openclawService.getAgentConfig(agent.openclawId) || {};
      await openclawService.updateAgentConfig(agent.openclawId, {
        ...currentConfig,
        name: name || currentConfig.name,
        persona: persona || currentConfig.persona,
        skills: skills || currentConfig.skills,
        workspace: finalWorkspace || currentConfig.workspace,
        model: model || currentConfig.model
      });

      // 如果模型变更，清除该 Agent 的 OpenClaw session 历史
      // 避免旧模型的历史消息误导新模型（如旧模型名、旧能力等）
      if (model && model !== 'default') {
        try {
          await openclawService.clearAgentSessions(agent.openclawId);
          console.log('[agents/update] 已清除 agent=' + agent.openclawId + ' 的 session 历史（模型变更）');
        } catch (clearErr) {
          console.warn('[agents/update] 清除 session 失败(非致命):', clearErr);
        }
      }
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 删除 Agent
router.delete('/:id', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    try {
      await openclawService.deleteAgent(agent.openclawId, agent.workspace);
    } catch (e) {
      console.warn('Failed to cleanup agent workspace:', e);
    }

    await agentService.deleteAgent(req.params.id);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取 Agent 配置
router.get('/:id/config', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const config = await openclawService.getAgentConfig(agent.openclawId);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新 Agent 配置
router.put('/:id/config', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    await openclawService.updateAgentConfig(agent.openclawId, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取 Agent 节点（带位置）
router.get('/nodes/all', async (req, res) => {
  try {
    const nodes = await agentService.getAgentNodes();
    res.json({ success: true, data: nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 更新 Agent 位置
router.put('/:id/position', async (req, res) => {
  try {
    const { x, y } = req.body;
    await agentService.updateAgentPosition(req.params.id, x, y);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 同步 OpenClaw Agents
router.post('/sync', async (req, res) => {
  try {
    const openclawAgents = await openclawService.listAgents();
    const platformAgents = await agentService.getAllAgents();
    
    const results = {
      created: 0,
      updated: 0,
      unchanged: 0
    };

    for (const ocAgent of openclawAgents) {
      const existing = platformAgents.find(a => a.openclawId === ocAgent.id);
      
      if (!existing) {
        await agentService.createAgent({
          name: ocAgent.name,
          openclawId: ocAgent.id,
          status: ocAgent.status,
          persona: ocAgent.config?.persona || '',
          skills: ocAgent.config?.skills || [],
          workspace: ocAgent.config?.workspace || ''
        });
        results.created++;
      } else if (existing.status !== ocAgent.status) {
        await agentService.updateAgentStatus(existing.id, ocAgent.status);
        results.updated++;
      } else {
        results.unchanged++;
      }
    }

    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 获取可用模型列表
router.get('/models/available', async (req, res) => {
  try {
    const models = await openclawService.getAvailableModels();
    res.json({ success: true, data: models });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// 测试 OpenClaw 命令
router.post('/test-openclaw', async (req, res) => {
  try {
    const { name, model } = req.body;
    console.log('[test-openclaw] Testing agent creation:', { name, model });
    
    const result = await openclawService.addAgent(name, { model });
    console.log('[test-openclaw] Result:', result);
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[test-openclaw] Error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Agent 间通信 - 发送消息给另一个 agent
router.post('/:id/send-to/:targetId', async (req, res) => {
  try {
    const { message } = req.body;
    const sourceAgent = await agentService.getAgent(req.params.id);
    const targetAgent = await agentService.getAgent(req.params.targetId);
    
    if (!sourceAgent || !targetAgent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }

    const config: AgentConfig = {
      id: targetAgent.openclawId,
      name: targetAgent.name,
      persona: targetAgent.persona || '',
      skills: targetAgent.skills || [],
      role: targetAgent.role || '',
      model: targetAgent.model || 'default',
      workspace: targetAgent.workspace
    };
    const reply = await agentExecutor.chat(targetAgent.openclawId, '[来自 ' + sourceAgent.name + '] ' + message, config);

    res.json({ success: true, data: { reply } });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
