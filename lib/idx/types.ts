// src/index-file/types.ts
export interface IndexHeader {
  magic: string;
  version: number;
  createdAt: bigint;
  entrySize: number;
  entryCount: number;
  validCount: number;
  dataFileSize: bigint;
  lastSequence: number;
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
  maxEntries: number;
  magic?: string;
}