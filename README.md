## 사용 예시

```typescript
// example.ts
import { DataWriter, DataReader, jsonSerializer, createSerializer } from './index.js';

// ============================================
// 1. JSON 직렬화 (간단한 경우)
// ============================================

interface UserLog {
  userId: string;
  action: string;
  metadata: Record<string, unknown>;
}

// 쓰기
const logWriter = new DataWriter<UserLog>('./data/logs', {
  serializer: jsonSerializer<UserLog>(),
  maxEntries: 100_000,
});
logWriter.open();

logWriter.append({ userId: 'u1', action: 'login', metadata: { ip: '1.2.3.4' } });
logWriter.append({ userId: 'u2', action: 'purchase', metadata: { amount: 100 } });
logWriter.append({ userId: 'u3', action: 'logout', metadata: {} });

console.log(logWriter.getStats());
logWriter.close();

// 읽기
const logReader = new DataReader<UserLog>('./data/logs', jsonSerializer<UserLog>());
logReader.open();

// 단일 조회
const single = logReader.getBySequence(2);
console.log('Single:', single);
// { sequence: 2, timestamp: 1234567890n, data: { userId: 'u2', action: 'purchase', ... } }

// 범위 조회
const bulk = logReader.getBulkData(1, 3);
console.log('Bulk:', bulk);
// [{ sequence: 1, ... }, { sequence: 2, ... }, { sequence: 3, ... }]

// 전체 조회
const all = logReader.getAllData();
console.log('Total:', all.length);

logReader.close();


// ============================================
// 2. 커스텀 바이너리 직렬화 (고성능)
// ============================================

interface SensorData {
  sensorId: number;
  temperature: number;
  humidity: number;
}

const sensorSerializer = createSerializer<SensorData>(
  // serialize
  (data) => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32LE(data.sensorId, 0);
    buf.writeFloatLE(data.temperature, 4);
    buf.writeFloatLE(data.humidity, 8);
    return buf;
  },
  // deserialize
  (buf) => ({
    sensorId: buf.readUInt32LE(0),
    temperature: buf.readFloatLE(4),
    humidity: buf.readFloatLE(8),
  })
);

const sensorWriter = new DataWriter<SensorData>('./data/sensors', {
  serializer: sensorSerializer,
  maxEntries: 1_000_000,
});
sensorWriter.open();

// 대량 추가
for (let i = 0; i < 10000; i++) {
  sensorWriter.append({
    sensorId: i % 100,
    temperature: 20 + Math.random() * 10,
    humidity: 40 + Math.random() * 30,
  });
}

sensorWriter.close();

const sensorReader = new DataReader<SensorData>('./data/sensors', sensorSerializer);
sensorReader.open();

// 범위 조회
const range = sensorReader.getBulkData(5000, 5010);
console.log('Range:', range.length, 'records');

// 타임스탬프 범위 조회
const now = BigInt(Date.now()) * 1000000n;
const oneHourAgo = now - 3600n * 1000000000n;
const byTime = sensorReader.getBulkDataByTime(oneHourAgo, now);
console.log('By time:', byTime.length, 'records');

sensorReader.close();


// ============================================
// 3. 벌크 추가
// ============================================

interface Order {
  orderId: string;
  amount: number;
  status: string;
}

const orderWriter = new DataWriter<Order>('./data/orders', {
  serializer: jsonSerializer<Order>(),
});
orderWriter.open();

const orders: Order[] = [
  { orderId: 'O-001', amount: 150, status: 'pending' },
  { orderId: 'O-002', amount: 250, status: 'completed' },
  { orderId: 'O-003', amount: 350, status: 'shipped' },
];

const sequences = orderWriter.appendBulk(orders);
console.log('Added sequences:', sequences);  // [1, 2, 3]

orderWriter.close();
```

---

## API 요약

### DataWriter<T>

| 메서드 | 설명 |
|--------|------|
| `open()` | 파일 열기 (없으면 생성) |
| `append(data, timestamp?)` | 레코드 추가, 시퀀스 반환 |
| `appendBulk(records, timestamp?)` | 여러 레코드 추가, 시퀀스 배열 반환 |
| `getLastSequence()` | 마지막 시퀀스 번호 |
| `getNextSequence()` | 다음 시퀀스 번호 |
| `sync()` | 디스크에 동기화 |
| `close()` | 파일 닫기 |
| `getStats()` | 상태 정보 |

### DataReader<T>

| 메서드 | 설명 |
|--------|------|
| `open()` | 파일 열기 |
| `getBySequence(seq)` | 시퀀스로 단일 조회 |
| `getByIndex(index)` | 인덱스로 단일 조회 |
| `getBulkData(startSeq, endSeq)` | 시퀀스 범위 조회 |
| `getBulkDataByTime(startTs, endTs)` | 타임스탬프 범위 조회 |
| `getAllData()` | 전체 조회 |
| `getRecordCount()` | 레코드 수 |
| `getLastSequence()` | 마지막 시퀀스 |
| `close()` | 파일 닫기 |

### Serializers

```typescript
// JSON (범용)
jsonSerializer<T>()

// MessagePack (빠름, npm install @msgpack/msgpack 필요)
msgpackSerializer<T>()

// 커스텀 바이너리
createSerializer<T>(serialize, deserialize)
```