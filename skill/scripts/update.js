#!/usr/bin/env node
/**
 * F2A Skill Self-Update Script
 * 
 * 功能：
 * - 检查 GitHub 最新版本
 * - 对比本地版本
 * - 自动拉取更新
 */

const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const SKILL_DIR = path.dirname(__dirname); // scripts/../
const PACKAGE_FILE = path.join(SKILL_DIR, 'package.json');
const GIT_REMOTE = 'origin';

// 读取本地版本
async function getLocalVersion() {
  try {
    const data = await fs.readFile(PACKAGE_FILE, 'utf-8');
    const pkg = JSON.parse(data);
    return pkg.version;
  } catch (err) {
    return null;
  }
}

// 获取远程最新版本（从 GitHub raw）
async function getRemoteVersion(repoUrl) {
  return new Promise((resolve, reject) => {
    // 从 repo URL 提取 owner/repo
    const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!match) {
      reject(new Error('Invalid GitHub URL'));
      return;
    }
    
    const [, owner, repo] = match;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/package.json`;
    
    https.get(rawUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const pkg = JSON.parse(data);
          resolve(pkg.version);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// 执行 git 命令
function git(args, cwd = SKILL_DIR) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

// 检查是否在 git 仓库中
function isGitRepo() {
  try {
    git('rev-parse --git-dir');
    return true;
  } catch {
    return false;
  }
}

// 获取远程仓库 URL
function getRemoteUrl() {
  try {
    return git('remote get-url origin');
  } catch {
    return null;
  }
}

// 检查更新
async function checkUpdate() {
  console.log('[F2A Update] Checking for updates...\n');
  
  if (!isGitRepo()) {
    console.log('Not a git repository. Skipping update check.');
    console.log('To enable auto-update, clone from GitHub:');
    console.log('  git clone https://github.com/yourname/f2a-skill.git');
    return { hasUpdate: false };
  }
  
  const localVersion = await getLocalVersion();
  const remoteUrl = getRemoteUrl();
  
  if (!remoteUrl) {
    console.log('No remote configured. Skipping update check.');
    return { hasUpdate: false };
  }
  
  console.log(`Local version:  ${localVersion || 'unknown'}`);
  console.log(`Repository:     ${remoteUrl}`);
  
  try {
    // 获取远程版本
    const remoteVersion = await getRemoteVersion(remoteUrl);
    console.log(`Remote version: ${remoteVersion}`);
    
    if (localVersion === remoteVersion) {
      console.log('\n✓ Already up to date!');
      return { hasUpdate: false };
    }
    
    console.log(`\n↑ Update available: ${localVersion} → ${remoteVersion}`);
    return { hasUpdate: true, localVersion, remoteVersion };
  } catch (err) {
    console.log(`\n✗ Failed to check remote version: ${err.message}`);
    return { hasUpdate: false };
  }
}

// 执行更新
async function doUpdate() {
  console.log('[F2A Update] Updating...\n');
  
  try {
    // 检查是否有本地修改
    const status = git('status --porcelain');
    if (status) {
      console.log('Local changes detected. Stashing...');
      git('stash');
    }
    
    // 拉取最新代码
    console.log('Pulling latest changes...');
    const output = git('pull origin main');
    console.log(output);
    
    // 恢复本地修改
    if (status) {
      try {
        git('stash pop');
      } catch {
        console.log('Note: Stashed changes could not be automatically reapplied.');
      }
    }
    
    // 安装新依赖
    console.log('\nInstalling dependencies...');
    execSync('npm install', { cwd: SKILL_DIR, stdio: 'inherit' });
    
    const newVersion = await getLocalVersion();
    console.log(`\n✓ Updated to version ${newVersion}`);
    
    return true;
  } catch (err) {
    console.error(`\n✗ Update failed: ${err.message}`);
    return false;
  }
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'check') {
    await checkUpdate();
  } else if (command === 'update') {
    const check = await checkUpdate();
    if (check.hasUpdate) {
      await doUpdate();
    }
  } else {
    console.log('Usage:');
    console.log('  node update.js check   # Check for updates');
    console.log('  node update.js update  # Check and apply updates');
    console.log('');
    console.log('Auto-check on startup:');
    console.log('  Set F2A_AUTO_UPDATE=true to check on skill load');
  }
}

// 如果设置了自动更新环境变量，静默检查
if (process.env.F2A_AUTO_UPDATE === 'true') {
  checkUpdate().then(result => {
    if (result.hasUpdate) {
      console.log('[F2A] Update available. Run: node scripts/update.js update');
    }
  }).catch(err => {
    // 静默失败，但在 verbose 模式下输出
    if (process.env.F2A_VERBOSE === 'true') {
      console.error('[F2A Update] Auto-check failed:', err.message);
    }
  });
}

main();
