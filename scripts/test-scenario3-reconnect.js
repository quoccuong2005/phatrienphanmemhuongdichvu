/**
 * Script test sau khi nhàn rỗi 6 giây (Tình huống 3 — phần cuối)
 *
 * Sau khi bank đóng kết nối cũ (5 giây), gửi vài yêu cầu xem có tự reconnect không.
 * Chạy: node scripts/test-scenario3-reconnect.js
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
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Test reconnect sau 6 giây nhàn rỗi ===');

  const statsBefore = await (await fetchJson(`${BANK_URL}/stats`)).body;
  console.log('Stats TRƯỚC:', statsBefore);

  console.log('\n⏳ Chờ 6 giây để bank đóng kết nối nhàn rỗi...');
  await new Promise((r) => setTimeout(r, 6000));
  console.log('Hết 6 giây. Gửi 3 yêu cầu test...\n');

  for (let i = 1; i <= 3; i++) {
    const res = await fetchJson(`${FEE_URL}/students/1/payments`, 'POST', { amount: 1_000 });
    console.log(`Yêu cầu ${i}: HTTP ${res.status} — ${JSON.stringify(res.body)}`);
  }

  const statsAfter = (await fetchJson(`${BANK_URL}/stats`)).body;
  console.log('\nStats SAU:', statsAfter);

  const newConn = statsAfter.connections - statsBefore.connections;
  console.log(`\nKết nối TCP mới: ${newConn} (phải > 0 — bank tự reconnect)`);
  console.log(newConn > 0 ? '✅ Keep-Alive tự reconnect hoạt động!' : '❌ Không có kết nối mới?');
}

main().catch(console.error);
