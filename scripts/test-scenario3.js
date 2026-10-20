/**
 * Script test Tình huống 3 — Duy trì kết nối
 *
 * Gửi 200 thanh toán, 10 yêu cầu cùng lúc (1.000đ mỗi lần)
 * Sinh viên 1 nợ 50.000.000đ nên đủ tiền.
 *
 * Chạy: node scripts/test-scenario3.js
 */

const http = require('http');

const FEE_URL = process.env.FEE_URL || 'http://localhost:4001';
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';
const TOTAL = 200;
const CONCURRENCY = 10;
const AMOUNT = 1_000;
const STUDENT_ID = 1;

async function fetchJson(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function makePayment() {
  const res = await fetchJson(
    `${FEE_URL}/students/${STUDENT_ID}/payments`,
    'POST',
    { amount: AMOUNT }
  );
  return res.status;
}

async function getStats() {
  const res = await fetchJson(`${BANK_URL}/stats`);
  return res.body;
}

async function runBatch(tasks) {
  return Promise.all(tasks.map((fn) => fn()));
}

async function main() {
  console.log('=== Test Tình huống 3: Duy trì kết nối ===');
  console.log(`Tổng: ${TOTAL} thanh toán, ${CONCURRENCY} cùng lúc, ${AMOUNT.toLocaleString('vi-VN')}đ mỗi lần`);
  console.log();

  // Lấy stats trước
  let statsBefore;
  try {
    statsBefore = await getStats();
    console.log('Stats TRƯỚC:', statsBefore);
  } catch (e) {
    console.log('Không lấy được stats ngân hàng:', e.message);
    statsBefore = null;
  }
  console.log();

  const start = Date.now();
  let success = 0;
  let failed = 0;

  // Gửi theo batch CONCURRENCY
  for (let i = 0; i < TOTAL; i += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, TOTAL - i);
    const tasks = Array.from({ length: batchSize }, () => makePayment);
    const results = await runBatch(tasks);

    for (const status of results) {
      if (status === 201) success++;
      else failed++;
    }

    process.stdout.write(`\rTiến độ: ${i + batchSize}/${TOTAL} (✓${success} ✗${failed})`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n\nHoàn thành trong ${elapsed}s`);
  console.log(`Thành công: ${success}/${TOTAL}`);
  console.log(`Thất bại: ${failed}/${TOTAL}`);
  console.log();

  // Lấy stats sau
  let statsAfter;
  try {
    statsAfter = await getStats();
    console.log('Stats SAU:', statsAfter);
    if (statsBefore) {
      const newConnections = statsAfter.connections - statsBefore.connections;
      console.log(`\nSố kết nối TCP mới mở: ${newConnections} (mục tiêu ≤ 20)`);
      if (newConnections <= 20) {
        console.log('✅ ĐẠT — Keep-Alive hoạt động đúng!');
      } else {
        console.log('❌ CHƯA ĐẠT — Cần bật Keep-Alive');
      }
    }
  } catch (e) {
    console.log('Không lấy được stats ngân hàng:', e.message);
  }
}

main().catch(console.error);
