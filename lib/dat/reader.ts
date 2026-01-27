// src/data-file/reader.ts
import * as fs from 'node:fs';
import mmap from '@elilee/mmap-native';
import { DATA_HEADER_SIZE } from './constants.js';
import { DataProtocol, DataHeader } from './protocol.js';
import { IndexReader } from '../idx/index.js';
import type { Serializer, DataEntry } from './types.js';

export class DataReader<T> {
  private fd: number | null = null;
  private buffer: Buffer | null = null;
  private header: DataHeader | null = null;

  private indexReader: IndexReader;
  private serializer: Serializer<T>;

  readonly dataPath: string;
  readonly indexPath: string;

  constructor(basePath: string, serializer: Serializer<T>) {
    this.dataPath = `${basePath}.dat`;
    this.indexPath = `${basePath}.idx`;
    this.serializer = serializer;
    this.indexReader = new IndexReader(this.indexPath);
  }

  open(): void {
    const stats = fs.statSync(this.dataPath);
    this.fd = fs.openSync(this.dataPath, 'r');

    this.buffer = mmap.map(
      stats.size,
      mmap.PROT_READ,
      mmap.MAP_SHARED,
      this.fd,
      0
    );

    this.header = DataProtocol.readHeader(this.buffer);
    this.indexReader.open();
  }

  getHeader(): DataHeader {
    if (!this.header) throw new Error('Data file not opened');
    return this.header;
  }

  getBySequence(sequence: number): DataEntry<T> | null {
    if (!this.buffer) throw new Error('Data file not opened');

    const found = this.indexReader.binarySearchBySequence(sequence);
    if (!found) return null;

    const result = DataProtocol.deserializeRecord(
      this.buffer,
      Number(found.entry.offset),
      this.serializer
    );
    if (!result) return null;

    return {
      sequence: found.entry.sequence,
      timestamp: found.entry.timestamp,
      data: result.data,
    };
  }

  getByIndex(index: number): DataEntry<T> | null {
    if (!this.buffer) throw new Error('Data file not opened');

    const entry = this.indexReader.getEntry(index);
    if (!entry) return null;

    const result = DataProtocol.deserializeRecord(
      this.buffer,
      Number(entry.offset),
      this.serializer
    );
    if (!result) return null;

    return {
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      data: result.data,
    };
  }

  getBulkData(startSeq: number, endSeq: number): DataEntry<T>[] {
    if (!this.buffer) throw new Error('Data file not opened');

    const results: DataEntry<T>[] = [];
    const indexHeader = this.indexReader.getHeader();
    let startIdx = this.findStartIndex(startSeq, indexHeader.validCount);

    for (let i = startIdx; i < indexHeader.validCount; i++) {
      const entry = this.indexReader.getEntry(i);
      if (!entry) continue;

      if (entry.sequence > endSeq) break;

      if (entry.sequence >= startSeq) {
        const result = DataProtocol.deserializeRecord(
          this.buffer,
          Number(entry.offset),
          this.serializer
        );
        if (result) {
          results.push({
            sequence: entry.sequence,
            timestamp: entry.timestamp,
            data: result.data,
          });
        }
      }
    }

    return results;
  }

  private findStartIndex(targetSeq: number, validCount: number): number {
    let left = 0;
    let right = validCount - 1;
    let result = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const entry = this.indexReader.getEntry(mid);

      if (!entry) {
        right = mid - 1;
        continue;
      }

      if (entry.sequence >= targetSeq) {
        result = mid;
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    return result;
  }

  getBulkDataByTime(startTs: bigint, endTs: bigint): DataEntry<T>[] {
    if (!this.buffer) throw new Error('Data file not opened');

    const indexResults = this.indexReader.findByTimeRange(startTs, endTs);
    const results: DataEntry<T>[] = [];

    for (const { entry } of indexResults) {
      const result = DataProtocol.deserializeRecord(
        this.buffer,
        Number(entry.offset),
        this.serializer
      );
      if (result) {
        results.push({
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          data: result.data,
        });
      }
    }

    return results;
  }

  getAllData(): DataEntry<T>[] {
    if (!this.buffer) throw new Error('Data file not opened');

    const entries = this.indexReader.getAllEntries();
    const results: DataEntry<T>[] = [];

    for (const entry of entries) {
      const result = DataProtocol.deserializeRecord(
        this.buffer,
        Number(entry.offset),
        this.serializer
      );
      if (result) {
        results.push({
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          data: result.data,
        });
      }
    }

    return results;
  }

  getRecordCount(): number {
    return this.indexReader.getHeader().validCount;
  }

  getLastSequence(): number {
    return this.indexReader.getHeader().lastSequence;
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
    this.indexReader.close();
  }
}