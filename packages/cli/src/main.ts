#!/usr/bin/env node
/**
 * F2A CLI 入口 - 命令路由器
 * 
 * Phase 1 修复：重写为命令路由器，导入并调用各模块函数
 * 
 * 命令结构：
 * - f2a agent <subcommand>  -> agents.ts
 * - f2a message <subcommand> -> messages.ts
 * - f2a daemon <subcommand>  -> daemon.ts
 * - f2a identity <subcommand> -> identity.ts
 * - f2a status              -> GET /status
 * - f2a peers               -> GET /peers
 * - f2a health              -> GET /health
 */

// CLI 静默模式：禁用内部日志输出到终端
// 用户可通过 F2A_DEBUG=1 启用调试日志
if (process.env.F2A_DEBUG !== '1') {
  process.env.F2A_LOG_LEVEL = 'ERROR';
  process.env.F2A_CONSOLE = 'false';
}

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendRequest } from './http-client.js';
import { listAgents, registerAgent, unregisterAgent, updateAgent } from './agents.js';
import { sendMessage, getMessages, clearMessages } from './messages.js';
import { startForeground, startBackground, stopDaemon, restartDaemon, showStatus } from './daemon.js';
import { showIdentityStatus, exportIdentity, importIdentityInternal, initIdentity } from './identity.js';
import { cliInitAgent, showAgentStatus } from './init.js';

// ESM 环境下获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 获取版本号
 */
function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.9.0';
  } catch {
    return '0.9.0';
  }
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
F2A CLI v${getVersion()} - Friend-to-Agent P2P Network

Usage: f2a <command> [options]

Commands:
  init       初始化 F2A 节点身份 [--force 强制重新创建]
             创建 Node Identity 和基础配置文件

  agent      管理 Agent 身份和注册
    init              生成 Agent 密钥对和身份文件
                       --name <name> --webhook <url> [--capability <cap>]... [--force]
                       自动保存到 ~/.f2a/agent-identities/
    register          注册 Agent 到 Daemon
                       --agent-id <agentId> [--force]
                       获取 Node 签发的归属证明
    list              列出已注册的 Agent
    unregister        注销 Agent
                       --agent-id <agentId>
    status            查看 Agent 身份状态
                       --agent-id <agentId>

  message    消息管理
    send              发送消息
                       --agent-id <agentId> [--to <agentId>] [--type <type>] "content"
                       使用签名认证
    list              查看消息 --agent-id <agentId> [--unread] [--limit <n>]
    clear             清除消息 --agent-id <agentId>

  daemon     Daemon 管理
    start             启动 Daemon (后台)
    stop              停止 Daemon
    restart           重启 Daemon
    status            查看 Daemon 状态
    foreground        前台启动 Daemon

  identity   身份管理
    status            查看身份状态
    export [file]     导出身份到文件
    import <file>     从文件导入身份

  status     查看系统状态
  peers      查看 P2P peers
  health     健康检查
  discover   发现 Agent [--capability <能力>]

  --help     显示帮助
  --version  显示版本
`);
}

/**
 * 显示 agent 子命令帮助
 */
function showAgentHelp(): void {
  console.log(`
F2A Agent 管理

Usage: f2a agent <subcommand> [options]

Subcommands:
  init              生成 Agent 密钥对和身份文件
                    f2a agent init --name <name> --webhook <url> [--capability <cap>]... [--force]
                    --name            Agent 名称（必填）
                    --webhook         Webhook URL（必填，用于接收消息）
                    --capability      能力标签（可多个）
                    --force           强制重新创建
                    身份文件自动保存到 ~/.f2a/agent-identities/

  register          注册 Agent 到 Daemon（获取 Node 签名）
                    f2a agent register --agent-id <agentId> [--force]
                    发送公钥到 Daemon，获取 Node 签名

  list              列出已注册的 Agent
                    f2a agent list

  unregister        注销 Agent
                    f2a agent unregister <agent_id> --agent-id <agentId>

  status            查看 Agent 身份状态
                    f2a agent status --agent-id <agentId>

  verify            验证 Agent（Challenge-Response）
                    f2a agent verify <agent_id>

Examples:
  # 创建身份
  f2a agent init --name "my-agent" --webhook http://localhost:3000/f2a/webhook
  
  # 注册到 Daemon（使用生成的 agentId）
  f2a agent register --agent-id agent:abc123...
  
  # 查看状态
  f2a agent status --agent-id agent:abc123...
  
  # 发送消息
  f2a message send --agent-id agent:abc123... --to agent:xyz789... "hello"
`);
}

/**
 * 显示 message 子命令帮助
 */
function showMessageHelp(): void {
  console.log(`
F2A 消息管理

Usage: f2a message <subcommand> [options]

Subcommands:
  send              发送消息到 Agent
                    f2a message send --agent-id <agentId> --to <agent_id> [--type <type>] "content"
                    --agent-id        Agent ID（必填）
                    --to              接收方 Agent ID（可选，不提供则广播）
                    --type            消息类型：message, task_request, task_response, announcement, claim

  list              查看消息队列
                    f2a message list --agent-id <agentId> [--unread] [--limit <n>]
                    --unread  只显示未读消息
                    --limit   限制数量

  clear             清除消息
                    f2a message clear --agent-id <agentId>

Examples:
  f2a message send --agent-id agent:abc123... --to agent:xyz789... "Hello"
  f2a message send --agent-id agent:abc123... "Broadcast message"
  f2a message list --agent-id agent:abc123... --unread
`);
}

/**
 * 显示 daemon 子命令帮助
 */
function showDaemonHelp(): void {
  console.log(`
F2A Daemon 管理

Usage: f2a daemon <subcommand> [options]

Subcommands:
  start             后台启动 Daemon
                    f2a daemon start

  stop              停止 Daemon
                    f2a daemon stop

  restart           重启 Daemon（先停止再启动）
                    f2a daemon restart

  status            查看 Daemon 状态
                    f2a daemon status

  foreground        前台启动 Daemon（用于调试）
                    f2a daemon foreground

Examples:
  f2a daemon start
  f2a daemon status
  f2a daemon stop
  f2a daemon restart
`);
}

/**
 * 显示 identity 子命令帮助
 */
function showIdentityHelp(): void {
  console.log(`
F2A 身份管理

Usage: f2a identity <subcommand> [options]

Subcommands:
  status            查看身份状态
                    f2a identity status

  export [file]     导出身份到文件（用于备份/迁移）
                    f2a identity export [output_file.json]

  import <file>     从文件导入身份（用于恢复/迁移）
                    f2a identity import <input_file.json>

Examples:
  f2a identity status
  f2a identity export ./backup.json
  f2a identity import ./backup.json
`);
}

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): Record<string, string | string[] | boolean> {
  const result: Record<string, string | string[] | boolean> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        const value = args[i + 1];
        // 处理重复参数（如 --capability）
        if (result[key] !== undefined) {
          if (Array.isArray(result[key])) {
            (result[key] as string[]).push(value);
          } else {
            result[key] = [result[key] as string, value];
          }
        } else {
          result[key] = value;
        }
        i += 2;
      } else {
        result[key] = true;
        i += 1;
      }
    } else {
      // 非选项参数作为 'content' 或 positional
      if (result.content !== undefined) {
        // 如果已有 content，忽略
      } else {
        result.content = arg;
      }
      i += 1;
    }
  }

  return result;
}

/**
 * Agent 命令处理
 */
async function handleAgentCommand(subArgs: string[]): Promise<void> {
  if (subArgs.length === 0 || subArgs[0] === '--help' || subArgs[0] === '-h') {
    showAgentHelp();
    return;
  }

  const subcommand = subArgs[0];
  const restArgs = subArgs.slice(1);

  switch (subcommand) {
    case 'init':
      const initOpts = parseArgs(restArgs);
      const initWebhook = initOpts.webhook as string | undefined;
      if (!initWebhook) {
        console.error('❌ 缺少 --webhook 参数');
        console.error('Agent 需要 webhook URL 来接收消息');
        console.error('用法: f2a agent init --name <name> --webhook <url>');
        process.exit(1);
      }
      await cliInitAgent({
        name: initOpts.name as string,
        webhook: initWebhook,
        capabilities: Array.isArray(initOpts.capability)
          ? initOpts.capability as string[]
          : initOpts.capability
            ? [initOpts.capability as string]
            : undefined,
        force: initOpts.force as boolean,
      });
      break;

    case 'register':
      const registerOpts = parseArgs(restArgs);
      await registerAgent({
        agentId: registerOpts['agent-id'] as string,
        force: registerOpts.force as boolean,
      });
      break;

    case 'list':
      await listAgents();
      break;

    case 'unregister':
      const unregisterOpts = parseArgs(restArgs);
      const unregisterAgentId = unregisterOpts['agent-id'] as string;
      if (!unregisterAgentId) {
        console.error('❌ 缺少 --agent-id 参数');
        console.error('用法: f2a agent unregister --agent-id <agentId>');
        process.exit(1);
      }
      await unregisterAgent(unregisterAgentId);
      break;

    case 'status':
      const statusOpts = parseArgs(restArgs);
      await showAgentStatus(statusOpts['agent-id'] as string);
      break;

    default:
      console.error(`❌ 未知的 agent 子命令：${subcommand}`);
      showAgentHelp();
      process.exit(1);
  }
}

/**
 * Message 命令处理
 */
async function handleMessageCommand(subArgs: string[]): Promise<void> {
  if (subArgs.length === 0 || subArgs[0] === '--help' || subArgs[0] === '-h') {
    showMessageHelp();
    return;
  }

  const subcommand = subArgs[0];
  const restArgs = subArgs.slice(1);

  switch (subcommand) {
    case 'send':
      const sendOpts = parseArgs(restArgs);
      await sendMessage({
        agentId: sendOpts['agent-id'] as string,
        toAgentId: sendOpts.to as string | undefined,
        content: sendOpts.content as string,
        type: sendOpts.type as 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim' | undefined,
      });
      break;

    case 'list':
      const listOpts = parseArgs(restArgs);
      await getMessages({
        agentId: listOpts['agent-id'] as string,
        unread: listOpts.unread as boolean,
        limit: listOpts.limit ? parseInt(listOpts.limit as string, 10) : undefined,
      });
      break;

    case 'clear':
      const clearOpts = parseArgs(restArgs);
      await clearMessages({
        agentId: clearOpts['agent-id'] as string,
      });
      break;

    default:
      console.error(`❌ 未知的 message 子命令：${subcommand}`);
      showMessageHelp();
      process.exit(1);
  }
}

/**
 * Daemon 命令处理
 */
async function handleDaemonCommand(subArgs: string[]): Promise<void> {
  if (subArgs.length === 0 || subArgs[0] === '--help' || subArgs[0] === '-h') {
    showDaemonHelp();
    return;
  }

  const subcommand = subArgs[0];

  switch (subcommand) {
    case 'start':
      await startBackground();
      break;

    case 'stop':
      await stopDaemon();
      break;

    case 'restart':
      await restartDaemon();
      break;

    case 'status':
      await showStatus();
      break;

    case 'foreground':
      await startForeground();
      break;

    default:
      console.error(`❌ 未知的 daemon 子命令：${subcommand}`);
      showDaemonHelp();
      process.exit(1);
  }
}

/**
 * Identity 命令处理
 */
async function handleIdentityCommand(subArgs: string[]): Promise<void> {
  if (subArgs.length === 0 || subArgs[0] === '--help' || subArgs[0] === '-h') {
    showIdentityHelp();
    return;
  }

  const subcommand = subArgs[0];
  const restArgs = subArgs.slice(1);

  switch (subcommand) {
    case 'status':
      await showIdentityStatus();
      break;

    case 'export':
      const outputPath = restArgs[0];
      await exportIdentity(outputPath);
      break;

    case 'import':
      const inputPath = restArgs[0];
      if (!inputPath) {
        console.error('❌ 错误：缺少导入文件路径');
        console.error('用法：f2a identity import <file.json>');
        process.exit(1);
      }
      const result = await importIdentityInternal(inputPath);
      if (result.success) {
        const data = result.data;
        console.log(`✅ 导入完成`);
        if (data.nodeImported) {
          console.log('   Node Identity: ✅ 已导入');
        }
        if (data.agentImported) {
          console.log('   Agent Identity: ✅ 已导入');
        }
        if (data.warnings.length > 0) {
          console.log('');
          console.log('⚠️  警告:');
          data.warnings.forEach(w => console.log(`   - ${w}`));
        }
        if (data.agentConfirmation) {
          console.log('');
          console.log('⚠️  Agent 导入需要确认:');
          console.log(`   ${data.agentConfirmation.reason}`);
          console.log('   使用 --force 参数强制导入');
        }
      } else {
        console.error(`❌ 导入失败：${result.error?.message}`);
        process.exit(1);
      }
      break;

    default:
      console.error(`❌ 未知的 identity 子命令：${subcommand}`);
      showIdentityHelp();
      process.exit(1);
  }
}

/**
 * 获取系统状态（GET /status）
 */
async function handleStatus(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/status');

    if (result.success) {
      console.log('=== F2A 系统状态 ===');
      console.log('');
      const peerId = result.peerId as string | undefined;
      console.log(`Node ID: ${peerId?.slice(0, 16) || 'N/A'}...`);
      if (result.multiaddrs) {
        console.log(`Multiaddrs: ${(result.multiaddrs as string[]).join(', ')}`);
      }
      if (result.agentInfo) {
        console.log('');
        console.log('Agent Info:');
        const info = result.agentInfo as { displayName?: string; nodeId?: string };
        console.log(`  Name: ${info.displayName || 'N/A'}`);
        console.log(`  Node ID: ${info.nodeId?.slice(0, 8) || 'N/A'}...`);
      }
    } else {
      console.error(`❌ 获取状态失败：${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 获取 Peers（GET /peers）
 */
async function handlePeers(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/peers');

    if (Array.isArray(result)) {
      // GET /peers 返回 peer 数组
      const peers = result as Array<{ peerId?: string; id?: string; connected?: boolean; multiaddrs?: string[] }>;
      if (peers.length === 0) {
        console.log('⚪ 没有连接的 Peers');
      } else {
        console.log(`=== P2P Peers (${peers.length}) ===`);
        console.log('');
        for (const peer of peers) {
          const status = peer.connected ? '🟢 已连接' : '⚪ 已断开';
          console.log(`${status} ${peer.peerId?.slice(0, 16) || peer.id?.slice(0, 16) || 'N/A'}...`);
          if (peer.multiaddrs && peer.multiaddrs.length > 0) {
            console.log(`   地址: ${peer.multiaddrs[0]}`);
          }
        }
      }
    } else if (result.success && result.peers) {
      const peers = result.peers as Array<{ peerId?: string; id?: string }>;
      if (peers.length === 0) {
        console.log('⚪ 没有连接的 Peers');
      } else {
        console.log(`=== P2P Peers (${peers.length}) ===`);
        console.log('');
        for (const peer of peers) {
          console.log(`🟢 ${peer.peerId?.slice(0, 16) || peer.id?.slice(0, 16) || 'N/A'}...`);
        }
      }
    } else {
      console.error(`❌ 获取 Peers 失败：${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 F2A Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 健康检查（GET /health）
 */
async function handleHealth(): Promise<void> {
  try {
    const result = await sendRequest('GET', '/health');

    if (result.success) {
      console.log('✅ Daemon 健康');
      const peerId = result.peerId as string | undefined;
      console.log(`   Node ID: ${peerId?.slice(0, 16) || 'N/A'}...`);
    } else {
      console.log('❌ Daemon 不健康');
      process.exit(1);
    }
  } catch {
    console.log('❌ 无法连接到 F2A Daemon');
    process.exit(1);
  }
}

/**
 * 发现 Agent（POST /control {action: 'discover'}）
 */
async function handleDiscover(capability?: string): Promise<void> {
  try {
    const result = await sendRequest('POST', '/control', {
      action: 'discover',
      capability
    }) as { success: boolean; agents?: Array<{
      displayName?: string;
      agentId?: string;
      peerId?: string;
      capabilities?: Array<{ name: string }>;
      agentType?: string;
    }>; error?: string };

    if (result.success && result.agents) {
      const agents = result.agents;
      if (agents.length === 0) {
        console.log('🔍 没有发现 Agent');
        if (capability) {
          console.log(`   搜索能力: ${capability}`);
        }
        return;
      }

      console.log(`🔍 发现 ${agents.length} 个 Agent${capability ? ` (能力: ${capability})` : ''}:`);
      console.log('');
      
      for (const agent of agents) {
        const displayName = agent.displayName || agent.agentId?.slice(0, 24) || 'Unknown';
        const peerId = agent.peerId?.slice(0, 16) || 'N/A';
        const capabilities = agent.capabilities?.map(c => c.name).join(', ') || 'N/A';
        
        console.log(`  📦 ${displayName}`);
        console.log(`     Agent ID: ${agent.agentId || 'N/A'}`);
        console.log(`     Node ID: ${peerId}...`);
        console.log(`     Capabilities: ${capabilities}`);
        console.log(`     Agent Type: ${agent.agentType || 'N/A'}`);
        console.log('');
      }
    } else {
      console.log('❌ 发现失败：', result.error || 'Unknown error');
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 无法连接到 Daemon：${message}`);
    console.error('请确保 Daemon 正在运行：f2a daemon start');
    process.exit(1);
  }
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 无参数或 --help 显示帮助
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  // --version 显示版本
  if (args[0] === '--version' || args[0] === '-v') {
    console.log(getVersion());
    return;
  }

  const command = args[0];
  const subArgs = args.slice(1);

  try {
    switch (command) {
      case 'agent':
        await handleAgentCommand(subArgs);
        break;

      case 'message':
        await handleMessageCommand(subArgs);
        break;

      case 'messages':
        // 兼容旧命令
        await handleMessageCommand(subArgs.length > 0 ? ['list', ...subArgs] : ['list']);
        break;

      case 'daemon':
        await handleDaemonCommand(subArgs);
        break;

      case 'identity':
        await handleIdentityCommand(subArgs);
        break;

      case 'status':
        await handleStatus();
        break;

      case 'peers':
        await handlePeers();
        break;

      case 'health':
        await handleHealth();
        break;

      case 'discover':
        // f2a discover [--capability <cap>]
        const capabilityArg = subArgs.find(arg => arg.startsWith('--capability'));
        const capability = capabilityArg 
          ? (capabilityArg.includes('=') ? capabilityArg.split('=')[1] : subArgs[subArgs.indexOf('--capability') + 1])
          : undefined;
        await handleDiscover(capability);
        break;

      // 向后兼容的旧命令
      case 'send':
        // f2a send --to <peer_id> "content" -> P2P send (deprecated)
        console.error('⚠️  f2a send 命令已废弃，请使用:');
        console.error('   f2a message send --agent-id <agentId> --to <agent_id> "content"');
        process.exit(1);
        break;

      case 'init':
        await initIdentity({ force: subArgs.includes('--force') });
        break;

      case 'start':
        // 向后兼容
        await startBackground();
        break;

      case 'stop':
        // 向后兼容
        await stopDaemon();
        break;

      default:
        console.error(`❌ 未知的命令：${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    // 错误已在各命令中处理，这里只捕获未处理的错误
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ 执行失败：${message}`);
    process.exit(1);
  }
}

main();