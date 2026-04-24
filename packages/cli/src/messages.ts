/**
 * F2A CLI - Message Commands
 * f2a message send / list / clear
 * 
 * Challenge-Response Signature Authentication
 * - Find local identity file by agentId
 * - Get challenge via /api/v1/challenge
 * - Sign and get temporary agentToken via /api/v1/challenge/verify
 * - Send message using agentToken
 */

import { sendRequest } from './http-client.js';
import { readIdentityByAgentId } from './init.js';
import type { AgentIdentityFile, Challenge, ChallengeResponse } from '@f2a/network';
import { signChallenge } from '@f2a/network';
import { isJsonMode, outputJson, outputError } from './output.js';

/**
 * Get temporary Agent Token via Challenge-Response
 * 
 * Flow:
 * 1. POST /api/v1/challenge to get challenge
 * 2. Sign challenge with private key
 * 3. POST /api/v1/challenge/verify to verify and get agentToken
 */
async function getAgentTokenViaChallenge(
  identity: AgentIdentityFile,
  toAgentId?: string
): Promise<string | undefined> {
  // 1. Request challenge
  const challengeResult = await sendRequest('POST', '/api/v1/challenge', {
    agentId: identity.agentId,
    operation: 'send_message',
    targetAgentId: toAgentId,
  });

  if (!challengeResult.success || !challengeResult.challenge) {
    if (isJsonMode()) {
      outputError('Failed to get challenge from server', 'CHALLENGE_FAILED');
    } else {
      console.error('❌ Error: Failed to get challenge from server.', challengeResult.error);
    }
    return undefined;
  }

  const challenge = challengeResult.challenge as Challenge;

  // 2. Sign challenge
  const response: ChallengeResponse = signChallenge(challenge, identity.privateKey);

  // 3. Verify challenge and get token
  const verifyResult = await sendRequest('POST', '/api/v1/challenge/verify', {
    agentId: identity.agentId,
    challenge,
    response,
  });

  if (!verifyResult.success || !verifyResult.agentToken) {
    if (isJsonMode()) {
      outputError('Challenge verification failed', 'CHALLENGE_VERIFY_FAILED');
    } else {
      console.error('❌ Error: Challenge verification failed.', verifyResult.error);
    }
    return undefined;
  }

  return verifyResult.agentToken as string;
}

/**
 * Send message
 * f2a message send --agent-id <agentId> --to <agentId> [--type <type>] [--expect-reply] [--reason <text>] <content>
 *
 * RFC 012: Self-send protection
 * - If --agent-id equals --to (self-send), --expect-reply is FORBIDDEN
 * - This prevents infinite message loops
 *
 * RFC 013: Safe by default
 * - Default noReply=true (don't expect reply)
 * - Use --expect-reply to explicitly request a reply
 * - Use --reason to provide optional reason for noReply
 */
export async function sendMessage(options: {
  /** Agent ID (required) */
  agentId: string;
  toAgentId?: string;
  content: string;
  type?: 'message' | 'task_request' | 'task_response' | 'announcement' | 'claim';
  metadata?: Record<string, unknown>;
  /** RFC 012: Mark message as not expecting reply (deprecated, use expectReply instead) */
  noReply?: boolean;
  /** RFC 013: Explicitly declare expecting a reply (sets noReply=false) */
  expectReply?: boolean;
  /** RFC 013: Optional reason for not expecting reply (stored in metadata.noReplyReason) */
  reason?: string;
}): Promise<void> {
  const { agentId, toAgentId, content, type, metadata, noReply, expectReply, reason } = options;

  if (!agentId) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --agent-id', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required --agent-id parameter.');
      console.error('Usage: f2a message send --agent-id <agentId> --to <agentId> "content"');
      process.exit(1);
    }
    return;
  }

  if (!content) {
    if (isJsonMode()) {
      outputError('Missing required parameter: message content', 'MISSING_CONTENT');
    } else {
      console.error('❌ Error: Missing message content.');
      console.error('Usage: f2a message send --agent-id <agentId> --to <agentId> "content"');
      process.exit(1);
    }
    return;
  }

  // RFC 013: Self-send protection (updated from RFC 012)
  // If agentId equals toAgentId and expectReply is true, reject to prevent infinite loops
  // Self-send always uses noReply=true, so expecting a reply is forbidden
  if (toAgentId && agentId === toAgentId && expectReply) {
    if (isJsonMode()) {
      outputError(
        'Self-send cannot expect reply (would cause infinite loop). You used --expect-reply, but self-send always uses noReply=true',
        'SELF_SEND_EXPECT_REPLY_FORBIDDEN'
      );
    } else {
      console.error('❌ Error: Self-send cannot expect reply (would cause infinite loop).');
      console.error('   You used --expect-reply, but self-send always uses noReply=true.');
      console.error('');
      console.error('   Self-send is allowed only for loopback testing without expecting a response.');
      console.error('');
      console.error('   Example (loopback test):');
      console.error('   f2a message send --agent-id agent:abc123 --to agent:abc123 "ping test"');
      process.exit(1);
    }
    return;
  }

  const identity = readIdentityByAgentId(agentId);

  if (!identity) {
    if (isJsonMode()) {
      outputError('Cannot find identity file for the specified agent', 'AGENT_NOT_FOUND');
      return;
    }
    console.error('❌ Error: Cannot find identity file for the specified agent.');
    console.error(`   AgentId: ${agentId}`);
    console.error('Please run: f2a agent init --name <name> --webhook <url>');
    process.exit(1);
  }

  try {
    // Get temporary Agent Token via Challenge-Response
    const agentToken = await getAgentTokenViaChallenge(identity, toAgentId);

    if (!agentToken) {
      if (isJsonMode()) {
        outputError('Failed to obtain Agent Token. Message send failed', 'TOKEN_FAILED');
        return;
      }
      console.error('❌ Error: Failed to obtain Agent Token. Message send failed.');
      console.error('Hint: Please ensure the Agent is registered and the Daemon is running.');
      process.exit(1);
    }

    // RFC 013: Calculate noReply based on expectReply
    // Safe by default: noReply=true (don't expect reply)
    // If expectReply=true, then noReply=false (expecting a reply)
    // If expectReply is not set, noReply=true (default, safe)
    // If noReply is explicitly set (legacy), respect it
    const actualNoReply = noReply !== undefined ? noReply : !expectReply;

    // RFC 012/013: Include noReply in payload
    // RFC 013: Include noReplyReason at top level (not in metadata)
    const messagePayload = {
      fromAgentId: agentId,
      toAgentId,
      content,
      type: type || 'message',
      metadata,
      noReply: actualNoReply,
      noReplyReason: reason,
    };

    const result = await sendRequest(
      'POST',
      '/api/v1/messages',
      messagePayload,
      { Authorization: agentToken }
    );

    handleSendResult(result, agentId, toAgentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Cannot connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
      return;
    }
    console.error(`❌ Error: Cannot connect to Daemon: ${message}`);
    console.error('Please ensure Daemon is running: f2a daemon start');
    process.exit(1);
  }
}

/**
 * Handle send result
 */
function handleSendResult(
  result: Record<string, unknown>,
  fromAgentId: string,
  toAgentId?: string
): void {
  if (result.success) {
    if (isJsonMode()) {
      outputJson({
        sent: true,
        fromAgentId: fromAgentId,
        toAgentId: toAgentId || null,
        messageId: result.messageId || null
      });
      return;
    }
    console.log('✅ Success: Message sent successfully.');
    console.log(`   From: ${fromAgentId}`);
    if (toAgentId) {
      console.log(`   To: ${toAgentId}`);
    } else {
      console.log('   To: (broadcast)');
    }
    if (result.messageId) {
      console.log(`   Message ID: ${result.messageId}`);
    }
  } else {
    if (isJsonMode()) {
      outputError(`Failed to send message: ${result.error}`, (result.code as string) || 'SEND_FAILED');
      return;
    }
    console.error(`❌ Error: Failed to send message: ${result.error}`);
    if (result.code === 'AGENT_NOT_REGISTERED') {
      console.error('Hint: Please ensure the Agent is registered.');
    }
    process.exit(1);
  }
}

/**
 * List messages
 * f2a message list --agent-id <agentId> [--unread] [--limit <n>]
 */
export async function getMessages(options: {
  /** Agent ID (required) */
  agentId: string;
  unread?: boolean;
  from?: string;
  limit?: number;
}): Promise<void> {
  if (!options.agentId) {
    if (isJsonMode()) {
      outputError('Missing required --agent-id parameter', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required --agent-id parameter.');
      console.error('Usage: f2a message list --agent-id <agentId>');
      process.exit(1);
    }
    return;
  }

  const limit = options.limit || 50;

  try {
    const result = await sendRequest('GET', `/api/v1/messages/${options.agentId}?limit=${limit}`);

    if (result.success && result.messages) {
      const messages = result.messages as Array<{
        fromAgentId?: string;
        toAgentId?: string;
        content: string;
        type?: string;
        createdAt?: string;
        read?: boolean;
      }>;
      
      const filtered = options.unread
        ? messages.filter(m => !m.read)
        : options.from
          ? messages.filter(m => m.fromAgentId?.includes(options.from!))
          : messages;

      if (isJsonMode()) {
        outputJson({
          messages: filtered.slice(0, limit),
          total: filtered.length,
          unread: filtered.filter(m => !m.read).length
        });
        return;
      }

      if (filtered.length === 0) {
        console.log('📭 No messages found.');
        return;
      }

      console.log(`📨 Messages (${filtered.length}):`);
      console.log('');

      for (const msg of filtered.slice(0, limit)) {
        const from = msg.fromAgentId || 'unknown';
        const to = msg.toAgentId || 'broadcast';
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString('en-US') : '';
        const msgType = msg.type || 'message';

        console.log(`[${msgType}] ${from} → ${to} (${time})`);
        console.log(`   ${msg.content}`);
        console.log('');
      }
    } else {
      if (isJsonMode()) {
        const errorMsg = typeof result.error === 'string' ? result.error : 'Failed to get messages';
        outputError(errorMsg, 'MESSAGES_FAILED');
      } else {
        console.log('📭 No messages found.');
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Cannot connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
    } else {
      console.error(`❌ Error: Cannot connect to Daemon: ${message}`);
      console.error('Please ensure Daemon is running: f2a daemon start');
      process.exit(1);
    }
  }
}

/**
 * Clear messages
 * f2a message clear --agent-id <agentId>
 */
export async function clearMessages(options: {
  /** Agent ID (required) */
  agentId: string;
  messageIds?: string[];
}): Promise<void> {
  if (!options.agentId) {
    if (isJsonMode()) {
      outputError('Missing required parameter: --agent-id', 'MISSING_AGENT_ID');
    } else {
      console.error('❌ Error: Missing required --agent-id parameter.');
      console.error('Usage: f2a message clear --agent-id <agentId>');
      process.exit(1);
    }
    return;
  }

  try {
    const result = await sendRequest(
      'DELETE',
      `/api/v1/messages/${options.agentId}`,
      options.messageIds ? { messageIds: options.messageIds } : undefined
    );

    if (result.success) {
      if (isJsonMode()) {
        outputJson({
          cleared: result.cleared || 0
        });
        return;
      }
      console.log(`✅ Success: Cleared ${result.cleared || 0} message(s).`);
    } else {
      if (isJsonMode()) {
        outputError(`Failed to clear messages: ${result.error}`, 'CLEAR_FAILED');
        return;
      }
      console.error(`❌ Error: Failed to clear messages: ${result.error}`);
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isJsonMode()) {
      outputError(`Cannot connect to Daemon: ${message}`, 'DAEMON_NOT_RUNNING');
      return;
    }
    console.error(`❌ Error: Cannot connect to Daemon: ${message}`);
    console.error('Please ensure Daemon is running: f2a daemon start');
    process.exit(1);
  }
}
