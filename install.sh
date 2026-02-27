#!/bin/bash
#
# F2A 一键安装脚本 (纯 P2P 版本)
# 
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash
#   
# 或指定安装目录:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --dir /path/to/install

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认配置
INSTALL_DIR="${HOME}/.openclaw/workspace/skills/f2a-network"
REPO_URL="https://github.com/LuciusCao/F2A"
P2P_PORT="9000"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --port)
      P2P_PORT="$2"
      shift 2
      ;;
    --help)
      echo "F2A 纯 P2P Agent 网络安装脚本"
      echo ""
      echo "用法:"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash"
      echo ""
      echo "选项:"
      echo "  --dir PATH      指定安装目录 (默认: ~/.openclaw/workspace/skills/f2a-network)"
      echo "  --port PORT     指定 P2P 端口 (默认: 9000)"
      echo "  --help          显示帮助"
      echo ""
      echo "示例:"
      echo "  # 默认安装"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash"
      echo ""
      echo "  # 指定端口"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --port 9001"
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}🚀 F2A 纯 P2P Agent 网络安装程序${NC}"
echo -e "${BLUE}   无需服务器，局域网直连${NC}"
echo ""

# 检查 Node.js
echo -e "${BLUE}📋 检查环境...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js 未安装${NC}"
  echo ""
  echo "请先安装 Node.js 18+:"
  echo "  https://nodejs.org/"
  echo ""
  echo "或使用包管理器:"
  echo "  macOS:    brew install node"
  echo "  Ubuntu:   sudo apt install nodejs npm"
  echo "  CentOS:   sudo yum install nodejs npm"
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

# 检查 git
if ! command -v git &> /dev/null; then
  echo -e "${YELLOW}⚠️  git 未安装，将使用 curl 下载${NC}"
  USE_GIT=false
else
  echo -e "${GREEN}✅ git $(git --version | cut -d' ' -f3)${NC}"
  USE_GIT=true
fi
echo ""

# 创建安装目录
echo -e "${BLUE}📁 创建安装目录...${NC}"
if [ -d "${INSTALL_DIR}" ]; then
  echo -e "${YELLOW}⚠️  目录已存在，将覆盖安装${NC}"
  rm -rf "${INSTALL_DIR}"
fi

mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
echo -e "${GREEN}✅ 目录: ${INSTALL_DIR}${NC}"
echo ""

# 下载 F2A
echo -e "${BLUE}⬇️  下载 F2A...${NC}"

if [ "$USE_GIT" = true ]; then
  # 使用 git clone
  git clone --depth 1 "${REPO_URL}.git" temp_clone 2>/dev/null || {
    echo -e "${YELLOW}⚠️  git clone 失败，尝试使用 curl...${NC}"
    USE_GIT=false
  }
  
  if [ "$USE_GIT" = true ]; then
    cp -r temp_clone/skill/* .
    rm -rf temp_clone
    echo -e "${GREEN}✅ 通过 git 下载成功${NC}"
  fi
fi

if [ "$USE_GIT" = false ]; then
  # 使用 curl 下载
  echo -e "${BLUE}📦 使用 curl 下载...${NC}"
  
  # 下载最新 release
  LATEST_URL="${REPO_URL}/archive/refs/heads/main.tar.gz"
  
  if curl -fsSL -o f2a.tar.gz "${LATEST_URL}"; then
    tar -xzf f2a.tar.gz --strip-components=2 "F2A-main/skill"
    rm -f f2a.tar.gz
    echo -e "${GREEN}✅ 通过 curl 下载成功${NC}"
  else
    echo -e "${RED}❌ 下载失败${NC}"
    echo ""
    echo "可能原因:"
    echo "  1. 无法连接到 GitHub"
    echo "  2. 网络不稳定"
    echo ""
    echo "解决方法:"
    echo "  1. 检查网络连接"
    echo "  2. 手动下载: git clone ${REPO_URL}"
    exit 1
  fi
fi

echo ""

# 安装依赖
echo -e "${BLUE}📚 安装依赖...${NC}"
npm install --production
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# 创建配置文件
mkdir -p "${INSTALL_DIR}/memory/f2a"
cat > "${INSTALL_DIR}/memory/f2a/config.json" << EOF
{
  "p2pPort": ${P2P_PORT},
  "security": {
    "level": "medium",
    "requireConfirmation": true
  }
}
EOF

# 创建启动脚本
cat > "${INSTALL_DIR}/start.sh" << EOF
#!/bin/bash
cd "$(dirname "$0")"
echo "🚀 启动 F2A 纯 P2P 网络..."
echo "   端口: ${P2P_PORT}"
echo ""
node examples/serverless-example.js
EOF
chmod +x "${INSTALL_DIR}/start.sh"

# 创建快速启动命令
if [ -d "${HOME}/.local/bin" ]; then
  cat > "${HOME}/.local/bin/f2a" << EOF
#!/bin/bash
cd "${INSTALL_DIR}"
./start.sh
EOF
  chmod +x "${HOME}/.local/bin/f2a"
  echo -e "${GREEN}✅ 已创建快捷命令: f2a${NC}"
fi

echo -e "${GREEN}🎉 F2A 安装完成！${NC}"
echo ""
echo "═══════════════════════════════════════"
echo ""
echo "📂 安装目录: ${INSTALL_DIR}"
echo "🔌 P2P 端口: ${P2P_PORT}"
echo ""
echo "🚀 启动方式:"
echo "  cd ${INSTALL_DIR}"
echo "  ./start.sh"
echo ""
echo "或直接使用:"
echo "  f2a"
echo ""
echo "📖 使用方法:"
echo "  1. 启动后自动发现局域网内的其他 Agent"
echo "  2. 新连接需要手动确认"
echo "  3. 使用命令行交互发送消息"
echo ""
echo "🔐 安全特性:"
echo "  - 端到端加密 (ECDH + AES-256-GCM)"
echo "  - Ed25519 身份签名验证"
echo "  - 白名单/黑名单机制"
echo "  - 速率限制防 DoS"
echo ""
echo "═══════════════════════════════════════"
