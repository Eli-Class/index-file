// src/data-file/serializers.ts
import type { Serializer } from './types.js';

export function jsonSerializer<T>(): Serializer<T> {
  return {
    serialize(data: T): Buffer {
      return Buffer.from(JSON.stringify(data), 'utf8');
    },
    deserialize(buf: Buffer): T {
      return JSON.parse(buf.toString('utf8'));
    },
  };
}

export function msgpackSerializer<T>(): Serializer<T> {
  const { encode, decode } = require('@msgpack/msgpack');
  return {
    serialize(data: T): Buffer {
      return Buffer.from(encode(data));
    },
    deserialize(buf: Buffer): T {
      return decode(buf) as T;
    },
  };
}

export function createSerializer<T>(
  serialize: (data: T) => Buffer,
  deserialize: (buf: Buffer) => T
): Serializer<T> {
  return { serialize, deserialize };
}