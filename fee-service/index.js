/**
 * Fee Service — cổng 4001
 *
 * Endpoints:
 *   GET  /students/:id/fees           — lấy công nợ sinh viên
 *   POST /students/:id/payments       — thanh toán học phí { "amount": <số tiền> }
 *
 * Biến môi trường:
 *   BANK_URL  — địa chỉ ngân hàng (mặc định http://localhost:4002)
 *   PORT      — cổng lắng nghe (mặc định 4001)
 *
 * Xử lý các tình huống:
 *   TH1: Ngân hàng không kết nối được  → 503 FAILED (< 1.5 giây, không crash)
 *   TH2: Ngân hàng phản hồi chậm       → timeout 4.5s → 504 PENDING
 *   TH3: Duy trì kết nối (Keep-Alive)  → http.Agent với keepAlive=true
 *   TH4: Drop/Fail/Từ chối             → idempotency key, retry có điều kiện
 */

const express = require('express');
const http = require('http');
const axios = require('axios');

const app = express();
app.use(express.json());

// --- Cấu hình ---
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';
const PORT = parseInt(process.env.PORT || '4001', 10);

// Timeout cho lời gọi ngân hàng (tình huống 2): 4500ms
const BANK_TIMEOUT_MS = 4500;

// HTTP Agent với Keep-Alive (tình huống 3)
// keepAlive=true: tái sử dụng TCP connection thay vì mở mới mỗi lần
// maxSockets: số connection tối đa đồng thời tới ngân hàng
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,       // tối đa 10 connection đồng thời (giới hạn TCP connections)
  maxFreeSockets: 10,   // giữ tối đa 10 connection nhàn rỗi trong pool
});

// Axios instance với keep-alive agent và timeout
const bankAxios = axios.create({
  baseURL: BANK_URL,
  httpAgent: keepAliveAgent,
  timeout: BANK_TIMEOUT_MS,
});

// --- Dữ liệu công nợ sinh viên (trong bộ nhớ) ---
// sinh viên 1: nợ 50.000.000đ; 2: nợ 0; 3: nợ 3.200.000đ
const studentFees = new Map([
  [1, 50_000_000],
  [2, 0],
  [3, 3_200_000],
]);

// --- Lưu trữ lệnh thanh toán (trong bộ nhớ) ---
let paymentCounter = 0;
const payments = new Map(); // paymentId -> { paymentId, studentId, amount, status, chargeId? }

// --- Helpers ---
function makePaymentId() {
  paymentCounter++;
  return `P${paymentCounter}`;
}

/**
 * Phân loại lỗi axios để quyết định response:
 *
 * - ECONNREFUSED / ENOTFOUND / ECONNRESET (chưa connect được)  → 503 FAILED
 * - Timeout / ETIMEDOUT (đã kết nối nhưng hết thời gian chờ)  → 504 PENDING
 * - Đứt kết nối giữa chừng (socket hang up)                   → 504 PENDING
 * - 5xx từ ngân hàng (lỗi tạm thời, chưa trừ tiền)            → 504 PENDING (retry an toàn)
 * - 4xx từ ngân hàng (từ chối rõ ràng)                        → forward mã của ngân hàng, FAILED
 */
function classifyBankError(err) {
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    // Không kết nối được tới ngân hàng — chắc chắn chưa trừ tiền
    return { httpStatus: 503, paymentStatus: 'FAILED', error: 'Không thể kết nối tới ngân hàng' };
  }

  if (
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNABORTED' ||
    err.code === 'ECONNRESET' ||
    err.message?.includes('timeout') ||
    err.message?.includes('socket hang up')
  ) {
    // Hết thời gian chờ hoặc đứt kết nối — không biết ngân hàng đã trừ chưa
    return { httpStatus: 504, paymentStatus: 'PENDING', error: 'Hết thời gian chờ hoặc mất kết nối tới ngân hàng' };
  }

  if (err.response) {
    const bankStatus = err.response.status;
    const bankError = err.response.data?.error || 'Lỗi từ ngân hàng';

    if (bankStatus >= 500) {
      // Lỗi tạm thời ngân hàng (FAIL_RATE) — chưa trừ tiền, an toàn retry
      return { httpStatus: 504, paymentStatus: 'PENDING', error: `Ngân hàng lỗi tạm thời: ${bankError}` };
    }

    // 4xx — từ chối rõ ràng (vượt hạn mức, số tiền không hợp lệ...)
    return { httpStatus: bankStatus, paymentStatus: 'FAILED', error: bankError };
  }

  // Lỗi không xác định
  return { httpStatus: 504, paymentStatus: 'PENDING', error: `Lỗi không xác định: ${err.message}` };
}

// --- Routes ---

// GET /students/:id/fees — lấy công nợ
app.get('/students/:id/fees', (req, res) => {
  const studentId = parseInt(req.params.id, 10);

  if (!studentFees.has(studentId)) {
    return res.status(404).json({ error: `Sinh viên ${studentId} không tồn tại` });
  }

  const fee = studentFees.get(studentId);
  return res.status(200).json({ studentId, fee });
});

// POST /students/:id/payments — thanh toán học phí
app.post('/students/:id/payments', async (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const { amount } = req.body;

  // Validate sinh viên
  if (!studentFees.has(studentId)) {
    return res.status(404).json({ error: `Sinh viên ${studentId} không tồn tại` });
  }

  // Validate số tiền
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ' });
  }

  const currentFee = studentFees.get(studentId);

  // Kiểm tra không vượt công nợ
  if (amount > currentFee) {
    return res.status(400).json({
      error: `Số tiền thanh toán (${amount.toLocaleString('vi-VN')}đ) vượt quá công nợ (${currentFee.toLocaleString('vi-VN')}đ)`,
    });
  }

  // Tạo lệnh thanh toán mới
  const paymentId = makePaymentId();
  const reference = paymentId; // dùng paymentId làm reference để idempotency

  // Lưu lệnh thanh toán với trạng thái PENDING ban đầu
  const payment = { paymentId, studentId, amount, status: 'PENDING', chargeId: null };
  payments.set(paymentId, payment);

  console.log(`[FEE] Tạo lệnh thanh toán ${paymentId}: studentId=${studentId} amount=${amount}`);

  // Gọi ngân hàng với Idempotency-Key = paymentId
  // → nếu cắt kết nối rồi retry, ngân hàng không trừ tiền hai lần
  try {
    const bankRes = await bankAxios.post(
      '/charges',
      { reference, amount },
      {
        headers: { 'Idempotency-Key': paymentId },
      }
    );

    // Ngân hàng xác nhận đã trừ tiền
    const { chargeId } = bankRes.data;
    payment.status = 'PAID';
    payment.chargeId = chargeId;

    // Chỉ giảm công nợ khi ngân hàng đã trừ tiền thành công
    studentFees.set(studentId, currentFee - amount);

    console.log(`[FEE] Thanh toán ${paymentId} THÀNH CÔNG: chargeId=${chargeId} công nợ còn ${studentFees.get(studentId)}`);

    return res.status(201).json({
      paymentId,
      status: 'PAID',
      chargeId,
      remainingFee: studentFees.get(studentId),
    });
  } catch (err) {
    const { httpStatus, paymentStatus, error } = classifyBankError(err);

    payment.status = paymentStatus;

    // Nếu PENDING (không biết ngân hàng đã trừ chưa) — KHÔNG giảm công nợ
    // Nếu FAILED (chắc chắn chưa trừ) — giữ nguyên công nợ
    console.log(`[FEE] Thanh toán ${paymentId} ${paymentStatus}: ${error} (HTTP ${httpStatus})`);

    return res.status(httpStatus).json({
      error,
      paymentId,
      status: paymentStatus,
    });
  }
});

// GET /payments/:id — xem trạng thái lệnh thanh toán
app.get('/payments/:id', (req, res) => {
  const payment = payments.get(req.params.id);
  if (!payment) {
    return res.status(404).json({ error: `Lệnh thanh toán ${req.params.id} không tồn tại` });
  }
  return res.json(payment);
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bankUrl: BANK_URL });
});

// --- Khởi động ---
app.listen(PORT, () => {
  console.log(`[FEE] Fee Service chạy tại http://localhost:${PORT}`);
  console.log(`[FEE] BANK_URL=${BANK_URL}`);
  console.log(`[FEE] Bank timeout: ${BANK_TIMEOUT_MS}ms`);
  console.log(`[FEE] Keep-Alive: bật (maxSockets=10)`);
});
