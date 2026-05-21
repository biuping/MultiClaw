#!/usr/bin/env bash
# MultiClaw 一键启动脚本
# Usage: ./start.sh [--skip-deps]

set -euo pipefail

SKIP_DEPS=${1:-}

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}═══════════════════════════════════════════${NC}"
echo -e "${BLUE}  MultiClaw — Multi-Agent Collaboration Platform${NC}"
echo -e "${BLUE}═══════════════════════════════════════════${NC}"

# ─── 1. 检查环境 ──────────────────────────────

echo -e "\n${BLUE}▶ Checking environment...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v openclaw &> /dev/null; then
    echo -e "${RED}✗ OpenClaw is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ OpenClaw $(openclaw --version 2>/dev/null | head -1)${NC}"

# ─── 2. 检查环境变量 ───────────────────────────

echo -e "\n${BLUE}▶ Checking configuration...${NC}"

ENV_FILE="$SCRIPT_DIR/multiClaw-server/.env"
ENV_EXAMPLE="$SCRIPT_DIR/multiClaw-server/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
    if [[ -f "$ENV_EXAMPLE" ]]; then
        echo -e "${YELLOW}! .env not found, copying from .env.example${NC}"
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        echo -e "${YELLOW}  Please review and edit: multiClaw-server/.env${NC}"
    else
        echo -e "${RED}✗ Neither .env nor .env.example found${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ .env configured${NC}"

# ─── 3. 安装依赖 ──────────────────────────────

if [[ "$SKIP_DEPS" != "--skip-deps" ]]; then
    echo -e "\n${BLUE}▶ Installing dependencies...${NC}"
    cd "$SCRIPT_DIR"
    if [[ ! -d "node_modules" ]] || [[ ! -d "multiClaw-server/node_modules" ]] || [[ ! -d "multiClaw-web/node_modules" ]]; then
        npm run install:all
    else
        echo -e "${GREEN}✓ Dependencies already installed (use --skip-deps to skip)${NC}"
    fi
else
    echo -e "\n${BLUE}▶ Skipping dependency installation${NC}"
fi

# ─── 4. 初始化数据库 ───────────────────────────

echo -e "\n${BLUE}▶ Checking database...${NC}"

DB_FILE="$HOME/.multiclaw/database.sqlite"
if [[ ! -f "$DB_FILE" ]]; then
    echo -e "${YELLOW}! Database not found, initializing...${NC}"
    cd "$SCRIPT_DIR/multiClaw-server"
    npx tsx src/db/init.ts
    echo -e "${GREEN}✓ Database initialized${NC}"
else
    echo -e "${GREEN}✓ Database exists ($DB_FILE)${NC}"
fi

# ─── 5. 检查 OpenClaw Gateway ──────────────────

echo -e "\n${BLUE}▶ Checking OpenClaw Gateway...${NC}"

GATEWAY_STATUS=$(openclaw gateway status 2>/dev/null | grep -i "running\|online\|ready" || true)
if [[ -z "$GATEWAY_STATUS" ]]; then
    echo -e "${YELLOW}! Gateway not running, attempting to start...${NC}"
    openclaw gateway start 2>/dev/null || openclaw gateway restart 2>/dev/null || true
    sleep 2
    GATEWAY_STATUS=$(openclaw gateway status 2>/dev/null | grep -i "running\|online\|ready" || true)
    if [[ -z "$GATEWAY_STATUS" ]]; then
        echo -e "${YELLOW}! Could not verify gateway status — you may need to start it manually:${NC}"
        echo -e "  ${YELLOW}openclaw gateway start${NC}"
    else
        echo -e "${GREEN}✓ Gateway is running${NC}"
    fi
else
    echo -e "${GREEN}✓ Gateway is running${NC}"
fi

# ─── 6. 启动服务 ───────────────────────────────

echo -e "\n${BLUE}▶ Starting services...${NC}"
echo ""

cd "$SCRIPT_DIR"
npm run dev
