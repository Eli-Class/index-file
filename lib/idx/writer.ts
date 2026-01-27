// src/index-file/writer.ts
import * as fs from 'node:fs';
import mmap from '@elilee/mmap-native';
import { INDEX_HEADER_SIZE, FLAG_VALID } from './constants.js';
import { IndexProtocol } from './protocol.js';
import type { IndexFileOptions } from './types.js';

export class IndexWriter {
  private fd: number | null = null;
  private buffer: Buffer | null = null;
  private validCount = 0;
  private dataFileSize = 0n;
  private lastSequence = 0;

  readonly path: string;
  readonly maxEntries: number;
  readonly fileSize: number;

  constructor(path: string, options: IndexFileOptions) {
    this.path = path;
    this.maxEntries = options.maxEntries;
    this.fileSize = IndexProtocol.calcFileSize(options.maxEntries);
  }

  open(): void {
    const isNew = !fs.existsSync(this.path);

    this.fd = fs.openSync(this.path, isNew ? 'w+' : 'r+');

    if (isNew) {
      fs.ftruncateSync(this.fd, this.fileSize);
    }

    this.buffer = mmap.map(
      this.fileSize,
      mmap.PROT_READ | mmap.PROT_WRITE,
      mmap.MAP_SHARED,
      this.fd,
      0
    );

    if (isNew) {
      const header = IndexProtocol.createHeader(this.maxEntries);
      header.copy(this.buffer, 0);
      this.syncHeader();
    } else {
      const header = IndexProtocol.readHeader(this.buffer);
      this.validCount = header.validCount;
      this.dataFileSize = header.dataFileSize;
      this.lastSequence = header.lastSequence;
    }
  }

  write(
    index: number,
    sequence: number,
    offset: bigint,
    length: number,
    timestamp?: bigint
  ): boolean {
    if (!this.buffer) throw new Error('Index file not opened');
    if (index < 0 || index >= this.maxEntries) return false;

    const ts = timestamp ?? BigInt(Date.now()) * 1000000n;

    IndexProtocol.writeEntry(this.buffer, index, {
      sequence,
      timestamp: ts,
      offset,
      length,
      flags: FLAG_VALID,
    });

    this.validCount++;
    if (sequence > this.lastSequence) {
      this.lastSequence = sequence;
    }

    const newDataEnd = offset + BigInt(length);
    if (newDataEnd > this.dataFileSize) {
      this.dataFileSize = newDataEnd;
    }

    return true;
  }

  append(offset: bigint, length: number, timestamp?: bigint): number {
    const index = this.validCount;
    if (index >= this.maxEntries) return -1;

    const sequence = this.lastSequence + 1;
    this.write(index, sequence, offset, length, timestamp);
    return index;
  }

  getLastSequence(): number {
    return this.lastSequence;
  }

  getNextSequence(): number {
    return this.lastSequence + 1;
  }

  syncHeader(): void {
    if (!this.buffer) return;
    IndexProtocol.updateHeaderCounts(
      this.buffer,
      this.validCount,
      this.dataFileSize,
      this.lastSequence
    );
    mmap.sync(this.buffer, 0, INDEX_HEADER_SIZE, mmap.MS_ASYNC);
  }

  syncAll(): void {
    if (!this.buffer) return;
    this.syncHeader();
    mmap.sync(this.buffer, 0, this.fileSize, mmap.MS_SYNC);
  }

  close(): void {
    if (!this.buffer || this.fd === null) return;

    this.syncAll();
    mmap.unmap(this.buffer);
    fs.closeSync(this.fd);

    this.buffer = null;
    this.fd = null;
  }

  getStats() {
    return {
      path: this.path,
      maxEntries: this.maxEntries,
      validCount: this.validCount,
      dataFileSize: this.dataFileSize,
      lastSequence: this.lastSequence,
    };
  }
}