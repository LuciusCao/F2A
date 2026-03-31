/**
 * F2A Configure 命令
 * 交互式配置向导（支持首次配置和重新配置）
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
  validateMultiaddr,
} from './config.js';

// ============================================================================
// 常量
// ============================================================================

// 端口验证常量
const MIN_PORT = 1024;
const MAX_PORT = 65535;

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

// 有效的配置 key 列表（支持嵌套 key）
const VALID_CONFIG_KEYS = [
  'agentName',
  'network',
  'network.bootstrapPeers',
  'network.bootstrapPeerFingerprints',
  'autoStart',
  'controlPort',
  'p2pPort',
  'enableMDNS',
  'enableDHT',
  'logLevel',
  'dataDir',
  'security',
  'security.level',
  'security.requireConfirmation',
  'rateLimit',
  'rateLimit.maxRequests',
  'rateLimit.windowMs',
];

// 日志级别选项
const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

// Agent 名称最大尝试次数
const MAX_NAME_ATTEMPTS = 3;

// ============================================================================
// 辅助函数
// ============================================================================

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

// ============================================================================
// 显示函数
// ============================================================================

/**
 * 显示欢迎信息
 */
function showWelcome(isReconfigure: boolean): void {
  console.log('');
  console.log(color('╔════════════════════════════════════════════════╗', 'blue'));
  if (isReconfigure) {
    console.log(color('║         F2A 重新配置                           ║', 'blue'));
  } else {
    console.log(color('║         F2A 配置向导                           ║', 'blue'));
  }
  console.log(color('║         Friend-to-Agent P2P 网络               ║', 'blue'));
  console.log(color('╚════════════════════════════════════════════════╝', 'blue'));
  console.log('');
  if (isReconfigure) {
    console.log('显示当前配置值，直接回车保持原值，输入新值修改。');
  } else {
    console.log('这个向导将帮助你配置 F2A 网络。');
    console.log('只需要回答几个简单的问题即可完成配置。');
  }
  console.log('');
}

/**
 * 显示配置摘要
 */
function showSummary(config: F2AConfig, isReconfigure: boolean): void {
  console.log('');
  console.log(color('══════════════════════════════════════════════════', 'blue'));
  console.log(color(isReconfigure ? '修改后的配置' : '配置摘要', 'bold'));
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
  
  // 显示指纹验证配置
  const fingerprints = config.network.bootstrapPeerFingerprints || {};
  const fingerprintCount = Object.keys(fingerprints).length;
  if (config.network.bootstrapPeers.length > 0) {
    console.log(`${color('指纹验证:', 'cyan')}       ${fingerprintCount > 0 ? `已配置 ${fingerprintCount} 个节点` : '未配置'}`);
  }
  
  console.log('');
  console.log(`${color('配置文件:', 'cyan')}       ${getConfigPath()}`);
  console.log('');
}

/**
 * 显示保存成功后的下一步提示
 */
function showNextSteps(): void {
  console.log(color('✅ 配置已保存！', 'green'));
  console.log('');
  console.log('下一步操作:');
  console.log(`  ${color('f2a daemon', 'cyan')}      # 启动 F2A daemon`);
  console.log(`  ${color('f2a status', 'cyan')}      # 查看运行状态`);
  console.log(`  ${color('f2a peers', 'cyan')}       # 查看已连接的节点`);
}

// ============================================================================
// 配置步骤函数
// ============================================================================

interface BasicConfig {
  agentName: string;
  autoStart: boolean;
}

interface AdvancedConfig {
  controlPort: number;
  p2pPort: number;
  enableMDNS: boolean;
  enableDHT: boolean;
  logLevel: F2AConfig['logLevel'];
}

interface BootstrapConfig {
  bootstrapPeers: string[];
  bootstrapPeerFingerprints: Record<string, string>;
}

/**
 * 配置基本选项（必需配置）
 */
async function configureBasic(
  rl: readline.Interface,
  existingConfig: F2AConfig
): Promise<BasicConfig> {
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(color('第一步：基本配置', 'bold'));
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log('');
  
  // Agent 名称
  const hostnameShort = hostname().split('.')[0];
  const defaultName = existingConfig.agentName || `${process.env.USER || 'user'}-${hostnameShort}`;
  let agentName = '';
  let nameAttempts = 0;
  
  while (nameAttempts < MAX_NAME_ATTEMPTS) {
    const input = await question(rl, 'Agent name (used to identify in network)', defaultName);
    const validation = validateAgentName(input || defaultName);
    
    if (validation.valid) {
      agentName = input || defaultName;
      break;
    } else {
      console.log(color(`  Invalid: ${validation.error}`, 'red'));
      nameAttempts++;
      if (nameAttempts < MAX_NAME_ATTEMPTS) {
        console.log(color(`  Please try again (${MAX_NAME_ATTEMPTS - nameAttempts} attempts remaining)`, 'yellow'));
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
  
  return { agentName, autoStart };
}

/**
 * 配置高级选项
 */
async function configureAdvanced(
  rl: readline.Interface,
  existingConfig: F2AConfig
): Promise<AdvancedConfig> {
  const advancedConfig: AdvancedConfig = {
    controlPort: existingConfig.controlPort ?? 9001,
    p2pPort: existingConfig.p2pPort ?? 0,
    enableMDNS: existingConfig.enableMDNS ?? true,
    enableDHT: existingConfig.enableDHT ?? true,
    logLevel: existingConfig.logLevel ?? 'INFO',
  };
  
  console.log('');
  const shouldConfigureAdvanced = await confirm(rl, '是否配置进阶选项？（端口、发现等）', false);
  
  if (!shouldConfigureAdvanced) {
    return advancedConfig;
  }
  
  console.log('');
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(color('第二步：进阶配置', 'bold'));
  console.log(color('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log('');
  
  // 控制端口
  console.log(`Port range: ${MIN_PORT}-${MAX_PORT}`);
  const controlPortStr = await question(rl, 'Control port (CLI communicates with daemon)', advancedConfig.controlPort.toString());
  if (controlPortStr !== '') {
    const controlPort = parseInt(controlPortStr);
    if (isNaN(controlPort) || controlPort < MIN_PORT || controlPort > MAX_PORT) {
      console.log(color(`  Warning: Invalid port "${controlPortStr}". Port must be between ${MIN_PORT} and ${MAX_PORT}. Using default: ${advancedConfig.controlPort}`, 'yellow'));
    } else {
      advancedConfig.controlPort = controlPort;
    }
  }
  
  // P2P 端口
  const p2pPortStr = await question(rl, 'P2P port (0 = random assignment)', advancedConfig.p2pPort.toString());
  if (p2pPortStr !== '') {
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
  const defaultLogLevelIndex = LOG_LEVELS.indexOf(advancedConfig.logLevel);
  const selectedLogLevelIndex = await select(rl, '日志级别', LOG_LEVELS, defaultLogLevelIndex >= 0 ? defaultLogLevelIndex : 1);
  advancedConfig.logLevel = LOG_LEVELS[selectedLogLevelIndex] as F2AConfig['logLevel'];
  
  return advancedConfig;
}

/**
 * 配置引导节点
 */
async function configureBootstrap(
  rl: readline.Interface,
  existingConfig: F2AConfig
): Promise<BootstrapConfig> {
  let bootstrapPeers: string[] = existingConfig.network?.bootstrapPeers || [];
  let bootstrapPeerFingerprints: Record<string, string> = existingConfig.network?.bootstrapPeerFingerprints || {};
  
  console.log('');
  const shouldConfigureBootstrap = await confirm(rl, '是否配置引导节点？（用于连接远程网络）', false);
  
  if (!shouldConfigureBootstrap) {
    return { bootstrapPeers, bootstrapPeerFingerprints };
  }
  
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
      if (validateMultiaddr(peer).valid) {
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
  
  // 配置指纹验证
  if (bootstrapPeers.length > 0) {
    console.log('');
    const configureFingerprints = await confirm(rl, '是否配置引导节点指纹验证？（推荐，防止中间人攻击）', false);
    
    if (configureFingerprints) {
      console.log('');
      console.log('指纹验证可以防止中间人攻击。');
      console.log('请输入每个引导节点的预期 PeerID（从引导节点管理员处获取）。');
      console.log('留空跳过该节点的验证。');
      console.log('');
      
      for (const peer of bootstrapPeers) {
        const existingFingerprint = bootstrapPeerFingerprints[peer] || '';
        const fingerprint = await question(rl, `  ${peer.slice(0, 50)}...`, existingFingerprint);
        
        if (fingerprint) {
          bootstrapPeerFingerprints[peer] = fingerprint;
        } else {
          delete bootstrapPeerFingerprints[peer];
        }
      }
      
      const configuredCount = Object.keys(bootstrapPeerFingerprints).length;
      if (configuredCount > 0) {
        console.log(color(`  Configured fingerprints for ${configuredCount} peer(s)`, 'green'));
      }
    }
  }
  
  return { bootstrapPeers, bootstrapPeerFingerprints };
}

// ============================================================================
// 主配置流程
// ============================================================================

/**
 * 主配置流程
 */
export async function configureCommand(): Promise<void> {
  // TTY 检测：确保在交互式环境中运行
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'This command requires an interactive terminal (TTY). ' +
      'Please run "f2a configure" in a terminal.'
    );
  }
  
  const existingConfig = loadConfig();
  const hasExisting = configExists();
  
  showWelcome(hasExisting);
  
  const rl = createInterface();
  
  try {
    // 配置基本选项
    const basicConfig = await configureBasic(rl, existingConfig);
    
    // 配置高级选项
    const advancedConfig = await configureAdvanced(rl, existingConfig);
    
    // 配置引导节点
    const bootstrapConfig = await configureBootstrap(rl, existingConfig);
    
    // 构建最终配置
    const config: F2AConfig = {
      agentName: basicConfig.agentName,
      network: {
        bootstrapPeers: bootstrapConfig.bootstrapPeers,
        bootstrapPeerFingerprints: Object.keys(bootstrapConfig.bootstrapPeerFingerprints).length > 0 
          ? bootstrapConfig.bootstrapPeerFingerprints 
          : undefined,
      },
      autoStart: basicConfig.autoStart,
      controlPort: advancedConfig.controlPort,
      p2pPort: advancedConfig.p2pPort,
      enableMDNS: advancedConfig.enableMDNS,
      enableDHT: advancedConfig.enableDHT,
      logLevel: advancedConfig.logLevel,
    };
    
    // 显示摘要并确认
    showSummary(config, hasExisting);
    
    const confirmSave = await confirm(rl, '保存配置？', true);
    
    if (confirmSave) {
      saveConfig(config);
      showNextSteps();
    } else {
      console.log(color('配置已取消。', 'yellow'));
    }
  } finally {
    rl.close();
  }
}

// ============================================================================
// 配置管理命令
// ============================================================================

/**
 * 显示配置信息（用于 config list 命令）
 */
export function listConfig(): void {
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

/**
 * 获取配置项值（用于 config get 命令）
 */
export function getConfigValue(key: string): void {
  const config = loadConfig();
  
  // 支持嵌套 key，如 network.bootstrapPeers
  const keys = key.split('.');
  let value: unknown = config;
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      console.error(color(`Error: Configuration key "${key}" not found`, 'red'));
      throw new Error(`Configuration key "${key}" not found`);
    }
  }
  
  // 根据类型输出
  if (typeof value === 'string') {
    console.log(value);
  } else if (typeof value === 'boolean') {
    console.log(value ? 'true' : 'false');
  } else if (typeof value === 'number') {
    console.log(value.toString());
  } else if (value === null || value === undefined) {
    console.log('');
  } else {
    console.log(JSON.stringify(value));
  }
}

/**
 * 验证配置 key 是否有效
 */
function isValidConfigKey(key: string): boolean {
  return VALID_CONFIG_KEYS.includes(key);
}

/**
 * 根据配置项 key 解析 value 为正确类型
 */
function parseConfigValue(key: string, value: string): unknown {
  // 布尔值
  if (value === 'true') return true;
  if (value === 'false') return false;

  // 数字
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }

  // 尝试解析 JSON（用于数组、对象）
  if ((value.startsWith('[') && value.endsWith(']')) ||
      (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value);
    } catch {
      // 解析失败，显示警告并抛出错误
      console.warn(color(`⚠️  Warning: Invalid JSON format for key "${key}": ${value}`, 'yellow'));
      console.warn(color(`    The value looks like JSON but failed to parse. Please check your syntax.`, 'yellow'));
      throw new Error(`Invalid JSON format for configuration value: ${value}`);
    }
  }

  // 默认字符串
  return value;
}

/**
 * 设置配置项值（用于 config set 命令）
 */
export function setConfigValue(key: string, value: string): void {
  // 验证 key 有效性
  if (!isValidConfigKey(key)) {
    console.error(color(`Error: Invalid configuration key "${key}"`, 'red'));
    console.error(color(`Valid keys are: ${VALID_CONFIG_KEYS.join(', ')}`, 'yellow'));
    throw new Error(`Invalid configuration key: ${key}`);
  }
  
  const config = loadConfig();
  
  // 支持嵌套 key
  const keys = key.split('.');
  
  // 根据 key 推断类型并转换 value
  const typedValue = parseConfigValue(key, value);
  
  // 深度设置值
  let target: Record<string, unknown> = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!(k in target) || typeof target[k] !== 'object' || target[k] === null) {
      target[k] = {};
    }
    target = target[k] as Record<string, unknown>;
  }
  
  target[keys[keys.length - 1]] = typedValue;
  
  // 验证并保存
  try {
    saveConfig(config as F2AConfig);
    console.log(color(`✅ Configuration updated: ${key} = ${JSON.stringify(typedValue)}`, 'green'));
  } catch (error) {
    console.error(color(`Error: Failed to save configuration - ${error instanceof Error ? error.message : String(error)}`, 'red'));
    throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
