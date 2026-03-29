/**
 * Connector (F2APlugin) Error Handlers Test
 * 测试 createWebhookHandler 中的错误处理路径
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { F2APlugin } from '../src/connector.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('F2APlugin - Webhook 错误处理测试', () => {
  let tempDir: string;
  let plugin: F2APlugin;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), `f2a-plugin-err-test-${Date.now()}-`));

    // 创建 IDENTITY.md
    writeFileSync(
      join(tempDir, 'IDENTITY.md'),
      '# IDENTITY.md\n\n- **Name:** TestAgent'
    );

    // 创建 .openclaw 目录
    mkdirSync(join(tempDir, '.openclaw'), { recursive: true });
  });

  afterEach(async () => {
    if (plugin) {
      try {
        await plugin.shutdown();
      } catch (e) {
        // 忽略关闭错误
      }
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createWebhookHandler 错误处理', () => {
    beforeEach(async () => {
      plugin = new F2APlugin();
    });

    describe('onMessage 错误处理', () => {
      it('应该处理无效的 PeerID', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // 获取 webhook handler
        const handler = (plugin as any).createWebhookHandler();

        const result = await handler.onMessage({
          from: 'invalid-peer-id', // 无效的 PeerID 格式
          content: 'test message',
          messageId: 'msg-123',
        });

        expect(result.response).toBe('Invalid sender');
      });

      it('应该处理过长的消息', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        const handler = (plugin as any).createWebhookHandler();
        
        // 创建超长消息（超过 MAX_MESSAGE_LENGTH = 1024 * 1024 = 1048576）
        // 使用有效的 PeerID 格式 (12D3KooW + 44 chars [A-Za-z1-9])
        const longMessage = 'x'.repeat(1048577); // Just over 1MB
        
        const result = await handler.onMessage({
          from: '12D3KooWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // Valid: 8 + 44 = 52 chars
          content: longMessage,
          messageId: 'msg-456',
        });

        expect(result.response).toBe('Message too long');
      });

      it('应该处理 invokeOpenClawAgent 抛出错误', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // Mock invokeOpenClawAgent to throw error using Object.defineProperty
        const originalMethod = (plugin as any).invokeOpenClawAgent;
        Object.defineProperty(plugin, 'invokeOpenClawAgent', {
          value: vi.fn().mockRejectedValue(new Error('Agent error')),
          configurable: true,
        });

        const handler = (plugin as any).createWebhookHandler();

        // 使用有效的 PeerID 格式 (12D3KooW + 44 chars [A-Za-z1-9])
        const result = await handler.onMessage({
          from: '12D3KooWBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          content: 'test message',
          messageId: 'msg-789',
        });

        expect(result.response).toContain('抱歉');

        // Restore
        Object.defineProperty(plugin, 'invokeOpenClawAgent', {
          value: originalMethod,
          configurable: true,
        });
      });

      it('应该处理 invokeOpenClawAgent 返回空结果', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // Mock invokeOpenClawAgent to return null
        const originalMethod = (plugin as any).invokeOpenClawAgent;
        Object.defineProperty(plugin, 'invokeOpenClawAgent', {
          value: vi.fn().mockResolvedValue(null),
          configurable: true,
        });

        const handler = (plugin as any).createWebhookHandler();

        // 使用有效的 PeerID 格式
        const result = await handler.onMessage({
          from: '12D3KooWCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
          content: 'test message',
          messageId: 'msg-101',
        });

        expect(result.response).toContain('暂时无法生成回复');

        // Restore
        Object.defineProperty(plugin, 'invokeOpenClawAgent', {
          value: originalMethod,
          configurable: true,
        });
      });
    });

    describe('onDelegate 错误处理', () => {
      it('应该处理信誉过低', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // Mock reputationSystem.isAllowed to return false
        const repSystem = (plugin as any).reputationSystem;
        if (repSystem) {
          vi.spyOn(repSystem, 'isAllowed').mockReturnValue(false);
        }

        const handler = (plugin as any).createWebhookHandler();

        const result = await handler.onDelegate({
          taskId: 'task-123',
          taskType: 'test',
          description: 'test task',
          from: '12D3KooWDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
          requiredCapabilities: [],
          estimatedComplexity: 1,
          reward: 0,
        });

        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Reputation');
      });

      it('应该处理任务队列添加失败', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // Mock reputationSystem.isAllowed to return true
        const repSystem = (plugin as any).reputationSystem;
        if (repSystem) {
          vi.spyOn(repSystem, 'isAllowed').mockReturnValue(true);
        }

        // Mock taskQueue.add 抛出错误
        const taskQueue = (plugin as any)._taskQueue || (plugin as any).taskQueue;
        if (taskQueue) {
          vi.spyOn(taskQueue, 'add').mockImplementation(() => {
            throw new Error('Queue full');
          });
        }

        const handler = (plugin as any).createWebhookHandler();

        const result = await handler.onDelegate({
          taskId: 'task-123',
          taskType: 'test',
          description: 'test task',
          from: '12D3KooWEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
          requiredCapabilities: [],
          estimatedComplexity: 1,
          reward: 0,
        });

        expect(result.accepted).toBe(false);
        expect(result.reason).toContain('Queue full');
      });
    });

    describe('onStatus 处理', () => {
      it('应该返回空闲状态当 TaskQueue 未初始化', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        // 强制清空 taskQueue
        (plugin as any)._taskQueue = undefined;

        const handler = (plugin as any).createWebhookHandler();

        const result = await handler.onStatus();

        expect(result.status).toBe('available');
        expect(result.load).toBe(0);
        expect(result.queued).toBe(0);
        expect(result.processing).toBe(0);
      });

      it('应该返回正确的队列状态', async () => {
        const mockApi = {
          config: {
            agents: {
              defaults: {
                workspace: tempDir,
              },
            },
          },
        };

        await plugin.initialize({
          api: mockApi as any,
          _api: mockApi as any,
          config: {},
        });

        const handler = (plugin as any).createWebhookHandler();

        const result = await handler.onStatus();

        expect(result.status).toBe('available');
        expect(typeof result.load).toBe('number');
        expect(typeof result.queued).toBe('number');
        expect(typeof result.processing).toBe('number');
      });
    });
  });
});