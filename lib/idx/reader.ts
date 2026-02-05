// src/index-file/reader.ts
import * as fs from 'node:fs';
import * as fsext from 'fs-ext';
import { INDEX_HEADER_SIZE, INDEX_ENTRY_SIZE, FLAG_VALID } from './constants.js';
import { IndexProtocol } from './protocol.js';
import type { IndexHeader, IndexEntry } from './types.js';

export class IndexReader {
    private fd: number | null = null;
    private header: IndexHeader | null = null;

    private path: string | null = null;

    // Sequential read state
    private currentIndex: number = -1;
    private currentSequence: number = -1;

    // Reusable buffers
    private headerBuf: Buffer = Buffer.alloc(INDEX_HEADER_SIZE);
    private entryBuffer: Buffer = Buffer.alloc(INDEX_ENTRY_SIZE);

    constructor() {
    }

    open(idxFilePath: string): void {
        this.path = idxFilePath;

        // 버퍼 초기화
        this.headerBuf.fill(0);
        this.entryBuffer.fill(0);

        this.fd = fs.openSync(this.path, 'r');

        // Read header only (64 bytes)
        fs.readSync(this.fd, this.headerBuf, 0, INDEX_HEADER_SIZE, null);
        this.header = IndexProtocol.readHeader(this.headerBuf);
        // 아예 최초에는 -1 로 두어서 readNextEntry 할때 자동 ++ 할때 오류를 검증
        this.currentIndex = -1;
        this.currentSequence = -1;
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
        if (this.fd === null || !this.header) throw new Error('Index file not opened');
        if (index < 0 || index >= this.header.writtenCnt) return null;
        return this.readEntryAt(this.fd, index);
    }

    /*
    getAllEntries(): IndexEntry[] {
        if (this.fd === null || !this.header) throw new Error('Index file not opened');

        const entries: IndexEntry[] = [];
        for (let i = 0; i < this.header.writtenCnt; i++) {
            const entry = this.readEntryAt(this.fd, i);
            if (entry) entries.push(entry);
        }
        return entries;
    }
    */

    findBySequenceRange(startSeq: number, endSeq: number): { index: number; entry: IndexEntry }[] {
        if (this.fd === null || !this.header) throw new Error('Index file not opened');

        const results: { index: number; entry: IndexEntry }[] = [];
        const currIdx = this.currentIndex;
        const first = this.searchSequenceLowerBound(this.fd, this.header.writtenCnt, startSeq);
        if (first === null) {
            this.currentIndex = currIdx;
            return [];
        }

        results.push(first);
        while (this.currentIndex < this.header.writtenCnt - 1) {
            const entry = this.readNextEntry(this.fd);
            if (entry == null || entry.sequence > endSeq) break;
            results.push({ index: this.currentIndex, entry });
        }
        return results;
    }

    findByTimeRange(startTs: bigint, endTs: bigint): { index: number; entry: IndexEntry }[] {
        if (this.fd === null || !this.header) throw new Error('Index file not opened');

        const results: { index: number; entry: IndexEntry }[] = [];
        const currIdx = this.currentIndex;
        const first = this.searchTimestampLowerBound(this.fd, this.header.writtenCnt, startTs);
        if (first === null) {
            this.currentIndex = currIdx;
            return [];
        }

        results.push(first);
        while (this.currentIndex < this.header.writtenCnt - 1) {
            const entry = this.readNextEntry(this.fd);
            if (entry == null || entry.timestamp > endTs) break;
            results.push({ index: this.currentIndex, entry });
        }
        return results;
    }

    binarySearchBySequence(targetSeq: number): { index: number; entry: IndexEntry } | null {
        if (this.fd === null || !this.header) throw new Error('Index file not opened');
        return this.searchSequenceExact(this.fd, this.header.writtenCnt, targetSeq);
    }

    getNextEntry(): { index: number; entry: IndexEntry } | null {
        if (this.fd === null || !this.header) throw new Error('Index file not opened');

        if (this.currentIndex >= (this.header.writtenCnt - 1)) {
            return null;
        }

        const entry = this.readNextEntry(this.fd);
        if (!entry) return null;

        return { index: this.currentIndex, entry };
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    getCurrentSequence(): number {
        return this.currentSequence;
    }

    close(): void {
        if (this.fd !== null) {
            fs.closeSync(this.fd);
            this.fd = null;
        }
        this.header = null;
        this.currentIndex = -1;
        this.currentSequence = -1;

        // 버퍼 초기화
        this.headerBuf.fill(0);
        this.entryBuffer.fill(0);
    }

    // ######################################################################
    //                        Private methods
    // ######################################################################
    private readEntryAt(fd: number, index: number): IndexEntry | null {
        const offset = INDEX_HEADER_SIZE + index * INDEX_ENTRY_SIZE;
        fsext.seekSync(fd, offset, 0);
        fs.readSync(fd, this.entryBuffer, 0, INDEX_ENTRY_SIZE, null);

        const flags = this.entryBuffer.readUInt32LE(24);
        const indexEntry = this.buildIndexEntry(flags);

        this.currentIndex = index;
        this.currentSequence = indexEntry.sequence;

        if (!(flags & FLAG_VALID)) return null;
        return indexEntry;
    }

    private readNextEntry(fd: number): IndexEntry | null {
        fs.readSync(fd, this.entryBuffer, 0, INDEX_ENTRY_SIZE, null);

        const flags = this.entryBuffer.readUInt32LE(24);
        const indexEntry = this.buildIndexEntry(flags);

        ++this.currentIndex;
        this.currentSequence = indexEntry.sequence;

        if (!(flags & FLAG_VALID)) return null;
        return indexEntry;
    }

    private buildIndexEntry(flags: number): IndexEntry {
        return {
            sequence: this.entryBuffer.readUInt32LE(0),
            timestamp: this.entryBuffer.readBigUInt64LE(4),
            offset: this.entryBuffer.readBigUInt64LE(12),
            length: this.entryBuffer.readUInt32LE(20),
            flags,
            checksum: this.entryBuffer.readUInt32LE(28),
        };
    }

    // Timestamp binary search methods
    private searchTimestampExact(fd: number, writtenCnt: number, targetTs: bigint): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.timestamp === targetTs) return { index: mid, entry };
            if (entry.timestamp < targetTs) left = mid + 1;
            else right = mid - 1;
        }
        return null;
    }

    private searchTimestampLowerBound(fd: number, writtenCnt: number, targetTs: bigint): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;
        let result: { index: number; entry: IndexEntry } | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.timestamp >= targetTs) {
                result = { index: mid, entry };
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        return result;
    }

    private searchTimestampUpperBound(fd: number, writtenCnt: number, targetTs: bigint): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;
        let result: { index: number; entry: IndexEntry } | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.timestamp <= targetTs) {
                result = { index: mid, entry };
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return result;
    }

    // Sequence binary search methods
    private searchSequenceExact(fd: number, writtenCnt: number, targetSeq: number): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.sequence === targetSeq) return { index: mid, entry };
            if (entry.sequence < targetSeq) left = mid + 1;
            else right = mid - 1;
        }
        return null;
    }

    private searchSequenceLowerBound(fd: number, writtenCnt: number, targetSeq: number): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;
        let result: { index: number; entry: IndexEntry } | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.sequence >= targetSeq) {
                result = { index: mid, entry };
                right = mid - 1;
            } else {
                left = mid + 1;
            }
        }
        return result;
    }

    private searchSequenceUpperBound(fd: number, writtenCnt: number, targetSeq: number): { index: number; entry: IndexEntry } | null {
        let left = 0;
        let right = writtenCnt - 1;
        let result: { index: number; entry: IndexEntry } | null = null;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const entry = this.readEntryAt(fd, mid);
            if (!entry) { right = mid - 1; continue; }

            if (entry.sequence <= targetSeq) {
                result = { index: mid, entry };
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return result;
    }
}
