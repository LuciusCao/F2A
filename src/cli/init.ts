/**
 * F2A Init 命令
 * 交互式配置向导
 */

import * as readline from 'readline';
import { homedir, hostname } from 'os';
import {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  F2AConfig,
  getConfigPath,
  configExists,
  validateAgentName,
} from './config.js';

// 端口验证常量
const MIN_PORT = 1024;
const MAX_PORT = 65535;

// Multiaddr 验证正则 (基本格式: /protocol/value/...)
const MULTIADDR_REGEX = /^\/(ip4|ip6|dns|dns4|dns6)\/[^/]+\/(tcp|udp)\/\d+(\/p2p\/[a-zA-Z0-9]+)?$/;

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function color(text: string, colorName: keyof typeof colors): string {
  return `${colors[colorName]}${text}${colors.reset}`;
}

/**
 * 创建 readline 接口
 */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * 提问函数
 */
function question(rl: readline.Interface, prompt: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const displayPrompt = defaultValue 
      ? `${prompt} ${color(`[${defaultValue}]`, 'cyan')}: `
      : `${prompt}: `;
    
    rl.question(displayPrompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * 选择函数
 */
async function select(
  rl: readline.Interface,
  prompt: string,
  options: string[],
  defaultIndex: number = 0
): Promise<number> {
  console.log(`\n${prompt}`);
  options.forEach((opt, i) => {
    const marker = i === defaultIndex ? color('→', 'cyan') : ' ';
    console.log(`  ${marker} ${i + 1}. ${opt}`);
  });
  
  const answer = await question(rl, '选择', (defaultIndex + 1).toString());
  const index = parseInt(answer) - 1;
  
  if (index >= 0 && index < options.length) {
    return index;
  }
  return defaultIndex;
}

/**
 * 确认函数
 */
async function confirm(rl: readline.Interface, prompt: string, defaultValue: boolean = false): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = await question(rl, `${prompt} ${color(`[${hint}]`, 'cyan')}`);
  
  if (answer === '') return defaultValue;
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * 显示欢迎信息
 */
function showWelcome(): void {
  console.log('');
  console.log(color('╔════════════════════════════════════════════════╗', 'blue'));
  console.log(color('║         F2A 配置向导                           ║', 'blue'));
  console.log(color('║         Friend-to-Agent P2P 网络               ║', 'blue'));
  console.log(color('╚════════════════════════════════════════════════╝', 'blue'));
  console.log('');
  console.log('这个向导将帮助你配置 F2A 网络。');
  console.log('只需要回答几个简单的问题即可完成配置。');
  console.log('');
}

/**
 * 显示配置摘要
 */
function showSummary(config: F2AConfig): void {
  console.log('');
  console.log(color('══════════════════════════════════════════════════', 'blue'));
  console.log(color('配置摘要', 'bold'));
  console.log(color('══════════════════════════════════════════════════', 'blue'));
  console.log('');
  console.log(`${color('Agent 名称:', 'cyan')}     ${config.agentName}`);
  console.log(`${color('自动启动:', 'cyan')}       ${config.autoStart ? '是' : '否'}`);
  console.log(`${color('控制端口:', 'cyan')}       ${config.controlPort}`);
  console.log(`${color('P2P 端口:', 'cyan')}        ${config.p2pPort === 0 ? '随机分配' : config.p2pPort}`);
  console.log(`${color('MDNS 发现:', 'cyan')}       ${config.enableMDNS ? '启用' : '禁用'}`);
  console.log(`${color('DHT:', 'cyan')}              ${config.enableDHT ? '启用' : '禁用'}`);
  console.log(`${color('日志级别:', 'cyan')}       ${config.logLevel}`);
  console.log(`${color('引导节点:', 'cyan')}       ${config.network.bootstrapPeers.length > 0 ? config.network.bootstrapPeers.join(', ') : '无'}`);
  console.log('');
  console.log(`${color('配置文件:', 'cyan')}       ${getConfigPath()}`);
  console.log('');
}

/**
 * 主配置流程
 */
export async function initConfig(): Promise<void> {
  // TTY 检测：确保在交互式环境中运行
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(color('Error: This command requires an interactive terminal (TTY).', 'red'));
    console.error(color('Please run "f2a init" in a terminal.', 'red'));
    process.exit(1);
  }
  
  showWelcome();
  
  const rl = createInterface();
  const existingConfig = loadConfig();
  const hasExisting = configExists();
  
  if (hasExisting) {
    console.log(color('发现已有配置文件。', 'yellow'));
    const overwrite = await confirm(rl, '是否覆盖现有配置？', false);
    if (!overwrite) {
      console.log(color('\n配置已取消。', 'yellow'));
      rl.close();
      return;
    }
    console.log('');
  }
  
  // ============================================
  // 必需配置
  // ============================================
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(color('第一步：基本配置', 'bold'));
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log('');
  
  // Agent 名称
  const hostnameShort = hostname().split('.')[0];
  const defaultName = existingConfig.agentName || `${process.env.USER || 'user'}-${hostnameShort}`;
  let agentName = '';
  let nameAttempts = 0;
  const maxNameAttempts = 3;
  
  while (nameAttempts < maxNameAttempts) {
    const input = await question(rl, 'Agent name (used to identify in network)', defaultName);
    const validation = validateAgentName(input || defaultName);
    
    if (validation.valid) {
      agentName = input || defaultName;
      break;
    } else {
      console.log(color(`  Invalid: ${validation.error}`, 'red'));
      nameAttempts++;
      if (nameAttempts < maxNameAttempts) {
        console.log(color(`  Please try again (${maxNameAttempts - nameAttempts} attempts remaining)`, 'yellow'));
      }
    }
  }
  
  if (!agentName) {
    console.log(color('Using default name...', 'yellow'));
    agentName = defaultName;
  }
  
  // 自动启动
  console.log('');
  console.log('是否在后台自动启动 F2A daemon？');
  console.log('  - 选择"是"会在系统启动时自动运行');
  console.log('  - 选择"否"需要手动运行 f2a daemon');
  const autoStart = await confirm(rl, '自动启动', existingConfig.autoStart);
  
  // ============================================
  // 进阶配置
  // ============================================
  console.log('');
  const configureAdvanced = await confirm(rl, '是否配置进阶选项？（端口、发现等）', false);
  
  let advancedConfig = {
    controlPort: existingConfig.controlPort ?? 9001,
    p2pPort: existingConfig.p2pPort ?? 0,
    enableMDNS: existingConfig.enableMDNS ?? true,
    enableDHT: existingConfig.enableDHT ?? true,
    logLevel: existingConfig.logLevel ?? 'INFO',
  };
  
  if (configureAdvanced) {
    console.log('');
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
    console.log(color('第二步：进阶配置', 'bold'));
    console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
    console.log('');
    
    // 控制端口
    console.log(`Port range: ${MIN_PORT}-${MAX_PORT}`);
    const controlPortStr = await question(rl, 'Control port (CLI communicates with daemon)', advancedConfig.controlPort.toString());
    if (controlPortStr === '') {
      // 空输入使用默认值，不需要提示
    } else {
      const controlPort = parseInt(controlPortStr);
      if (isNaN(controlPort) || controlPort < MIN_PORT || controlPort > MAX_PORT) {
        console.log(color(`  Warning: Invalid port "${controlPortStr}". Port must be between ${MIN_PORT} and ${MAX_PORT}. Using default: ${advancedConfig.controlPort}`, 'yellow'));
      } else {
        advancedConfig.controlPort = controlPort;
      }
    }
    
    // P2P 端口
    const p2pPortStr = await question(rl, 'P2P port (0 = random assignment)', advancedConfig.p2pPort.toString());
    if (p2pPortStr === '') {
      // 空输入使用默认值，不需要提示
    } else {
      const p2pPort = parseInt(p2pPortStr);
      if (isNaN(p2pPort) || p2pPort < 0 || p2pPort > MAX_PORT) {
        console.log(color(`  Warning: Invalid port "${p2pPortStr}". Port must be between 0 and ${MAX_PORT}. Using default: ${advancedConfig.p2pPort}`, 'yellow'));
      } else {
        advancedConfig.p2pPort = p2pPort;
      }
    }
    
    // MDNS
    console.log('');
    console.log('MDNS 本地发现可以让局域网内的 Agent 自动发现彼此。');
    advancedConfig.enableMDNS = await confirm(rl, '启用 MDNS 本地发现', advancedConfig.enableMDNS);
    
    // DHT
    console.log('');
    console.log('DHT 可以帮助查找远程节点（非局域网）。');
    advancedConfig.enableDHT = await confirm(rl, '启用 DHT', advancedConfig.enableDHT);
    
    // 日志级别
    console.log('');
    const logLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
    const defaultLogLevelIndex = logLevels.indexOf(advancedConfig.logLevel);
    const selectedLogLevelIndex = await select(rl, '日志级别', logLevels, defaultLogLevelIndex >= 0 ? defaultLogLevelIndex : 1);
    advancedConfig.logLevel = logLevels[selectedLogLevelIndex] as F2AConfig['logLevel'];
  }
  
  // ============================================
  // 引导节点（可选）
  // ============================================
  console.log('');
  const configureBootstrap = await confirm(rl, '是否配置引导节点？（用于连接远程网络）', false);
  
  let bootstrapPeers: string[] = existingConfig.network?.bootstrapPeers || [];
  
  if (configureBootstrap) {
    console.log('');
    console.log('Bootstrap peers are used to connect to remote F2A networks.');
    console.log('Enter multiaddr addresses (e.g., /ip4/1.2.3.4/tcp/9000/p2p/PeerID)');
    console.log('Multiple addresses separated by commas, leave empty to skip.');
    console.log('');
    
    const peersStr = await question(rl, 'Bootstrap peers', bootstrapPeers.join(', '));
    if (peersStr) {
      const peers = peersStr.split(',').map(p => p.trim()).filter(Boolean);
      const validPeers: string[] = [];
      const invalidPeers: string[] = [];
      
      for (const peer of peers) {
        if (MULTIADDR_REGEX.test(peer)) {
          validPeers.push(peer);
        } else {
          invalidPeers.push(peer);
        }
      }
      
      if (invalidPeers.length > 0) {
        console.log(color(`  Warning: Invalid multiaddr format: ${invalidPeers.join(', ')}`, 'yellow'));
        console.log(color(`  Valid format: /ip4|ip6|dns/.../tcp|udp/PORT[/p2p/PEERID]`, 'yellow'));
      }
      
      bootstrapPeers = validPeers;
      if (validPeers.length > 0) {
        console.log(color(`  Added ${validPeers.length} valid bootstrap peer(s)`, 'green'));
      }
    }
  }
  
  // ============================================
  // 构建最终配置
  // ============================================
  const config: F2AConfig = {
    agentName,
    network: {
      bootstrapPeers,
    },
    autoStart,
    controlPort: advancedConfig.controlPort,
    p2pPort: advancedConfig.p2pPort,
    enableMDNS: advancedConfig.enableMDNS,
    enableDHT: advancedConfig.enableDHT,
    logLevel: advancedConfig.logLevel,
  };
  
  // ============================================
  // 显示摘要并确认
  // ============================================
  showSummary(config);
  
  const confirmSave = await confirm(rl, '保存配置？', true);
  
  if (confirmSave) {
    saveConfig(config);
    console.log(color('✅ 配置已保存！', 'green'));
    console.log('');
    console.log('下一步操作:');
    console.log(`  ${color('f2a daemon', 'cyan')}      # 启动 F2A daemon`);
    console.log(`  ${color('f2a status', 'cyan')}      # 查看运行状态`);
    console.log(`  ${color('f2a peers', 'cyan')}       # 查看已连接的节点`);
  } else {
    console.log(color('配置已取消。', 'yellow'));
  }
  
  rl.close();
}

/**
 * 显示配置信息
 */
export function showConfig(): void {
  const config = loadConfig();
  const path = getConfigPath();
  
  console.log('');
  console.log(color('F2A 配置', 'bold'));
  console.log(color('────────────────────────────────────────', 'blue'));
  console.log(`配置文件: ${path}`);
  console.log('');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
}