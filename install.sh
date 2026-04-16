#!/bin/bash
# F2A 一键安装脚本
# 用法: curl -sSf https://f2a.io/install.sh | sh

set -e

echo "🚀 安装 F2A - Friend-to-Agent P2P Networking"

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 需要 Node.js >= 18.0.0"
    echo "请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

# 检查版本
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ 错误: 需要 Node.js >= 18.0.0"
    echo "当前版本: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) 已安装"

# 安装 F2A
echo ""
echo "📦 安装 F2A..."
npm install -g f2a

# 验证安装
echo ""
echo "🔍 验证安装..."
if command -v f2a &> /dev/null; then
    echo "✅ F2A CLI 已安装: $(f2a --version 2>/dev/null || echo '0.5.0')"
else
    echo "❌ F2A CLI 安装失败"
    exit 1
fi

echo ""
echo "🎉 F2A 安装完成！"
echo ""
echo "📖 使用指南:"
echo "  f2a --help          查看帮助"
echo "  f2a daemon start    启动后台服务"
echo "  f2a status          查看状态"
echo ""
