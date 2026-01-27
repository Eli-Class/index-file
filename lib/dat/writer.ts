// src/data-file/writer.ts
import * as fs from 'node:fs';
import { DATA_HEADER_SIZE } from './constants.js';
import { DataProtocol } from './protocol.js';
import { IndexWriter } from '../idx/index.js';
import type { Serializer, DataFileOptions } from './types.js';

export class DataWriter<T> {
  private fd: number | null = null;
  private headerBuf: Buffer | null = null;
  private currentOffset: bigint = BigInt(DATA_HEADER_SIZE);
  private recordCount = 0;

  private indexWriter: IndexWriter;
  private serializer: Serializer<T>;

  readonly dataPath: string;
  readonly indexPath: string;

  constructor(basePath: string, options: DataFileOptions<T>) {
    this.dataPath = `${basePath}.dat`;
    this.indexPath = `${basePath}.idx`;
    this.serializer = options.serializer;

    const maxEntries = options.maxEntries ?? 10_000_000;
    this.indexWriter = new IndexWriter(this.indexPath, { maxEntries });
  }

  open(): void {
    const isNew = !fs.existsSync(this.dataPath);

    this.fd = fs.openSync(this.dataPath, isNew ? 'w+' : 'r+');
    this.headerBuf = Buffer.alloc(DATA_HEADER_SIZE);

    if (isNew) {
      const header = DataProtocol.createHeader();
      fs.writeSync(this.fd, header, 0, DATA_HEADER_SIZE, 0);
      this.currentOffset = BigInt(DATA_HEADER_SIZE);
      this.recordCount = 0;
    } else {
      fs.readSync(this.fd, this.headerBuf, 0, DATA_HEADER_SIZE, 0);
      const header = DataProtocol.readHeader(this.headerBuf);
      this.currentOffset = header.fileSize;
      this.recordCount = header.recordCount;
    }

    this.indexWriter.open();
  }

  append(data: T, timestamp?: bigint): number {
    if (this.fd === null) throw new Error('Data file not opened');

    const buf = DataProtocol.serializeRecord(data, this.serializer);
    const offset = this.currentOffset;

    fs.writeSync(this.fd, buf, 0, buf.length, Number(offset));

    const sequence = this.indexWriter.getNextSequence();
    const ts = timestamp ?? BigInt(Date.now()) * 1000000n;

    this.indexWriter.append(offset, buf.length, ts);

    this.currentOffset += BigInt(buf.length);
    this.recordCount++;

    return sequence;
  }

  appendBulk(records: T[], timestamp?: bigint): number[] {
    const sequences: number[] = [];
    const ts = timestamp ?? BigInt(Date.now()) * 1000000n;

    for (const record of records) {
      const seq = this.append(record, ts);
      sequences.push(seq);
    }

    return sequences;
  }

  getLastSequence(): number {
    return this.indexWriter.getLastSequence();
  }

  getNextSequence(): number {
    return this.indexWriter.getNextSequence();
  }

  sync(): void {
    if (this.fd === null || !this.headerBuf) return;

    DataProtocol.updateHeader(this.headerBuf, this.currentOffset, this.recordCount);
    fs.writeSync(this.fd, this.headerBuf, 0, DATA_HEADER_SIZE, 0);
    fs.fsyncSync(this.fd);

    this.indexWriter.syncAll();
  }

  close(): void {
    this.sync();

    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }

    this.indexWriter.close();
    this.headerBuf = null;
  }

  getStats() {
    return {
      dataPath: this.dataPath,
      indexPath: this.indexPath,
      currentOffset: this.currentOffset,
      recordCount: this.recordCount,
      lastSequence: this.indexWriter.getLastSequence(),
    };
  }
}