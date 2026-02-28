#!/bin/bash
#
# F2A Agent 一键安装脚本
# 供其他 OpenClaw Agent 通过 curl 直接安装使用
#
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install-agent.sh | bash
#
# 指定安装目录:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install-agent.sh | bash -s -- --dir /path/to/skills/f2a-network

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 默认配置
DEFAULT_SKILLS_DIR="${HOME}/.openclaw/workspace/skills"
INSTALL_DIR="${DEFAULT_SKILLS_DIR}/f2a-network"
REPO_URL="https://github.com/LuciusCao/F2A"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --help)
      echo "F2A Agent Skill 一键安装脚本"
      echo ""
      echo "用法:"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install-agent.sh | bash"
      echo ""
      echo "选项:"
      echo "  --dir PATH    指定安装目录 (默认: ~/.openclaw/workspace/skills/f2a-network)"
      echo "  --help        显示帮助"
      echo ""
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}🚀 F2A Agent Skill 安装程序${NC}"
echo ""

# 检查 Node.js
echo -e "${BLUE}📋 检查环境...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js 未安装${NC}"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Node.js 版本过低，需要 18+${NC}"
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
echo -e "${BLUE}📁 安装到: ${INSTALL_DIR}${NC}"
if [ -d "${INSTALL_DIR}" ]; then
  echo -e "${YELLOW}⚠️  目录已存在，将覆盖安装${NC}"
  rm -rf "${INSTALL_DIR}"
fi
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

# 下载 F2A skill
echo -e "${BLUE}⬇️  下载 F2A...${NC}"
if command -v git &> /dev/null; then
  git clone --depth 1 "${REPO_URL}.git" temp_clone 2>/dev/null && {
    cp -r temp_clone/skill/* .
    rm -rf temp_clone
    echo -e "${GREEN}✅ 下载成功${NC}"
  } || {
    echo -e "${YELLOW}⚠️  git 下载失败，尝试 curl...${NC}"
    USE_CURL=1
  }
else
  USE_CURL=1
fi

if [ "${USE_CURL:-0}" = "1" ]; then
  LATEST_URL="${REPO_URL}/archive/refs/heads/main.tar.gz"
  if curl -fsSL -o f2a.tar.gz "${LATEST_URL}"; then
    tar -xzf f2a.tar.gz --strip-components=2 "F2A-main/skill"
    rm -f f2a.tar.gz
    echo -e "${GREEN}✅ 下载成功${NC}"
  else
    echo -e "${RED}❌ 下载失败，请检查网络连接${NC}"
    exit 1
  fi
fi
echo ""

# 安装依赖
echo -e "${BLUE}📚 安装依赖...${NC}"
npm install --production
echo -e "${GREEN}✅ 依赖安装完成${NC}"
echo ""

# 完成
echo -e "${GREEN}🎉 F2A Agent Skill 安装完成！${NC}"
echo ""
echo "═══════════════════════════════════════"
echo ""
echo "📂 安装目录: ${INSTALL_DIR}"
echo ""
echo "Agent 现在可以:"
echo "  1. 读取 SKILL.md 获取使用指南"
echo "  2. 启动 P2P 网络发现其他 Agent"
echo "  3. 与其他 Agent 建立加密连接"
echo "  4. 调用远程 Agent 的技能"
echo ""
echo "═══════════════════════════════════════"
