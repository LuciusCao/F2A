import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';

async function createNode() {
  const privateKey = await generateKeyPair('Ed25519');
  const peerId = peerIdFromPrivateKey(privateKey);
  
  const node = await createLibp2p({
    privateKey,
    addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping()
    }
  });
  
  return node;
}

async function test() {
  console.log('Creating node 1...');
  const node1 = await createNode();
  await node1.start();
  console.log('Node 1 started:', node1.peerId.toString());
  console.log('Addresses:', node1.getMultiaddrs().map(a => a.toString()));
  
  console.log('\nCreating node 2...');
  const node2 = await createNode();
  await node2.start();
  console.log('Node 2 started:', node2.peerId.toString());
  
  // Get node 1's address
  const addr = node1.getMultiaddrs()[0];
  console.log('\nConnecting node2 to node1:', addr.toString());
  
  try {
    const conn = await node2.dial(addr);
    console.log('Connected!');
    console.log('Remote peer:', conn.remotePeer.toString());
    console.log('Status:', conn.status);
  } catch (e) {
    console.error('Connection failed:', e.message);
    console.error('Stack:', e.stack);
  }
  
  await node2.stop();
  await node1.stop();
  console.log('\nNodes stopped');
}

test().catch(console.error);