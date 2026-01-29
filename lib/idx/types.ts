// src/index-file/types.ts
export interface IndexHeader {
    magic: string;
    version: number;
    createdAt: bigint;
    entrySize: number;
    entryCount: number;
    writtenCnt: number;
    dataFileSize: bigint;
    latestSequence: number;
    autoIncrementSequence: boolean;
    reserved: Buffer;
}

export interface IndexEntry {
    sequence: number;
    timestamp: bigint;
    offset: bigint;
    length: number;
    flags: number;
    checksum: number;
}

export interface IndexFileOptions {
    maxEntries?: number;
    autoIncrementSequence?: boolean;
}

export type IndexFileOptionsRequired = Required<IndexFileOptions>;
