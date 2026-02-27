#!/bin/bash
#
# F2A Skill 一键安装脚本
# 
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/yourname/F2A/main/install.sh | bash
#   
# 或带参数:
#   curl -fsSL https://.../install.sh | bash -s -- --server ws://192.168.1.100:8765

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
SKILL_NAME="f2a-network"
INSTALL_DIR="${HOME}/.openclaw/workspace/skills/${SKILL_NAME}"
REPO_URL="https://github.com/LuciusCao/F2A"
RELEASE_URL="${REPO_URL}/releases/latest/download/f2a-skill.tar.gz"

# 解析参数
SERVER_URL=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --server)
      SERVER_URL="$2"
      shift 2
      ;;
    --help)
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  --server URL    指定 F2A Server 地址"
      echo "  --help          显示帮助"
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}🚀 F2A Skill 安装程序${NC}"
echo ""

# 检查 Node.js
echo -e "${BLUE}📋 检查环境...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js 未安装${NC}"
  echo "请先安装 Node.js 18+: https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Node.js 版本过低: $(node --version)${NC}"
  echo "需要 Node.js 18+"
  exit 1
fi

echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# 检查 npm
if ! command -v npm &> /dev/null; then
  echo -e "${RED}❌ npm 未安装${NC}"
  exit 1
fi

echo -e "${GREEN}✅ npm $(npm --version)${NC}"
echo ""

# 创建安装目录
echo -e "${BLUE}📁 创建安装目录...${NC}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
echo -e "${GREEN}✅ 目录: ${INSTALL_DIR}${NC}"
echo ""

# 下载 Skill
echo -e "${BLUE}⬇️  下载 F2A Skill...${NC}"

# 优先尝试 GitHub Release，失败则尝试从 Server 下载
if curl -fsSL -o f2a-skill.tar.gz "${RELEASE_URL}" 2>/dev/null; then
  echo -e "${GREEN}✅ 从 GitHub 下载成功${NC}"
elif [ -n "$SERVER_URL" ]; then
  # 从指定 Server 下载
  HTTP_URL=$(echo "$SERVER_URL" | sed 's/ws:/http:/' | sed 's/wss:/https:/')
  echo -e "${YELLOW}⚠️  尝试从 Server 下载: ${HTTP_URL}/skill/download${NC}"
  
  if curl -fsSL -o f2a-skill.tar.gz "${HTTP_URL}/skill/download"; then
    echo -e "${GREEN}✅ 从 Server 下载成功${NC}"
  else
    echo -e "${RED}❌ 下载失败${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ 下载失败${NC}"
  echo ""
  echo "可能原因:"
  echo "  1. 无法连接到 GitHub"
  echo "  2. 没有可用的 F2A Server"
  echo ""
  echo "解决方法:"
  echo "  1. 检查网络连接"
  echo "  2. 指定 Server 地址重新安装:"
  echo "     curl -fsSL .../install.sh | bash -s -- --server ws://your-server:8765"
  exit 1
fi

# 解压
echo -e "${BLUE}📦 解压文件...${NC}"
tar -xzf f2a-skill.tar.gz
rm f2a-skill.tar.gz
echo -e "${GREEN}✅ 解压完成${NC}"
echo ""

# 安装依赖
echo -e "${BLUE}📚 安装依赖...${NC}"
npm install --production
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# 配置 Server（如果指定了）
if [ -n "$SERVER_URL" ]; then
  echo -e "${BLUE}⚙️  配置 Server...${NC}"
  mkdir -p "${INSTALL_DIR}/memory/f2a"
  echo "{\"defaultServer\": \"${SERVER_URL}\"}" > "${INSTALL_DIR}/memory/f2a/config.json"
  echo -e "${GREEN}✅ Server 配置: ${SERVER_URL}${NC}"
  echo ""
fi

# 创建启动脚本
cat > "${INSTALL_DIR}/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
node scripts/discover.js
EOF
chmod +x "${INSTALL_DIR}/start.sh"

echo -e "${GREEN}🎉 F2A Skill 安装完成！${NC}"
echo ""
echo "安装目录: ${INSTALL_DIR}"
echo ""
echo "使用方法:"
echo "  cd ${INSTALL_DIR}"
echo "  ./start.sh"
echo ""
echo "在 OpenClaw 中使用:"
echo "  启动 F2A 配对"
