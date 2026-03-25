import type { PrivateKey } from '@libp2p/interface';

// 模拟 IdentityManager.getPrivateKey() 的返回类型
declare const privateKey: PrivateKey | null;

// 模拟 libp2pOptions.privateKey 的类型
interface Libp2pOptions {
  privateKey?: PrivateKey;
}

const options: Libp2pOptions = {};

if (privateKey) {
  options.privateKey = privateKey;  // 不需要 as any
}
