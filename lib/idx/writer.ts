// src/index-file/writer.ts
import * as fs from 'node:fs';
import * as fsext from 'fs-ext';
import { INDEX_HEADER_SIZE, INDEX_ENTRY_SIZE, FLAG_VALID } from './constants.js';
import { IndexProtocol } from './protocol.js';
import { IndexFileOptionsRequired } from './types.js';

export class IndexWriter {
    private fd: number | null = null;
    private headerBuf: Buffer = Buffer.alloc(INDEX_HEADER_SIZE);
    private entryBuf: Buffer = Buffer.alloc(INDEX_ENTRY_SIZE);

    private writtenCnt = 0;
    private dataFileSize = 0n;
    private latestSequence = 0;

    private path: string | null = null;
    private fileSize: number = 0;


    // see IndexFileOptions
    private maxEntries: number = 0;
    private autoIncrementSequence: boolean = false;

    constructor(opt: IndexFileOptionsRequired) {
        // Empty constructor - maxEntries provided in open()
        this.maxEntries = opt.maxEntries;
        this.autoIncrementSequence = opt.autoIncrementSequence;
    }

    open(path: string, forceTruncate: boolean = false): number {
        this.path = path;

        const isNew = !fs.existsSync(this.path);

        // 버퍼 초기화
        this.headerBuf.fill(0);
        this.entryBuf.fill(0);

        if (isNew || forceTruncate) {
            // New file: use provided values
            this.fileSize = IndexProtocol.calcFileSize(this.maxEntries);
            this.writtenCnt = 0;
            this.dataFileSize = 0n;
            this.latestSequence = 0;

            this.fd = fs.openSync(this.path, 'w+');
            fs.ftruncateSync(this.fd, this.fileSize);

            const header = IndexProtocol.createHeader(this.maxEntries, this.autoIncrementSequence);
            header.copy(this.headerBuf, 0);

            // Write header to file
            fs.writeSync(this.fd, this.headerBuf, 0, INDEX_HEADER_SIZE, null);
            fs.fsyncSync(this.fd);
        } else {
            // Existing file: read header first
            this.fd = fs.openSync(this.path, 'r+');

            try {
                fs.readSync(this.fd, this.headerBuf, 0, INDEX_HEADER_SIZE, null);
                const header = IndexProtocol.readHeader(this.headerBuf);

                if (this.maxEntries !== header.entryCount) {
                    throw new Error(
                        `maxEntries mismatch: provided ${this.maxEntries} but file has ${header.entryCount}`
                    );
                }
                if (this.autoIncrementSequence !== header.autoIncrementSequence) {
                    throw new Error(
                        `autoIncrementSequence mismatch: provided ${this.autoIncrementSequence} but file has ${header.autoIncrementSequence}`
                    );
                }

                const expectFileSize = IndexProtocol.calcFileSize(this.maxEntries);
                const calcedFileSize = IndexProtocol.calcFileSize(header.entryCount);
                if (expectFileSize !== calcedFileSize) {
                    // if (opt.version !== header.version) { 버전이 다른거니까 어떻게 처리 할지는 추후 고민 TODO }
                    throw new Error(
                        `Indexfile size calc is invalid : provided ${expectFileSize} but file has ${calcedFileSize}`
                    );
                }

                this.fileSize = calcedFileSize;
                this.writtenCnt = header.writtenCnt;
                this.dataFileSize = header.dataFileSize;
                this.latestSequence = header.latestSequence;
                // Writer 중 이미 있었으면 가장 마지막으로 이동
                const fileOffset = INDEX_HEADER_SIZE + this.writtenCnt * INDEX_ENTRY_SIZE;
                fsext.seekSync(this.fd, fileOffset, 0);
            } catch (error) {
                // Clean up resources on error
                if (this.fd !== null) {
                    fs.closeSync(this.fd);
                    this.fd = null;
                }
                this.headerBuf.fill(0);
                this.entryBuf.fill(0);
                throw error;
            }
        }

        return this.writtenCnt;
    }

    write(
        offset: bigint,
        length: number,
        sequence?: number,
        timestamp?: bigint
    ): boolean {
        if (this.fd === null) throw new Error('Index file not opened');
        if (this.writtenCnt >= this.maxEntries) {
            throw new Error(`Data count exceed provide : ${this.writtenCnt + 1} - max : ${this.maxEntries}`);
        }

        // Calculate sequence
        let seq: number;
        if (!this.autoIncrementSequence) {
            if (sequence === undefined) {
                throw new Error('sequence is required when autoIncrementSequence is false');
            }
            seq = sequence;
        } else {
            seq = this.writtenCnt + 1;
        }

        const ts = timestamp ?? BigInt(Date.now()) * 1000000n;

        // Write entry to entryBuf (offset 0부터)
        IndexProtocol.writeEntry(this.entryBuf, {
            sequence: seq,
            timestamp: ts,
            offset,
            length,
            flags: FLAG_VALID,
        });

        // Write entry to file (현재 fd 위치에 쓰기)
        fs.writeSync(this.fd, this.entryBuf, 0, INDEX_ENTRY_SIZE, null);

        this.writtenCnt++;
        this.latestSequence = seq;

        const newDataEnd = offset + BigInt(length);
        if (newDataEnd > this.dataFileSize) {
            this.dataFileSize = newDataEnd;
        }

        // Sync immediately after write
        this.writeHeader();

        return true;
    }

    getLatestSequence(): number {
        return this.latestSequence;
    }

    getFlags(): number {
        if (this.fd === null) throw new Error('Index file not opened');
        return this.headerBuf.readUInt32LE(41);
    }

    writeHeader(): void {
        if (this.fd === null) return;

        // Update header counts
        IndexProtocol.updateHeaderCounts(
            this.headerBuf,
            this.writtenCnt,
            this.dataFileSize,
            this.latestSequence
        );

        // Write header to file
        fs.writeSync(this.fd, this.headerBuf, 0, INDEX_HEADER_SIZE, 0);
    }

    syncAll(): void {
        if (this.fd === null) return;

        // Sync header first
        this.writeHeader();

        // Sync all file changes to disk
        fs.fsyncSync(this.fd);
    }

    close(): void {
        if (this.fd === null) return;

        // 1. Sync all changes
        this.syncAll();

        // 2. Close file descriptor
        fs.closeSync(this.fd);
        this.fd = null;

        // 3. Clean up buffers
        this.headerBuf.fill(0);
        this.entryBuf.fill(0);
    }

    writeFlags(flags: number): void {
        if (this.fd === null) {
            throw new Error('Index file not opened');
        }

        IndexProtocol.writeFlags(this.headerBuf, flags);
        fs.writeSync(this.fd, this.headerBuf, 41, 4, 41);
        fs.fsyncSync(this.fd);
    }

    getStats() {
        return {
            path: this.path,
            writtenCnt: this.writtenCnt,
            dataFileSize: this.dataFileSize,
            latestSequence: this.latestSequence,
        };
    }
}
