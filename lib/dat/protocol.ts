// src/data-file/protocol.ts
import { DATA_MAGIC, DATA_VERSION, DATA_HEADER_SIZE, RECORD_HEADER_SIZE } from './constants.js';
import { crc32 } from '../idx/index.js';
import type { Serializer } from './types.js';

export interface DataHeader {
  magic: string;
  version: number;
  createdAt: bigint;
  fileSize: bigint;
  recordCount: number;
  reserved: Buffer;
}

export class DataProtocol {
  static createHeader(): Buffer {
    const buf = Buffer.alloc(DATA_HEADER_SIZE);
    buf.write(DATA_MAGIC, 0, 4, 'ascii');
    buf.writeUInt32LE(DATA_VERSION, 4);
    buf.writeBigUInt64LE(BigInt(Date.now()) * 1000000n, 8);
    buf.writeBigUInt64LE(BigInt(DATA_HEADER_SIZE), 16);
    buf.writeUInt32LE(0, 24);
    return buf;
  }

  static readHeader(buf: Buffer): DataHeader {
    return {
      magic: buf.toString('ascii', 0, 4),
      version: buf.readUInt32LE(4),
      createdAt: buf.readBigUInt64LE(8),
      fileSize: buf.readBigUInt64LE(16),
      recordCount: buf.readUInt32LE(24),
      reserved: buf.subarray(28, 64),
    };
  }

  static updateHeader(buf: Buffer, fileSize: bigint, recordCount: number): void {
    buf.writeBigUInt64LE(fileSize, 16);
    buf.writeUInt32LE(recordCount, 24);
  }

  static serializeRecord<T>(data: T, serializer: Serializer<T>): Buffer {
    const dataBytes = serializer.serialize(data);
    const totalLen = RECORD_HEADER_SIZE + dataBytes.length;

    const buf = Buffer.alloc(totalLen);

    dataBytes.copy(buf, RECORD_HEADER_SIZE);

    buf.writeUInt32LE(dataBytes.length, 0);
    const checksum = crc32(buf, RECORD_HEADER_SIZE, totalLen);
    buf.writeUInt32LE(checksum, 4);

    return buf;
  }

  static deserializeRecord<T>(
    buf: Buffer,
    offset: number,
    serializer: Serializer<T>
  ): { data: T; length: number } | null {
    if (offset + RECORD_HEADER_SIZE > buf.length) return null;

    const dataLen = buf.readUInt32LE(offset);
    const storedChecksum = buf.readUInt32LE(offset + 4);

    const totalLen = RECORD_HEADER_SIZE + dataLen;
    if (offset + totalLen > buf.length) return null;

    const calcChecksum = crc32(buf, offset + RECORD_HEADER_SIZE, offset + totalLen);
    if (calcChecksum !== storedChecksum) {
      throw new Error(`Checksum mismatch at offset ${offset}`);
    }

    const dataBytes = buf.subarray(offset + RECORD_HEADER_SIZE, offset + totalLen);
    const data = serializer.deserialize(dataBytes);

    return { data, length: totalLen };
  }
}