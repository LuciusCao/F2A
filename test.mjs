import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';

async function test() {
  // 生成密钥
  const privateKey = await generateKeyPair('Ed25519');
  const peerId = peerIdFromPrivateKey(privateKey);
  console.log('Local PeerId:', peerId.toString());

  // 创建 libp2p 节点
  const node = await createLibp2p({
    privateKey,
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()]
  });

  await node.start();
  console.log('Node started, addresses:', node.getMultiaddrs().map(a => a.toString()));

  // 尝试连接到 CatPi
  const targetAddr = '/ip4/192.168.2.55/tcp/39715/p2p/12D3KooWPP1yEu1Emb9LJ5noLERVBrgny8SkgWKiwsisyx6EzZ4R';
  console.log('\nConnecting to:', targetAddr);

  try {
    const conn = await node.dial(multiaddr(targetAddr));
    console.log('Connected! Remote peer:', conn.remotePeer.toString());
    console.log('Connection status:', conn.status);
  } catch (e) {
    console.error('Connection failed:', e.message);
    console.error('Stack:', e.stack);
  }

  await node.stop();
  console.log('\nNode stopped');
}

test().catch(console.error);