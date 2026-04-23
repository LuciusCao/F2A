import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { sendRequest } from './http-client.js';

describe('sendRequest', () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function startMockServer(handler: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void): Promise<void> {
    return new Promise((resolve) => {
      server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          port = addr.port;
        }
        resolve();
      });
    });
  }

  it('should return JSON on successful GET request', async () => {
    await startMockServer((req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/api/test');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: 'hello' }));
    });

    const result = await sendRequest('GET', '/api/test', undefined, undefined, port);
    expect(result).toEqual({ success: true, data: 'hello' });
  });

  it('should send POST request with body and custom headers', async () => {
    await startMockServer((req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/api/test');
      expect(req.headers['content-type']).toBe('application/json');
      expect(req.headers['x-custom-header']).toBe('custom-value');

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        expect(JSON.parse(body)).toEqual({ key: 'value' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });

    const result = await sendRequest('POST', '/api/test', { key: 'value' }, { 'x-custom-header': 'custom-value' }, port);
    expect(result).toEqual({ success: true });
  });

  it('should handle timeout scenario', async () => {
    vi.stubEnv('F2A_REQUEST_TIMEOUT', '100');
    await startMockServer((_req, _res) => {
      // never respond
    });

    const result = await sendRequest('GET', '/api/test', undefined, undefined, port);
    expect(result).toEqual({
      success: false,
      error: 'Request timeout after 100ms. Daemon may not be responding.',
    });
  });

  it('should handle connection failure', async () => {
    const result = await sendRequest('GET', '/api/test', undefined, undefined, 54321);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection failed');
    expect(result.error).toContain('Please ensure daemon is running');
  });

  it('should handle invalid JSON response', async () => {
    await startMockServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not-json');
    });

    const result = await sendRequest('GET', '/api/test', undefined, undefined, port);
    expect(result).toEqual({
      success: false,
      error: 'Invalid response',
      raw: 'not-json',
    });
  });
});
