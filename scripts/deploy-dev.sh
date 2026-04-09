#!/bin/bash
# F2A 开发部署脚本 - 用于开发调试阶段
# 正式发布后使用: openclaw plugins install

set -e

TARGET="${1:-local}"  # local 或 CatPi

echo "=========================================="
echo "F2A 开发部署 (目标: $TARGET)"
echo "=========================================="

# 1. 编译
echo ""
echo "【1/4】编译最新代码..."
cd ~/.openclaw/workspace/projects/f2a

# 编译 network 包
cd packages/network
npm run build 2>&1 | grep -E "error|built|✓" | tail -5
cd ../..

# 编译 openclaw-f2a 包
cd packages/openclaw-f2a
npm run build 2>&1 | grep -E "error|built|✓" | tail -5
cd ..

# 2. 验证编译产物
echo ""
echo "【2/4】验证编译产物..."

NETWORK_DIST="packages/network/dist/core/p2p-network.js"
F2A_DIST="packages/openclaw-f2a/dist/F2ACore.js"

if [ ! -f "$NETWORK_DIST" ]; then
  echo "❌ 编译失败: $NETWORK_DIST 不存在"
  exit 1
fi

# 验证关键修复
FIXES=(
  "等待 peer:connect"
  "connectedPeers.has"
  "过滤 localhost"
)

for fix in "${FIXES[@]}"; do
  if grep -q "$fix" "$NETWORK_DIST" 2>/dev/null; then
    echo "✅ 包含修复: $fix"
  else
    echo "⚠️ 缺少修复: $fix"
  fi
done

# 3. 部署
echo ""
echo "【3/4】部署到 $TARGET..."

deploy_files() {
  local base_dir="$1"
  local name="$2"
  
  if [ ! -d "$base_dir" ]; then
    echo "⚠️ 目录不存在: $base_dir"
    return 1
  fi
  
  echo ""
  echo "--- $name ---"
  
  # 复制 network 包
  local network_target="$base_dir/node_modules/@f2a/network/dist/core"
  if [ -d "$network_target" ]; then
    cp packages/network/dist/core/*.js "$network_target/"
    cp packages/network/dist/core/*.d.ts "$network_target/" 2>/dev/null || true
    echo "✅ network 核心文件"
  fi
  
  # 复制 F2ACore
  local f2a_target="$base_dir/dist"
  if [ -d "$f2a_target" ]; then
    cp packages/openclaw-f2a/dist/*.js "$f2a_target/"
    cp packages/openclaw-f2a/dist/*.d.ts "$f2a_target/" 2>/dev/null || true
    echo "✅ F2ACore 文件"
  fi
  
  # 复制 connector
  if [ -d "$f2a_target" ]; then
    cp packages/openclaw-f2a/dist/connector.js "$f2a_target/" 2>/dev/null || true
    echo "✅ connector 文件"
  fi
}

if [ "$TARGET" = "local" ] || [ "$TARGET" = "Mac" ] || [ "$TARGET" = "mac" ]; then
  # 部署到 Mac mini
  deploy_files ~/.openclaw/extensions/openclaw-f2a "Mac mini 本地"
  
elif [ "$TARGET" = "CatPi" ] || [ "$TARGET" = "catpi" ]; then
  # 部署到 CatPi - 检查实际运行位置
  echo "检测 CatPi 运行位置..."
  
  CATPI_PATHS=(
    "/home/lucius/.npm-global/lib/node_modules/openclaw/extensions/openclaw-f2a"
    "/mnt/ssd/openclaw/extensions/openclaw-f2a"
  )
  
  for path in "${CATPI_PATHS[@]}"; do
    if ssh lucius@CatPi.local "[ -d '$path' ]" 2>/dev/null; then
      # 复制 network 包
      ssh lucius@CatPi.local "mkdir -p '$path/node_modules/@f2a/network/dist/core'"
      scp packages/network/dist/core/*.js "lucius@CatPi.local:$path/node_modules/@f2a/network/dist/core/"
      scp packages/network/dist/core/*.d.ts "lucius@CatPi.local:$path/node_modules/@f2a/network/dist/core/" 2>/dev/null || true
      
      # 复制 F2ACore
      scp packages/openclaw-f2a/dist/*.js "lucius@CatPi.local:$path/dist/"
      scp packages/openclaw-f2a/dist/*.d.ts "lucius@CatPi.local:$path/dist/" 2>/dev/null || true
      
      echo "✅ CatPi: $path"
    fi
  done
fi

# 4. 验证部署
echo ""
echo "【4/4】验证部署..."

if [ "$TARGET" = "local" ] || [ "$TARGET" = "Mac" ] || [ "$TARGET" = "mac" ]; then
  DEPLOYED_FILE=~/.openclaw/extensions/openclaw-f2a/node_modules/@f2a/network/dist/core/p2p-network.js
  if [ -f "$DEPLOYED_FILE" ]; then
    VERSION=$(grep -o 'VERSION.*=.*"' "$DEPLOYED_FILE" 2>/dev/null | head -1 || echo "未知版本")
    echo "Mac mini 部署文件: $DEPLOYED_FILE"
    echo "版本标记: $VERSION"
  fi
fi

echo ""
echo "=========================================="
echo "部署完成"
echo "=========================================="
echo ""
echo "下一步：重启 Gateway"
echo "  Mac mini: pkill -f openclaw; sleep 2; openclaw gateway start &"
echo "  CatPi:    ssh CatPi 'pkill -f openclaw; sleep 2; openclaw gateway start &'"
echo ""
echo "正式发布时使用:"
echo "  openclaw plugins install @f2a/network"
