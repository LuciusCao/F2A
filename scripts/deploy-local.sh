#!/bin/bash
# 一键部署到本地 OpenClaw 扩展

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOCAL_EXT="$HOME/.openclaw/extensions/openclaw-f2a/node_modules/@f2a/network"

echo "📦 编译 @f2a/network..."
cd "$PROJECT_ROOT"
npm run build -w packages/network

echo ""
echo "📋 复制到本地扩展..."
mkdir -p "$LOCAL_EXT/dist"
cp -r packages/network/dist/* "$LOCAL_EXT/dist/"
cp packages/network/package.json "$LOCAL_EXT/"

echo ""
echo "✅ 部署完成！"
echo ""
echo "⚠️  请重启 Gateway 加载新代码:"
echo "   pkill -f openclaw-gateway && sleep 3 && openclaw gateway start"