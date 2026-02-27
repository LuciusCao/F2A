/**
 * F2A File Transfer Module
 * 
 * 文件传输模块，支持分块传输和断点续传
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const CHUNK_SIZE = 64 * 1024; // 64KB 每块

class FileTransfer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.tempDir = options.tempDir || path.join(process.env.HOME, '.openclaw/workspace/memory/f2a/files');
    this.transfers = new Map(); // transferId -> transferInfo
    
    // 确保临时目录存在
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * 发送文件给 peer
   */
  async sendFile(peerId, filePath, connection, options = {}) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const fileId = crypto.randomUUID();
    const filename = path.basename(filePath);
    const md5 = await this._calculateMD5(filePath);
    const totalChunks = Math.ceil(stats.size / this.chunkSize);

    const transfer = {
      fileId,
      peerId,
      filePath,
      filename,
      size: stats.size,
      md5,
      totalChunks,
      sentChunks: 0,
      status: 'offering',
      startTime: Date.now()
    };

    this.transfers.set(fileId, transfer);

    // 发送文件 offer
    connection.send(JSON.stringify({
      type: 'file_offer',
      fileId,
      filename,
      size: stats.size,
      md5,
      chunks: totalChunks
    }));

    this.emit('file_offered', { fileId, peerId, filename, size: stats.size });

    return fileId;
  }

  /**
   * 处理文件 offer
   */
  async handleFileOffer(fileInfo, peerId, connection, options = {}) {
    const { fileId, filename, size, md5, chunks } = fileInfo;
    
    // 检查存储空间
    const freeSpace = await this._getFreeSpace();
    if (size > freeSpace) {
      connection.send(JSON.stringify({
        type: 'file_reject',
        fileId,
        reason: 'Insufficient storage'
      }));
      return;
    }

    const transfer = {
      fileId,
      peerId,
      filename,
      size,
      md5,
      totalChunks: chunks,
      receivedChunks: 0,
      chunks: new Map(),
      status: 'receiving',
      startTime: Date.now(),
      tempPath: path.join(this.tempDir, `${fileId}.tmp`)
    };

    this.transfers.set(fileId, transfer);

    // 发送接受确认
    connection.send(JSON.stringify({
      type: 'file_accept',
      fileId
    }));

    this.emit('file_receiving', { fileId, peerId, filename, size });
  }

  /**
   * 获取传输状态
   */
  getTransferStatus(fileId) {
    const transfer = this.transfers.get(fileId);
    if (!transfer) return null;

    return {
      fileId,
      status: transfer.status,
      filename: transfer.filename,
      size: transfer.size,
      progress: transfer.totalChunks 
        ? (transfer.sentChunks || transfer.receivedChunks) / transfer.totalChunks
        : 0
    };
  }

  /**
   * 取消传输
   */
  cancelTransfer(fileId) {
    const transfer = this.transfers.get(fileId);
    if (!transfer) return;

    transfer.status = 'cancelled';
    
    // 清理临时文件
    if (transfer.tempPath && fs.existsSync(transfer.tempPath)) {
      fs.unlinkSync(transfer.tempPath);
    }

    this.transfers.delete(fileId);
    this.emit('file_cancelled', { fileId });
  }

  /**
   * 计算 MD5
   */
  _calculateMD5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * 获取可用空间
   */
  async _getFreeSpace() {
    // 简化实现，实际应该使用系统调用
    return 1024 * 1024 * 1024; // 假设 1GB 可用
  }
}

module.exports = { FileTransfer };
