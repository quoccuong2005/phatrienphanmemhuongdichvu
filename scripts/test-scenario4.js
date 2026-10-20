/**
 * Script test Tình huống 4 — Đứt giữa chừng, lỗi tạm thời, bị từ chối
 *
 * (a) DROP_RATE=0.3 — 60 thanh toán lần lượt
 * (b) FAIL_RATE=0.3 — 60 thanh toán lần lượt
 * (c) Thanh toán 25.000.000đ (vượt hạn mức 20tr ngân hàng)
 *
 * Chạy: node scripts/test-scenario4.js [a|b|c]
 */

const http = require('http');

const FEE_URL = process.env.FEE_URL || 'http://localhost:4001';
const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';

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

    req.on('error', (err) => resolve({ status: 0, body: { error: err.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function makePayment(studentId, amount) {
  return fetchJson(
    `${FEE_URL}/students/${studentId}/payments`,
    'POST',
    { amount }
  );
}

async function getStats() {
  const res = await fetchJson(`${BANK_URL}/stats`);
  return res.body;
}

async function getFees(studentId) {
  const res = await fetchJson(`${FEE_URL}/students/${studentId}/fees`);
  return res.body;
}

// --- Tình huống 4a: DROP_RATE=0.3 ---
async function scenario4a() {
  console.log('=== Tình huống 4a: DROP_RATE=0.3 (60 thanh toán tuần tự) ===');
  console.log('>>> Đảm bảo bank đang chạy với DROP_RATE=0.3\n');

  const statsBefore = await getStats();
  const feesBefore = await getFees(1);
  console.log('Stats TRƯỚC:', statsBefore);
  console.log('Công nợ TRƯỚC:', feesBefore.fee?.toLocaleString('vi-VN') + 'đ');
  console.log();

  let paid = 0, pending = 0, failed = 0;
  const amount = 1_000;

  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const res = await makePayment(1, amount);
    const status = res.body?.status;
    if (res.status === 201 && status === 'PAID') paid++;
    else if (status === 'PENDING') pending++;
    else failed++;
    process.stdout.write(`\r[4a] ${i + 1}/60 — PAID=${paid} PENDING=${pending} FAILED=${failed}`);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n\nHoàn thành trong ${elapsed}s`);

  const statsAfter = await getStats();
  const feesAfter = await getFees(1);
  console.log('\nStats SAU:', statsAfter);
  console.log('Công nợ SAU:', feesAfter.fee?.toLocaleString('vi-VN') + 'đ');

  const feeDiff = feesBefore.fee - feesAfter.fee;
  const expectedFeeReduction = paid * amount;
  console.log(`\nCông nợ giảm: ${feeDiff.toLocaleString('vi-VN')}đ`);
  console.log(`Tiền các lệnh PAID: ${expectedFeeReduction.toLocaleString('vi-VN')}đ`);

  console.log('\n--- Kiểm tra kết quả ---');
  console.log(`duplicates = ${statsAfter.duplicates}`, statsAfter.duplicates === 0 ? '✅' : '❌ PHẢI = 0');
  console.log(`≥ 54/60 thành công: ${paid}`, paid >= 54 ? '✅' : `❌ (${paid} < 54)`);
  console.log(`Công nợ chỉ giảm đúng tiền PAID:`, feeDiff === expectedFeeReduction ? '✅' : `❌ (${feeDiff} ≠ ${expectedFeeReduction})`);
}

// --- Tình huống 4b: FAIL_RATE=0.3 ---
async function scenario4b() {
  console.log('=== Tình huống 4b: FAIL_RATE=0.3 (60 thanh toán tuần tự) ===');
  console.log('>>> Đảm bảo bank đang chạy với FAIL_RATE=0.3\n');

  const statsBefore = await getStats();
  console.log('Stats TRƯỚC:', statsBefore);
  console.log();

  let paid = 0, pending = 0, failed = 0;
  const amount = 1_000;

  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const res = await makePayment(1, amount);
    const status = res.body?.status;
    if (res.status === 201 && status === 'PAID') paid++;
    else if (status === 'PENDING') pending++;
    else failed++;
    process.stdout.write(`\r[4b] ${i + 1}/60 — PAID=${paid} PENDING=${pending} FAILED=${failed}`);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n\nHoàn thành trong ${elapsed}s`);

  const statsAfter = await getStats();
  console.log('\nStats SAU:', statsAfter);

  console.log('\n--- Kiểm tra kết quả ---');
  console.log(`≥ 54/60 thành công: ${paid}`, paid >= 54 ? '✅' : `❌ (${paid} < 54)`);
  console.log(`Không trừ tiền hai lần (duplicates=0): ${statsAfter.duplicates}`, statsAfter.duplicates === 0 ? '✅' : '❌');
}

// --- Tình huống 4c: Vượt hạn mức ---
async function scenario4c() {
  console.log('=== Tình huống 4c: Thanh toán 25.000.000đ (vượt hạn mức 20tr) ===');
  console.log('>>> Sinh viên 1 nợ 50.000.000đ\n');

  const statsBefore = await getStats();
  console.log('Stats TRƯỚC:', statsBefore);

  const start = Date.now();
  const res = await makePayment(1, 25_000_000);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\nKết quả (${elapsed}s):`, JSON.stringify(res.body, null, 2));
  console.log(`HTTP Status: ${res.status}`);

  const statsAfter = await getStats();
  console.log('\nStats SAU:', statsAfter);

  console.log('\n--- Kiểm tra kết quả ---');
  console.log(`Trả 402:`, res.status === 402 ? '✅' : `❌ (nhận ${res.status})`);
  const newRequests = statsAfter.requests - statsBefore.requests;
  console.log(`Ngân hàng chỉ nhận 1 yêu cầu (không thử lại): ${newRequests}`, newRequests === 1 ? '✅' : `❌ (${newRequests} yêu cầu)`);
}

// --- Main ---
const mode = process.argv[2] || 'a';

const modes = { a: scenario4a, b: scenario4b, c: scenario4c };
if (!modes[mode]) {
  console.log('Dùng: node test-scenario4.js [a|b|c]');
  process.exit(1);
}

modes[mode]().catch(console.error);
