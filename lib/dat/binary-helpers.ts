export class BinaryWriter {
  private chunks: Buffer[] = [];

  writeUInt32(value: number): this {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    this.chunks.push(buf);
    return this;
  }

  writeDouble(value: number): this {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value, 0);
    this.chunks.push(buf);
    return this;
  }

  writeBigUInt64(value: bigint): this {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value, 0);
    this.chunks.push(buf);
    return this;
  }

  writeString(value: string): this {
    const strBuf = Buffer.from(value, 'utf8');
    this.writeUInt32(strBuf.length);
    this.chunks.push(strBuf);
    return this;
  }

  writeNumberArray(values: number[]): this {
    this.writeUInt32(values.length);
    for (const v of values) this.writeDouble(v);
    return this;
  }

  writeStringArray(values: string[]): this {
    this.writeUInt32(values.length);
    for (const v of values) this.writeString(v);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export class BinaryReader {
  private offset = 0;

  constructor(private buf: Buffer) {}

  readUInt32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readDouble(): number {
    const v = this.buf.readDoubleLE(this.offset);
    this.offset += 8;
    return v;
  }

  readBigUInt64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readString(): string {
    const len = this.readUInt32();
    const v = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return v;
  }

  readNumberArray(): number[] {
    const len = this.readUInt32();
    const arr: number[] = [];
    for (let i = 0; i < len; i++) arr.push(this.readDouble());
    return arr;
  }

  readStringArray(): string[] {
    const len = this.readUInt32();
    const arr: string[] = [];
    for (let i = 0; i < len; i++) arr.push(this.readString());
    return arr;
  }
}