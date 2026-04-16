#!/bin/bash
# F2A 插件部署脚本
# 用法: ./scripts/deploy.sh [local|CatPi|all]
#
# 功能：
# 1. 构建 F2A 插件
# 2. 清理旧进程（杀掉占用端口的进程）
# 3. 部署到 OpenClaw 插件目录
# 4. 重启 Gateway

set -e

# 配置
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLUGIN_PATH="$PROJECT_ROOT/packages/openclaw-f2a"

# OpenClaw 插件安装位置（和 openclaw plugins install 相同）
LOCAL_OPENCLAW=~/.openclaw/extensions/openclaw-f2a

# CatPi 配置
CATPI_HOST="lucius@CatPi.local"
CATPI_OPENCLAW="/mnt/ssd/openclaw/extensions/openclaw-f2a"

# F2A 端口
F2A_PORTS="9000 9001 9002"

# 部署目标
TARGET="${1:-local}"

echo "📦 构建 F2A 插件..."
cd "$PROJECT_ROOT"
npm run build --workspace=@f2a/network
npm run build --workspace=@f2a/openclaw-f2a

kill_f2a_processes() {
    local host="$1"
    local ports="$F2A_PORTS"
    
    echo "🧹 清理旧进程 ($host)..."
    
    for port in $ports; do
        if [ "$host" = "local" ]; then
            pid=$(lsof -t -i:$port 2>/dev/null || true)
            if [ -n "$pid" ]; then
                echo "  杀掉端口 $port 的进程 (PID: $pid)"
                kill $pid 2>/dev/null || true
            fi
        else
            ssh "$host" "pid=\$(lsof -t -i:$port 2>/dev/null) && kill \$pid 2>/dev/null" || true
        fi
    done
    
    # 等待端口释放
    sleep 1
}

deploy_local() {
    echo ""
    echo "📍 部署到本地 Mac mini..."
    
    # 清理旧进程
    kill_f2a_processes "local"
    
    # 部署文件
    echo "📂 复制文件到 $LOCAL_OPENCLAW"
    mkdir -p "$LOCAL_OPENCLAW"
    cp -r "$PLUGIN_PATH/dist" "$LOCAL_OPENCLAW/"
    cp "$PLUGIN_PATH/package.json" "$LOCAL_OPENCLAW/"
    
    # 安装依赖
    echo "📦 安装依赖..."
    cd "$LOCAL_OPENCLAW" && npm install --production --silent
    
    echo "✅ 本地部署完成"
    
    # 重启 Gateway
    echo "🔄 重启 Gateway..."
    openclaw gateway restart
}

deploy_catpi() {
    echo ""
    echo "📍 部署到 CatPi..."
    
    # 检查 CatPi 是否可访问
    if ! ssh "$CATPI_HOST" "echo ok" &>/dev/null; then
        echo "❌ 无法连接到 CatPi，请检查 SSH 配置"
        exit 1
    fi
    
    # 清理旧进程
    kill_f2a_processes "$CATPI_HOST"
    
    # 部署文件
    echo "📂 复制文件到 $CATPI_OPENCLAW"
    ssh "$CATPI_HOST" "mkdir -p $CATPI_OPENCLAW"
    scp -r "$PLUGIN_PATH/dist" "$CATPI_HOST:$CATPI_OPENCLAW/"
    scp "$PLUGIN_PATH/package.json" "$CATPI_HOST:$CATPI_OPENCLAW/"
    
    # 安装依赖
    echo "📦 安装依赖..."
    ssh "$CATPI_HOST" "cd $CATPI_OPENCLAW && npm install --production --silent"
    
    echo "✅ CatPi 部署完成"
    
    # 重启 Gateway
    echo "🔄 重启 CatPi Gateway..."
    ssh "$CATPI_HOST" "openclaw gateway restart" &
}

case "$TARGET" in
    local)
        deploy_local
        ;;
    CatPi|catpi)
        deploy_catpi
        ;;
    all|both)
        deploy_local
        deploy_catpi
        wait
        ;;
    *)
        echo "用法: $0 [local|CatPi|all]"
        exit 1
        ;;
esac

echo ""
echo "🎉 部署完成！"
echo ""
echo "验证命令:"
echo "  f2a_status              # 查看本地 F2A 状态"
echo "  ssh CatPi f2a_status    # 查看 CatPi F2A 状态"