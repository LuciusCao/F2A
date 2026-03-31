/**
 * E2E 测试工具模块导出
 */

export { NodeSpawner } from './node-spawner.js';
export type { SpawnedNode, NodeSpawnerOptions } from './node-spawner.js';

export { MessageWaiter } from './message-waiter.js';
export type {
  WaitOptions,
  MessageMatch,
  TaskRequestMatch,
  TaskResponseMatch
} from './message-waiter.js';

export {
  generateTestConfig,
  getPortRange
} from './test-config.js';
export type {
  NodeConfig,
  TestConfig,
  TestCommand,
  TestEvent
} from './test-config.js';