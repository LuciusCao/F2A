/**
 * F2A Server Discovery
 * 
 * 自动发现局域网内的 F2A Server
 * 使用 UDP 广播协议
 */

const dgram = require('dgram');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DISCOVERY_PORT = 8766;
const DISCOVERY_TIMEOUT = 3000; // 3秒超时
const CANDIDATE_SERVERS = [
  'ws://localhost:8765',
  'ws://127.0.0.1:8765',
  'ws://nas.local:8765',
];

const CURRENT_SKILL_VERSION = '1.0.0';

/**
 * 发现局域网内的 F2A Server
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<string|null|Array>} 服务器地址或列表
 */
async function discoverServer(timeout = DISCOVERY_TIMEOUT) {
  return new Promise((resolve) => {
    const udpClient = dgram.createSocket('udp4');
    const servers = [];
    let resolved = false;
    
    // 监听响应
    udpClient.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'F2A_HERE') {
          // 避免重复
          const exists = servers.find(s => s.address === data.server);
          if (!exists) {
            servers.push({
              address: data.server,
              source: rinfo.address,
              version: data.version,
              uptime: data.uptime,
              pendingPairs: data.pendingPairs,
              skillUpdateAvailable: data.skillUpdateAvailable,
              skillVersion: data.skillVersion
            });
            console.log(`[Discovery] Found server: ${data.server} (from ${rinfo.address})`);
            
            // 检查是否需要更新
            if (data.skillUpdateAvailable) {
              console.log(`[Update] Server has skill version ${data.skillVersion}`);
            }
          }
        }
      } catch (e) {
        // 忽略非 JSON 消息
      }
    });
    
    udpClient.on('error', (err) => {
      console.error('[Discovery] UDP error:', err.message);
    });
    
    // 发送广播
    udpClient.bind(() => {
      udpClient.setBroadcast(true);
      
      const message = Buffer.from('F2A_DISCOVER');
      
      // 向常见广播地址发送
      const broadcastAddresses = [
        '255.255.255.255',
        '192.168.1.255',
        '192.168.0.255',
        '10.0.0.255',
        '172.16.255.255'
      ];
      
      broadcastAddresses.forEach(addr => {
        udpClient.send(message, DISCOVERY_PORT, addr, (err) => {
          if (err) {
            // 某些地址可能发送失败，忽略
          }
        });
      });
      
      console.log('[Discovery] Broadcasting...');
    });
    
    // 超时处理
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      
      udpClient.close();
      
      if (servers.length === 0) {
        console.log('[Discovery] No server found via UDP');
        resolve(null);
      } else if (servers.length === 1) {
        resolve(servers[0].address);
      } else {
        resolve(servers);
      }
    }, timeout);
  });
}

/**
 * 测试服务器是否可用
 * @param {string} serverUrl 
 * @returns {Promise<boolean>}
 */
async function testServer(serverUrl) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(serverUrl);
      
      const timeout = setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 2000);
      
      ws.on('open', () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      });
      
      ws.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * 自动发现并连接到最佳服务器
 * @returns {Promise<string|null>} 最佳服务器地址
 */
async function autoDiscover() {
  console.log('🔍 正在搜索 F2A Server...');
  
  // 1. 先尝试 UDP 发现
  const discovered = await discoverServer();
  
  if (discovered) {
    if (Array.isArray(discovered)) {
      // 找到多个，返回列表
      console.log(`✅ 发现 ${discovered.length} 个服务器:`);
      discovered.forEach((s, i) => {
        console.log(`  ${i + 1}. ${s.address} (运行 ${s.uptime}s, ${s.pendingPairs} 个待配对)`);
      });
      return discovered;
    } else {
      // 只有一个，直接返回
      console.log(`✅ 自动发现服务器: ${discovered}`);
      return discovered;
    }
  }
  
  // 2. UDP 没找到，尝试候选列表
  console.log('[Discovery] Trying candidate servers...');
  for (const server of CANDIDATE_SERVERS) {
    if (await testServer(server)) {
      console.log(`✅ 连接到候选服务器: ${server}`);
      return server;
    }
  }
  
  console.log('❌ 未找到可用的 F2A Server');
  return null;
}

/**
 * 选择服务器（交互式）
 * @param {Array} servers 
 * @returns {string}
 */
function selectServer(servers) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return servers;
  }
  if (servers.length === 1) {
    return servers[0].address;
  }
  
  // 这里可以添加交互式选择逻辑
  // 简单返回第一个
  console.log(`[Discovery] Auto-selecting first server: ${servers[0].address}`);
  return servers[0].address;
}

module.exports = {
  discoverServer,
  testServer,
  autoDiscover,
  selectServer,
  checkForUpdate,
  downloadSkillUpdate
};

// 检查服务器是否有新版本
async function checkForUpdate(serverUrl) {
  return new Promise((resolve) => {
    const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const infoUrl = `${httpUrl}/skill/info`;
    
    http.get(infoUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.available && info.version !== CURRENT_SKILL_VERSION) {
            console.log(`[Update] New version available: ${info.version} (current: ${CURRENT_SKILL_VERSION})`);
            resolve(info);
          } else {
            console.log(`[Update] Already up to date (${CURRENT_SKILL_VERSION})`);
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
}

// 下载 Skill 更新
async function downloadSkillUpdate(serverUrl, savePath) {
  return new Promise((resolve) => {
    const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const downloadUrl = `${httpUrl}/skill/download`;
    
    console.log(`[Update] Downloading from ${downloadUrl}...`);
    
    const file = fs.createWriteStream(savePath);
    http.get(downloadUrl, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`[Update] Saved to ${savePath}`);
        resolve(true);
      });
    }).on('error', (err) => {
      console.error(`[Update] Download failed: ${err.message}`);
      resolve(false);
    });
  });
}

// 直接运行测试
if (require.main === module) {
  autoDiscover().then(async (server) => {
    if (server) {
      console.log('\n🎯 Result:', server);
      
      // 检查更新
      const serverUrl = Array.isArray(server) ? server[0].address : server;
      const updateInfo = await checkForUpdate(serverUrl);
      
      if (updateInfo) {
        console.log(`\n📦 Update available: ${updateInfo.version}`);
        console.log(`   Size: ${updateInfo.size} bytes`);
        console.log(`   MD5: ${updateInfo.md5}`);
        
        // 下载到临时目录
        const tmpPath = path.join(__dirname, '..', 'f2a-skill-update.tar.gz');
        await downloadSkillUpdate(serverUrl, tmpPath);
      }
      
      process.exit(0);
    } else {
      console.log('\n💡 Tips:');
      console.log('  1. 确保 F2A Server 已启动');
      console.log('  2. 检查防火墙是否放行 UDP 8766');
      console.log('  3. 手动配置: export F2A_SERVER=ws://your-server:8765');
      process.exit(1);
    }
  }).catch(err => {
    console.error('[Discovery] Error:', err.message);
    process.exit(1);
  });
}
