/**
 * CapabilityService - 能力注册与管理服务
 *
 * Phase 3a: 从 F2A 类中提取的能力管理逻辑
 */

import { Logger } from '../utils/logger.js';
import { validateAgentCapability } from '../utils/validation.js';
import {
  AgentCapability,
  RegisteredCapability,
  Result,
  success,
  failureFromError
} from '../types/index.js';

/**
 * CapabilityService 配置选项
 */
export interface CapabilityServiceOptions {
  /** 日志记录器 */
  logger: Logger;
  /** 能力更新回调 - 当能力列表变更时调用 */
  onCapabilitiesUpdate?: (capabilities: AgentCapability[]) => void;
}

/**
 * CapabilityService - 能力注册与管理
 *
 * 负责:
 * - 注册和管理 Agent 能力
 * - 提供能力查询接口
 * - 通过回调通知能力变更
 */
export class CapabilityService {
  private registeredCapabilities: Map<string, RegisteredCapability> = new Map();
  private logger: Logger;
  private onCapabilitiesUpdate?: (capabilities: AgentCapability[]) => void;

  constructor(options: CapabilityServiceOptions) {
    this.logger = options.logger;
    this.onCapabilitiesUpdate = options.onCapabilitiesUpdate;
  }

  /**
   * 注册能力
   * @param capability 能力定义
   * @param handler 能力处理函数
   * @returns Result<void> 注册结果
   */
  registerCapability(
    capability: AgentCapability,
    handler: (params: Record<string, unknown>) => Promise<unknown>
  ): Result<void> {
    // 验证能力定义
    const validation = validateAgentCapability(capability);
    if (!validation.success) {
      this.logger.error('Invalid capability definition', {
        errors: validation.error.errors
      });
      return failureFromError(
        'INVALID_PARAMS',
        `Invalid capability: ${validation.error.errors.map(e => e.message).join(', ')}`
      );
    }

    this.registeredCapabilities.set(capability.name, {
      ...capability,
      handler
    });

    // 通知能力更新
    this.notifyCapabilitiesUpdate();

    this.logger.info('Registered capability', { name: capability.name });

    return success(undefined);
  }

  /**
   * 获取已注册的能力列表
   * @returns AgentCapability[] 能力列表（不含 handler）
   */
  getCapabilities(): AgentCapability[] {
    return Array.from(this.registeredCapabilities.values()).map(c => ({
      name: c.name,
      description: c.description,
      tools: c.tools,
      parameters: c.parameters
    }));
  }

  /**
   * 获取能力处理函数
   * @param capabilityName 能力名称
   * @returns 处理函数或 undefined
   */
  getHandler(capabilityName: string): ((params: Record<string, unknown>) => Promise<unknown>) | undefined {
    const registered = this.registeredCapabilities.get(capabilityName);
    return registered?.handler;
  }

  /**
   * 检查能力是否已注册
   * @param capabilityName 能力名称
   * @returns 是否已注册
   */
  hasCapability(capabilityName: string): boolean {
    return this.registeredCapabilities.has(capabilityName);
  }

  /**
   * 注销能力
   * @param capabilityName 能力名称
   * @returns 是否成功注销
   */
  unregisterCapability(capabilityName: string): boolean {
    const deleted = this.registeredCapabilities.delete(capabilityName);
    if (deleted) {
      this.notifyCapabilitiesUpdate();
      this.logger.info('Unregistered capability', { name: capabilityName });
    }
    return deleted;
  }

  /**
   * 通知能力列表更新
   */
  private notifyCapabilitiesUpdate(): void {
    if (this.onCapabilitiesUpdate) {
      this.onCapabilitiesUpdate(this.getCapabilities());
    }
  }
}