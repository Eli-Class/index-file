// src/index-file/reader.ts
import * as fs from 'node:fs';
import mmap from '@elilee/mmap-native';
import { IndexProtocol } from './protocol.js';
import type { IndexHeader, IndexEntry } from './types.js';

export class IndexReader {
  private fd: number | null = null;
  private buffer: Buffer | null = null;
  private header: IndexHeader | null = null;

  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  open(): void {
    const stats = fs.statSync(this.path);
    this.fd = fs.openSync(this.path, 'r');

    this.buffer = mmap.map(
      stats.size,
      mmap.PROT_READ,
      mmap.MAP_SHARED,
      this.fd,
      0
    );

    this.header = IndexProtocol.readHeader(this.buffer);
  }

  getHeader(): IndexHeader {
    if (!this.header) throw new Error('Index file not opened');
    return this.header;
  }

  getEntry(index: number): IndexEntry | null {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');
    if (index < 0 || index >= this.header.entryCount) return null;
    return IndexProtocol.readEntry(this.buffer, index);
  }

  findBySequence(sequence: number): { index: number; entry: IndexEntry } | null {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');

    for (let i = 0; i < this.header.validCount; i++) {
      const entry = IndexProtocol.readEntry(this.buffer, i);
      if (entry && entry.sequence === sequence) {
        return { index: i, entry };
      }
    }
    return null;
  }

  findBySequenceRange(startSeq: number, endSeq: number): { index: number; entry: IndexEntry }[] {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');

    const results: { index: number; entry: IndexEntry }[] = [];
    for (let i = 0; i < this.header.validCount; i++) {
      const entry = IndexProtocol.readEntry(this.buffer, i);
      if (entry && entry.sequence >= startSeq && entry.sequence <= endSeq) {
        results.push({ index: i, entry });
      }
    }
    return results;
  }

  getAllEntries(): IndexEntry[] {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');

    const entries: IndexEntry[] = [];
    for (let i = 0; i < this.header.validCount; i++) {
      const entry = IndexProtocol.readEntry(this.buffer, i);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  findByTimeRange(startTs: bigint, endTs: bigint): { index: number; entry: IndexEntry }[] {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');

    const results: { index: number; entry: IndexEntry }[] = [];
    for (let i = 0; i < this.header.validCount; i++) {
      const entry = IndexProtocol.readEntry(this.buffer, i);
      if (entry && entry.timestamp >= startTs && entry.timestamp <= endTs) {
        results.push({ index: i, entry });
      }
    }
    return results;
  }

  binarySearchBySequence(targetSeq: number): { index: number; entry: IndexEntry } | null {
    if (!this.buffer || !this.header) throw new Error('Index file not opened');

    let left = 0;
    let right = this.header.validCount - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = IndexProtocol.readEntry(this.buffer, mid);

      if (!entry) {
        right = mid - 1;
        continue;
      }

      if (entry.sequence === targetSeq) {
        return { index: mid, entry };
      } else if (entry.sequence < targetSeq) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return null;
  }

  close(): void {
    if (this.buffer) {
      mmap.unmap(this.buffer);
      this.buffer = null;
    }
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
    this.header = null;
  }
}