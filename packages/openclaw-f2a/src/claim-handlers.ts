/**
 * F2A OpenClaw Connector - Claim Handlers
 * 认领模式处理器模块 - 处理任务广播和认领相关工具
 */

import type {
  SessionContext,
  ToolResult,
  F2APluginConfig,
  OpenClawPluginApi
} from './types.js';
import type { F2AOpenClawAdapter } from './connector.js';
import type { AnnouncementQueue } from './announcement-queue.js';
import { pluginLogger as logger } from './logger.js';

/**
 * Adapter 内部接口 - 用于类型安全的属性访问
 */
interface AdapterInternalAccess {
  announcementQueue: AnnouncementQueue;
  api?: OpenClawPluginApi;
  config: F2APluginConfig;
}

/**
 * 认领模式处理器参数类型
 */
export interface ClaimHandlerParams {
  announce: {
    task_type: string;
    description: string;
    required_capabilities?: string[];
    estimated_complexity?: number;
    reward?: number;
    timeout?: number;
  };
  listAnnouncements: {
    capability?: string;
    limit?: number;
  };
  claim: {
    announcement_id: string;
    estimated_time?: number;
    confidence?: number;
  };
  manageClaims: {
    announcement_id: string;
    action: 'list' | 'accept' | 'reject';
    claim_id?: string;
  };
  myClaims: {
    status?: 'pending' | 'accepted' | 'rejected' | 'all';
  };
}

/**
 * 认领模式处理器类
 * 包含所有认领相关工具的处理逻辑
 */
export class ClaimHandlers {
  constructor(private adapter: F2AOpenClawAdapter) {}

  /**
   * 处理 f2a_announce 工具
   * 广播任务到 F2A 网络
   */
  async handleAnnounce(
    params: ClaimHandlerParams['announce'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.task_type || typeof params.task_type !== 'string' || params.task_type.trim() === '') {
      return { content: '❌ 请提供有效的 task_type 参数' };
    }
    if (!params.description || typeof params.description !== 'string' || params.description.trim() === '') {
      return { content: '❌ 请提供有效的 description 参数' };
    }
    
    // estimated_complexity 验证：必须在 1-10 之间
    if (params.estimated_complexity !== undefined) {
      if (typeof params.estimated_complexity !== 'number' || !Number.isFinite(params.estimated_complexity)) {
        return { content: '❌ estimated_complexity 必须是有效数字' };
      }
      if (params.estimated_complexity < 1 || params.estimated_complexity > 10) {
        return { content: '❌ estimated_complexity 必须在 1 到 10 之间' };
      }
    }
    
    // reward 验证：必须为非负数
    if (params.reward !== undefined) {
      if (typeof params.reward !== 'number' || !Number.isFinite(params.reward)) {
        return { content: '❌ reward 必须是有效数字' };
      }
      if (params.reward < 0) {
        return { content: '❌ reward 不能为负数' };
      }
    }
    
    // timeout 验证：必须为正数且不超过 24 小时
    if (params.timeout !== undefined) {
      if (typeof params.timeout !== 'number' || !Number.isFinite(params.timeout)) {
        return { content: '❌ timeout 必须是有效数字' };
      }
      if (params.timeout <= 0) {
        return { content: '❌ timeout 必须大于 0' };
      }
      if (params.timeout > 24 * 60 * 60 * 1000) {
        return { content: '❌ timeout 不能超过 24 小时' };
      }
    }
    
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    const api = (this.adapter as unknown as AdapterInternalAccess).api;
    const config = (this.adapter as unknown as AdapterInternalAccess).config;
    
    try {
      const announcement = announcementQueue.create({
        taskType: params.task_type,
        description: params.description,
        requiredCapabilities: params.required_capabilities,
        estimatedComplexity: params.estimated_complexity,
        reward: params.reward,
        timeout: params.timeout || 300000,
        from: 'local', // 实际应该从网络获取本机ID
      });

      // 触发心跳让其他Agent知道有新广播
      api?.runtime?.system?.requestHeartbeatNow?.();

      const content = `
📢 任务广播已创建

ID: ${announcement.announcementId}
类型: ${announcement.taskType}
描述: ${announcement.description.slice(0, 100)}${announcement.description.length > 100 ? '...' : ''}
${announcement.requiredCapabilities ? `所需能力: ${announcement.requiredCapabilities.join(', ')}` : ''}
${announcement.estimatedComplexity ? `复杂度: ${announcement.estimatedComplexity}/10` : ''}
${announcement.reward ? `奖励: ${announcement.reward}` : ''}
超时: ${Math.round(announcement.timeout / 1000)}秒

💡 使用 f2a_manage_claims 查看认领情况
      `.trim();

      return {
        content,
        data: {
          announcementId: announcement.announcementId,
          status: announcement.status
        }
      };
    } catch (error: any) {
      return {
        content: `❌ 创建广播失败: ${error.message}`,
        data: { error: error.message }
      };
    }
  }

  /**
   * 处理 f2a_list_announcements 工具
   * 查看当前开放的任务广播
   */
  async handleListAnnouncements(
    params: ClaimHandlerParams['listAnnouncements'],
    context: SessionContext
  ): Promise<ToolResult> {
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    
    let announcements = announcementQueue.getOpen();

    // 按能力过滤
    if (params.capability) {
      announcements = announcements.filter((a: any) =>
        a.requiredCapabilities?.includes(params.capability!)
      );
    }

    // 限制数量
    const limit = params.limit || 10;
    announcements = announcements.slice(0, limit);

    if (announcements.length === 0) {
      return { content: '📭 当前没有开放的任务广播' };
    }

    const content = `
📢 开放的任务广播 (${announcements.length} 个):

${announcements.map((a: any, i: number) => {
  const claimCount = a.claims?.length || 0;
  return `${i + 1}. [${a.announcementId.slice(0, 8)}...] ${a.description.slice(0, 50)}${a.description.length > 50 ? '...' : ''}
   类型: ${a.taskType} | 认领: ${claimCount} | 复杂度: ${a.estimatedComplexity || '?'}/10
   ${a.reward ? `奖励: ${a.reward} | ` : ''}超时: ${Math.round(a.timeout / 1000)}s`;
}).join('\n\n')}

💡 使用 f2a_claim 认领任务
    `.trim();

    return {
      content,
      data: {
        count: announcements.length,
        announcements: announcements.map((a: any) => ({
          announcementId: a.announcementId,
          taskType: a.taskType,
          description: a.description.slice(0, 100),
          requiredCapabilities: a.requiredCapabilities,
          estimatedComplexity: a.estimatedComplexity,
          reward: a.reward,
          claimCount: a.claims?.length || 0
        }))
      }
    };
  }

  /**
   * 处理 f2a_claim 工具
   * 认领一个开放的任务广播
   */
  async handleClaim(
    params: ClaimHandlerParams['claim'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.announcement_id || typeof params.announcement_id !== 'string' || params.announcement_id.trim() === '') {
      return { content: '❌ 请提供有效的 announcement_id 参数' };
    }
    
    // estimated_time 验证：必须为正数且不超过 24 小时
    if (params.estimated_time !== undefined) {
      if (typeof params.estimated_time !== 'number' || !Number.isFinite(params.estimated_time)) {
        return { content: '❌ estimated_time 必须是有效数字' };
      }
      if (params.estimated_time <= 0) {
        return { content: '❌ estimated_time 必须大于 0' };
      }
      if (params.estimated_time > 24 * 60 * 60 * 1000) {
        return { content: '❌ estimated_time 不能超过 24 小时' };
      }
    }
    
    // confidence 验证：必须在 0-1 之间
    if (params.confidence !== undefined) {
      if (typeof params.confidence !== 'number' || !Number.isFinite(params.confidence)) {
        return { content: '❌ confidence 必须是有效数字' };
      }
      if (params.confidence < 0 || params.confidence > 1) {
        return { content: '❌ confidence 必须在 0 到 1 之间' };
      }
    }
    
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    const api = (this.adapter as unknown as AdapterInternalAccess).api;
    const config = (this.adapter as unknown as AdapterInternalAccess).config;
    
    const announcement = announcementQueue.get(params.announcement_id);
    
    if (!announcement) {
      return { content: `❌ 找不到广播: ${params.announcement_id}` };
    }

    if (announcement.status !== 'open') {
      return { content: `❌ 该广播已${announcement.status === 'claimed' ? '被认领' : '过期'}` };
    }

    // 检查是否已有认领
    const existingClaim = announcement.claims?.find((c: any) => c.claimant === 'local');
    if (existingClaim) {
      return { content: `⚠️ 你已经认领过这个广播了 (认领ID: ${existingClaim.claimId.slice(0, 8)}...)` };
    }

    const claim = announcementQueue.submitClaim(params.announcement_id, {
      claimant: 'local', // 实际应该从网络获取本机ID
      claimantName: config.agentName,
      estimatedTime: params.estimated_time,
      confidence: params.confidence
    });

    if (!claim) {
      return { content: '❌ 认领失败' };
    }

    // 触发心跳
    api?.runtime?.system?.requestHeartbeatNow?.();

    return {
      content: `
✅ 认领已提交

广播ID: ${params.announcement_id.slice(0, 16)}...
认领ID: ${claim.claimId.slice(0, 16)}...
${params.estimated_time ? `预计时间: ${Math.round(params.estimated_time / 1000)}秒` : ''}
${params.confidence ? `信心指数: ${Math.round(params.confidence * 100)}%` : ''}

⏳ 等待广播发布者接受...
💡 使用 f2a_my_claims 查看认领状态
      `.trim(),
      data: {
        claimId: claim.claimId,
        status: claim.status
      }
    };
  }

  /**
   * 处理 f2a_manage_claims 工具
   * 管理我的任务广播的认领
   */
  async handleManageClaims(
    params: ClaimHandlerParams['manageClaims'],
    context: SessionContext
  ): Promise<ToolResult> {
    // 输入验证
    if (!params.announcement_id || typeof params.announcement_id !== 'string' || params.announcement_id.trim() === '') {
      return { content: '❌ 请提供有效的 announcement_id 参数' };
    }
    if (!params.action || !['list', 'accept', 'reject'].includes(params.action)) {
      return { content: '❌ action 参数必须是 list, accept 或 reject' };
    }
    if ((params.action === 'accept' || params.action === 'reject') && 
        (!params.claim_id || typeof params.claim_id !== 'string' || params.claim_id.trim() === '')) {
      return { content: '❌ accept/reject 操作需要提供 claim_id 参数' };
    }
    
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    
    const announcement = announcementQueue.get(params.announcement_id);
    
    if (!announcement) {
      return { content: `❌ 找不到广播: ${params.announcement_id}` };
    }

    // 检查是否是本机的广播
    if (announcement.from !== 'local') {
      return { content: '❌ 只能管理自己发布的广播' };
    }

    switch (params.action) {
      case 'list': {
        const claims = announcement.claims || [];
        if (claims.length === 0) {
          return { content: '📭 暂无认领' };
        }

        const content = `
📋 认领列表 (${claims.length} 个):

${claims.map((c: any, i: number) => {
  const statusIcon = ({ pending: '⏳', accepted: '✅', rejected: '❌' } as Record<string, string>)[c.status];
  return `${i + 1}. ${statusIcon} [${c.claimId.slice(0, 8)}...] ${c.claimantName || c.claimant.slice(0, 16)}...
   ${c.estimatedTime ? `预计: ${Math.round(c.estimatedTime / 1000)}s | ` : ''}${c.confidence ? `信心: ${Math.round(c.confidence * 100)}%` : ''}`;
}).join('\n\n')}

💡 使用 accept/reject 操作认领
        `.trim();

        return { content, data: { claims } };
      }

      case 'accept': {
        if (!params.claim_id) {
          return { content: '❌ 请提供 claim_id' };
        }

        const claim = announcementQueue.acceptClaim(params.announcement_id, params.claim_id);
        if (!claim) {
          return { content: '❌ 接受认领失败' };
        }

        return {
          content: `
✅ 已接受认领

认领ID: ${params.claim_id.slice(0, 16)}...
认领者: ${claim.claimantName || claim.claimant.slice(0, 16)}...

现在可以正式委托任务给对方了。
          `.trim(),
          data: { claim }
        };
      }

      case 'reject': {
        if (!params.claim_id) {
          return { content: '❌ 请提供 claim_id' };
        }

        const claim = announcementQueue.rejectClaim(params.announcement_id, params.claim_id);
        if (!claim) {
          return { content: '❌ 拒绝认领失败' };
        }

        return {
          content: `
🚫 已拒绝认领

认领ID: ${params.claim_id.slice(0, 16)}...
认领者: ${claim.claimantName || claim.claimant.slice(0, 16)}...
          `.trim()
        };
      }

      default:
        return { content: `❌ 未知操作: ${params.action}` };
    }
  }

  /**
   * 处理 f2a_my_claims 工具
   * 查看我提交的任务认领状态
   */
  async handleMyClaims(
    params: ClaimHandlerParams['myClaims'],
    context: SessionContext
  ): Promise<ToolResult> {
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    
    const status = params.status || 'all';
    let claims = announcementQueue.getMyClaims('local');

    // 状态过滤
    if (status !== 'all') {
      claims = claims.filter((c: any) => c.status === status);
    }

    if (claims.length === 0) {
      return { content: `📭 没有${status === 'all' ? '' : status}的认领` };
    }

    const content = `
📋 我的认领 (${claims.length} 个):

${claims.map((c: any, i: number) => {
  const announcement = announcementQueue.get(c.announcementId);
  const statusIcon = ({ pending: '⏳', accepted: '✅', rejected: '❌' } as Record<string, string>)[c.status];
  return `${i + 1}. ${statusIcon} [${c.claimId.slice(0, 8)}...]
   广播: ${announcement?.description.slice(0, 40)}...
   状态: ${c.status}${c.status === 'accepted' ? ' (可以开始执行)' : ''}`;
}).join('\n\n')}
    `.trim();

    return {
      content,
      data: {
        count: claims.length,
        claims: claims.map((c: any) => ({
          claimId: c.claimId,
          announcementId: c.announcementId,
          status: c.status,
          estimatedTime: c.estimatedTime,
          confidence: c.confidence
        }))
      }
    };
  }

  /**
   * 处理 f2a_announcement_stats 工具
   * 查看任务广播统计
   */
  async handleAnnouncementStats(
    params: {},
    context: SessionContext
  ): Promise<ToolResult> {
    const announcementQueue = (this.adapter as unknown as AdapterInternalAccess).announcementQueue;
    const stats = announcementQueue.getStats();
    
    const content = `
📊 任务广播统计:

📢 开放中: ${stats.open}
✅ 已认领: ${stats.claimed}
📋 已委托: ${stats.delegated}
⏰ 已过期: ${stats.expired}
📦 总计: ${stats.total}

💡 使用 f2a_list_announcements 查看开放广播
    `.trim();

    return { content, data: stats };
  }
}