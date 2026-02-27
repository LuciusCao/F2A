/**
 * 技能模块测试
 */

const { SkillsManager } = require('../scripts/skills');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    process.exitCode = 1;
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

console.log('\n📦 SkillsManager Tests');

test('registerSkill adds skill to registry', () => {
  const skills = new SkillsManager();
  
  skills.registerSkill('greet', {
    description: 'Greeting skill',
    parameters: { name: { type: 'string', required: true } },
    handler: async (params) => `Hello, ${params.name}!`
  });
  
  const localSkills = skills.getLocalSkills();
  assertEqual(localSkills.length, 1, 'Should have 1 skill');
  assertEqual(localSkills[0].name, 'greet', 'Skill name should match');
  assertEqual(localSkills[0].description, 'Greeting skill', 'Description should match');
});

test('registerSkill with requireAuth false', () => {
  const skills = new SkillsManager();
  
  skills.registerSkill('public', {
    description: 'Public skill',
    requireAuth: false,
    handler: async () => 'public result'
  });
  
  const localSkills = skills.getLocalSkills();
  assertEqual(localSkills.length, 1, 'Should have 1 skill');
});

test('unregisterSkill removes skill', () => {
  const skills = new SkillsManager();
  
  skills.registerSkill('test', {
    description: 'Test skill',
    handler: async () => 'result'
  });
  
  assertEqual(skills.getLocalSkills().length, 1, 'Should have 1 skill');
  
  skills.unregisterSkill('test');
  
  assertEqual(skills.getLocalSkills().length, 0, 'Should have 0 skills');
});

test('getLocalSkills returns skill info without handler', () => {
  const skills = new SkillsManager();
  
  skills.registerSkill('test', {
    description: 'Test skill',
    parameters: { input: { type: 'string', required: true } },
    handler: async () => 'result'
  });
  
  const localSkills = skills.getLocalSkills();
  assertTrue(!localSkills[0].handler, 'Should not include handler function');
  assertTrue(localSkills[0].parameters, 'Should include parameters');
});

test('validateParameters checks required fields', () => {
  const skills = new SkillsManager();
  
  let threw = false;
  try {
    skills._validateParameters(
      {}, // Empty params
      { name: { type: 'string', required: true } }
    );
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for missing required parameter');
});

test('validateParameters checks type', () => {
  const skills = new SkillsManager();
  
  let threw = false;
  try {
    skills._validateParameters(
      { count: 'not a number' },
      { count: { type: 'number', required: true } }
    );
  } catch (err) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for wrong type');
});

test('validateParameters accepts correct types', () => {
  const skills = new SkillsManager();
  
  let threw = false;
  try {
    skills._validateParameters(
      { name: 'John', count: 42 },
      {
        name: { type: 'string', required: true },
        count: { type: 'number', required: true }
      }
    );
  } catch (err) {
    threw = true;
  }
  
  assertTrue(!threw, 'Should not throw for correct types');
});

test('validateParameters allows optional fields', () => {
  const skills = new SkillsManager();
  
  let threw = false;
  try {
    skills._validateParameters(
      { name: 'John' }, // Missing optional field
      {
        name: { type: 'string', required: true },
        description: { type: 'string', required: false }
      }
    );
  } catch (err) {
    threw = true;
  }
  
  assertTrue(!threw, 'Should not throw for missing optional field');
});

test('handleSkillQuery returns skills list', async () => {
  const skills = new SkillsManager();
  
  skills.registerSkill('skill1', {
    description: 'Skill 1',
    handler: async () => 'result1'
  });
  
  skills.registerSkill('skill2', {
    description: 'Skill 2',
    handler: async () => 'result2'
  });
  
  const sentMessages = [];
  const mockConnection = {
    send: (data) => sentMessages.push(JSON.parse(data))
  };
  
  skills.handleSkillQuery('req-123', mockConnection);
  
  assertEqual(sentMessages.length, 1, 'Should send one response');
  assertEqual(sentMessages[0].type, 'skill_response', 'Should be skill_response');
  assertEqual(sentMessages[0].requestId, 'req-123', 'Should have correct requestId');
  assertEqual(sentMessages[0].skills.length, 2, 'Should return 2 skills');
});

test('handleSkillInvoke calls handler and returns result', async () => {
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
  
  assertEqual(sentMessages.length, 1, 'Should send one response');
  assertEqual(sentMessages[0].type, 'skill_result', 'Should be skill_result');
  assertEqual(sentMessages[0].status, 'success', 'Should be success');
  assertEqual(sentMessages[0].result, 5, 'Result should be 5');
});

test('handleSkillInvoke returns error for unknown skill', async () => {
  const skills = new SkillsManager();
  
  const sentMessages = [];
  const mockConnection = {
    send: (data) => sentMessages.push(JSON.parse(data))
  };
  
  await skills.handleSkillInvoke(
    'req-789',
    'unknown',
    {},
    mockConnection,
    { authorized: true }
  );
  
  assertEqual(sentMessages[0].status, 'error', 'Should be error');
  assertTrue(sentMessages[0].error.includes('not found'), 'Should mention not found');
});

test('handleSkillInvoke returns error for unauthorized', async () => {
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
    { authorized: false } // Not authorized
  );
  
  assertEqual(sentMessages[0].status, 'error', 'Should be error');
  assertTrue(sentMessages[0].error.includes('Unauthorized'), 'Should mention unauthorized');
});

test('cachePeerSkills stores skills', () => {
  const skills = new SkillsManager();
  
  skills.cachePeerSkills('peer-a', [
    { name: 'skill1', description: 'Skill 1' }
  ]);
  
  const cached = skills.getCachedPeerSkills('peer-a');
  assertEqual(cached.length, 1, 'Should have 1 cached skill');
  assertEqual(cached[0].name, 'skill1', 'Should have correct name');
});

test('getCachedPeerSkills returns null for expired cache', () => {
  const skills = new SkillsManager();
  
  // 手动设置过期时间
  skills.peerSkills.set('peer-b', {
    skills: [{ name: 'skill1' }],
    lastUpdated: Date.now() - 10 * 60 * 1000 // 10 minutes ago
  });
  
  const cached = skills.getCachedPeerSkills('peer-b');
  assertEqual(cached, null, 'Should return null for expired cache');
});

console.log('');
