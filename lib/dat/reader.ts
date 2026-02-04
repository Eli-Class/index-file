// src/data-file/reader.ts
import * as fs from 'node:fs';
import { DATA_HEADER_SIZE } from './constants.js';
import { DataProtocol, DataHeader } from './protocol.js';
import { IndexReader } from '../idx/index.js';
import type { Serializer, DataEntry, DataFileReaderOptions } from './types.js';

export class DataReader<T> {
    private fd: number | null = null;
    private header: DataHeader | null = null;

    private indexReader: IndexReader;
    private serializer: Serializer<T>;

    private dataPath: string | null = null;
    private indexPath: string | null = null;

    constructor(options: DataFileReaderOptions<T>) {
        this.serializer = options.serializer;
        this.indexReader = new IndexReader();
    }

    open(basePath: string): void {
        this.dataPath = `${basePath}.dat`;
        this.indexPath = `${basePath}.idx`;

        this.fd = fs.openSync(this.dataPath, 'r');

        // Read header only
        const headerBuf = Buffer.alloc(DATA_HEADER_SIZE);
        fs.readSync(this.fd, headerBuf, 0, DATA_HEADER_SIZE, 0);
        this.header = DataProtocol.readHeader(headerBuf);

        this.indexReader.open(this.indexPath);
    }

    private readRecordAt(fd: number, offset: bigint, length: number): { data: T; length: number } | null {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, Number(offset));
        const result = DataProtocol.deserializeRecord(
            buf,
            0,
            this.serializer
        );
        return result;
    }

    private readNextRecord(fd: number, length: number): { data: T; length: number } | null {
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, null);
        const result = DataProtocol.deserializeRecord(
            buf,
            0,
            this.serializer
        );
        return result;
    }

    getHeader(): DataHeader {
        if (!this.header) throw new Error('Data file not opened');
        return this.header;
    }

    getBySequence(sequence: number): DataEntry<T> | null {
        if (this.fd === null) throw new Error('Data file not opened');

        const found = this.indexReader.binarySearchBySequence(sequence);
        if (!found) return null;

        const result = this.readRecordAt(this.fd, found.entry.offset, found.entry.length);

        if (!result) return null;

        return {
            index: found.index,
            sequence: found.entry.sequence,
            timestamp: found.entry.timestamp,
            data: result.data,
        };
    }

    getByIndex(index: number): DataEntry<T> | null {
        if (this.fd === null) throw new Error('Data file not opened');

        const entry = this.indexReader.getEntry(index);
        if (!entry) return null;

        const result = this.readRecordAt(this.fd, entry.offset, entry.length);

        if (!result) return null;

        return {
            index: index,
            sequence: entry.sequence,
            timestamp: entry.timestamp,
            data: result.data,
        };
    }

    getBulkDataBySequence(startSeq: number, endSeq: number): DataEntry<T>[] {
        if (this.fd === null) throw new Error('Data file not opened');

        const results: DataEntry<T>[] = [];
        const indexResults = this.indexReader.findBySequenceRange(startSeq, endSeq);
        if (indexResults.length === 0) return [];

        const firstRecord = this.readRecordAt(this.fd, indexResults[0].entry.offset, indexResults[0].entry.length);
        if (firstRecord) {
            results.push({
                index: indexResults[0].index,
                sequence: indexResults[0].entry.sequence,
                timestamp: indexResults[0].entry.timestamp,
                data: firstRecord.data,
            })
        }

        for (let i = 1; i < indexResults.length; i++) {
            const { index, entry } = indexResults[i];
            const result = this.readNextRecord(this.fd, entry.length);
            if (!result) continue;

            results.push({
                index: index,
                sequence: entry.sequence,
                timestamp: entry.timestamp,
                data: result.data,
            });
        }

        return results;
    }

    getBulkDataByTime(startTs: bigint, endTs: bigint): DataEntry<T>[] {
        if (this.fd === null) throw new Error('Data file not opened');

        const results: DataEntry<T>[] = [];
        const indexResults = this.indexReader.findByTimeRange(startTs, endTs);
        if (indexResults.length === 0) return [];

        const firstRecord = this.readRecordAt(this.fd, indexResults[0].entry.offset, indexResults[0].entry.length);
        if (firstRecord) {
            results.push({
                index: indexResults[0].index,
                sequence: indexResults[0].entry.sequence,
                timestamp: indexResults[0].entry.timestamp,
                data: firstRecord.data,
            })
        }

        for (let i = 1; i < indexResults.length; i++) {
            const { index, entry } = indexResults[i];
            const result = this.readNextRecord(this.fd, entry.length);
            if (!result) continue;

            results.push({
                index: index,
                sequence: entry.sequence,
                timestamp: entry.timestamp,
                data: result.data,
            });
        }

        return results;
    }

    /*
    getAllData(): DataEntry<T>[] {
        if (this.fd === null) throw new Error('Data file not opened');
     
        const entries = this.indexReader.getAllEntries();
        const results: DataEntry<T>[] = [];
     
        for (const entry of entries) {
            const buf = this.readRecordAt(this.fd, entry.offset, entry.length);
            const result = DataProtocol.deserializeRecord(
                buf,
                0,
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
    */

    getRecordCount(): number {
        return this.indexReader.getHeader().writtenCnt;
    }

    getLastSequence(): number {
        return this.indexReader.getHeader().latestSequence;
    }

    getFlags(): number {
        return this.indexReader.getFlags();
    }

    readNext(): DataEntry<T> | null {
        if (this.fd === null) throw new Error('Data file not opened');

        const next = this.indexReader.getNextEntry();
        if (!next) return null;
        const { index, entry } = next;

        const result = this.readNextRecord(this.fd, entry.length);
        if (!result) return null;

        return {
            index,
            sequence: entry.sequence,
            timestamp: entry.timestamp,
            data: result.data,
        };
    }

    getCurrentIndex(): number {
        return this.indexReader.getCurrentIndex();
    }

    getCurrentSequence(): number {
        return this.indexReader.getCurrentSequence();
    }

    close(): void {
        if (this.fd !== null) {
            fs.closeSync(this.fd);
            this.fd = null;
        }
        this.header = null;
        this.indexReader.close();
    }
}
