/**
 * 技能交换管理器
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'eventemitter3';
import type { F2AMessage } from '../types/index.js';
import type {
  SkillDefinition,
  SkillHandler,
  SkillExchangeConfig,
  SkillAnnouncePayload,
  SkillQueryPayload,
  RemoteSkill,
  SkillExecutionContext,
} from '../types/skill-exchange.js';
import { DEFAULT_SKILL_EXCHANGE_CONFIG } from '../types/skill-exchange.js';
import { Logger } from '../utils/logger.js';

export interface SkillExchangeEvents {
  'skill:registered': (skill: SkillDefinition) => void;
  'skill:discovered': (peerId: string, skill: SkillDefinition) => void;
  'skill:invoke_completed': (invokeId: string, success: boolean, durationMs: number) => void;
}

export class SkillExchangeManager extends EventEmitter<SkillExchangeEvents> {
  private peerId: string;
  private config: Required<SkillExchangeConfig>;
  private logger: Logger;
  private localSkills: Map<string, { definition: SkillDefinition; handler: SkillHandler }> = new Map();
  private remoteSkills: Map<string, RemoteSkill[]> = new Map();
  private stats = { totalInvokes: 0, successfulInvokes: 0, failedInvokes: 0, totalExecutionTimeMs: 0 };
  private sendFn?: (peerId: string, message: F2AMessage) => Promise<void>;
  private broadcastFn?: (message: F2AMessage) => Promise<void>;
  private announceTimer?: ReturnType<typeof setInterval>;

  constructor(
    peerId: string,
    config: Partial<SkillExchangeConfig> = {},
    sendFn?: (peerId: string, message: F2AMessage) => Promise<void>,
    broadcastFn?: (message: F2AMessage) => Promise<void>
  ) {
    super();
    this.peerId = peerId;
    this.config = { ...DEFAULT_SKILL_EXCHANGE_CONFIG, ...config } as Required<SkillExchangeConfig>;
    this.sendFn = sendFn;
    this.broadcastFn = broadcastFn;
    this.logger = new Logger({ component: 'SkillExchange' });
  }

  private createMessage(type: F2AMessage['type'], payload: unknown): F2AMessage {
    return {
      id: `skill-${Date.now()}-${randomBytes(4).toString('hex')}`,
      type,
      from: this.peerId,
      timestamp: Date.now(),
      payload,
    };
  }

  start(): void {
    if (this.config.enableAnnounce) {
      this.announceTimer = setInterval(() => this.announceSkills(), this.config.announceInterval * 1000);
      this.announceSkills();
    }
    this.logger.info('Started');
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.logger.info('Stopped');
  }

  // 本地技能管理
  registerSkill(definition: SkillDefinition, handler: SkillHandler): void {
    this.localSkills.set(definition.id, { definition, handler });
    this.emit('skill:registered', definition);
    this.logger.info('Registered', { skillId: definition.id });
  }

  unregisterSkill(skillId: string): void {
    this.localSkills.delete(skillId);
    this.logger.info('Unregistered', { skillId });
  }

  getLocalSkills(): SkillDefinition[] {
    return Array.from(this.localSkills.values()).map(s => s.definition);
  }

  // 技能发现
  async announceSkills(): Promise<void> {
    if (!this.broadcastFn || this.localSkills.size === 0) return;
    const payload: SkillAnnouncePayload = {
      peerId: this.peerId,
      skills: this.getLocalSkills(),
      timestamp: Date.now(),
      ttl: this.config.skillTtl,
    };
    await this.broadcastFn(this.createMessage('SKILL_ANNOUNCE', payload));
  }

  async querySkills(query: SkillQueryPayload): Promise<void> {
    if (!this.broadcastFn) return;
    await this.broadcastFn(this.createMessage('SKILL_QUERY', query));
  }

  findSkills(query: Partial<SkillQueryPayload>): Array<{ local?: SkillDefinition; remote?: RemoteSkill }> {
    const results: Array<{ local?: SkillDefinition; remote?: RemoteSkill }> = [];
    for (const skill of this.localSkills.values()) {
      if (this.matchesQuery(skill.definition, query)) results.push({ local: skill.definition });
    }
    for (const [, providers] of this.remoteSkills) {
      for (const remote of providers) {
        if (this.matchesQuery(remote.definition, query)) results.push({ remote });
      }
    }
    return results;
  }

  private matchesQuery(skill: SkillDefinition, query: Partial<SkillQueryPayload>): boolean {
    if (query.skillName && !skill.name.toLowerCase().includes(query.skillName.toLowerCase())) return false;
    if (query.category && skill.category !== query.category) return false;
    return true;
  }

  // 技能调用
  async invokeSkill(skillId: string, input: Record<string, unknown>, timeout?: number): Promise<{ success: boolean; output?: unknown; error?: string }> {
    const skill = this.localSkills.get(skillId);
    if (!skill) return { success: false, error: `Skill not found: ${skillId}` };

    const invokeId = `invoke-${Date.now()}`;
    const startTime = Date.now();

    try {
      this.stats.totalInvokes++;
      const context: SkillExecutionContext = {
        callerId: this.peerId,
        invokeId,
        timeout: timeout ?? this.config.defaultTimeout,
        log: (msg, level = 'info') => this.logger[level](`[${skill.definition.name}] ${msg}`),
      };

      const result = await skill.handler(input, context);
      const durationMs = Date.now() - startTime;
      this.stats.successfulInvokes++;
      this.stats.totalExecutionTimeMs += durationMs;
      this.emit('skill:invoke_completed', invokeId, true, durationMs);
      return { success: true, output: result };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.stats.failedInvokes++;
      this.emit('skill:invoke_completed', invokeId, false, durationMs);
      return { success: false, error: String(error) };
    }
  }

  // 消息处理
  handleAnnounce(peerId: string, payload: SkillAnnouncePayload): void {
    if (peerId === this.peerId) return;
    for (const skill of payload.skills) {
      const remote: RemoteSkill = {
        definition: skill,
        providerId: peerId,
        lastUpdated: payload.timestamp,
        available: true,
      };
      const existing = this.remoteSkills.get(skill.id) ?? [];
      const updated = existing.filter(r => r.providerId !== peerId);
      updated.push(remote);
      this.remoteSkills.set(skill.id, updated);
      this.emit('skill:discovered', peerId, skill);
    }
  }

  getStats() { return { ...this.stats }; }
  getRemoteSkillCount() { return this.remoteSkills.size; }
}
