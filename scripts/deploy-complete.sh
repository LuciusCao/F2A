#!/bin/bash
# F2A 完整部署脚本 - 确保所有位置都更新
# 使用: ./scripts/deploy-complete.sh [CatPi]

set -e

echo "=========================================="
echo "F2A 完整部署"
echo "=========================================="

# 1. 编译
echo ""
echo "【1】编译最新代码..."
cd ~/.openclaw/workspace/projects/f2a
cd packages/network
npm run build
cd ../..

# 2. 定义源文件
SRC_NETWORK="packages/network/dist/core/p2p-network.js"
SRC_F2ACORE="packages/openclaw-f2a/dist/F2ACore.js"

if [ ! -f "$SRC_NETWORK" ]; then
  echo "❌ 编译失败：找不到 $SRC_NETWORK"
  exit 1
fi

echo "✅ 编译完成"

# 3. 部署函数
deploy_to_location() {
  local base_dir="$1"
  local name="$2"
  
  echo ""
  echo "【部署到 $name】"
  
  # 更新 network 包
  local network_target="$base_dir/node_modules/@f2a/network/dist/core/p2p-network.js"
  if [ -d "$(dirname "$network_target")" ]; then
    cp "$SRC_NETWORK" "$network_target"
    echo "✅ network/p2p-network.js"
  fi
  
  # 更新 F2ACore
  local f2acore_target="$base_dir/dist/F2ACore.js"
  if [ -f "$f2acore_target" ]; then
    cp "packages/openclaw-f2a/dist/F2ACore.js" "$f2acore_target"
    echo "✅ F2ACore.js"
  fi
  
  # 验证关键修复
  if grep -q "等待 peer:connect" "$network_target" 2>/dev/null; then
    echo "✅ 验证：包含 Stream 生命周期修复"
  else
    echo "⚠️ 警告：缺少 Stream 生命周期修复"
  fi
}

# 4. 部署到 Mac mini 本地
echo ""
echo "=========================================="
echo "Mac mini 部署"
echo "=========================================="

# 找到所有插件位置
for plugin_dir in ~/.openclaw/extensions/openclaw-f2a; do
  if [ -d "$plugin_dir" ]; then
    deploy_to_location "$plugin_dir" "Mac mini ($plugin_dir)"
  fi
done

# 5. 部署到 CatPi
if [ "$1" = "CatPi" ] || [ "$1" = "CatPi.local" ]; then
  echo ""
  echo "=========================================="
  echo "CatPi 部署"
  echo "=========================================="
  
  # CatPi 可能有多个位置
  CATPI_DIRS=(
    "/home/lucius/.npm-global/lib/node_modules/openclaw/extensions/openclaw-f2a"
    "/mnt/ssd/openclaw/extensions/openclaw-f2a"
  )
  
  for dir in "${CATPI_DIRS[@]}"; do
    if ssh lucius@CatPi.local "[ -d '$dir' ]" 2>/dev/null; then
      # 复制文件
      scp "$SRC_NETWORK" "lucius@CatPi.local:$dir/node_modules/@f2a/network/dist/core/p2p-network.js" 2>/dev/null
      scp "packages/openclaw-f2a/dist/F2ACore.js" "lucius@CatPi.local:$dir/dist/F2ACore.js" 2>/dev/null
      
      # 验证
      if ssh lucius@CatPi.local "grep -q '等待 peer:connect' '$dir/node_modules/@f2a/network/dist/core/p2p-network.js'" 2>/dev/null; then
        echo "✅ CatPi ($dir) - 验证通过"
      else
        echo "❌ CatPi ($dir) - 验证失败"
      fi
    fi
  done
fi

echo ""
echo "=========================================="
echo "部署完成"
echo "=========================================="
echo ""
echo "下一步：重启 Gateway"
echo "  Mac mini: pkill -9 -f openclaw; sleep 3; openclaw gateway start &"
echo "  CatPi:    ssh CatPi 'pkill -9 -f openclaw; sleep 3; openclaw gateway start &'"
