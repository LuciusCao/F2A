#!/usr/bin/env node
/**
 * F2A CLI 入口 - 命令路由器
 * 
 * Phase 1 修复：重写为命令路由器，导入并调用各模块函数
 * 
 * 命令结构：
 * - f2a node <subcommand>    -> node.ts (init, status, peers, health, discover)
 * - f2a agent <subcommand>   -> agents.ts
 * - f2a message <subcommand> -> messages.ts
 * - f2a daemon <subcommand>  -> daemon.ts
 * - f2a identity <subcommand> -> identity.ts
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
import { listAgents, registerAgent, unregisterAgent, updateAgent } from './agents.js';
import { sendMessage, getMessages, clearMessages } from './messages.js';
import { startForeground, startBackground, stopDaemon, restartDaemon, showStatus } from './daemon.js';
import { showIdentityStatus, exportIdentity, importIdentityInternal } from './identity.js';
import { cliInitAgent, showAgentStatus } from './init.js';
import { nodeInit, nodeStatus, nodePeers, nodeHealth, nodeDiscover } from './node.js';
import { setJsonMode, isJsonMode, outputError } from './output.js';

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
  node       P2P node management (init, status, peers, health, discover)

  agent      Agent management (init, register, list, unregister, status, update)
  message    Message management (send, list, clear)
  daemon     Daemon management (start, stop, restart, status, foreground)
  identity   Identity management (status, export, import)

Global Options:
  --json     Output results in JSON format
  --help     Show help
  --version  Show version
`);
}

/**
 * 显示 agent 子命令帮助
 */
function showAgentHelp(): void {
  console.log(`
F2A Agent Management

Usage: f2a agent <subcommand> [options]

Subcommands:
  init              Create Agent keypair and identity file
                    f2a agent init --name <name> --webhook <url> [--capability <cap>]... [--force]
                    --name            Agent name (required)
                    --webhook         Webhook URL (required, for receiving messages)
                    --capability      Capability tags (multiple allowed)
                    --force           Force re-creation
                    Identity file saved to ~/.f2a/agent-identities/

  register          Register Agent to Daemon (get Node signature)
                    f2a agent register --agent-id <agentId> [--force]
                    Send public key to Daemon, receive Node signature

  list              List registered Agents
                    f2a agent list

  unregister        Unregister Agent
                    f2a agent unregister --agent-id <agentId>

  status            View Agent identity status
                    f2a agent status --agent-id <agentId>

  update            Update Agent configuration
                    f2a agent update --agent-id <agentId> [--webhook <url>] [--name <name>]
                    Re-register required after webhook or name changes

  verify            Verify Agent (Challenge-Response)
                    f2a agent verify --agent-id <agentId>

Examples:
  # Create identity
  f2a agent init --name "my-agent" --webhook http://localhost:3000/f2a/webhook
  
  # Register to Daemon
  f2a agent register --agent-id agent:abc123...
  
  # View status
  f2a agent status --agent-id agent:abc123...
  
  # Send message
  f2a message send --agent-id agent:abc123... --to agent:xyz789... "hello"
`);
}

/**
 * 显示 message 子命令帮助
 */
function showMessageHelp(): void {
  console.log(`
F2A Message Management

Usage: f2a message <subcommand> [options]

Subcommands:
  send              Send message to Agent
                    f2a message send --agent-id <agentId> --to <agent_id> [--type <type>] "content"
                    --agent-id        Agent ID (required)
                    --to              Recipient Agent ID (optional, broadcasts if omitted)
                    --type            Message type: message, task_request, task_response, announcement, claim

  list              View message queue
                    f2a message list --agent-id <agentId> [--unread] [--limit <n>]
                    --unread  Show only unread messages
                    --limit   Limit count

  clear             Clear messages
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
F2A Daemon Management

Usage: f2a daemon <subcommand> [options]

Subcommands:
  start             Start Daemon in background
                    f2a daemon start

  stop              Stop Daemon
                    f2a daemon stop

  restart           Restart Daemon (stop then start)
                    f2a daemon restart

  status            View Daemon status
                    f2a daemon status

  foreground        Start Daemon in foreground (for debugging)
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
F2A Identity Management

Usage: f2a identity <subcommand> [options]

Subcommands:
  status            View identity status
                    f2a identity status

  export [file]     Export identity to file (for backup/migration)
                    f2a identity export [output_file.json]

  import <file>     Import identity from file (for recovery/migration)
                    f2a identity import <input_file.json>

Examples:
  f2a identity status
  f2a identity export ./backup.json
  f2a identity import ./backup.json
`);
}

/**
 * Show node subcommand help
 */
function showNodeHelp(): void {
  console.log(`
F2A Node Management

Usage: f2a node <subcommand> [options]

Subcommands:
  init        Initialize node identity
              f2a node init [--force]
              --force    Force re-initialization, overwrite existing identity

  status      Show node status
              f2a node status
              Displays node ID, multiaddrs, and system info

  peers       List connected P2P peers
              f2a node peers
              Shows all connected peers with their status

  health      Health check
              f2a node health
              Verifies daemon is running and healthy

  discover    Discover agents on the network
              f2a node discover [--capability <cap>]
              --capability    Filter by capability (optional)

Examples:
  f2a node init
  f2a node status
  f2a node peers
  f2a node discover --capability chat
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
        console.error('❌ Missing --webhook parameter');
        console.error('Agent requires a webhook URL to receive messages');
        console.error('Usage: f2a agent init --name <name> --webhook <url>');
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
        console.error('❌ Missing --agent-id parameter');
        console.error('Usage: f2a agent unregister --agent-id <agentId>');
        process.exit(1);
      }
      await unregisterAgent(unregisterAgentId);
      break;

    case 'status':
      const statusOpts = parseArgs(restArgs);
      await showAgentStatus(statusOpts['agent-id'] as string);
      break;

    case 'update':
      const updateOpts = parseArgs(restArgs);
      const updateAgentId = updateOpts['agent-id'] as string;
      if (!updateAgentId) {
        console.error('❌ Missing --agent-id parameter');
        console.error('Usage: f2a agent update --agent-id <agentId> [--webhook <url>] [--name <name>]');
        process.exit(1);
      }
      await updateAgent({
        agentId: updateAgentId,
        webhook: updateOpts.webhook as string | undefined,
        name: updateOpts.name as string | undefined,
      });
      break;

    default:
      console.error(`❌ Unknown agent subcommand: ${subcommand}`);
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
      console.error(`❌ Unknown message subcommand: ${subcommand}`);
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
      console.error(`❌ Unknown daemon subcommand: ${subcommand}`);
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
        console.error('❌ Error: Missing import file path');
        console.error('Usage: f2a identity import <file.json>');
        process.exit(1);
      }
      const result = await importIdentityInternal(inputPath);
      if (result.success) {
        const data = result.data;
        console.log(`✅ Import complete`);
        if (data.nodeImported) {
          console.log('   Node Identity: ✅ imported');
        }
        if (data.agentImported) {
          console.log('   Agent Identity: ✅ imported');
        }
        if (data.warnings.length > 0) {
          console.log('');
          console.log('⚠️  Warnings:');
          data.warnings.forEach(w => console.log(`   - ${w}`));
        }
        if (data.agentConfirmation) {
          console.log('');
          console.log('⚠️  Agent import requires confirmation:');
          console.log(`   ${data.agentConfirmation.reason}`);
          console.log('   Use --force to force import');
        }
      } else {
        console.error(`❌ Import failed: ${result.error?.message}`);
        process.exit(1);
      }
      break;

    default:
      console.error(`❌ Unknown identity subcommand: ${subcommand}`);
      showIdentityHelp();
      process.exit(1);
  }
}

/**
 * Node command handler
 */
async function handleNodeCommand(subArgs: string[]): Promise<void> {
  if (subArgs.length === 0 || subArgs[0] === '--help' || subArgs[0] === '-h') {
    showNodeHelp();
    return;
  }

  const subcommand = subArgs[0];
  const restArgs = subArgs.slice(1);

  switch (subcommand) {
    case 'init':
      await nodeInit({ force: restArgs.includes('--force') });
      break;

    case 'status':
      await nodeStatus();
      break;

    case 'peers':
      await nodePeers();
      break;

    case 'health':
      await nodeHealth();
      break;

    case 'discover':
      // f2a node discover [--capability <cap>]
      const capabilityArg = restArgs.find(arg => arg.startsWith('--capability'));
      const capability = capabilityArg 
        ? (capabilityArg.includes('=') ? capabilityArg.split('=')[1] : restArgs[restArgs.indexOf('--capability') + 1])
        : undefined;
      await nodeDiscover(capability);
      break;

    default:
      console.error(`Unknown node subcommand: ${subcommand}`);
      showNodeHelp();
      process.exit(1);
  }
}

/**
 * 主入口
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Detect and extract --json global flag
  const jsonFlagIndex = args.indexOf('--json');
  if (jsonFlagIndex !== -1) {
    setJsonMode(true);
    args.splice(jsonFlagIndex, 1); // Remove --json from args
  }

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
      case 'node':
        await handleNodeCommand(subArgs);
        break;

      case 'agent':
        await handleAgentCommand(subArgs);
        break;

      case 'message':
        await handleMessageCommand(subArgs);
        break;

      case 'daemon':
        await handleDaemonCommand(subArgs);
        break;

      case 'identity':
        await handleIdentityCommand(subArgs);
        break;

      default:
        if (isJsonMode()) {
          outputError(`Unknown command: ${command}`, 'UNKNOWN_COMMAND');
        } else {
          console.error(`❌ Unknown command: ${command}`);
          showHelp();
          process.exit(1);
        }
    }
  } catch (err) {
    // Errors handled in each command, this catches unhandled errors
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(message, 'EXECUTION_ERROR');
    } else {
      console.error(`❌ Execution failed: ${message}`);
      process.exit(1);
    }
  }
}

main();