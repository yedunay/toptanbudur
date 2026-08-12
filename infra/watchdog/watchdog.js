// ---------------------------------------------------------------------------
// Toptan Budur watchdog — public URL'i periyodik prob eder, çökme anında
// Telegram'a tek mesaj atar.
//
// Tasarım kararları:
//   - Backend container'ından AYRI bir mini container'da çalışır. Backend
//     çöktüğünde de mesaj gönderebilmesi için kendi process'i olmalı.
//   - Sadece `up → down` geçişinde mesaj atar; site down kaldığı sürece
//     spam yapmaz. Recovery mesajı default kapalı; `WATCHDOG_NOTIFY_RECOVERY=1`
//     ile açılır.
//   - Anti-flapping: WATCHDOG_FAIL_THRESHOLD ardışık başarısızlık olmadan
//     "down" demez (default 2). Geçici ağ tıkanıklıklarını filtreler.
//   - Node.js 18+ native `fetch` kullanılır; ekstra dependency yok.
// ---------------------------------------------------------------------------

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_URL = process.env.WATCHDOG_TARGET_URL;
const CHECK_INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 60_000);
const TIMEOUT_MS = Number(process.env.WATCHDOG_TIMEOUT_MS || 15_000);
const FAIL_THRESHOLD = Number(process.env.WATCHDOG_FAIL_THRESHOLD || 2);
const RECOVERY_THRESHOLD = Number(
  process.env.WATCHDOG_RECOVERY_THRESHOLD || 2,
);
const NOTIFY_RECOVERY = process.env.WATCHDOG_NOTIFY_RECOVERY === '1';
const SITE_LABEL = process.env.WATCHDOG_SITE_LABEL || TARGET_URL || 'site';

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error(
    '[watchdog] FATAL: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID zorunlu',
  );
  process.exit(1);
}
if (!TARGET_URL) {
  console.error('[watchdog] FATAL: WATCHDOG_TARGET_URL zorunlu');
  process.exit(1);
}

let consecutiveFailures = 0;
let consecutiveSuccesses = 0;
// Başlangıçta "up" varsayıyoruz; ilk turlarda gerçek durumu öğreniriz.
// Watchdog çalışırken zaten down olan bir siteye düşüyorsak ilk
// FAIL_THRESHOLD prob'tan sonra "down" mesajı atılır.
let currentState = 'up';
let lastDownAt = null;

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        `[watchdog] Telegram API ${res.status}: ${body.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error('[watchdog] Telegram fetch failed:', err.message);
    return false;
  }
}

async function probe() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(TARGET_URL, {
      signal: ctl.signal,
      // 3xx'i success say — site cevap veriyor demek.
      redirect: 'manual',
      // Her seferinde fresh; cache yok.
      cache: 'no-store',
      headers: { 'User-Agent': 'toptanbudur-watchdog/1.0' },
    });
    const ms = Date.now() - startedAt;
    // 5xx = site bozuk. 2xx/3xx/4xx = ayakta (404 dahi sayfa dönüyor demek).
    const ok = res.status < 500;
    return { ok, status: res.status, ms };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const reason =
      err.name === 'AbortError' ? `timeout (${TIMEOUT_MS}ms)` : err.message;
    return { ok: false, status: 0, ms, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

function fmtDuration(seconds) {
  if (seconds < 60) return `${seconds} sn`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} dk`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} sa ${m} dk`;
}

async function tick() {
  const result = await probe();
  const ts = new Date().toISOString();

  if (result.ok) {
    consecutiveFailures = 0;
    consecutiveSuccesses++;
    if (
      currentState === 'down' &&
      consecutiveSuccesses >= RECOVERY_THRESHOLD
    ) {
      const downSeconds = lastDownAt
        ? Math.round((Date.now() - lastDownAt) / 1000)
        : null;
      currentState = 'up';
      console.log(`[watchdog] ${ts} RECOVERED status=${result.status}`);
      if (NOTIFY_RECOVERY) {
        await sendTelegram(
          `✅ *${SITE_LABEL} geri geldi*\n` +
            `URL: ${TARGET_URL}\n` +
            (downSeconds !== null
              ? `Kesinti süresi: ~${fmtDuration(downSeconds)}\n`
              : '') +
            `Status: ${result.status} (${result.ms}ms)`,
        );
      }
      lastDownAt = null;
    } else {
      console.log(
        `[watchdog] ${ts} ok status=${result.status} ms=${result.ms}`,
      );
    }
  } else {
    consecutiveSuccesses = 0;
    consecutiveFailures++;
    console.log(
      `[watchdog] ${ts} FAIL ${consecutiveFailures}/${FAIL_THRESHOLD} ` +
        `status=${result.status || 'n/a'} ${result.error ? `error="${result.error}"` : ''}`,
    );
    if (
      currentState === 'up' &&
      consecutiveFailures >= FAIL_THRESHOLD
    ) {
      currentState = 'down';
      lastDownAt = Date.now();
      const reason = result.error
        ? result.error
        : `HTTP ${result.status}`;
      await sendTelegram(
        `🚨 *${SITE_LABEL} erişilemiyor*\n` +
          `URL: ${TARGET_URL}\n` +
          `Hata: ${reason}\n` +
          `Zaman: ${ts}`,
      );
    }
  }
}

console.log(
  `[watchdog] start target=${TARGET_URL} interval=${CHECK_INTERVAL_MS}ms ` +
    `timeout=${TIMEOUT_MS}ms threshold=${FAIL_THRESHOLD} ` +
    `recovery=${NOTIFY_RECOVERY ? 'on' : 'off'}`,
);

// İlk prob hemen, sonrası interval ile.
tick().catch((err) => console.error('[watchdog] tick error:', err));
setInterval(
  () => tick().catch((err) => console.error('[watchdog] tick error:', err)),
  CHECK_INTERVAL_MS,
);

// Graceful shutdown — docker compose down sırasında temiz çıkış.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[watchdog] ${sig} received, exiting`);
    process.exit(0);
  });
}
