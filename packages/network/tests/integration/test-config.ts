const defaultBootstrapHttp = 'http://bootstrap:9001';

function normalizeBootstrapUrl(raw: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }

  // 兼容 /dns4/bootstrap/tcp/9000 这样的多地址配置
  const match = raw.match(/^\/dns4\/([^/]+)\/tcp\/(\d+)$/);
  if (match) {
    const [, host, port] = match;
    const controlPort = port === '9000' ? '9001' : port;
    return `http://${host}:${controlPort}`;
  }

  return raw;
}

export function getBootstrapHttp(): string {
  const explicitHttp = process.env.TEST_BOOTSTRAP_HTTP;
  if (explicitHttp) {
    return normalizeBootstrapUrl(explicitHttp);
  }

  const bootstrapAddr = process.env.TEST_BOOTSTRAP_ADDR;
  if (bootstrapAddr) {
    return normalizeBootstrapUrl(bootstrapAddr);
  }

  return defaultBootstrapHttp;
}

