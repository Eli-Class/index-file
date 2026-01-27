```typescript
// 가변 배열 직렬화 예시
import { createSerializer, DataWriter, DataReader } from './src/data-file/index.js';

// ============================================
// 1. 단순 배열 (숫자 배열)
// ============================================

interface SensorReading {
  sensorId: number;
  values: number[];  // 가변 길이
}

const sensorSerializer = createSerializer<SensorReading>(
  (data) => {
    // 4(sensorId) + 4(배열길이) + 8*N(values)
    const buf = Buffer.alloc(4 + 4 + data.values.length * 8);
    let offset = 0;

    buf.writeUInt32LE(data.sensorId, offset); offset += 4;
    buf.writeUInt32LE(data.values.length, offset); offset += 4;

    for (const v of data.values) {
      buf.writeDoubleLE(v, offset); offset += 8;
    }

    return buf;
  },
  (buf) => {
    let offset = 0;

    const sensorId = buf.readUInt32LE(offset); offset += 4;
    const len = buf.readUInt32LE(offset); offset += 4;

    const values: number[] = [];
    for (let i = 0; i < len; i++) {
      values.push(buf.readDoubleLE(offset)); offset += 8;
    }

    return { sensorId, values };
  }
);


// ============================================
// 2. 객체 배열
// ============================================

interface OrderItem {
  sku: string;
  qty: number;
  price: number;
}

interface Order {
  orderId: number;
  items: OrderItem[];  // 가변 길이 객체 배열
  total: number;
}

const orderSerializer = createSerializer<Order>(
  (data) => {
    // 각 item의 sku 길이를 먼저 계산
    const skuBuffers = data.items.map(item => Buffer.from(item.sku, 'utf8'));
    const itemsSize = skuBuffers.reduce(
      (sum, skuBuf, i) => sum + 4 + skuBuf.length + 4 + 8,  // skuLen + sku + qty + price
      0
    );

    // 4(orderId) + 4(items길이) + itemsSize + 8(total)
    const buf = Buffer.alloc(4 + 4 + itemsSize + 8);
    let offset = 0;

    buf.writeUInt32LE(data.orderId, offset); offset += 4;
    buf.writeUInt32LE(data.items.length, offset); offset += 4;

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const skuBuf = skuBuffers[i];

      buf.writeUInt32LE(skuBuf.length, offset); offset += 4;
      skuBuf.copy(buf, offset); offset += skuBuf.length;
      buf.writeUInt32LE(item.qty, offset); offset += 4;
      buf.writeDoubleLE(item.price, offset); offset += 8;
    }

    buf.writeDoubleLE(data.total, offset);

    return buf;
  },
  (buf) => {
    let offset = 0;

    const orderId = buf.readUInt32LE(offset); offset += 4;
    const itemsLen = buf.readUInt32LE(offset); offset += 4;

    const items: OrderItem[] = [];
    for (let i = 0; i < itemsLen; i++) {
      const skuLen = buf.readUInt32LE(offset); offset += 4;
      const sku = buf.toString('utf8', offset, offset + skuLen); offset += skuLen;
      const qty = buf.readUInt32LE(offset); offset += 4;
      const price = buf.readDoubleLE(offset); offset += 8;

      items.push({ sku, qty, price });
    }

    const total = buf.readDoubleLE(offset);

    return { orderId, items, total };
  }
);


// ============================================
// 3. 다중 가변 배열
// ============================================

interface TimeSeries {
  id: number;
  timestamps: bigint[];  // 가변
  values: number[];      // 가변
  tags: string[];        // 가변
}

const timeSeriesSerializer = createSerializer<TimeSeries>(
  (data) => {
    const tagBuffers = data.tags.map(t => Buffer.from(t, 'utf8'));
    const tagsSize = tagBuffers.reduce((sum, b) => sum + 4 + b.length, 0);

    // 4(id) + 4(tsLen) + 8*N + 4(valLen) + 8*M + 4(tagLen) + tagsSize
    const size = 4 + 4 + data.timestamps.length * 8 + 4 + data.values.length * 8 + 4 + tagsSize;
    const buf = Buffer.alloc(size);
    let offset = 0;

    // id
    buf.writeUInt32LE(data.id, offset); offset += 4;

    // timestamps
    buf.writeUInt32LE(data.timestamps.length, offset); offset += 4;
    for (const ts of data.timestamps) {
      buf.writeBigUInt64LE(ts, offset); offset += 8;
    }

    // values
    buf.writeUInt32LE(data.values.length, offset); offset += 4;
    for (const v of data.values) {
      buf.writeDoubleLE(v, offset); offset += 8;
    }

    // tags
    buf.writeUInt32LE(data.tags.length, offset); offset += 4;
    for (const tagBuf of tagBuffers) {
      buf.writeUInt32LE(tagBuf.length, offset); offset += 4;
      tagBuf.copy(buf, offset); offset += tagBuf.length;
    }

    return buf;
  },
  (buf) => {
    let offset = 0;

    const id = buf.readUInt32LE(offset); offset += 4;

    // timestamps
    const tsLen = buf.readUInt32LE(offset); offset += 4;
    const timestamps: bigint[] = [];
    for (let i = 0; i < tsLen; i++) {
      timestamps.push(buf.readBigUInt64LE(offset)); offset += 8;
    }

    // values
    const valLen = buf.readUInt32LE(offset); offset += 4;
    const values: number[] = [];
    for (let i = 0; i < valLen; i++) {
      values.push(buf.readDoubleLE(offset)); offset += 8;
    }

    // tags
    const tagLen = buf.readUInt32LE(offset); offset += 4;
    const tags: string[] = [];
    for (let i = 0; i < tagLen; i++) {
      const len = buf.readUInt32LE(offset); offset += 4;
      tags.push(buf.toString('utf8', offset, offset + len)); offset += len;
    }

    return { id, timestamps, values, tags };
  }
);


// ============================================
// 사용 예시
// ============================================

// Order 쓰기
const writer = new DataWriter<Order>('./data/orders', {
  serializer: orderSerializer,
});
writer.open();

writer.append({
  orderId: 1001,
  items: [
    { sku: 'ITEM-A', qty: 2, price: 10.5 },
    { sku: 'ITEM-B', qty: 1, price: 25.0 },
    { sku: 'ITEM-C-LONG-SKU', qty: 5, price: 5.0 },
  ],
  total: 71.0,
});

writer.append({
  orderId: 1002,
  items: [{ sku: 'X', qty: 100, price: 1.0 }],
  total: 100.0,
});

writer.close();

// Order 읽기
const reader = new DataReader<Order>('./data/orders', orderSerializer);
reader.open();

const orders = reader.getBulkData(1, 2);
console.log(orders);
// [
//   { sequence: 1, data: { orderId: 1001, items: [...], total: 71 } },
//   { sequence: 2, data: { orderId: 1002, items: [...], total: 100 } },
// ]

reader.close();
```

---

## 가변 배열 직렬화 패턴

```
┌─────────────────────────────────────────────────┐
│ [길이 4bytes] [요소1] [요소2] ... [요소N]        │
└─────────────────────────────────────────────────┘
```

| 타입 | 직렬화 방식 |
|------|-------------|
| `number[]` | `[len:4] [val:8] [val:8] ...` |
| `string[]` | `[len:4] [strLen:4] [str] [strLen:4] [str] ...` |
| `Object[]` | `[len:4] [obj1 필드들] [obj2 필드들] ...` |
| `bigint[]` | `[len:4] [val:8] [val:8] ...` |

---

## 헬퍼 함수 (재사용)

```typescript
// dat/binary-helpers.ts

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
```

---

## 헬퍼 사용 예시

```typescript
import { createSerializer } from './src/data-file/index.js';
import { BinaryWriter, BinaryReader } from './src/data-file/binary-helpers.js';

interface Order {
  orderId: number;
  items: { sku: string; qty: number; price: number }[];
  total: number;
}

const orderSerializer = createSerializer<Order>(
  (data) => {
    const w = new BinaryWriter();
    w.writeUInt32(data.orderId);
    w.writeUInt32(data.items.length);
    for (const item of data.items) {
      w.writeString(item.sku);
      w.writeUInt32(item.qty);
      w.writeDouble(item.price);
    }
    w.writeDouble(data.total);
    return w.toBuffer();
  },
  (buf) => {
    const r = new BinaryReader(buf);
    const orderId = r.readUInt32();
    const itemsLen = r.readUInt32();
    const items = [];
    for (let i = 0; i < itemsLen; i++) {
      items.push({
        sku: r.readString(),
        qty: r.readUInt32(),
        price: r.readDouble(),
      });
    }
    const total = r.readDouble();
    return { orderId, items, total };
  }
);
```
