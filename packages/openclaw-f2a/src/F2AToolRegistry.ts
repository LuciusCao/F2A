/**
 * F2A 工具注册器
 * 
 * 负责 F2A 工具的注册和组装。
 * 从 connector.ts 拆分（Issue #106），遵循单一职责原则。
 * 
 * @module F2AToolRegistry
 */

import type { Tool } from './types.js';
import { getNetworkTools, getTaskTools, getContactTools } from './tools/index.js';
import type { ToolHandlers } from './tool-handlers.js';
import type { ClaimHandlers } from './claim-handlers.js';
import type { ContactToolHandlers } from './contact-tool-handlers.js';

/**
 * 工具注册器依赖
 */
export interface ToolRegistryDeps {
  /** 工具处理器 */
  toolHandlers: ToolHandlers;
  /** 认领处理器 */
  claimHandlers: ClaimHandlers;
  /** 通讯录工具处理器 */
  contactToolHandlers: ContactToolHandlers;
}

/**
 * F2A 工具注册器
 * 
 * 负责组装所有 F2A 工具（网络工具、任务工具、通讯录工具）。
 */
export class F2AToolRegistry {
  private deps: ToolRegistryDeps;

  constructor(deps: ToolRegistryDeps) {
    this.deps = deps;
  }

  /**
   * 获取所有 F2A 工具
   * 
   * @returns 工具列表
   */
  getTools(): Tool[] {
    // 网络、状态、信誉工具
    const networkTools = getNetworkTools({
      handleDiscover: this.deps.toolHandlers.handleDiscover.bind(this.deps.toolHandlers),
      handleDelegate: this.deps.toolHandlers.handleDelegate.bind(this.deps.toolHandlers),
      handleBroadcast: this.deps.toolHandlers.handleBroadcast.bind(this.deps.toolHandlers),
      handleStatus: this.deps.toolHandlers.handleStatus.bind(this.deps.toolHandlers),
      handleReputation: this.deps.toolHandlers.handleReputation.bind(this.deps.toolHandlers),
    });

    // 任务工具
    const taskTools = getTaskTools({
      handlePollTasks: this.deps.toolHandlers.handlePollTasks.bind(this.deps.toolHandlers),
      handleSubmitResult: this.deps.toolHandlers.handleSubmitResult.bind(this.deps.toolHandlers),
      handleTaskStats: this.deps.toolHandlers.handleTaskStats.bind(this.deps.toolHandlers),
      handleAnnounce: this.deps.claimHandlers.handleAnnounce.bind(this.deps.claimHandlers),
      handleListAnnouncements: this.deps.claimHandlers.handleListAnnouncements.bind(this.deps.claimHandlers),
      handleClaim: this.deps.claimHandlers.handleClaim.bind(this.deps.claimHandlers),
      handleManageClaims: this.deps.claimHandlers.handleManageClaims.bind(this.deps.claimHandlers),
      handleMyClaims: this.deps.claimHandlers.handleMyClaims.bind(this.deps.claimHandlers),
      handleAnnouncementStats: this.deps.claimHandlers.handleAnnouncementStats.bind(this.deps.claimHandlers),
      handleEstimateTask: this.deps.toolHandlers.handleEstimateTask.bind(this.deps.toolHandlers),
      handleReviewTask: this.deps.toolHandlers.handleReviewTask.bind(this.deps.toolHandlers),
      handleGetReviews: this.deps.toolHandlers.handleGetReviews.bind(this.deps.toolHandlers),
      handleGetCapabilities: this.deps.toolHandlers.handleGetCapabilities.bind(this.deps.toolHandlers),
    });

    // 通讯录工具
    const contactTools = getContactTools({
      handleContacts: this.deps.contactToolHandlers.handleContacts.bind(this.deps.contactToolHandlers),
      handleContactGroups: this.deps.contactToolHandlers.handleContactGroups.bind(this.deps.contactToolHandlers),
      handleFriendRequest: this.deps.contactToolHandlers.handleFriendRequest.bind(this.deps.contactToolHandlers),
      handlePendingRequests: this.deps.contactToolHandlers.handlePendingRequests.bind(this.deps.contactToolHandlers),
      handleContactsExport: this.deps.contactToolHandlers.handleContactsExport.bind(this.deps.contactToolHandlers),
      handleContactsImport: this.deps.contactToolHandlers.handleContactsImport.bind(this.deps.contactToolHandlers),
    });

    return [...networkTools, ...taskTools, ...contactTools];
  }

  /**
   * 更新依赖（用于运行时更新处理器）
   * 
   * @param deps - 新的依赖
   */
  updateDeps(deps: Partial<ToolRegistryDeps>): void {
    if (deps.toolHandlers) this.deps.toolHandlers = deps.toolHandlers;
    if (deps.claimHandlers) this.deps.claimHandlers = deps.claimHandlers;
    if (deps.contactToolHandlers) this.deps.contactToolHandlers = deps.contactToolHandlers;
  }
}