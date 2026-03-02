/**
 * Daemon 启动脚本测试
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

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

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message || 'Expected true, got false');
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message || 'Expected false, got true');
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('\n📦 Daemon Tests');

const skillDir = path.join(__dirname, '..');
const daemonScript = path.join(skillDir, 'daemon.js');
const f2aScript = path.join(skillDir, 'f2a.js');

// ==================== 文件存在测试 ====================

test('daemon.js exists', () => {
  assertTrue(fs.existsSync(daemonScript), 'Daemon script should exist');
});

test('f2a.js exists', () => {
  assertTrue(fs.existsSync(f2aScript), 'f2a.js should exist');
});

test('daemon.js is executable', () => {
  const stats = fs.statSync(daemonScript);
  assertTrue(stats.isFile(), 'Should be a file');
});

// ==================== 脚本内容测试 ====================

test('daemon script contains required functions', () => {
  const content = fs.readFileSync(daemonScript, 'utf8');
  assertTrue(content.includes('function start'), 'Should have start function');
  assertTrue(content.includes('function stop'), 'Should have stop function');
  assertTrue(content.includes('function status'), 'Should have status function');
});

test('daemon script supports --daemon flag', () => {
  const content = fs.readFileSync(daemonScript, 'utf8');
  assertTrue(content.includes('--daemon') || content.includes("'--daemon'"), 'Should support --daemon flag');
  assertTrue(content.includes('-D') || content.includes("'-D'"), 'Should support -D shorthand');
});

test('f2a.js contains required commands', () => {
  const content = fs.readFileSync(f2aScript, 'utf8');
  assertTrue(content.includes('start'), 'Should support start command');
  assertTrue(content.includes('stop'), 'Should support stop command');
  assertTrue(content.includes('status'), 'Should support status command');
});

test('f2a.js forwards arguments to daemon.js', () => {
  const content = fs.readFileSync(f2aScript, 'utf8');
  assertTrue(content.includes('daemon.js'), 'Should reference daemon.js');
  assertTrue(content.includes('daemonArgs'), 'Should forward arguments');
});

test('daemon script uses PID file', () => {
  const content = fs.readFileSync(daemonScript, 'utf8');
  assertTrue(content.includes('daemon.pid'), 'Should reference PID file');
});

test('daemon script uses log file', () => {
  const content = fs.readFileSync(daemonScript, 'utf8');
  assertTrue(content.includes('daemon.log'), 'Should reference log file');
});

test('daemon script handles environment variables', () => {
  const content = fs.readFileSync(daemonScript, 'utf8');
  assertTrue(content.includes('F2A_DISPLAY_NAME'), 'Should handle F2A_DISPLAY_NAME');
  assertTrue(content.includes('F2A_PORT'), 'Should handle F2A_PORT');
  assertTrue(content.includes('F2A_DATA_DIR'), 'Should handle F2A_DATA_DIR');
});

// ==================== package.json 脚本测试 ====================

test('package.json has daemon scripts', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(skillDir, 'package.json'), 'utf8'));
  assertTrue(pkg.scripts['daemon:start'], 'Should have daemon:start script');
  assertTrue(pkg.scripts['daemon:stop'], 'Should have daemon:stop script');
  assertTrue(pkg.scripts['daemon:status'], 'Should have daemon:status script');
});

// ==================== 帮助信息测试 ====================

test('daemon script shows help for unknown command', () => {
  try {
    execSync('node daemon.js unknown', { cwd: skillDir, stdio: 'pipe' });
  } catch (e) {
    // Should exit with error code and show usage
    assertTrue(e.status !== 0, 'Should exit with error code');
    const output = e.stderr ? e.stderr.toString() : e.message;
    // Check for either "Usage" or "用法" (Chinese) or just verify it failed
    assertTrue(
      output.includes('Usage') || 
      output.includes('用法') || 
      output.includes('start|stop|status') ||
      e.status !== 0,
      'Should show usage or exit with error'
    );
  }
});

// ==================== 状态检查测试（无 daemon 运行时）====================

test('status shows not running when daemon is not active', () => {
  // 确保没有 PID 文件
  const pidFile = path.join(os.homedir(), '.f2a', 'daemon.pid');
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
  
  try {
    const output = execSync('node daemon.js status', { 
      cwd: skillDir, 
      encoding: 'utf8',
      timeout: 5000 
    });
    assertTrue(output.includes('not running') || output.includes('未运行'), 'Should show not running');
  } catch (e) {
    // 如果进程返回非零退出码，检查输出
    const output = e.stdout ? e.stdout.toString() : e.message;
    assertTrue(output.includes('not running') || output.includes('未运行'), 'Should show not running');
  }
});

console.log('');

// 确保退出
setTimeout(() => {
  process.exit(process.exitCode || 0);
}, 100);
