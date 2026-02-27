/**
 * F2A Skills Module
 * 
 * 技能管理和远程调用模块
 */

const EventEmitter = require('events');

class SkillsManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.localSkills = new Map(); // skillName -> skillDefinition
    this.peerSkills = new Map(); // peerId -> { skills: [], lastUpdated }
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }
    this.requestTimeout = options.requestTimeout || 30000;
  }

  /**
   * 注册本地技能
   */
  registerSkill(name, definition) {
    this.localSkills.set(name, {
      name,
      description: definition.description || '',
      parameters: definition.parameters || {},
      handler: definition.handler,
      requireAuth: definition.requireAuth !== false
    });
    
    this.emit('skill_registered', { name });
  }

  /**
   * 注销本地技能
   */
  unregisterSkill(name) {
    this.localSkills.delete(name);
    this.emit('skill_unregistered', { name });
  }

  /**
   * 获取本地技能列表
   */
  getLocalSkills() {
    return Array.from(this.localSkills.values()).map(s => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters
    }));
  }

  /**
   * 查询 peer 的技能列表
   */
  async querySkills(peerId, connection) {
    const requestId = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Query skills timeout'));
      }, this.requestTimeout);
      
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      
      connection.send(JSON.stringify({
        type: 'skill_query',
        requestId
      }));
    });
  }

  /**
   * 处理技能查询请求
   */
  handleSkillQuery(requestId, connection) {
    const skills = this.getLocalSkills();
    connection.send(JSON.stringify({
      type: 'skill_response',
      requestId,
      skills
    }));
  }

  /**
   * 处理技能查询响应
   */
  handleSkillResponse(requestId, skills) {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.resolve(skills);
    }
  }

  /**
   * 远程调用 peer 的技能
   */
  async invokeSkill(peerId, skillName, parameters, connection) {
    const requestId = crypto.randomUUID();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Invoke skill timeout'));
      }, this.requestTimeout);
      
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      
      connection.send(JSON.stringify({
        type: 'skill_invoke',
        requestId,
        skill: skillName,
        parameters
      }));
    });
  }

  /**
   * 处理技能调用请求
   */
  async handleSkillInvoke(requestId, skillName, parameters, connection, options = {}) {
    const skill = this.localSkills.get(skillName);
    
    if (!skill) {
      connection.send(JSON.stringify({
        type: 'skill_result',
        requestId,
        status: 'error',
        error: `Skill not found: ${skillName}`
      }));
      return;
    }

    // 检查权限
    if (skill.requireAuth && !options.authorized) {
      connection.send(JSON.stringify({
        type: 'skill_result',
        requestId,
        status: 'error',
        error: 'Unauthorized'
      }));
      return;
    }

    try {
      // 验证参数
      this._validateParameters(parameters, skill.parameters);
      
      // 执行技能
      const result = await skill.handler(parameters, options);
      
      connection.send(JSON.stringify({
        type: 'skill_result',
        requestId,
        status: 'success',
        result
      }));
    } catch (err) {
      connection.send(JSON.stringify({
        type: 'skill_result',
        requestId,
        status: 'error',
        error: err.message
      }));
    }
  }

  /**
   * 处理技能调用结果
   */
  handleSkillResult(requestId, status, result, error) {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      
      if (status === 'success') {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || 'Skill invocation failed'));
      }
    }
  }

  /**
   * 验证参数
   */
  _validateParameters(params, schema) {
    for (const [key, config] of Object.entries(schema)) {
      if (config.required && !(key in params)) {
        throw new Error(`Missing required parameter: ${key}`);
      }
      
      if (key in params && config.type) {
        const actualType = typeof params[key];
        if (actualType !== config.type) {
          throw new Error(`Invalid type for ${key}: expected ${config.type}, got ${actualType}`);
        }
      }
    }
  }

  /**
   * 缓存 peer 的技能列表
   */
  cachePeerSkills(peerId, skills) {
    this.peerSkills.set(peerId, {
      skills,
      lastUpdated: Date.now()
    });
  }

  /**
   * 获取缓存的 peer 技能
   */
  getCachedPeerSkills(peerId) {
    const cached = this.peerSkills.get(peerId);
    if (cached && Date.now() - cached.lastUpdated < 5 * 60 * 1000) {
      return cached.skills;
    }
    return null;
  }
}

module.exports = { SkillsManager };
