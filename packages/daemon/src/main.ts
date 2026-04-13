#!/usr/bin/env node
/**
 * F2A Daemon 入口
 */

import { F2ADaemon } from './index.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger({ component: 'daemon' });

// 解析引导节点地址
const bootstrapPeers = process.env.BOOTSTRAP_PEERS 
  ? process.env.BOOTSTRAP_PEERS.split(',')
  : undefined;

// P2P 端口（默认 0 = 随机分配）
const p2pPort = parseInt(process.env.F2A_P2P_PORT || '0');

const daemon = new F2ADaemon({
  controlPort: parseInt(process.env.F2A_CONTROL_PORT || '9001'),
  displayName: process.env.F2A_AGENT_NAME,
  network: {
    listenPort: p2pPort,
    bootstrapPeers,
  },
});

// 处理信号
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down');
  await daemon.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down');
  await daemon.stop();
  process.exit(0);
});

// 启动
daemon.start().catch((error) => {
  logger.error('Failed to start daemon', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});