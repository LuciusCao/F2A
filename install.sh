#!/bin/bash
#
# F2A 一键安装脚本
# 
# 使用方法:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash
#   
# 或指定安装目录:
#   curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --dir /path/to/install
#
# 可选：安装后运行配置向导
#   f2a init

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 默认配置
INSTALL_DIR=""
REPO_URL="https://github.com/LuciusCao/F2A"
PACKAGE_NAME="@f2a/network"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      INSTALL_DIR="$2"
      # 验证路径安全性
      if [[ -z "$INSTALL_DIR" ]]; then
        echo -e "${RED}❌ 错误: --dir 参数不能为空${NC}"
        exit 1
      fi
      # 必须是绝对路径
      if [[ "$INSTALL_DIR" != /* ]]; then
        echo -e "${RED}❌ 错误: --dir 必须是绝对路径 (以 / 开头)${NC}"
        exit 1
      fi
      # 禁止路径遍历和特殊字符
      if [[ "$INSTALL_DIR" =~ \.\. || "$INSTALL_DIR" =~ [^a-zA-Z0-9_./\-] ]]; then
        echo -e "${RED}❌ 错误: --dir 路径包含不允许的字符 (禁止使用 .. 或特殊字符)${NC}"
        exit 1
      fi
      shift 2
      ;;
    --global)
      GLOBAL_INSTALL=true
      shift
      ;;
    --systemd)
      SETUP_SYSTEMD=true
      shift
      ;;
    --help)
      echo "F2A P2P Agent 网络安装脚本"
      echo ""
      echo "用法:"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash"
      echo ""
      echo "选项:"
      echo "  --dir PATH      指定安装目录 (默认: 全局安装或当前目录)"
      echo "  --global        全局安装 (npm install -g)"
      echo "  --systemd       安装为 systemd 服务 (仅 Linux)"
      echo "  --help          显示帮助"
      echo ""
      echo "安装后配置:"
      echo "  f2a init        交互式配置向导"
      echo ""
      echo "示例:"
      echo "  # 全局安装 (推荐)"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --global"
      echo ""
      echo "  # 指定目录安装"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --dir ~/f2a"
      echo ""
      echo "  # 安装为系统服务 (Linux)"
      echo "  curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash -s -- --global --systemd"
      exit 0
      ;;
    *)
      echo "未知选项: $1"
      echo "使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   F2A P2P Agent 网络安装程序           ║${NC}"
echo -e "${BLUE}║   无需服务器，局域网直连               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# 1. 检查系统环境
# ============================================
echo -e "${BLUE}📋 检查系统环境...${NC}"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Node.js 未安装${NC}"
  echo ""
  echo "请先安装 Node.js 18+:"
  echo "  https://nodejs.org/"
  echo ""
  echo "或使用包管理器:"
  echo "  macOS:    brew install node"
  echo "  Ubuntu:   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  echo "  CentOS:   curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo yum install -y nodejs"
  echo "  Arch:     sudo pacman -S nodejs npm"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Node.js 版本过低: $(node --version)${NC}"
  echo "需要 Node.js 18+"
  exit 1
fi

echo -e "${GREEN}  ✅ Node.js $(node --version)${NC}"

# 检查包管理器
PKG_MANAGER=""
if command -v pnpm &> /dev/null; then
  PKG_MANAGER="pnpm"
  echo -e "${GREEN}  ✅ pnpm $(pnpm --version)${NC}"
elif command -v npm &> /dev/null; then
  PKG_MANAGER="npm"
  echo -e "${GREEN}  ✅ npm $(npm --version)${NC}"
else
  echo -e "${RED}❌ 未找到 npm 或 pnpm${NC}"
  exit 1
fi

# 检查 git（可选）
if command -v git &> /dev/null; then
  echo -e "${GREEN}  ✅ git $(git --version | cut -d' ' -f3)${NC}"
  HAS_GIT=true
else
  echo -e "${YELLOW}  ⚠️  git 未安装（将使用 npm 直接安装）${NC}"
  HAS_GIT=false
fi

echo ""

# ============================================
# 2. 选择安装方式
# ============================================
if [ -n "$INSTALL_DIR" ]; then
  # 指定目录安装
  INSTALL_METHOD="dir"
elif [ "${GLOBAL_INSTALL}" = true ]; then
  # 全局安装
  INSTALL_METHOD="global"
elif [ "${SETUP_SYSTEMD}" = true ]; then
  # systemd 服务需要全局安装
  INSTALL_METHOD="global"
else
  # 默认全局安装
  INSTALL_METHOD="global"
fi

# ============================================
# 3. 执行安装
# ============================================
echo -e "${BLUE}📦 安装 F2A...${NC}"
echo ""

case $INSTALL_METHOD in
  "global")
    echo -e "${CYAN}  安装方式: 全局安装${NC}"
    
    if [ "$PKG_MANAGER" = "pnpm" ]; then
      pnpm install -g "$PACKAGE_NAME"
    else
      npm install -g "$PACKAGE_NAME"
    fi
    
    # 验证安装
    if command -v f2a &> /dev/null; then
      echo -e "${GREEN}  ✅ F2A 已安装到全局${NC}"
    else
      echo -e "${YELLOW}  ⚠️  f2a 命令未在 PATH 中找到${NC}"
      echo -e "${YELLOW}     可能需要重新打开终端或添加 npm 全局目录到 PATH${NC}"
    fi
    ;;
    
  "dir")
    echo -e "${CYAN}  安装方式: 目录安装${NC}"
    
    # 创建安装目录
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    if [ "$HAS_GIT" = true ]; then
      echo -e "${CYAN}  克隆仓库...${NC}"
      git clone --depth 1 "${REPO_URL}.git" . 2>/dev/null || {
        echo -e "${YELLOW}  ⚠️  目录不为空，尝试更新...${NC}"
        git pull || true
      }
    else
      echo -e "${RED}  ❌ 目录安装需要 git，请使用 --global 安装或安装 git${NC}"
      exit 1
    fi
    
    # 安装依赖
    echo -e "${CYAN}  安装依赖...${NC}"
    if [ "$PKG_MANAGER" = "pnpm" ]; then
      pnpm install
    else
      npm install
    fi
    
    # 构建
    echo -e "${CYAN}  构建 TypeScript...${NC}"
    npm run build
    
    echo -e "${GREEN}  ✅ F2A 已安装到 $INSTALL_DIR${NC}"
    ;;
esac

echo ""

# ============================================
# 4. 创建默认配置文件
# ============================================
echo -e "${BLUE}📝 创建配置文件...${NC}"

CONFIG_DIR="${HOME}/.f2a"
mkdir -p "$CONFIG_DIR"

# 默认配置文件
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << 'EOF'
{
  "agentName": "my-agent",
  "network": {
    "bootstrapPeers": []
  },
  "autoStart": false
}
EOF
  echo -e "${GREEN}  ✅ 配置文件已创建: $CONFIG_FILE${NC}"
else
  echo -e "${YELLOW}  ⚠️  配置文件已存在: $CONFIG_FILE${NC}"
fi

echo ""

# ============================================
# 5. 可选：设置 systemd 服务
# ============================================
if [ "${SETUP_SYSTEMD}" = true ]; then
  if [ "$(uname -s)" != "Linux" ]; then
    echo -e "${YELLOW}  ⚠️  systemd 服务仅支持 Linux${NC}"
  else
    echo -e "${BLUE}🔧 设置 systemd 服务...${NC}"
    
    # 验证 f2a 命令存在
    F2A_PATH=$(which f2a 2>/dev/null || true)
    if [ -z "$F2A_PATH" ]; then
      echo -e "${RED}  ❌ f2a 命令未找到，无法创建 systemd 服务${NC}"
      echo -e "${YELLOW}     请确保 F2A 已正确安装并添加到 PATH${NC}"
    else
      NODE_PATH=$(which node 2>/dev/null || true)
      if [ -z "$NODE_PATH" ]; then
        echo -e "${RED}  ❌ node 命令未找到${NC}"
      else
        SERVICE_FILE="/etc/systemd/system/f2a.service"
        
        # 生成随机控制 token (32 字节 hex = 64 字符)
        CONTROL_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
        
        # 创建安全的环境文件目录和文件
        ENV_DIR="/etc/f2a"
        ENV_FILE="$ENV_DIR/control.env"
        sudo mkdir -p "$ENV_DIR"
        sudo chmod 700 "$ENV_DIR"
        sudo chown root:root "$ENV_DIR"
        
        # 使用临时文件写入 token，然后安全移动
        # 使用 umask 077 确保临时文件在写入时权限安全
        TEMP_ENV_FILE=$(mktemp)
        (umask 077; cat > "$TEMP_ENV_FILE" << EOF
# F2A 控制令牌 - 请勿分享此文件
F2A_CONTROL_TOKEN=${CONTROL_TOKEN}
EOF
)
        sudo mv "$TEMP_ENV_FILE" "$ENV_FILE"
        sudo chmod 600 "$ENV_FILE"
        sudo chown root:root "$ENV_FILE"
        
        # 使用临时文件避免 sudo tee 权限提升风险
        TEMP_SERVICE_FILE=$(mktemp)
        cat > "$TEMP_SERVICE_FILE" << EOF
[Unit]
Description=F2A P2P Agent Network
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${HOME}
ExecStart=${NODE_PATH} ${F2A_PATH} daemon
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=F2A_CONTROL_PORT=9001
EnvironmentFile=${ENV_FILE}

[Install]
WantedBy=multi-user.target
EOF
        
        # 使用 sudo mv 替代 sudo tee (更安全)
        sudo mv "$TEMP_SERVICE_FILE" "$SERVICE_FILE"
        sudo chmod 600 "$SERVICE_FILE"

        sudo systemctl daemon-reload
        sudo systemctl enable f2a
        
        # 输出控制 token 提示
        echo ""
        echo -e "${YELLOW}  ⚠️  控制令牌已自动生成并安全保存${NC}"
        echo -e "${YELLOW}     查看令牌: sudo cat ${ENV_FILE}${NC}"
        
        echo -e "${GREEN}  ✅ systemd 服务已设置${NC}"
        echo ""
        echo "服务管理命令:"
        echo "  sudo systemctl start f2a    # 启动服务"
        echo "  sudo systemctl stop f2a     # 停止服务"
        echo "  sudo systemctl status f2a   # 查看状态"
        echo "  sudo journalctl -u f2a -f   # 查看日志"
      fi
    fi
    
    echo ""
  fi
fi

# ============================================
# 6. 完成提示
# ============================================
echo -e "${GREEN}🎉 F2A 安装完成！${NC}"
echo ""
echo "══════════════════════════════════════════════════"
echo ""
echo -e "${CYAN}下一步操作:${NC}"
echo ""
echo "  1. 配置 F2A:"
echo "     ${BLUE}f2a init${NC}              # 交互式配置向导"
echo ""
echo "  2. 启动 F2A:"
echo "     ${BLUE}f2a daemon${NC}            # 前台运行"
echo "     ${BLUE}f2a daemon -d${NC}         # 后台运行"
echo ""
echo "  3. 查看状态:"
echo "     ${BLUE}f2a status${NC}            # 查看节点状态"
echo "     ${BLUE}f2a peers${NC}             # 查看已连接节点"
echo ""
echo -e "${CYAN}配置文件:${NC}"
echo "  $CONFIG_FILE"
echo ""
echo -e "${CYAN}环境变量 (可选):${NC}"
echo "  F2A_CONTROL_PORT    控制端口 (默认: 9001)"
echo "  F2A_P2P_PORT        P2P 端口 (默认: 随机)"
echo "  F2A_CONTROL_TOKEN   认证 Token"
echo ""
echo "══════════════════════════════════════════════════"