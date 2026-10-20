# LAB 3 — Kết nối và duy trì kết nối giữa các service

Hệ thống thanh toán học phí với 4 tình huống sự cố.

## Cấu trúc

```
├── bank-service/     Ngân hàng giả lập (cổng 4002)
├── fee-service/      Fee Service của trường (cổng 4001)
└── scripts/          Scripts test tình huống 3 & 4
```

## Cài đặt

```bash
# Terminal 1
cd bank-service
npm install

# Terminal 2
cd fee-service
npm install
```

---

## Tình huống 1 — Ngân hàng không kết nối được

**Bước 1:** Chạy Fee Service, KHÔNG chạy ngân hàng
```bash
cd fee-service && node index.js
```

**Bước 2:** Gọi thanh toán (phải trả 503 trong < 1.5s)
```
POST http://localhost:4001/students/1/payments
Body: {"amount": 100000}
```

**Bước 3:** Kiểm tra Fee Service còn sống
```
GET http://localhost:4001/students/1/fees  → 200 nhanh
```

**Bước 4:** Khởi động ngân hàng (KHÔNG restart Fee Service)
```bash
cd bank-service && node index.js
```

**Bước 5:** Gọi lại → phải trả 201

**Thay đổi BANK_URL:**
```bash
BANK_URL=http://localhost:4999 node index.js   # vẫn hoạt động đúng
```

---

## Tình huống 2 — Ngân hàng phản hồi rất chậm

**Chạy ngân hàng với delay 5 giây:**
```bash
cd bank-service
DELAY_MS=5000 node index.js
```

**Chạy Fee Service:**
```bash
cd fee-service && node index.js
```

**Test đơn lẻ** (phải trả 504 PENDING trong ≤ 4.5s):
```
POST http://localhost:4001/students/1/payments
Body: {"amount": 100000}
```

**Test 20 yêu cầu cùng lúc** (trong lúc đó gọi GET /fees):
```bash
# Dùng Postman Runner hoặc:
for i in {1..20}; do curl -X POST http://localhost:4001/students/1/payments -H "Content-Type: application/json" -d '{"amount":1000}' &; done
# Trong lúc đó:
curl http://localhost:4001/students/1/fees  # phải trả < 300ms
```

---

## Tình huống 3 — Duy trì kết nối (Keep-Alive)

**Chạy ngân hàng bình thường:**
```bash
cd bank-service && node index.js
```

**Chạy Fee Service:**
```bash
cd fee-service && node index.js
```

**Chạy script test (200 thanh toán, 10 cùng lúc):**
```bash
node scripts/test-scenario3.js
```
→ Kiểm tra: số kết nối TCP ≤ 20, 200/200 thành công.

**Test sau 6 giây nhàn rỗi:**
```bash
node scripts/test-scenario3-reconnect.js
```

---

## Tình huống 4 — Đứt giữa chừng, lỗi tạm thời, bị từ chối

### 4a — DROP_RATE=0.3 (trừ tiền xong rồi cắt kết nối)
```bash
DROP_RATE=0.3 node bank-service/index.js
node scripts/test-scenario4.js a
```
Kết quả: `duplicates=0`, ≥ 54/60 PAID, công nợ giảm đúng tiền PAID.

### 4b — FAIL_RATE=0.3 (lỗi 500 trước khi trừ tiền)
```bash
FAIL_RATE=0.3 node bank-service/index.js
node scripts/test-scenario4.js b
```
Kết quả: ≥ 54/60 PAID, không trừ tiền hai lần.

### 4c — Vượt hạn mức 20.000.000đ
```bash
node bank-service/index.js
node scripts/test-scenario4.js c
```
Kết quả: trả 402, ngân hàng chỉ nhận 1 yêu cầu.

---

## API Reference

### Fee Service (4001)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/students/:id/fees` | Công nợ sinh viên |
| POST | `/students/:id/payments` | Thanh toán `{"amount": N}` |
| GET | `/payments/:id` | Trạng thái lệnh |
| GET | `/health` | Health check |

**Dữ liệu sinh viên:**
- Sinh viên 1: nợ 50.000.000đ
- Sinh viên 2: nợ 0đ
- Sinh viên 3: nợ 3.200.000đ

### Ngân hàng giả lập (4002)

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/charges` | Trừ tiền `{"reference","amount"}` + Header `Idempotency-Key` |
| GET | `/stats` | `{connections, requests, charges, duplicates}` |
| GET | `/health` | Health check |

**Biến môi trường ngân hàng:**
| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `DELAY_MS` | 0 | Trễ thêm N ms |
| `FAIL_RATE` | 0 | Tỉ lệ [0-1] lỗi 500 trước khi trừ tiền |
| `DROP_RATE` | 0 | Tỉ lệ [0-1] cắt kết nối sau khi trừ tiền |
| `PORT` | 4002 | Cổng lắng nghe |

**Biến môi trường Fee Service:**
| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `BANK_URL` | http://localhost:4002 | Địa chỉ ngân hàng |
| `PORT` | 4001 | Cổng lắng nghe |

---

## Quy ước kết quả thanh toán

| Tình trạng | HTTP | status | Khi nào |
|------------|------|--------|---------|
| Thành công | 201 | PAID | Ngân hàng xác nhận đã trừ tiền |
| Ngân hàng từ chối rõ ràng | 402 | FAILED | Vượt hạn mức |
| Chắc chắn chưa trừ tiền | 503 | FAILED | Không kết nối được |
| Không biết đã trừ chưa | 504 | PENDING | Timeout hoặc đứt kết nối |
