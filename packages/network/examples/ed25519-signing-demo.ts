/**
 * RFC 003 Ed25519 签名机制使用示例
 * 
 * 演示如何使用 Ed25519 非对称签名替代 HMAC-SHA256
 */

import { Ed25519Signer } from '../src/core/identity/ed25519-signer.js';

async function main() {
  console.log('=== RFC 003 Ed25519 签名机制演示 ===\n');

  // 场景 1: Agent 注册时生成 Ed25519 密钥对
  console.log('1. Agent 注册 - 生成 Ed25519 密钥对');
  const agentSigner = new Ed25519Signer();
  
  console.log('  公钥 (公开，用于验证):', agentSigner.getPublicKey());
  console.log('  私钥 (保密，用于签名):', agentSigner.getPrivateKey().slice(0, 10) + '...');
  console.log();

  // 场景 2: Agent 签名自己的 AgentId
  console.log('2. Agent 签名 AgentId');
  const agentId = 'agent:12D3KooWPeer123:a1b2c3d4';
  const signature = await agentSigner.sign(agentId);
  
  console.log('  AgentId:', agentId);
  console.log('  签名:', signature.slice(0, 20) + '...');
  console.log();

  // 场景 3: 其他节点验证签名（无需共享密钥）
  console.log('3. 跨节点验证签名（无需共享密钥）');
  
  // 验证方只需要公钥
  const publicKey = agentSigner.getPublicKey();
  
  // 使用静态方法验证
  const isValid = await Ed25519Signer.verifyWithPublicKey(
    agentId,
    signature,
    publicKey
  );
  
  console.log('  验证结果:', isValid ? '✅ 有效' : '❌ 无效');
  console.log('  (验证方不需要私钥或共享密钥)');
  console.log();

  // 场景 4: 防止篡改
  console.log('4. 防止篡改攻击');
  const tamperedAgentId = 'agent:12D3KooWPeer123:hacked';
  const isTamperedValid = await Ed25519Signer.verifyWithPublicKey(
    tamperedAgentId,
    signature,
    publicKey
  );
  
  console.log('  篡改后的 AgentId:', tamperedAgentId);
  console.log('  验证结果:', isTamperedValid ? '❌ 有效（不应该）' : '✅ 无效（预期）');
  console.log();

  // 场景 5: 防止冒充
  console.log('5. 防止冒充攻击');
  const fakeSigner = new Ed25519Signer();
  const fakeSignature = await fakeSigner.sign(agentId);
  
  const isFakeValid = await Ed25519Signer.verifyWithPublicKey(
    agentId,
    fakeSignature,
    publicKey // 使用真正的公钥验证假签名
  );
  
  console.log('  假签名:', fakeSignature.slice(0, 20) + '...');
  console.log('  验证结果:', isFakeValid ? '❌ 有效（不应该）' : '✅ 无效（预期）');
  console.log('  (不同密钥签名的消息无法通过验证)');
  console.log();

  // 场景 6: 消息携带 Ed25519 公钥
  console.log('6. Agent 消息携带 Ed25519 公钥');
  const messagePayload = {
    fromAgentId: agentId,
    fromSignature: signature,
    fromEd25519PublicKey: publicKey,
    fromPeerId: '12D3KooWPeer12345678',
    content: 'Hello from Agent A!',
    timestamp: Date.now()
  };
  
  console.log('  消息载荷:', JSON.stringify({
    ...messagePayload,
    fromSignature: signature.slice(0, 20) + '...',
    fromEd25519PublicKey: publicKey.slice(0, 10) + '...'
  }, null, 2));
  console.log();

  // 场景 7: 接收方验证消息
  console.log('7. 接收方验证消息');
  const receiverVerifyResult = await Ed25519Signer.verifyWithPublicKey(
    messagePayload.fromAgentId,
    messagePayload.fromSignature,
    messagePayload.fromEd25519PublicKey
  );
  
  console.log('  验证结果:', receiverVerifyResult ? '✅ 消息可信' : '❌ 消息不可信');
  console.log();

  console.log('=== 总结 ===');
  console.log('Ed25519 签名优势:');
  console.log('  1. 公钥公开，无需共享密钥');
  console.log('  2. 支持首次连接验证');
  console.log('  3. 防止篡改和冒充攻击');
  console.log('  4. 更符合标准签名用途');
  console.log('  5. 验证速度快（Ed25519 设计优化）');
}

main().catch(console.error);