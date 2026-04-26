/**
 * Conversation Layer 最小集成测试
 *
 * 覆盖真实 ControlServer HTTP API、Agent 注册、消息发送、会话历史查询和重启后持久化读取。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ControlServer } from '../src/control-server.js';
import {
  AgentIdentityKeypair,
  F2A,
  generateAgentId,
  signSelfSignature,
} from '@f2a/network';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate test port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function createF2A(dataDir: string): Promise<F2A> {
  return F2A.create({
    dataDir,
    displayName: 'Conversation Integration Test',
    network: {
      listenPort: 0,
      enableMDNS: false,
      enableDHT: false,
    },
    logLevel: 'ERROR',
  });
}

function createAgentIdentity(name: string): { name: string; publicKey: string; selfSignature: string } {
  const keypair = new AgentIdentityKeypair().generateKeypair();
  const agentId = generateAgentId(keypair.publicKey);
  return {
    name,
    publicKey: keypair.publicKey,
    selfSignature: signSelfSignature(agentId, keypair.publicKey, keypair.privateKey),
  };
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const json = await response.json() as T;

  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  const json = await response.json() as T;

  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

describe('Conversation history integration', () => {
  let server: ControlServer | undefined;
  let dataDir: string | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;

    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
      dataDir = undefined;
    }
  });

  it('persists conversation history across ControlServer restarts', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'f2a-conversation-integration-'));
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const conversationId = 'conv-integration-minimal';

    const firstF2A = await createF2A(dataDir);
    server = new ControlServer(firstF2A, port, undefined, { dataDir });
    await server.start();

    const aliceIdentity = createAgentIdentity('Alice');
    const bobIdentity = createAgentIdentity('Bob');

    const aliceRegistration = await postJson<{
      success: boolean;
      agent: { agentId: string };
      token: string;
    }>(baseUrl, '/api/v1/agents', {
      name: aliceIdentity.name,
      publicKey: aliceIdentity.publicKey,
      selfSignature: aliceIdentity.selfSignature,
      capabilities: ['chat'],
      webhook: { url: 'http://127.0.0.1:65535/alice-webhook' },
    });
    const bobRegistration = await postJson<{
      success: boolean;
      agent: { agentId: string };
      token: string;
    }>(baseUrl, '/api/v1/agents', {
      name: bobIdentity.name,
      publicKey: bobIdentity.publicKey,
      selfSignature: bobIdentity.selfSignature,
      capabilities: ['chat'],
      webhook: { url: 'http://127.0.0.1:65535/bob-webhook' },
    });

    expect(aliceRegistration.success).toBe(true);
    expect(bobRegistration.success).toBe(true);

    firstF2A.getAgentRegistry().get(aliceRegistration.agent.agentId)!.webhook = undefined;
    firstF2A.getAgentRegistry().get(bobRegistration.agent.agentId)!.webhook = undefined;

    const sendResult = await postJson<{
      success: boolean;
      messageId: string;
      conversationId: string;
      historyPersisted: boolean;
    }>(baseUrl, '/api/v1/messages', {
      fromAgentId: aliceRegistration.agent.agentId,
      toAgentId: bobRegistration.agent.agentId,
      content: 'hello from integration',
      conversationId,
      expectReply: false,
    }, {
      Authorization: aliceRegistration.token,
    });

    expect(sendResult).toMatchObject({
      success: true,
      conversationId,
      historyPersisted: true,
    });

    const aliceConversations = await getJson<{
      success: boolean;
      conversations: Array<{ conversationId: string; peerAgentId: string; messageCount: number }>;
    }>(baseUrl, `/api/v1/conversations/${encodeURIComponent(aliceRegistration.agent.agentId)}`);
    const bobHistory = await getJson<{
      success: boolean;
      source: string;
      messages: Array<{ conversationId: string; direction: string; content?: string; summary?: string }>;
    }>(
      baseUrl,
      `/api/v1/messages/${encodeURIComponent(bobRegistration.agent.agentId)}?conversationId=${encodeURIComponent(conversationId)}`
    );

    expect(aliceConversations.conversations).toContainEqual(expect.objectContaining({
      conversationId,
      peerAgentId: bobRegistration.agent.agentId,
      messageCount: 1,
    }));
    expect(bobHistory).toMatchObject({
      success: true,
      source: 'history',
    });
    expect(bobHistory.messages).toHaveLength(1);
    expect(bobHistory.messages[0]).toMatchObject({
      conversationId,
      direction: 'inbound',
      summary: 'hello from integration',
    });

    server.stop();
    server = undefined;

    const secondF2A = await createF2A(dataDir);
    server = new ControlServer(secondF2A, port, undefined, { dataDir });
    await server.start();

    const persistedBobHistory = await getJson<{
      success: boolean;
      source: string;
      messages: Array<{ conversationId: string; direction: string; summary?: string }>;
    }>(
      baseUrl,
      `/api/v1/messages/${encodeURIComponent(bobRegistration.agent.agentId)}?conversationId=${encodeURIComponent(conversationId)}`
    );

    expect(persistedBobHistory).toMatchObject({
      success: true,
      source: 'history',
    });
    expect(persistedBobHistory.messages).toHaveLength(1);
    expect(persistedBobHistory.messages[0]).toMatchObject({
      conversationId,
      direction: 'inbound',
      summary: 'hello from integration',
    });
  }, 30000);
});
