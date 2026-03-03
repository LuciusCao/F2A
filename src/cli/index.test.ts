import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock http module
vi.mock('http', () => ({
  request: vi.fn((options, callback) => {
    const mockRes = {
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify({ success: true, peerId: 'test-peer-id' })));
        }
        if (event === 'end') {
          handler();
        }
      }),
      statusCode: 200
    };
    callback(mockRes);
    return {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn()
    };
  })
}));

describe('CLI Index', () => {
  let originalArgv: string[];
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    originalArgv = process.argv;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should show help by default', async () => {
    process.argv = ['node', 'f2a'];
    
    await import('./index');
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('should show help when requested', async () => {
    process.argv = ['node', 'f2a', 'help'];
    
    await import('./index');
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(consoleLogSpy).toHaveBeenCalled();
  });
});
