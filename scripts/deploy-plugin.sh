#!/bin/bash
#
# OpenClaw F2A 插件部署脚本
# 
# 使用方法:
#   ./scripts/deploy-plugin.sh [target_host] [target_user]
#
# 示例:
#   ./scripts/deploy-plugin.sh CatPi.local lucius
#   ./scripts/deploy-plugin.sh 192.168.1.100 root

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 默认配置
TARGET_HOST="${1:-CatPi.local}"
TARGET_USER="${2:-lucius}"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE_DIR="$PLUGIN_DIR/packages/openclaw-f2a"
TEMP_FILE="/tmp/openclaw-f2a-deploy.tar.gz"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   OpenClaw F2A 插件部署程序            ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# 获取版本号
VERSION=$(grep '"version"' "$PACKAGE_DIR/package.json" | cut -d'"' -f4)
echo -e "${CYAN}📦 插件版本: $VERSION${NC}"
echo -e "${CYAN}🎯 目标主机: $TARGET_USER@$TARGET_HOST${NC}"
echo ""

# ============================================
# 1. 检查本地环境
# ============================================
echo -e "${BLUE}📋 检查本地环境...${NC}"

if [ ! -d "$PACKAGE_DIR/dist" ]; then
  echo -e "${YELLOW}  ⚠️  dist 目录不存在，正在构建...${NC}"
  cd "$PLUGIN_DIR"
  npm run build -w packages/openclaw-f2a
fi

echo -e "${GREEN}  ✅ 本地环境检查完成${NC}"
echo ""

# ============================================
# 2. 打包插件
# ============================================
echo -e "${BLUE}📦 打包插件...${NC}"

cd "$PACKAGE_DIR"
tar czf "$TEMP_FILE" dist package.json openclaw.plugin.json README.md

echo -e "${GREEN}  ✅ 已打包到: $TEMP_FILE${NC}"
echo ""

# ============================================
# 3. 复制到目标主机
# ============================================
echo -e "${BLUE}🚀 部署到目标主机...${NC}"

# 复制安装包
echo -e "${CYAN}  复制安装包...${NC}"
scp "$TEMP_FILE" "$TARGET_USER@$TARGET_HOST:/tmp/"

# 复制部署脚本
echo -e "${CYAN}  复制部署脚本...${NC}"
REMOTE_SCRIPT=$(cat << 'REMOTE_EOF'
#!/bin/bash
set -e

PLUGIN_DIR="$HOME/.openclaw/extensions/openclaw-f2a"
TEMP_FILE="/tmp/openclaw-f2a-deploy.tar.gz"

echo "解压插件..."
mkdir -p "$PLUGIN_DIR"
cd "$PLUGIN_DIR"
tar xzf "$TEMP_FILE"

echo "安装依赖..."
npm install --production

echo "验证安装..."
if [ -d "node_modules/@f2a" ]; then
  echo "✅ @f2a/network 已安装"
else
  echo "❌ @f2a/network 安装失败"
  exit 1
fi

echo "清理临时文件..."
rm -f "$TEMP_FILE"

echo "✅ 部署完成"
REMOTE_EOF
)

ssh "$TARGET_USER@$TARGET_HOST" "echo '$REMOTE_SCRIPT' > /tmp/deploy-f2a-plugin.sh && chmod +x /tmp/deploy-f2a-plugin.sh && bash /tmp/deploy-f2a-plugin.sh"

echo -e "${GREEN}  ✅ 部署完成${NC}"
echo ""

# ============================================
# 4. 提示重启 Gateway
# ============================================
echo -e "${YELLOW}⚠️  请重启 Gateway 以加载新插件:${NC}"
echo ""
echo "  ssh $TARGET_USER@$TARGET_HOST"
echo "  pkill -f openclaw-gateway"
echo "  # 等待 5 秒"
echo "  openclaw gateway start"
echo ""

# 清理本地临时文件
rm -f "$TEMP_FILE"

echo -e "${GREEN}🎉 部署完成！${NC}"