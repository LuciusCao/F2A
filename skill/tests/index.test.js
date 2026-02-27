/**
 * F2A Test Suite - 独立模块测试
 * 
 * 运行测试: npm test
 */

// 直接引用独立模块，避免 ws 依赖
const { E2ECrypto } = require('../scripts/crypto');
const { GroupChat } = require('../scripts/group');
const { SkillsManager } = require('../scripts/skills');

// 测试工具
function describe(name, fn) {
  console.log(`\n📦 ${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    process.exitCode = 1;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy, got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected defined, got undefined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${actual}`);
      }
    }
  };
}

// ==================== 加密模块测试 ====================
describe('E2ECrypto', () => {
  it('should generate key pair', () => {
    const crypto = new E2ECrypto();
    const keyPair = crypto.generateKeyPair();
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
  });

  it('should derive session key', () => {
    const cryptoA = new E2ECrypto();
    const cryptoB = new E2ECrypto();
    
    const pairA = cryptoA.generateKeyPair();
    const pairB = cryptoB.generateKeyPair();
    
    // A 使用 B 的公钥派生密钥
    cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
    // B 使用 A 的公钥派生密钥
    cryptoB.deriveSessionKey('peer-a', pairA.publicKey);
    
    // 双方派生的密钥应该能互相加解密
    const message = 'Hello, World!';
    const encrypted = cryptoA.encrypt('peer-b', message);
    const decrypted = cryptoB.decrypt('peer-a', encrypted);
    
    expect(decrypted).toBe(message);
  });

  it('should encrypt and decrypt message', () => {
    const cryptoA = new E2ECrypto();
    const cryptoB = new E2ECrypto();
    
    const pairA = cryptoA.generateKeyPair();
    const pairB = cryptoB.generateKeyPair();
    
    // A 使用 B 的公钥派生密钥
    cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
    // B 使用 A 的公钥派生密钥
    cryptoB.deriveSessionKey('peer-a', pairA.publicKey);
    
    const message = 'Secret message';
    const encrypted = cryptoA.encrypt('peer-b', message);
    
    expect(encrypted !== message).toBeTruthy();
    
    const decrypted = cryptoB.decrypt('peer-a', encrypted);
    expect(decrypted).toBe(message);
  });

  it('should throw when encrypting without session key', () => {
    const crypto = new E2ECrypto();
    crypto.generateKeyPair();
    
    let errorThrown = false;
    try {
      crypto.encrypt('unknown-peer', 'message');
    } catch (err) {
      errorThrown = true;
    }
    expect(errorThrown).toBeTruthy();
  });

  it('should clear session', () => {
    const cryptoA = new E2ECrypto();
    const cryptoB = new E2ECrypto();
    
    const pairA = cryptoA.generateKeyPair();
    const pairB = cryptoB.generateKeyPair();
    
    cryptoA.deriveSessionKey('peer-b', pairB.publicKey);
    expect(cryptoA.sessionKeys.has('peer-b')).toBeTruthy();
    
    cryptoA.clearSession('peer-b');
    expect(cryptoA.sessionKeys.has('peer-b')).toBeFalsy();
  });
});

// ==================== 群聊模块测试 ====================
describe('GroupChat', () => {
  it('should create group', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    
    expect(groupId).toBeDefined();
    
    const info = groups.getGroupInfo(groupId);
    expect(info.name).toBe('Test Group');
    expect(info.creator).toBe('agent-a');
    expect(info.memberCount).toBe(1);
  });

  it('should invite member to group', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    
    const invite = groups.inviteMember(groupId, 'agent-b');
    
    expect(invite.type).toBe('group_invite');
    expect(invite.groupId).toBe(groupId);
    expect(invite.members.includes('agent-b')).toBeTruthy();
    
    const info = groups.getGroupInfo(groupId);
    expect(info.memberCount).toBe(2);
  });

  it('should only allow creator to invite', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    
    // 切换到另一个 agent
    groups.myAgentId = 'agent-b';
    
    let errorThrown = false;
    try {
      groups.inviteMember(groupId, 'agent-c');
    } catch (err) {
      errorThrown = true;
    }
    expect(errorThrown).toBeTruthy();
  });

  it('should leave group', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    
    groups.leaveGroup(groupId);
    
    const myGroups = groups.getMyGroups();
    expect(myGroups.length).toBe(0);
  });

  it('should get all groups', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    groups.createGroup('Group 1');
    groups.createGroup('Group 2');
    groups.createGroup('Group 3');
    
    const allGroups = groups.getAllGroups();
    expect(allGroups.length).toBe(3);
  });

  it('should handle group invite', () => {
    const groups = new GroupChat({ myAgentId: 'agent-b' });
    
    groups.handleGroupInvite({
      type: 'group_invite',
      groupId: 'group-123',
      groupName: 'Test Group',
      creator: 'agent-a',
      members: ['agent-a', 'agent-b']
    });
    
    const info = groups.getGroupInfo('group-123');
    expect(info.name).toBe('Test Group');
    expect(info.memberCount).toBe(2);
  });

  it('should broadcast group message', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    groups.inviteMember(groupId, 'agent-b');
    groups.inviteMember(groupId, 'agent-c');
    
    const sentMessages = [];
    const sendFunction = (peerId, message) => {
      sentMessages.push({ peerId, message });
    };
    
    groups.sendGroupMessage(groupId, 'Hello everyone!', sendFunction);
    
    expect(sentMessages.length).toBe(2);
    expect(sentMessages.every(m => m.peerId !== 'agent-a')).toBeTruthy();
    expect(sentMessages.every(m => m.message.content === 'Hello everyone!')).toBeTruthy();
  });

  it('should emit group_message event', () => {
    const groups = new GroupChat({ myAgentId: 'agent-a' });
    const groupId = groups.createGroup('Test Group');
    groups.inviteMember(groupId, 'agent-b');
    
    let receivedEvent = null;
    groups.on('group_message', (data) => {
      receivedEvent = data;
    });
    
    groups.handleGroupMessage({
      type: 'group_message',
      messageId: 'msg-1',
      groupId: groupId,
      from: 'agent-b',
      content: 'Hello!',
      timestamp: Date.now()
    });
    
    expect(receivedEvent !== null).toBeTruthy();
    expect(receivedEvent.content).toBe('Hello!');
  });
});

// ==================== 技能模块测试 ====================
describe('SkillsManager', () => {
  it('should register skill', () => {
    const skills = new SkillsManager();
    
    skills.registerSkill('test', {
      description: 'Test skill',
      parameters: { name: { type: 'string', required: true } },
      handler: async (params) => `Hello, ${params.name}!`
    });
    
    const localSkills = skills.getLocalSkills();
    expect(localSkills.length).toBe(1);
    expect(localSkills[0].name).toBe('test');
  });

  it('should unregister skill', () => {
    const skills = new SkillsManager();
    
    skills.registerSkill('test', {
      description: 'Test skill',
      handler: async () => 'result'
    });
    
    expect(skills.getLocalSkills().length).toBe(1);
    
    skills.unregisterSkill('test');
    expect(skills.getLocalSkills().length).toBe(0);
  });

  it('should validate parameters', () => {
    const skills = new SkillsManager();
    
    let errorThrown = false;
    try {
      skills._validateParameters(
        {},
        { name: { type: 'string', required: true } }
      );
    } catch (err) {
      errorThrown = true;
    }
    expect(errorThrown).toBeTruthy();
  });

  it('should handle skill query', () => {
    const skills = new SkillsManager();
    
    skills.registerSkill('skill1', {
      description: 'Skill 1',
      handler: async () => 'result1'
    });
    
    const sentMessages = [];
    const mockConnection = {
      send: (data) => sentMessages.push(JSON.parse(data))
    };
    
    skills.handleSkillQuery('req-123', mockConnection);
    
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].type).toBe('skill_response');
    expect(sentMessages[0].skills.length).toBe(1);
  });

  it('should handle skill invoke', async () => {
    const skills = new SkillsManager();
    
    skills.registerSkill('add', {
      description: 'Add two numbers',
      parameters: {
        a: { type: 'number', required: true },
        b: { type: 'number', required: true }
      },
      handler: async (params) => params.a + params.b
    });
    
    const sentMessages = [];
    const mockConnection = {
      send: (data) => sentMessages.push(JSON.parse(data))
    };
    
    await skills.handleSkillInvoke(
      'req-456',
      'add',
      { a: 2, b: 3 },
      mockConnection,
      { authorized: true }
    );
    
    expect(sentMessages[0].status).toBe('success');
    expect(sentMessages[0].result).toBe(5);
  });

  it('should reject unauthorized skill invoke', async () => {
    const skills = new SkillsManager();
    
    skills.registerSkill('private', {
      description: 'Private skill',
      requireAuth: true,
      handler: async () => 'secret'
    });
    
    const sentMessages = [];
    const mockConnection = {
      send: (data) => sentMessages.push(JSON.parse(data))
    };
    
    await skills.handleSkillInvoke(
      'req-000',
      'private',
      {},
      mockConnection,
      { authorized: false }
    );
    
    expect(sentMessages[0].status).toBe('error');
  });
});

// 运行测试
console.log('🧪 F2A Test Suite');
console.log('==================');

// 测试总结
process.on('exit', () => {
  console.log('\n==================');
  if (process.exitCode === 1) {
    console.log('❌ Some tests failed');
  } else {
    console.log('✅ All tests passed');
  }
});
