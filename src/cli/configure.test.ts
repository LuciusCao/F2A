import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original TTY values
let originalIsTTY: boolean | undefined;

// Mock dependencies before importing
const mockLoadConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockGetConfigPath = vi.fn().mockReturnValue('/home/test/.f2a/config.json');
const mockConfigExists = vi.fn().mockReturnValue(false);
const mockValidateAgentName = vi.fn();
const mockValidateMultiaddr = vi.fn();

vi.mock('./config.js', () => ({
  loadConfig: () => mockLoadConfig(),
  saveConfig: (...args: any[]) => mockSaveConfig(...args),
  getDefaultConfig: vi.fn().mockReturnValue({
    agentName: 'test-agent',
    network: { bootstrapPeers: [] },
    autoStart: false,
    controlPort: 9001,
    p2pPort: 0,
    enableMDNS: true,
    enableDHT: true,
    logLevel: 'INFO',
  }),
  getConfigPath: () => mockGetConfigPath(),
  configExists: () => mockConfigExists(),
  validateAgentName: (...args: any[]) => mockValidateAgentName(...args),
  validateMultiaddr: (...args: any[]) => mockValidateMultiaddr(...args),
}));

// Mock readline
const mockQuestion = vi.fn();
const mockClose = vi.fn();
const mockCreateInterface = vi.fn().mockReturnValue({
  question: (...args: any[]) => mockQuestion(...args),
  close: () => mockClose(),
});

vi.mock('readline', () => ({
  createInterface: () => mockCreateInterface(),
}));

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
  hostname: vi.fn().mockReturnValue('test-host'),
}));

// Import after mocking
import { 
  listConfig, 
  getConfigValue, 
  setConfigValue,
  configureCommand 
} from './configure.js';

describe('configure.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      agentName: 'test-agent',
      network: { bootstrapPeers: [] },
      autoStart: false,
      controlPort: 9001,
      p2pPort: 0,
      enableMDNS: true,
      enableDHT: true,
      logLevel: 'INFO',
    });
    mockValidateAgentName.mockReturnValue({ valid: true });
    mockValidateMultiaddr.mockReturnValue({ valid: true });
    // Mock TTY for interactive tests
    (process.stdin as any).isTTY = true;
    (process.stdout as any).isTTY = true;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('listConfig()', () => {
    it('should list all configuration values', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      listConfig();
      
      expect(mockLoadConfig).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('F2A 配置'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/home/test/.f2a/config.json'));
      consoleSpy.mockRestore();
    });

    it('should display config as formatted JSON', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const testConfig = {
        agentName: 'my-agent',
        controlPort: 8080,
      };
      mockLoadConfig.mockReturnValue(testConfig);
      
      listConfig();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"agentName": "my-agent"'));
      consoleSpy.mockRestore();
    });
  });

  describe('getConfigValue()', () => {
    it('should get simple key value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        agentName: 'my-agent',
        controlPort: 8080,
      });
      
      getConfigValue('agentName');
      
      expect(consoleSpy).toHaveBeenCalledWith('my-agent');
      consoleSpy.mockRestore();
    });

    it('should get nested key value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        network: {
          bootstrapPeers: ['/ip4/1.2.3.4/tcp/9000'],
        },
      });
      
      getConfigValue('network.bootstrapPeers');
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('/ip4/1.2.3.4'));
      consoleSpy.mockRestore();
    });

    it('should output boolean as string', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        autoStart: true,
      });
      
      getConfigValue('autoStart');
      
      expect(consoleSpy).toHaveBeenCalledWith('true');
      consoleSpy.mockRestore();
    });

    it('should output number as string', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        controlPort: 9001,
      });
      
      getConfigValue('controlPort');
      
      expect(consoleSpy).toHaveBeenCalledWith('9001');
      consoleSpy.mockRestore();
    });

    it('should output null/undefined as empty string', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        nullValue: null,
        undefinedValue: undefined,
      });
      
      getConfigValue('nullValue');
      getConfigValue('undefinedValue');
      
      expect(consoleSpy).toHaveBeenCalledWith('');
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid key', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        agentName: 'test',
      });
      
      expect(() => getConfigValue('invalidKey')).toThrow('Configuration key "invalidKey" not found');
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid nested key', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadConfig.mockReturnValue({
        network: {
          bootstrapPeers: [],
        },
      });
      
      expect(() => getConfigValue('network.invalidKey')).toThrow('Configuration key "network.invalidKey" not found');
      consoleSpy.mockRestore();
    });
  });

  describe('setConfigValue()', () => {
    it('should set simple string value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { agentName: 'old-name' };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('agentName', 'new-name');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agentName: 'new-name' }));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('new-name'));
      consoleSpy.mockRestore();
    });

    it('should set boolean true value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { autoStart: false };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('autoStart', 'true');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ autoStart: true }));
      consoleSpy.mockRestore();
    });

    it('should set boolean false value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { autoStart: true };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('autoStart', 'false');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false }));
      consoleSpy.mockRestore();
    });

    it('should set number value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { controlPort: 9001 };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('controlPort', '8080');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ controlPort: 8080 }));
      consoleSpy.mockRestore();
    });

    it('should set negative number value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { someValue: 0 };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('someValue', '-100');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ someValue: -100 }));
      consoleSpy.mockRestore();
    });

    it('should set JSON array value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { network: { bootstrapPeers: [] } };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('network.bootstrapPeers', '["/ip4/1.2.3.4/tcp/9000"]');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        network: { bootstrapPeers: ['/ip4/1.2.3.4/tcp/9000'] }
      }));
      consoleSpy.mockRestore();
    });

    it('should set JSON object value', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { security: {} };
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('security', '{"level": "high"}');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        security: { level: 'high' }
      }));
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid key', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('invalidKey', 'value')).toThrow('Invalid configuration key: invalidKey');
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid JSON array', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config: any = { network: { bootstrapPeers: [] } };
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('network.bootstrapPeers', '[invalid json')).toThrow('Invalid JSON format');
      consoleSpy.mockRestore();
    });

    it('should throw error for invalid JSON object', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('security', '{invalid json}')).toThrow('Invalid JSON format');
      consoleSpy.mockRestore();
    });

    it('should create nested objects if they do not exist', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('network.bootstrapPeers', '[]');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        network: { bootstrapPeers: [] }
      }));
      consoleSpy.mockRestore();
    });

    it('should handle save errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config: any = { agentName: 'test' };
      mockLoadConfig.mockReturnValue(config);
      mockSaveConfig.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      
      expect(() => setConfigValue('agentName', 'new-name')).toThrow('Failed to save configuration');
      consoleSpy.mockRestore();
    });
  });

  describe('isValidConfigKey (via setConfigValue)', () => {
    it('should accept valid simple keys', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      // These should not throw
      expect(() => setConfigValue('agentName', 'test')).not.toThrow();
      expect(() => setConfigValue('autoStart', 'true')).not.toThrow();
      expect(() => setConfigValue('controlPort', '9001')).not.toThrow();
      expect(() => setConfigValue('p2pPort', '0')).not.toThrow();
      expect(() => setConfigValue('enableMDNS', 'true')).not.toThrow();
      expect(() => setConfigValue('enableDHT', 'true')).not.toThrow();
      expect(() => setConfigValue('logLevel', 'INFO')).not.toThrow();
      expect(() => setConfigValue('dataDir', '/tmp')).not.toThrow();
      
      consoleSpy.mockRestore();
    });

    it('should accept valid nested keys', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = { network: {}, security: {}, rateLimit: {} };
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('network', '{}')).not.toThrow();
      expect(() => setConfigValue('network.bootstrapPeers', '[]')).not.toThrow();
      expect(() => setConfigValue('network.bootstrapPeerFingerprints', '{}')).not.toThrow();
      expect(() => setConfigValue('security.level', 'high')).not.toThrow();
      expect(() => setConfigValue('security.requireConfirmation', 'true')).not.toThrow();
      expect(() => setConfigValue('rateLimit.maxRequests', '100')).not.toThrow();
      expect(() => setConfigValue('rateLimit.windowMs', '60000')).not.toThrow();
      
      consoleSpy.mockRestore();
    });

    it('should reject invalid keys', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('invalidKey', 'value')).toThrow();
      expect(() => setConfigValue('unknown.nested', 'value')).toThrow();
      expect(() => setConfigValue('network.invalid', 'value')).toThrow();
      
      consoleSpy.mockRestore();
    });
  });

  describe('parseConfigValue (via setConfigValue)', () => {
    it('should parse boolean true', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('autoStart', 'true');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ autoStart: true }));
      consoleSpy.mockRestore();
    });

    it('should parse boolean false', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('autoStart', 'false');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ autoStart: false }));
      consoleSpy.mockRestore();
    });

    it('should parse positive integer', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('controlPort', '9001');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ controlPort: 9001 }));
      consoleSpy.mockRestore();
    });

    it('should parse negative integer', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('someValue', '-100');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ someValue: -100 }));
      consoleSpy.mockRestore();
    });

    it('should parse JSON array', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('network.bootstrapPeers', '["a", "b"]');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        network: { bootstrapPeers: ['a', 'b'] }
      }));
      consoleSpy.mockRestore();
    });

    it('should parse JSON object', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('security', '{"level": "high"}');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        security: { level: 'high' }
      }));
      consoleSpy.mockRestore();
    });

    it('should treat non-JSON string as plain string', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      setConfigValue('agentName', 'my-agent-name');
      
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        agentName: 'my-agent-name'
      }));
      consoleSpy.mockRestore();
    });

    it('should throw on invalid JSON', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config: any = {};
      mockLoadConfig.mockReturnValue(config);
      
      expect(() => setConfigValue('network.bootstrapPeers', '[invalid')).toThrow();
      consoleSpy.mockRestore();
    });
  });

  describe('configureCommand (interactive)', () => {
    beforeEach(() => {
      // Mock TTY
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
    });

    it('should throw error when not in TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: false });
      
      await expect(configureCommand()).rejects.toThrow('interactive terminal');
    });

    it('should run interactive configuration', async () => {
      // Mock user inputs
      mockQuestion
        .mockResolvedValueOnce('') // Agent name (use default)
        .mockResolvedValueOnce('n') // Auto start
        .mockResolvedValueOnce('n') // Advanced config
        .mockResolvedValueOnce('n') // Bootstrap peers
        .mockResolvedValueOnce('y'); // Confirm save

      await configureCommand();

      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });

    it('should allow reconfiguration with existing values', async () => {
      mockConfigExists.mockReturnValue(true);
      mockLoadConfig.mockReturnValue({
        agentName: 'existing-agent',
        network: { bootstrapPeers: [] },
        autoStart: true,
        controlPort: 8080,
        p2pPort: 9000,
        enableMDNS: false,
        enableDHT: false,
        logLevel: 'DEBUG',
      });

      // User just presses enter to keep existing values
      mockQuestion
        .mockResolvedValueOnce('') // Keep agent name
        .mockResolvedValueOnce('') // Keep auto start
        .mockResolvedValueOnce('n') // Skip advanced
        .mockResolvedValueOnce('n') // Skip bootstrap
        .mockResolvedValueOnce('y'); // Confirm save

      await configureCommand();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        agentName: 'existing-agent',
        autoStart: true,
      }));
    });

    it('should cancel configuration when user declines save', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // Agent name
        .mockResolvedValueOnce('n') // Auto start
        .mockResolvedValueOnce('n') // Advanced
        .mockResolvedValueOnce('n') // Bootstrap
        .mockResolvedValueOnce('n'); // Decline save

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await configureCommand();

      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('取消'));
      consoleSpy.mockRestore();
    });

    it('should configure advanced options when requested', async () => {
      mockQuestion
        .mockResolvedValueOnce('my-agent') // Agent name
        .mockResolvedValueOnce('y') // Auto start
        .mockResolvedValueOnce('y') // Configure advanced
        .mockResolvedValueOnce('8080') // Control port
        .mockResolvedValueOnce('9000') // P2P port
        .mockResolvedValueOnce('y') // MDNS
        .mockResolvedValueOnce('y') // DHT
        .mockResolvedValueOnce('1') // Log level (DEBUG)
        .mockResolvedValueOnce('n') // Skip bootstrap
        .mockResolvedValueOnce('y'); // Confirm save

      await configureCommand();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        agentName: 'my-agent',
        autoStart: true,
        controlPort: 8080,
        p2pPort: 9000,
        enableMDNS: true,
        enableDHT: true,
        logLevel: 'DEBUG',
      }));
    });

    it('should configure bootstrap peers when requested', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // Agent name
        .mockResolvedValueOnce('n') // Auto start
        .mockResolvedValueOnce('n') // Skip advanced
        .mockResolvedValueOnce('y') // Configure bootstrap
        .mockResolvedValueOnce('/ip4/1.2.3.4/tcp/9000') // Peers
        .mockResolvedValueOnce('n') // Skip fingerprints
        .mockResolvedValueOnce('y'); // Confirm save

      await configureCommand();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        network: expect.objectContaining({
          bootstrapPeers: ['/ip4/1.2.3.4/tcp/9000'],
        }),
      }));
    });

    it('should handle invalid agent name with retries', async () => {
      mockValidateAgentName
        .mockReturnValueOnce({ valid: false, error: 'Name too short' })
        .mockReturnValueOnce({ valid: false, error: 'Invalid characters' })
        .mockReturnValue({ valid: true });

      mockQuestion
        .mockResolvedValueOnce('ab') // Invalid
        .mockResolvedValueOnce('invalid@name') // Invalid
        .mockResolvedValueOnce('valid-name') // Valid
        .mockResolvedValueOnce('n') // Auto start
        .mockResolvedValueOnce('n') // Advanced
        .mockResolvedValueOnce('n') // Bootstrap
        .mockResolvedValueOnce('y'); // Confirm

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await configureCommand();

      expect(mockValidateAgentName).toHaveBeenCalledTimes(3);
      consoleSpy.mockRestore();
    });

    it('should handle invalid port input', async () => {
      mockQuestion
        .mockResolvedValueOnce('') // Agent name
        .mockResolvedValueOnce('n') // Auto start
        .mockResolvedValueOnce('y') // Configure advanced
        .mockResolvedValueOnce('99999') // Invalid port (too high)
        .mockResolvedValueOnce('9000') // P2P port
        .mockResolvedValueOnce('y') // MDNS
        .mockResolvedValueOnce('y') // DHT
        .mockResolvedValueOnce('2') // Log level
        .mockResolvedValueOnce('n') // Bootstrap
        .mockResolvedValueOnce('y'); // Confirm

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await configureCommand();

      // Should still save with default control port (9001) since 99999 is invalid
      expect(mockSaveConfig).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
