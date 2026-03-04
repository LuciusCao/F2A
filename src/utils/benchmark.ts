/**
 * F2A 性能基准测试工具
 */

import { performance } from 'perf_hooks';
import { Logger } from './logger';

export interface BenchmarkConfig {
  /** 测试名称 */
  name: string;
  /** 迭代次数 */
  iterations: number;
  /** 预热次数 */
  warmup?: number;
  /** 测试函数 */
  fn: () => void | Promise<void>;
}

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
}

/**
 * 性能基准测试运行器
 */
export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ component: 'Benchmark' });
  }

  /**
   * 运行单个基准测试
   */
  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const { name, iterations, warmup = 10, fn } = config;

    this.logger.info(`Running benchmark: ${name}`, { iterations, warmup });

    // 预热
    for (let i = 0; i < warmup; i++) {
      await fn();
    }

    // 正式测试
    const times: number[] = [];
    const startTotal = performance.now();

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    const endTotal = performance.now();

    // 计算统计
    const totalTime = endTotal - startTotal;
    const avgTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const opsPerSecond = 1000 / avgTime;

    const result: BenchmarkResult = {
      name,
      iterations,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      opsPerSecond
    };

    this.results.push(result);
    this.logResult(result);

    return result;
  }

  /**
   * 运行多个基准测试
   */
  async runAll(configs: BenchmarkConfig[]): Promise<BenchmarkResult[]> {
    for (const config of configs) {
      await this.run(config);
    }
    return this.results;
  }

  /**
   * 打印结果
   */
  private logResult(result: BenchmarkResult): void {
    this.logger.info(`Benchmark: ${result.name}`, {
      iterations: result.iterations,
      totalTime: `${result.totalTime.toFixed(2)}ms`,
      avgTime: `${result.avgTime.toFixed(3)}ms`,
      minTime: `${result.minTime.toFixed(3)}ms`,
      maxTime: `${result.maxTime.toFixed(3)}ms`,
      opsPerSecond: result.opsPerSecond.toFixed(2)
    });
  }

  /**
   * 生成报告
   */
  generateReport(): string {
    const lines: string[] = [];
    lines.push('# F2A Performance Benchmark Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    for (const result of this.results) {
      lines.push(`## ${result.name}`);
      lines.push('');
      lines.push(`- Iterations: ${result.iterations}`);
      lines.push(`- Total Time: ${result.totalTime.toFixed(2)}ms`);
      lines.push(`- Average Time: ${result.avgTime.toFixed(3)}ms`);
      lines.push(`- Min Time: ${result.minTime.toFixed(3)}ms`);
      lines.push(`- Max Time: ${result.maxTime.toFixed(3)}ms`);
      lines.push(`- Ops/Second: ${result.opsPerSecond.toFixed(2)}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 获取所有结果
   */
  getResults(): BenchmarkResult[] {
    return [...this.results];
  }

  /**
   * 清空结果
   */
  clear(): void {
    this.results = [];
  }
}

// ============================================================================
// 常用基准测试
// ============================================================================

/**
 * 加密性能测试
 */
export async function benchmarkEncryption(
  runner: BenchmarkRunner,
  encryptFn: (data: string) => string,
  decryptFn: (data: string) => string
): Promise<void> {
  const testData = 'x'.repeat(1024); // 1KB 数据

  await runner.run({
    name: 'Encryption (1KB)',
    iterations: 1000,
    fn: () => {
      encryptFn(testData);
    }
  });

  const encrypted = encryptFn(testData);
  await runner.run({
    name: 'Decryption (1KB)',
    iterations: 1000,
    fn: () => {
      decryptFn(encrypted);
    }
  });
}

/**
 * 消息序列化性能测试
 */
export async function benchmarkSerialization(
  runner: BenchmarkRunner
): Promise<void> {
  const message = {
    id: 'test-uuid',
    type: 'TASK_REQUEST',
    from: 'peer-123',
    to: 'peer-456',
    timestamp: Date.now(),
    payload: { data: 'x'.repeat(100) }
  };

  await runner.run({
    name: 'Message Serialization',
    iterations: 10000,
    fn: () => {
      JSON.stringify(message);
    }
  });

  const serialized = JSON.stringify(message);
  await runner.run({
    name: 'Message Deserialization',
    iterations: 10000,
    fn: () => {
      JSON.parse(serialized);
    }
  });
}

/**
 * 哈希计算性能测试
 */
export async function benchmarkHash(
  runner: BenchmarkRunner,
  hashFn: (data: string) => string
): Promise<void> {
  const sizes = [100, 1000, 10000]; // 100B, 1KB, 10KB

  for (const size of sizes) {
    const data = 'x'.repeat(size);
    await runner.run({
      name: `Hash (${size}B)`,
      iterations: 1000,
      fn: () => {
        hashFn(data);
      }
    });
  }
}
