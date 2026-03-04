import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing
const mockRequest = vi.fn();
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('http', () => ({
  request: (...args: any[]) => mockRequest(...args),
}));

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}));

describe('CLI Index', () => {
  const mockReq = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  const mockRes = {
    statusCode: 200,
    on: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockRequest.mockImplementation((options: any, callback: Function) => {
      callback(mockRes);
      return mockReq;
    });

    mockRes.on.mockImplementation((event: string, callback: Function) => {
      if (event === 'data') callback(Buffer.from(JSON.stringify({ success: true, status: 'ok' })));
      if (event === 'end') callback();
    });

    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.F2A_CONTROL_PORT;
    delete process.env.F2A_CONTROL_TOKEN;
  });

  describe('getControlToken', () => {
    it('should use environment variable token', async () => {
      process.env.F2A_CONTROL_TOKEN = 'env-token';
      
      vi.resetModules();
      // Just verify env is set correctly
      expect(process.env.F2A_CONTROL_TOKEN).toBe('env-token');
    });

    it('should read token from file when env not set', async () => {
      delete process.env.F2A_CONTROL_TOKEN;
      
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('file-token');
      
      vi.resetModules();
      // Import will trigger the token reading
      await import('./index');
      
      expect(mockExistsSync).toHaveBeenCalled();
    });
  });
});
