// src/index-file/protocol.ts
import {
    INDEX_MAGIC,
    INDEX_VERSION,
    INDEX_HEADER_SIZE,
    INDEX_ENTRY_SIZE,
    FLAG_VALID,
} from './constants.js';
import type { IndexHeader, IndexEntry } from './types.js';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
}

export function crc32(buf: Buffer, start = 0, end?: number): number {
    let crc = 0xFFFFFFFF;
    const len = end ?? buf.length;
    for (let i = start; i < len; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (~crc) >>> 0;
}

export class IndexProtocol {
    static createHeader(entryCount: number, autoIncrementSequence: boolean, magic = INDEX_MAGIC): Buffer {
        const buf = Buffer.alloc(INDEX_HEADER_SIZE);
        buf.write(magic, 0, 4, 'ascii');
        buf.writeUInt32LE(INDEX_VERSION, 4);
        buf.writeBigUInt64LE(BigInt(Date.now()) * 1000000n, 8);
        buf.writeUInt32LE(INDEX_ENTRY_SIZE, 16);
        buf.writeUInt32LE(entryCount, 20);
        buf.writeUInt32LE(0, 24);  // writtenCnt
        buf.writeBigUInt64LE(0n, 28);  // dataFileSize
        buf.writeUInt32LE(0, 36);  // latestSequence
        buf.writeUInt8(autoIncrementSequence ? 1 : 0, 40);  // autoIncrementSequence
        buf.writeUInt32LE(0, 41);  // flags
        return buf;
    }

    static readHeader(buf: Buffer): IndexHeader {
        return {
            magic: buf.toString('ascii', 0, 4),
            version: buf.readUInt32LE(4),
            createdAt: buf.readBigUInt64LE(8),
            entrySize: buf.readUInt32LE(16),
            entryCount: buf.readUInt32LE(20),
            writtenCnt: buf.readUInt32LE(24),
            dataFileSize: buf.readBigUInt64LE(28),
            latestSequence: buf.readUInt32LE(36),
            autoIncrementSequence: buf.readUInt8(40) === 1,
            flags: buf.readUInt32LE(41),
            reserved: buf.subarray(45, 64),
        };
    }

    static writeFlags(buf: Buffer, flags: number): void {
        buf.writeUInt32LE(flags, 41);
    }

    static updateHeaderCounts(
        buf: Buffer,
        writtenCnt: number,
        dataFileSize: bigint,
        latestSequence: number
    ): void {
        buf.writeUInt32LE(writtenCnt, 24);
        buf.writeBigUInt64LE(dataFileSize, 28);
        buf.writeUInt32LE(latestSequence, 36);
    }

    static writeEntry(buf: Buffer, entry: Omit<IndexEntry, 'checksum'>): void {
        buf.writeUInt32LE(entry.sequence, 0);
        buf.writeBigUInt64LE(entry.timestamp, 4);
        buf.writeBigUInt64LE(entry.offset, 12);
        buf.writeUInt32LE(entry.length, 20);
        buf.writeUInt32LE(entry.flags | FLAG_VALID, 24);

        const checksum = crc32(buf, 0, 28);
        buf.writeUInt32LE(checksum, 28);
    }

    static calcFileSize(entryCount: number): number {
        return INDEX_HEADER_SIZE + INDEX_ENTRY_SIZE * entryCount;
    }
}
