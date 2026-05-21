<div align="center">

# MultiClaw

**A Multi-Agent Collaboration Platform powered by OpenClaw**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6.svg)](https://www.typescriptlang.org/)

[English](#english) | [中文](#中文)

</div>

---

<a id="english"></a>

## English

### What is MultiClaw?

MultiClaw is a web-based multi-agent collaboration platform built on top of [OpenClaw](https://github.com/openclaw/openclaw). It provides an intuitive visual interface to create, configure, and coordinate multiple AI agents, each with its own persona, skills, and role.

### Key Features

- **Agent Management**: Create, edit, and delete agents with custom names, avatars, personas, skills, and model preferences.
- **Relationship Canvas**: Visually configure agent hierarchies and collaboration flows via drag-and-drop (powered by React Flow).
- **Team Task Execution**: Coordinate multi-agent workflows — analyze tasks, delegate to appropriate agents, and integrate results.
- **Real-time Chat**: Independent chat windows for each agent with Markdown rendering, streaming output, and skill-call step visualization.
- **Skill Library**: Browse and assign skills to agents. Each agent workspace can host private skills.
- **Checkpoint & Resume**: Tasks support breakpoint resumption. If a task fails or produces unsatisfactory results, retry from any phase with optional human guidance injection.
- **Gateway Monitoring**: Monitor and restart the OpenClaw gateway directly from the UI.

### Architecture

```
┌─────────────────────────────────────────────┐
│              Frontend (React 18)             │
│  Canvas │ Agent List │ Chat │ Tasks │ Skills │
└──────────────────┬──────────────────────────┘
                   │ REST API + WebSocket
┌──────────────────▼──────────────────────────┐
│         Backend (Express + SQLite)           │
│   Agent CRUD │ Relations │ Chat │ Tasks      │
└──────────────────┬──────────────────────────┘
                   │ spawn child process
┌──────────────────▼──────────────────────────┐
│              OpenClaw CLI                    │
│   openclaw agent --local --session-id ...    │
└─────────────────────────────────────────────┘
```

**Isolation by Design**: MultiClaw agents are *virtual entities* stored in a local SQLite database. They do not register with OpenClaw's agent system. Conversations are executed via `openclaw agent --local` in temporary, isolated sessions — no cross-task memory pollution.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript, Vite, Ant Design, React Flow, Zustand, Tailwind CSS |
| Backend | Node.js + Express + TypeScript, SQLite3, WebSocket (`ws`) |
| Execution | OpenClaw CLI (`openclaw agent --local`) |
| Database | SQLite (file: `~/.multiclaw/database.sqlite`) |

### Quick Start

```bash
# 1. Clone & enter directory
cd multiClaw

# 2. One-click start (auto installs deps, checks gateway, starts servers)
./start.sh

# Or step by step:
# npm run install:all          # Install dependencies
# cp multiClaw-server/.env.example multiClaw-server/.env
# npm run db:init              # Initialize database
# npm run dev                  # Start dev servers
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3010
- WebSocket: ws://localhost:3010/ws

### Project Structure

```
multiClaw/
├── multiClaw-server/          # Backend service
│   ├── src/
│   │   ├── db/               # Database (SQLite + migrations)
│   │   ├── routes/           # REST API routes
│   │   ├── services/         # Business logic
│   │   │   ├── openclaw.ts   # OpenClaw CLI wrapper
│   │   │   ├── agent-executor.ts  # Unified agent task execution
│   │   │   └── task.ts       # Task management
│   │   ├── types/            # TypeScript definitions
│   │   ├── websocket.ts      # WebSocket entry
│   │   └── ws/               # WebSocket handlers (chat, stream, connection)
│   ├── .env.example          # Environment template
│   └── package.json
│
├── multiClaw-web/             # Frontend application
│   ├── src/
│   │   ├── components/       # React components
│   │   │   ├── AgentCanvas.tsx      # Relationship canvas
│   │   │   ├── TaskBoard.tsx        # Kanban task board
│   │   │   ├── TaskDetailPanel.tsx  # Task execution panel
│   │   │   └── ChatPanel.tsx        # Chat interface
│   │   ├── pages/            # Page components
│   │   ├── stores/           # Zustand state management
│   │   ├── services/         # API client (Axios)
│   │   └── hooks/            # Custom React hooks
│   └── package.json
│
└── workspace/                 # Agent workspaces (gitignored)
    └── .gitkeep
```

### What Gets Uploaded to GitHub

| Upload? | Path | Reason |
|---------|------|--------|
| ✅ Yes | `multiClaw-server/src/`, `multiClaw-web/src/` | Source code |
| ✅ Yes | `package.json`, `tsconfig.json`, `vite.config.ts` | Build config |
| ✅ Yes | `.env.example` | Template for users |
| ✅ Yes | `README.md`, `LICENSE` | Documentation |
| ❌ No | `.env` | Contains secrets (API keys) |
| ❌ No | `workspace/` | Personal agent configs & generated files |
| ❌ No | `*.sqlite`, `*.log` | Local data & logs |
| ❌ No | `node_modules/`, `dist/` | Dependencies & build output |
| ❌ No | `uploads/` | User-uploaded avatars |
| ❌ No | `.DS_Store` | OS junk |

---

<a id="中文"></a>

## 中文

### MultiClaw 是什么？

MultiClaw 是一个基于 [OpenClaw](https://github.com/openclaw/openclaw) 的多 Agent 协同管理平台。它提供直观的可视化界面，让你创建、配置和协调多个 AI Agent，每个 Agent 拥有独立的性格、技能和角色。

### 核心功能

- **Agent 管理**：创建、编辑、删除 Agent，自定义名称、头像、性格、技能和模型偏好。
- **关系画布**：通过拖拽连线可视化配置 Agent 层级关系与协作流向（基于 React Flow）。
- **团队任务执行**：协调多 Agent 工作流 — 分析任务、委派给合适的 Agent、整合结果。
- **实时聊天**：每个 Agent 拥有独立聊天窗口，支持 Markdown 渲染、流式输出、技能调用步骤可视化。
- **技能库**：浏览并为 Agent 分配技能，每个 Agent 工作区可拥有私有技能。
- **断点续传与重来**：任务支持断点恢复；若失败或结果不满意，可从任意阶段重新开始，并支持注入人工指导。
- **网关监控**：直接从 UI 监控和重启 OpenClaw 网关。

### 架构设计

```
┌─────────────────────────────────────────────┐
│              前端 (React 18)                 │
│  关系画布 │ Agent 列表 │ 聊天 │ 任务 │ 技能库 │
└──────────────────┬──────────────────────────┘
                   │ REST API + WebSocket
┌──────────────────▼──────────────────────────┐
│            后端 (Express + SQLite)            │
│   Agent CRUD │ 关系管理 │ 聊天 │ 任务管理      │
└──────────────────┬──────────────────────────┘
                   │ spawn 子进程
┌──────────────────▼──────────────────────────┐
│              OpenClaw CLI                    │
│   openclaw agent --local --session-id ...    │
└─────────────────────────────────────────────┘
```

**隔离设计**：MultiClaw 的 Agent 是*虚拟实体*，存储在本地 SQLite 数据库中。它们不注册到 OpenClaw 的 Agent 系统。对话通过 `openclaw agent --local` 在临时、隔离的 session 中执行 —— 不会跨任务污染记忆。

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript, Vite, Ant Design, React Flow, Zustand, Tailwind CSS |
| 后端 | Node.js + Express + TypeScript, SQLite3, WebSocket (`ws`) |
| 执行层 | OpenClaw CLI (`openclaw agent --local`) |
| 数据库 | SQLite (文件路径: `~/.multiclaw/database.sqlite`) |

### 快速开始

```bash
# 1. 进入目录
cd multiClaw

# 2. 一键启动（自动安装依赖、检查网关、启动服务）
./start.sh

# 或分步执行：
# npm run install:all          # 安装依赖
# cp multiClaw-server/.env.example multiClaw-server/.env
# npm run db:init              # 初始化数据库
# npm run dev                  # 启动开发服务器
```

- 前端: http://localhost:3000
- 后端: http://localhost:3010
- WebSocket: ws://localhost:3010/ws

### 项目结构

```
multiClaw/
├── multiClaw-server/          # 后端服务
│   ├── src/
│   │   ├── db/               # 数据库 (SQLite + 迁移)
│   │   ├── routes/           # REST API 路由
│   │   ├── services/         # 业务逻辑
│   │   │   ├── openclaw.ts   # OpenClaw CLI 封装
│   │   │   ├── agent-executor.ts  # 统一 Agent 任务执行
│   │   │   └── task.ts       # 任务管理
│   │   ├── types/            # TypeScript 类型定义
│   │   ├── websocket.ts      # WebSocket 入口
│   │   └── ws/               # WebSocket 处理器
│   ├── .env.example          # 环境变量模板
│   └── package.json
│
├── multiClaw-web/             # 前端应用
│   ├── src/
│   │   ├── components/       # React 组件
│   │   │   ├── AgentCanvas.tsx      # 关系画布
│   │   │   ├── TaskBoard.tsx        # 任务看板
│   │   │   ├── TaskDetailPanel.tsx  # 任务执行面板
│   │   │   └── ChatPanel.tsx        # 聊天界面
│   │   ├── pages/            # 页面组件
│   │   ├── stores/           # Zustand 状态管理
│   │   ├── services/         # API 客户端 (Axios)
│   │   └── hooks/            # 自定义 React Hooks
│   └── package.json
│
└── workspace/                 # Agent 工作区 (gitignored)
    └── .gitkeep
```

### 哪些文件上传 GitHub

| 上传？ | 路径 | 原因 |
|--------|------|------|
| ✅ 是 | `multiClaw-server/src/`, `multiClaw-web/src/` | 源代码 |
| ✅ 是 | `package.json`, `tsconfig.json`, `vite.config.ts` | 构建配置 |
| ✅ 是 | `.env.example` | 环境变量模板 |
| ✅ 是 | `README.md`, `LICENSE` | 项目文档 |
| ❌ 否 | `.env` | 包含密钥等敏感信息 |
| ❌ 否 | `workspace/` | 个人 Agent 配置与生成文件 |
| ❌ 否 | `*.sqlite`, `*.log` | 本地数据与日志 |
| ❌ 否 | `node_modules/`, `dist/` | 依赖与构建产物 |
| ❌ 否 | `uploads/` | 用户上传的头像 |
| ❌ 否 | `.DS_Store` | 系统垃圾文件 |

---

## License

MIT
