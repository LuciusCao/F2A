#!/bin/bash
# F2A Agent 技能安装脚本
# 用法: cd ~/.openclaw/skills/ && curl -sSf https://f2a.io/skill-install.sh | sh

set -e

# 获取技能目录路径
SKILL_DIR="${1:-$(pwd)/f2a}"

echo "🔧 安装 F2A Agent 技能..."

# 检查 F2A CLI 是否已安装
if ! command -v f2a &> /dev/null; then
    echo "❌ 错误: F2A CLI 未安装"
    echo "请先安装 F2A: curl -sSf https://f2a.io/install.sh | sh"
    exit 1
fi

echo "✅ F2A CLI 已安装: $(f2a --version 2>/dev/null || echo '0.5.0')"

# 创建技能目录
mkdir -p "$SKILL_DIR/commands"

# 复制技能文件（从 GitHub 或本地）
SKILL_SOURCE="$(dirname "$0")/../skills/f2a"

if [ -d "$SKILL_SOURCE" ]; then
    echo "📋 从本地复制技能文件..."
    cp -r "$SKILL_SOURCE"/* "$SKILL_DIR/"
else
    echo "📋 创建技能文件..."
    # 创建 SKILL.md
    cat > "$SKILL_DIR/SKILL.md" << 'SKILLEOF'
---
name: f2a
description: F2A P2P 网络通信技能。可以发送消息、接收消息、发现网络中的 Agent。
---

# F2A P2P Network

## 命令

### f2a send
发送消息给指定 Agent
- `--to <peer_id>`: 目标 Agent
- `--topic <topic>`: 消息主题
- `<message>`: 消息内容

### f2a messages
查看收到的消息

### f2a discover
发现网络中的 Agent

### f2a agent
管理已注册的 Agent

### f2a daemon
管理后台服务
SKILLEOF
fi

# 创建命令脚本
cat > "$SKILL_DIR/f2a.sh" << 'CMDEOF'
#!/bin/bash
# F2A 技能入口脚本
# 调用 F2A CLI 执行命令

exec f2a "$@"
CMDEOF
chmod +x "$SKILL_DIR/f2a.sh"

echo ""
echo "🎉 F2A 技能安装完成！"
echo ""
echo "📖 使用指南:"
echo "  f2a send --to <peer_id> 'Hello!'"
echo "  f2a messages"
echo "  f2a discover"
echo ""
