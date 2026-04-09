#!/bin/bash
#
# F2A 一键部署脚本
# 
# 解决问题：
# 1. 统一部署流程，避免手动复制错误
# 2. 自动检测目标平台路径
# 3. 验证部署结果
#
# 使用方法:
#   ./scripts/deploy.sh              # 部署到本机
#   ./scripts/deploy.sh CatPi        # 部署到 CatPi
#   ./scripts/deploy.sh CatPi /mnt/ssd/openclaw  # 指定路径

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "F2A 部署脚本"
echo "========================================"

# 编译
echo ""
echo -e "${YELLOW}[1/5] 编译项目${NC}"
cd "$PROJECT_ROOT"
npm run build 2>&1 | tail -5

# 部署目标
TARGET_HOST="${1:-local}"
CUSTOM_PATH="${2:-}"

if [ "$TARGET_HOST" = "local" ]; then
    # 本机部署
    DEPLOY_PATH="$HOME/.openclaw/extensions/openclaw-f2a"
    echo ""
    echo -e "${YELLOW}[2/5] 部署到本机${NC}"
    echo "路径: $DEPLOY_PATH"
    
    # 部署 openclaw-f2a
    rsync -av --checksum packages/openclaw-f2a/dist/ "$DEPLOY_PATH/dist/"
    
    # 部署 network 包
    rsync -av --checksum packages/network/dist/ "$DEPLOY_PATH/node_modules/@f2a/network/dist/"
    
else
    # 远程部署
    echo ""
    echo -e "${YELLOW}[2/5] 部署到 $TARGET_HOST${NC}"
    
    # 检测实际运行路径
    if [ -n "$CUSTOM_PATH" ]; then
        DEPLOY_PATH="$CUSTOM_PATH/extensions/openclaw-f2a"
    else
        # 默认路径（需要根据实际情况调整）
        DEPLOY_PATH="$HOME/.npm-global/lib/node_modules/openclaw/extensions/openclaw-f2a"
        ALT_PATH="/mnt/ssd/openclaw/extensions/openclaw-f2a"
        
        # 检查哪个路径存在
        if ssh "$TARGET_HOST" "[ -d $ALT_PATH ]" 2>/dev/null; then
            DEPLOY_PATH="$ALT_PATH"
            echo -e "${GREEN}检测到实际路径: $DEPLOY_PATH${NC}"
        else
            echo -e "${YELLOW}使用默认路径: $DEPLOY_PATH${NC}"
        fi
    fi
    
    # 部署 openclaw-f2a
    ssh "$TARGET_HOST" "mkdir -p $DEPLOY_PATH/dist" 2>&1
    rsync -av --checksum packages/openclaw-f2a/dist/ "$TARGET_HOST:$DEPLOY_PATH/dist/"
    
    # 部署 network 包
    ssh "$TARGET_HOST" "mkdir -p $DEPLOY_PATH/node_modules/@f2a/network/dist" 2>&1
    rsync -av --checksum packages/network/dist/ "$TARGET_HOST:$DEPLOY_PATH/node_modules/@f2a/network/dist/"
fi

# 验证部署
echo ""
echo -e "${YELLOW}[3/5] 验证部署${NC}"

check_fix() {
    local path="$1"
    local file="$2"
    local pattern="$3"
    local name="$4"
    
    if grep -q "$pattern" "$path/$file" 2>/dev/null; then
        echo -e "${GREEN}✅ $name: 已修复${NC}"
        return 0
    else
        echo -e "${RED}❌ $name: 未修复${NC}"
        return 1
    fi
}

if [ "$TARGET_HOST" = "local" ]; then
    check_fix "$DEPLOY_PATH" "dist/F2ACore.js" "on('peer:message'" "事件名"
    check_fix "$DEPLOY_PATH" "node_modules/@f2a/network/dist/core/p2p-network.js" "localhostPatterns" "localhost 过滤"
else
    ssh "$TARGET_HOST" "grep -q \"on('peer:message'\" $DEPLOY_PATH/dist/F2ACore.js" 2>/dev/null && \
        echo -e "${GREEN}✅ 事件名: 已修复${NC}" || \
        echo -e "${RED}❌ 事件名: 未修复${NC}"
    
    ssh "$TARGET_HOST" "grep -q 'localhostPatterns' $DEPLOY_PATH/node_modules/@f2a/network/dist/core/p2p-network.js" 2>/dev/null && \
        echo -e "${GREEN}✅ localhost 过滤: 已修复${NC}" || \
        echo -e "${RED}❌ localhost 过滤: 未修复${NC}"
fi

# 重启服务
echo ""
echo -e "${YELLOW}[4/5] 重启服务${NC}"
if [ "$TARGET_HOST" = "local" ]; then
    pkill -f openclaw-gateway 2>/dev/null || true
    sleep 3
    openclaw gateway start > /dev/null 2>&1 &
else
    ssh "$TARGET_HOST" "pkill -f 'openclaw.*gateway' 2>/dev/null; sleep 3; nohup ~/.npm-global/bin/openclaw gateway start > /tmp/gateway.log 2>&1 &" 2>&1
fi

echo ""
echo -e "${YELLOW}[5/5] 等待启动...${NC}"
sleep 40

echo ""
echo -e "${GREEN}========================================"
echo "部署完成！"
echo "========================================${NC}"
echo ""
echo "下一步："
echo "  1. 检查服务状态: curl http://localhost:9001/status"
echo "  2. 测试消息发送: 使用 f2a_send 工具"