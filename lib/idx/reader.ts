// src/index-file/reader.ts
import * as fs from 'node:fs';
import { IndexProtocol } from './protocol.js';
import type { IndexHeader, IndexEntry } from './types.js';

export class IndexReader {
    private buffer: Buffer | null = null;
    private header: IndexHeader | null = null;

    private path: string | null = null;

    constructor() {
    }

    open(idxFilePath: string): void {
        // Read entire file into buffer (simpler than mmap for read-only access)
        this.path = idxFilePath;
        this.buffer = fs.readFileSync(this.path);
        this.header = IndexProtocol.readHeader(this.buffer);
    }

    getHeader(): IndexHeader {
        if (!this.header) throw new Error('Index file not opened');
        return this.header;
    }

    getFlags(): number {
        if (!this.header) throw new Error('Index file not opened');
        return this.header.flags;
    }

    getEntry(index: number): IndexEntry | null {
        if (!this.buffer || !this.header) throw new Error('Index file not opened');
        if (index < 0 || index >= this.header.entryCount) return null;
        return IndexProtocol.readEntry(this.buffer, index);
    }

    findBySequence(sequence: number): { index: number; entry: IndexEntry } | null {
        if (!this.buffer || !this.header) throw new Error('Index file not opened');

        for (let i = 0; i < this.header.writtenCnt; i++) {
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
        for (let i = 0; i < this.header.writtenCnt; i++) {
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
        for (let i = 0; i < this.header.writtenCnt; i++) {
            const entry = IndexProtocol.readEntry(this.buffer, i);
            if (entry) entries.push(entry);
        }
        return entries;
    }

    findByTimeRange(startTs: bigint, endTs: bigint): { index: number; entry: IndexEntry }[] {
        if (!this.buffer || !this.header) throw new Error('Index file not opened');

        const results: { index: number; entry: IndexEntry }[] = [];
        for (let i = 0; i < this.header.writtenCnt; i++) {
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
        let right = this.header.writtenCnt - 1;

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
        // Simply release buffer reference (GC will handle cleanup)
        this.buffer = null;
        this.header = null;
    }
}
