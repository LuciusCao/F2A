/**
 * 测试节点进程 (JavaScript 版本)
 * 
 * 这是一个独立的进程，可被测试运行器 spawn。
 * 通过 IPC 与测试运行器通信，接收命令并发送事件。
 */

import { F2A } from '../../dist/index.js';
import { mkdirSync, rmSync } from 'fs';

// 全局变量
let f2a = null;
let currentConfig = null;
let registeredCapabilities = new Map();

/**
 * 处理 IPC 命令
 */
async function handleCommand(command) {
  try {
    switch (command.type) {
      case 'start':
        await handleStart(command.config);
        break;

      case 'send':
        await handleSendMessage(command.peerId, command.message, command.metadata);
        break;

      case 'sendTask':
        await handleSendTask(command.peerId, command.taskType, command.description, command.parameters);
        break;

      case 'registerCapability':
        await handleRegisterCapability(command.capability);
        break;

      case 'stop':
        await handleStop();
        break;

      case 'getStatus':
        handleGetStatus();
        break;

      case 'getConnectedPeers':
        handleGetConnectedPeers();
        break;

      default:
        sendEvent({ type: 'error', error: `Unknown command type: ${JSON.stringify(command)}` });
    }
  } catch (error) {
    sendEvent({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 处理启动命令
 */
async function handleStart(config) {
  currentConfig = config;

  // 创建数据目录
  try {
    mkdirSync(config.dataDir, { recursive: true });
  } catch {
    // 忽略
  }

  // 创建 F2A 实例
  f2a = await F2A.create({
    displayName: config.displayName,
    agentType: 'custom',
    network: {
      listenPort: config.listenPort,
      enableMDNS: true,
      enableDHT: config.enableDHT
    },
    logLevel: config.logLevel,
    dataDir: config.dataDir
  });

  // 绑定事件处理器
  bindEvents(f2a);

  // 启动网络
  const result = await f2a.start();

  if (result.success) {
    sendEvent({
      type: 'started',
      peerId: f2a.peerId,
      multiaddrs: f2a.agentInfo.multiaddrs || []
    });
  } else {
    sendEvent({
      type: 'error',
      error: `Failed to start: ${result.error?.message || 'Unknown error'}`,
      details: result.error
    });
  }
}

/**
 * 处理发送消息命令
 */
async function handleSendMessage(peerId, message, metadata) {
  if (!f2a) {
    sendEvent({ type: 'error', error: 'Node not started' });
    return;
  }

  const result = await f2a.sendMessage(peerId, message, metadata);

  if (!result.success) {
    sendEvent({
      type: 'error',
      error: `Failed to send message: ${result.error?.message || 'Unknown error'}`,
      details: result.error
    });
  }
}

/**
 * 处理发送任务命令
 */
async function handleSendTask(peerId, taskType, description, parameters) {
  if (!f2a) {
    sendEvent({ type: 'error', error: 'Node not started' });
    return;
  }

  const result = await f2a.sendTaskTo(peerId, taskType, description, parameters);

  if (!result.success) {
    sendEvent({
      type: 'error',
      error: `Failed to send task: ${result.error?.message || 'Unknown error'}`,
      details: result.error
    });
  } else {
    sendEvent({
      type: 'taskResponse',
      from: f2a.peerId,
      taskId: 'unknown',
      status: 'success',
      result: result.data
    });
  }
}

/**
 * 处理注册能力命令
 */
async function handleRegisterCapability(capability) {
  if (!f2a) {
    sendEvent({ type: 'error', error: 'Node not started' });
    return;
  }

  const agentCapability = {
    name: capability.name,
    description: capability.description,
    tools: []
  };

  const handler = async (params) => {
    return { executed: true, capability: capability.name, params };
  };

  registeredCapabilities.set(capability.name, handler);
  f2a.registerCapability(agentCapability, handler);
}

/**
 * 处理停止命令
 */
async function handleStop() {
  if (f2a) {
    await f2a.stop();
    f2a = null;

    // 清理数据目录（可选）
    if (currentConfig) {
      try {
        rmSync(currentConfig.dataDir, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
      currentConfig = null;
    }
  }

  sendEvent({ type: 'stopped' });
}

/**
 * 处理获取状态命令
 */
function handleGetStatus() {
  if (!f2a) {
    sendEvent({ type: 'status', peerId: '', connectedPeers: [], running: false });
    return;
  }

  const connectedPeers = f2a.getConnectedPeers().map(p => p.peerId);

  sendEvent({
    type: 'status',
    peerId: f2a.peerId,
    connectedPeers,
    running: true
  });
}

/**
 * 处理获取连接 peers 命令
 */
function handleGetConnectedPeers() {
  if (!f2a) {
    sendEvent({ type: 'connectedPeers', peers: [] });
    return;
  }

  const peers = f2a.getConnectedPeers().map(p => p.peerId);
  sendEvent({ type: 'connectedPeers', peers });
}

/**
 * 绑定 F2A 事件处理器
 */
function bindEvents(instance) {
  instance.on('peer:discovered', (event) => {
    sendEvent({ type: 'peerDiscovered', peerId: event.peerId });
  });

  instance.on('peer:connected', (event) => {
    sendEvent({ type: 'peerConnected', peerId: event.peerId });
  });

  instance.on('peer:disconnected', (event) => {
    sendEvent({ type: 'peerDisconnected', peerId: event.peerId });
  });

  instance.on('peer:message', (event) => {
    sendEvent({
      type: 'messageReceived',
      from: event.from,
      content: event.content,
      metadata: event.metadata,
      messageId: event.messageId
    });
  });

  instance.on('task:request', (event) => {
    sendEvent({
      type: 'taskRequest',
      from: event.from || '',
      taskId: event.taskId,
      taskType: event.taskType,
      description: event.description || '',
      parameters: event.parameters
    });
  });

  instance.on('task:response', (event) => {
    sendEvent({
      type: 'taskResponse',
      from: event.from,
      taskId: event.taskId,
      status: event.status,
      result: event.result,
      error: event.error
    });
  });

  instance.on('error', (error) => {
    sendEvent({ type: 'error', error: error.message });
  });
}

/**
 * 发送事件给父进程
 */
function sendEvent(event) {
  if (process.send) {
    process.send(event);
  }
}

/**
 * 主函数
 */
async function main() {
  // 监听 IPC 消息
  process.on('message', (command) => {
    handleCommand(command);
  });

  // 处理进程退出
  process.on('SIGINT', async () => {
    await handleStop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await handleStop();
    process.exit(0);
  });

  // 发送就绪信号
  sendEvent({ type: 'status', peerId: '', connectedPeers: [], running: false });
}

// 运行主函数
main().catch((error) => {
  sendEvent({ type: 'error', error: error.message });
  process.exit(1);
});