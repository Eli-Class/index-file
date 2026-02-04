import { IndexFileOptions } from "../idx/types.js";

// src/data-file/types.ts
export interface Serializer<T> {
    serialize(data: T): Buffer;
    deserialize(buf: Buffer): T;
}

export interface DataEntry<T> {
    index: number;
    sequence: number;
    timestamp: bigint;
    data: T;
}

export interface DataFileOptions<T> {
    serializer: Serializer<T>;
    forceTruncate?: boolean;
    indexFileOpt: IndexFileOptions;
}

export interface DataFileReaderOptions<T> {
    serializer: Serializer<T>;
}
