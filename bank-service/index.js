/**
 * Ngân hàng giả lập — cổng 4002
 *
 * Hành vi lỗi đặt bằng biến môi trường (restart để áp dụng):
 *   DELAY_MS   — trễ thêm ngần ấy ms trước khi trả lời
 *   FAIL_RATE  — tỉ lệ [0-1] trả lỗi 500 TRƯỚC khi trừ tiền
 *   DROP_RATE  — tỉ lệ [0-1] trừ tiền xong rồi cắt kết nối trước khi trả lời
 */

const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

// --- Cấu hình hành vi lỗi ---
const DELAY_MS = parseInt(process.env.DELAY_MS || '0', 10);
const FAIL_RATE = parseFloat(process.env.FAIL_RATE || '0');
const DROP_RATE = parseFloat(process.env.DROP_RATE || '0');
const IDLE_TIMEOUT_MS = 5000; // 5 giây — mặc định Node.js

// Hạn mức thanh toán tối đa
const MAX_CHARGE_LIMIT = 20_000_000;

// --- Lưu trữ trong bộ nhớ ---
let chargeCounter = 0;
const charges = new Map();    // chargeId -> {reference, amount, chargeId}
const idempotencyStore = new Map(); // Idempotency-Key -> response object

// --- Thống kê ---
let stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0,
};

// --- Tạo HTTP server để track TCP connections ---
const server = http.createServer(app);

server.on('connection', (socket) => {
  stats.connections++;
  console.log(`[BANK] Kết nối TCP mới #${stats.connections} từ ${socket.remoteAddress}:${socket.remotePort}`);

  // Đóng kết nối nhàn rỗi sau IDLE_TIMEOUT_MS
  socket.setTimeout(IDLE_TIMEOUT_MS);
  socket.on('timeout', () => {
    console.log(`[BANK] Đóng kết nối nhàn rỗi sau ${IDLE_TIMEOUT_MS}ms`);
    socket.destroy();
  });
});

// --- Helpers ---
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Routes ---

// POST /charges — trừ tiền
app.post('/charges', async (req, res) => {
  stats.requests++;

  const { reference, amount } = req.body;
  const idempotencyKey = req.headers['idempotency-key'];

  // Validate input
  if (!reference || !amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ hoặc thiếu reference' });
  }

  if (amount > MAX_CHARGE_LIMIT) {
    return res.status(402).json({ error: `Vượt hạn mức thanh toán ${MAX_CHARGE_LIMIT.toLocaleString('vi-VN')}đ` });
  }

  // Kiểm tra idempotency key — trả lại giao dịch cũ, không trừ thêm
  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);
    console.log(`[BANK] Idempotency hit key=${idempotencyKey} -> chargeId=${cached.chargeId}`);
    return res.status(201).json(cached);
  }

  // Áp dụng DELAY
  if (DELAY_MS > 0) {
    await sleep(DELAY_MS);
  }

  // Áp dụng FAIL_RATE — lỗi 500 trước khi trừ tiền
  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    console.log(`[BANK] FAIL_RATE kích hoạt — trả 500 (chưa trừ tiền)`);
    return res.status(500).json({ error: 'Lỗi tạm thời phía ngân hàng' });
  }

  // Thực hiện trừ tiền
  chargeCounter++;
  const chargeId = `CHG-${String(chargeCounter).padStart(6, '0')}`;

  // Kiểm tra reference trùng lặp (đếm duplicates)
  for (const [, charge] of charges) {
    if (charge.reference === reference) {
      stats.duplicates++;
      console.log(`[BANK] DUPLICATE reference=${reference} -> duplicates=${stats.duplicates}`);
    }
  }

  const chargeRecord = { chargeId, reference, amount };
  charges.set(chargeId, chargeRecord);
  stats.charges++;

  console.log(`[BANK] Đã trừ tiền: chargeId=${chargeId} reference=${reference} amount=${amount}`);

  // Lưu vào idempotency store
  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, chargeRecord);
  }

  // Áp dụng DROP_RATE — trừ tiền xong rồi cắt kết nối
  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    console.log(`[BANK] DROP_RATE kích hoạt — cắt kết nối sau khi trừ tiền`);
    res.socket && res.socket.destroy();
    return;
  }

  return res.status(201).json(chargeRecord);
});

// GET /stats — thống kê
app.get('/stats', (req, res) => {
  res.json({ ...stats });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Khởi động ---
const PORT = parseInt(process.env.PORT || '4002', 10);
server.listen(PORT, () => {
  console.log(`[BANK] Ngân hàng giả lập chạy tại http://localhost:${PORT}`);
  console.log(`[BANK] Cấu hình: DELAY_MS=${DELAY_MS}, FAIL_RATE=${FAIL_RATE}, DROP_RATE=${DROP_RATE}`);
  console.log(`[BANK] Idle timeout: ${IDLE_TIMEOUT_MS}ms`);
});
