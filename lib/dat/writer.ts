// src/data-file/writer.ts
import * as fs from 'node:fs';
import * as fsext from 'fs-ext';
import { DATA_HEADER_SIZE } from './constants.js';
import { DataProtocol, BufferRef } from './protocol.js';
import { IndexWriter, IndexFileOptionsRequired } from '../idx/index.js';
import type { Serializer, DataFileOptions } from './types.js';

const DEFAULT_DATA_BUF_SIZE = 4096;

export class DataWriter<T> {
    private fd: number | null = null;
    private headerBuf: Buffer = Buffer.alloc(DATA_HEADER_SIZE);
    private dataBufRef: BufferRef = { buf: Buffer.alloc(DEFAULT_DATA_BUF_SIZE) };
    private currentOffset: bigint = BigInt(DATA_HEADER_SIZE);
    private recordCount = 0;

    private indexWriter: IndexWriter;

    // See DataFileOptions
    private readonly serializer: Serializer<T>;
    private readonly forceTruncate: boolean;

    private latestSequence: number = 0;

    private readonly indexFileOpt: IndexFileOptionsRequired;

    private dataPath: string | null = null;
    private indexPath: string | null = null;


    constructor(options: DataFileOptions<T>) {
        this.serializer = options.serializer;
        this.forceTruncate = options.forceTruncate ?? false;

        this.indexFileOpt = {
            maxEntries: options.indexFileOpt.maxEntries ?? 10_000_000,
            autoIncrementSequence: options.indexFileOpt.autoIncrementSequence ?? false
        }

        this.indexWriter = new IndexWriter(this.indexFileOpt);
    }

    open(basePath: string): void {
        this.dataPath = `${basePath}.dat`;
        this.indexPath = `${basePath}.idx`;

        // Index file 을 Open 함으로써 파일을 시작 할 수 있는지 검증 (Throw 로써)
        // Open index file with maxEntries and autoIncrementSequence
        const writtenCount = this.indexWriter.open(this.indexPath, this.forceTruncate);
        const isNew = !fs.existsSync(this.dataPath);

        // Index file 은 초기화인데, 신규파일 혹은 강제 클리어가 아니라면
        if (writtenCount > 0 && isNew) {
            throw new Error(`Index file & Data File is invalid data of ${this.indexPath} | ${writtenCount} is exists but ${this.dataPath} is not exists`);
        }

        // Warn if forceTruncate will delete existing data
        if (this.forceTruncate && !isNew) {
            const stats = fs.statSync(this.dataPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            console.warn(
                `[DataWriter] forceTruncate enabled: Deleting ${sizeMB} MB of existing data\n` +
                `  Index: ${this.indexPath} (${writtenCount} records)\n` +
                `  Data: ${this.dataPath}`
            );
        }

        this.fd = fs.openSync(this.dataPath,
            isNew || this.forceTruncate ? 'w+' : 'r+');

        // 버퍼 초기화
        this.headerBuf.fill(0);
        this.dataBufRef.buf.fill(0);

        try {
            if (isNew || this.forceTruncate) {
                const header = DataProtocol.createHeader();
                fs.writeSync(this.fd, header, 0, DATA_HEADER_SIZE, null);
                this.currentOffset = BigInt(DATA_HEADER_SIZE);
                this.recordCount = 0;
                this.latestSequence = 0;
            } else {
                fs.readSync(this.fd, this.headerBuf, 0, DATA_HEADER_SIZE, null);
                const header = DataProtocol.readHeader(this.headerBuf);

                // Validate: Data file recordCount must match Index file writtenCnt
                if (header.recordCount !== writtenCount) {
                    throw new Error(
                        `Data file record count mismatch: Data has ${header.recordCount} but Index has ${writtenCount}`
                    );
                }

                this.currentOffset = header.fileSize;
                this.recordCount = header.recordCount;
                this.latestSequence = this.indexWriter.getLatestSequence();
                fsext.seekSync(this.fd, 0, 2); // 가장 마지막으로
            }
        } catch (error) {
            // Clean up resources on error
            if (this.fd !== null) {
                fs.closeSync(this.fd);
                this.fd = null;
            }
            this.headerBuf.fill(0);
            this.dataBufRef.buf.fill(0);
            throw error;
        }
    }

    append(data: T, sequence?: number, timestamp?: bigint): number {
        if (this.fd === null) throw new Error('Data file not opened');

        // dataBufRef에 직렬화 (내부에서 필요시 재할당)
        const writtenLen = DataProtocol.serializeRecordTo(this.dataBufRef, data, this.serializer);
        const offset = this.currentOffset;

        fs.writeSync(this.fd, this.dataBufRef.buf, 0, writtenLen, null);

        // Write to index file
        this.indexWriter.write(offset, writtenLen, sequence, timestamp);

        // Update latestSequence to the most recent sequence
        this.latestSequence = this.indexWriter.getLatestSequence();

        this.currentOffset += BigInt(writtenLen);
        ++this.recordCount;

        this.writeHeader();
        return this.latestSequence;
    }

    /*
    appendBulk(records: T[], sequences?: number[], timestamp?: bigint): number[] {
        // Runtime check: sequences required when autoIncrementSequence is false
        if (!this.autoIncrementSequence) {
            if (!sequences) {
                throw new Error('sequences is required when autoIncrementSequence is false');
            }
            if (sequences.length !== records.length) {
                throw new Error(`sequences length (${sequences.length}) must match records length (${records.length})`);
            }
        }

        const resultSequences: number[] = [];
        const ts = timestamp ?? BigInt(Date.now()) * 1000000n;

        for (let i = 0; i < records.length; i++) {
            const seq = sequences?.[i];
            const resultSeq = this.append(records[i], seq, ts);
            resultSequences.push(resultSeq);
        }

        return resultSequences;
    }
    */

    getLatestSequence(): number {
        return this.latestSequence;
    }

    writeHeader(): void {
        if (this.fd === null) return;

        DataProtocol.updateHeader(this.headerBuf, this.currentOffset, this.recordCount);
        fs.writeSync(this.fd, this.headerBuf, 0, DATA_HEADER_SIZE, 0);
    }

    sync(): void {
        if (this.fd === null) return;

        DataProtocol.updateHeader(this.headerBuf, this.currentOffset, this.recordCount);
        fs.writeSync(this.fd, this.headerBuf, 0, DATA_HEADER_SIZE, 0);
        fs.fsyncSync(this.fd);
    }

    close(): void {
        this.sync();

        if (this.fd !== null) {
            fs.closeSync(this.fd);
            this.fd = null;
        }

        this.indexWriter.close();
        this.headerBuf.fill(0);
        this.dataBufRef.buf.fill(0);
    }

    writeFlags(flags: number): void {
        this.indexWriter.writeFlags(flags);
    }

    getFlags(): number {
        return this.indexWriter.getFlags();
    }

    getStats() {
        return {
            dataPath: this.dataPath,
            indexPath: this.indexPath,
            currentOffset: this.currentOffset,
            recordCount: this.recordCount,
            latestSequence: this.indexWriter.getLatestSequence(),
        };
    }
}
