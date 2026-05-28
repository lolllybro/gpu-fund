const path = require('path');
// Load halal.env for local dev; Railway/cloud sets env vars directly
const envFile = path.join(__dirname, 'halal.env');
const fs_check = require('fs');
if (fs_check.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
} else {
  require('dotenv').config(); // fallback to .env
}

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const axios      = require('axios');
const fs         = require('fs');
const initSqlJs  = require('sql.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client')));

// ── Config ────────────────────────────────────────────────────────────
const TON_WALLET  = process.env.TON_WALLET  || 'UQADNsGWjhdTfSv4fei9cdfuUyx8zKtc0A8m0op2sXq_llQm';
const SOL_WALLET  = process.env.SOL_WALLET  || 'DT39PJjRN7zFcZk36PDRthxzP66Sw4AcpqL54QdesLsD';
const GOAL_USD    = parseFloat(process.env.DONATION_GOAL) || 5000;
const TON_API_URL = process.env.TON_API_URL || 'https://toncenter.com/api/v2';
const SOL_RPC_URL = process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TG_TOKEN    = process.env.TG_BOT_TOKEN || '';
const TG_CHAT     = process.env.TG_CHAT_ID   || '';
const PORT        = parseInt(process.env.PORT) || 3000;
const DB_PATH     = path.join(__dirname, 'donations.db');

// ── Database ──────────────────────────────────────────────────────────
let db;
let saveTimer = null;

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
    catch(e) { console.error('[DB] Save error:', e.message); }
  }, 400);
}

async function initDb() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS donations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash       TEXT UNIQUE NOT NULL,
      network       TEXT NOT NULL,
      sender        TEXT DEFAULT '',
      donor_name    TEXT DEFAULT 'Anonymous',
      message       TEXT DEFAULT '',
      social        TEXT DEFAULT '',
      social_type   TEXT DEFAULT '',
      amount_usd    REAL NOT NULL DEFAULT 0,
      amount_crypto REAL NOT NULL DEFAULT 0,
      symbol        TEXT NOT NULL,
      explorer_url  TEXT NOT NULL,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT OR IGNORE INTO config VALUES ('last_ton_lt','0');
    -- Migrate existing DB: add social columns if missing
    `);
  try { db.run("ALTER TABLE donations ADD COLUMN social TEXT DEFAULT ''"); } catch(e) {}
  try { db.run("ALTER TABLE donations ADD COLUMN social_type TEXT DEFAULT ''"); } catch(e) {}
  db.run(`
    INSERT OR IGNORE INTO config VALUES ('last_sol_signature','');
    INSERT OR IGNORE INTO config VALUES ('poll_count','0');
  `);
  scheduleSave();
  console.log('[DB] Ready');
}

const dbGet = (sql, p=[]) => {
  const s = db.prepare(sql); s.bind(p);
  const row = s.step() ? s.getAsObject() : null;
  s.free(); return row;
};
const dbAll = (sql, p=[]) => {
  const rows = []; const s = db.prepare(sql); s.bind(p);
  while (s.step()) rows.push(s.getAsObject());
  s.free(); return rows;
};
const dbRun = (sql, p=[]) => { db.run(sql, p); scheduleSave(); };

// ── Prices ────────────────────────────────────────────────────────────
let prices = { TON: 3.0, SOL: 150.0 };
let lastPriceFetch = 0;

async function fetchPrices(force = false) {
  if (!force && Date.now() - lastPriceFetch < 5 * 60 * 1000) return;
  try {
    const { data } = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,solana&vs_currencies=usd',
      { timeout: 7000 }
    );
    prices.TON = data['the-open-network']?.usd || prices.TON;
    prices.SOL = data['solana']?.usd            || prices.SOL;
    lastPriceFetch = Date.now();
    console.log(`[Prices] TON=$${prices.TON}  SOL=$${prices.SOL}`);
  } catch(e) { console.warn('[Prices]', e.message); }
}

// ── Memo parser ───────────────────────────────────────────────────────
// Format: name:Alice social:@handle message:Some text
// Fields can appear in any order. Value ends at next field keyword.
function parseMemo(raw = '') {
  const src = String(raw || '').trim() + ' ';
  const fields = {};
  const re = /(name|message|social)[:=]\s*(.*?)(?=\s+(?:name|message|social)[:=]|\s*$)/gi;
  let match;
  while ((match = re.exec(src)) !== null) {
    fields[match[1].toLowerCase()] = match[2].trim();
  }

  let social = (fields.social || '').slice(0, 60);
  let social_type = '';
  if (social) {
    const low = social.toLowerCase();
    if (low.startsWith('u/') || low.startsWith('r/') || low.includes('reddit')) {
      social_type = 'reddit';
      if (!social.startsWith('u/') && !social.startsWith('r/')) social = 'u/' + social;
    } else {
      social_type = 'x';
      if (!social.startsWith('@')) social = '@' + social;
    }
  }

  return {
    name:        (fields.name    || 'Anonymous').slice(0, 50),
    message:     (fields.message || '').slice(0, 200),
    social,
    social_type,
  };
}

// ── Telegram notify ───────────────────────────────────────────────────
async function tgNotify(donation) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const net  = donation.network;
  const icon = net === 'TON' ? '💎' : '◎';
  const text =
    `${icon} *New Donation!*\n` +
    `👤 ${donation.donor_name}\n` +
    `💰 $${parseFloat(donation.amount_usd).toFixed(2)} (${parseFloat(donation.amount_crypto).toFixed(4)} ${donation.symbol})\n` +
    (donation.message ? `💬 ${donation.message}\n` : '') +
    `🔗 [Explorer](${donation.explorer_url})\n\n` +
    `📊 Total raised: $${totalUsd().toFixed(2)} / $${GOAL_USD}`;
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT, text, parse_mode: 'Markdown',
      disable_web_page_preview: true
    }, { timeout: 8000 });
  } catch(e) { console.warn('[TG]', e.message); }
}

// ── TON ───────────────────────────────────────────────────────────────
async function checkTon() {
  try {
    const q = { address: TON_WALLET, limit: 25 };
    if (process.env.TON_API_KEY) q.api_key = process.env.TON_API_KEY;
    const { data } = await axios.get(`${TON_API_URL}/getTransactions`, { params: q, timeout: 12000 });
    const txs = data?.result || [];
    const lastLt = dbGet("SELECT value FROM config WHERE key='last_ton_lt'")?.value || '0';
    let newLt = lastLt;
    const fresh = [];

    for (const tx of txs) {
      if (!tx.in_msg) continue;
      const lt = String(tx.transaction_id?.lt || '0');
      try { if (BigInt(lt) <= BigInt(lastLt)) continue; } catch { continue; }
      try { if (BigInt(lt) > BigInt(newLt)) newLt = lt; } catch {}

      const nano = parseInt(tx.in_msg.value || '0');
      if (nano <= 0) continue;
      const hash = tx.transaction_id?.hash || '';
      if (!hash || dbGet('SELECT id FROM donations WHERE tx_hash=?', [hash])) continue;

      const amtTon = nano / 1e9;
      const amtUsd = amtTon * prices.TON;
      const { name, message, social, social_type } = parseMemo(tx.in_msg.message || tx.in_msg.comment || '');
      const sender = tx.in_msg.source || '';
      const url    = `https://tonscan.org/tx/${encodeURIComponent(hash)}`;

      dbRun(
        `INSERT OR IGNORE INTO donations
         (tx_hash,network,sender,donor_name,message,social,social_type,amount_usd,amount_crypto,symbol,explorer_url)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [hash,'TON',sender,name,message,social,social_type,amtUsd,amtTon,'TON',url]
      );
      const saved = dbGet('SELECT * FROM donations WHERE tx_hash=?', [hash]);
      if (saved) fresh.push(saved);
    }
    if (newLt !== lastLt) dbRun("INSERT OR REPLACE INTO config VALUES ('last_ton_lt',?)", [newLt]);
    return fresh;
  } catch(e) { console.error('[TON]', e.message); return []; }
}

// ── Solana ────────────────────────────────────────────────────────────
async function checkSol() {
  try {
    const lastSig = dbGet("SELECT value FROM config WHERE key='last_sol_signature'")?.value || '';
    const sigRes  = await axios.post(SOL_RPC_URL, {
      jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress',
      params: [SOL_WALLET, { limit: 25, ...(lastSig ? { until: lastSig } : {}) }]
    }, { timeout: 12000 });

    const sigs = sigRes.data?.result || [];
    if (!sigs.length) return [];
    const newLastSig = sigs[0]?.signature || lastSig;
    const fresh = [];

    for (const si of [...sigs].reverse()) {
      const sig = si.signature;
      if (dbGet('SELECT id FROM donations WHERE tx_hash=?', [sig])) continue;
      try {
        const { data } = await axios.post(SOL_RPC_URL, {
          jsonrpc: '2.0', id: 1, method: 'getTransaction',
          params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        }, { timeout: 12000 });
        const tx = data?.result;
        if (!tx || tx.meta?.err) continue;

        const keys = tx.transaction?.message?.accountKeys || [];
        const idx  = keys.findIndex(k => (k.pubkey || k) === SOL_WALLET);
        if (idx === -1) continue;
        const diff = (tx.meta?.postBalances?.[idx] || 0) - (tx.meta?.preBalances?.[idx] || 0);
        if (diff <= 0) continue;

        const amtSol = diff / 1e9;
        const amtUsd = amtSol * prices.SOL;
        let memo = '';
        for (const ix of (tx.transaction?.message?.instructions || [])) {
          if (ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
            memo = typeof ix.parsed === 'string' ? ix.parsed : (ix.data || '');
            break;
          }
        }
        const { name, message, social, social_type } = parseMemo(memo);
        const sender = keys[0]?.pubkey || String(keys[0]) || '';
        const url    = `https://solscan.io/tx/${sig}`;

        dbRun(
          `INSERT OR IGNORE INTO donations
           (tx_hash,network,sender,donor_name,message,amount_usd,amount_crypto,symbol,explorer_url)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [sig,'SOL',sender,name,message,amtUsd,amtSol,'SOL',url]
        );
        const saved = dbGet('SELECT * FROM donations WHERE tx_hash=?', [sig]);
        if (saved) fresh.push(saved);
      } catch(e) { console.error('[SOL tx]', e.message); }
    }
    if (newLastSig !== lastSig) dbRun("INSERT OR REPLACE INTO config VALUES ('last_sol_signature',?)", [newLastSig]);
    return fresh;
  } catch(e) { console.error('[SOL]', e.message); return []; }
}

// ── Poll ──────────────────────────────────────────────────────────────
let isPollRunning = false;

async function poll() {
  if (isPollRunning) return;
  isPollRunning = true;
  try {
    console.log('[Poll]', new Date().toISOString());
    await fetchPrices();
    const all = (await Promise.all([checkTon(), checkSol()])).flat();
    if (all.length) {
      const s = buildStats();
      io.emit('new_donations', { donations: all, stats: s });
      console.log(`[Poll] +${all.length} donation(s), total $${s.total_usd.toFixed(2)}`);
      // Telegram notifications
      for (const d of all) { await tgNotify(d); }
    }
    const cnt = parseInt(dbGet("SELECT value FROM config WHERE key='poll_count'")?.value || '0') + 1;
    dbRun("INSERT OR REPLACE INTO config VALUES ('poll_count',?)", [String(cnt)]);
  } finally {
    isPollRunning = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
const totalUsd = () =>
  parseFloat(dbGet('SELECT COALESCE(SUM(amount_usd),0) as t FROM donations')?.t || 0);

const buildStats = () => {
  const total = totalUsd();
  const count = dbGet('SELECT COUNT(*) as c FROM donations')?.c || 0;
  const polls = dbGet("SELECT value FROM config WHERE key='poll_count'")?.value || '0';
  return {
    total_usd:      total,
    goal_usd:       GOAL_USD,
    percent:        Math.min((total / GOAL_USD) * 100, 100).toFixed(2),
    donation_count: count,
    poll_count:     parseInt(polls),
    ton_wallet:     TON_WALLET,
    sol_wallet:     SOL_WALLET,
    ton_price_usd:  prices.TON,
    sol_price_usd:  prices.SOL,
  };
};

// ── REST API ──────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => res.json(buildStats()));

app.get('/api/donations', (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const net    = req.query.network;
  const search = req.query.search ? `%${req.query.search}%` : null;

  let sql = 'SELECT * FROM donations';
  const cond = [], params = [];
  if (net)    { cond.push('network=?');   params.push(net.toUpperCase()); }
  if (search) { cond.push('(donor_name LIKE ? OR message LIKE ? OR social LIKE ? OR tx_hash LIKE ?)'); params.push(search, search, search, search); }
  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows  = dbAll(sql, params);
  const total = dbGet('SELECT COUNT(*) as c FROM donations')?.c || 0;
  res.json({ donations: rows, total, limit, offset });
});

// Export CSV
app.get('/api/export.csv', (req, res) => {
  const rows = dbAll('SELECT * FROM donations ORDER BY created_at DESC');
  const hdr  = 'id,tx_hash,network,donor_name,message,social,social_type,amount_usd,amount_crypto,symbol,sender,explorer_url,created_at\n';
  const body = rows.map(r =>
    [r.id, r.tx_hash, r.network,
     `"${(r.donor_name||'').replace(/"/g,'""')}"`,
     `"${(r.message||'').replace(/"/g,'""')}"`,
     r.amount_usd, r.amount_crypto, r.symbol,
     r.sender, r.explorer_url, r.created_at].join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="donations.csv"');
  res.send(hdr + body);
});

// Health check
app.get('/api/health', (req, res) => {
  const count = dbGet('SELECT COUNT(*) as c FROM donations')?.c || 0;
  res.json({ ok: true, uptime: Math.floor(process.uptime()), donations: count, prices });
});

// Manual poll trigger
app.post('/api/poll', async (req, res) => {
  poll().catch(() => {});
  res.json({ ok: true, message: 'Poll triggered' });
});

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'index.html')));

// ── WebSocket ─────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[WS] +', socket.id);
  socket.emit('init', buildStats());
  socket.on('disconnect', () => console.log('[WS] -', socket.id));
});

// ── Boot ──────────────────────────────────────────────────────────────
initDb().then(async () => {
  await fetchPrices(true);
  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════╗
║       GPU Fund — Crypto Tracker       ║
╚═══════════════════════════════════════╝
  🚀  http://localhost:${PORT}
  💎  TON : ${TON_WALLET}
  ◎   SOL : ${SOL_WALLET}
  🎯  Goal: $${GOAL_USD}
  🤖  TG  : ${TG_TOKEN ? 'enabled' : 'disabled'}
`);
  });
  // First poll after 5 sec, then every 30 sec
  setTimeout(() => poll().catch(() => {}), 5000);
  setInterval(() => poll().catch(() => {}), 30_000);
});
