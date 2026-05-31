'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || '/data/collection.db';
const BULK_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 hours
const SCRYFALL_UA = `mtg-collection/1.0 (self-hosted; ${process.env.SCRYFALL_CONTACT_EMAIL || 'unknown'})`;

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS collection (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    set_code    TEXT,
    set_name    TEXT,
    quantity    INTEGER NOT NULL DEFAULT 1,
    foil        INTEGER NOT NULL DEFAULT 0,
    deck        TEXT,
    scryfall_id TEXT,
    image_uri   TEXT,
    mana_cost   TEXT,
    type_line   TEXT,
    oracle_text TEXT,
    colors      TEXT,
    rarity      TEXT,
    prices_usd  REAL,
    added_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS card_cache (
    scryfall_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    set_code    TEXT,
    set_name    TEXT,
    image_uri   TEXT,
    mana_cost   TEXT,
    type_line   TEXT,
    oracle_text TEXT,
    colors      TEXT,
    rarity      TEXT,
    prices_usd  REAL,
    cached_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cache_name    ON card_cache (name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_cache_name_lc ON card_cache (lower(name));
  CREATE INDEX IF NOT EXISTS idx_cache_set     ON card_cache (set_code, scryfall_id);

  CREATE TABLE IF NOT EXISTS bulk_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function scryFetch(url, options = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': SCRYFALL_UA, Accept: 'application/json', ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(tid);
  }
}

// ─── Bulk-data cache ──────────────────────────────────────────────────────────
async function refreshBulkCache() {
  console.log('[bulk] Starting Scryfall bulk-data refresh…');
  try {
    const indexRes = await scryFetch('https://api.scryfall.com/bulk-data');
    if (!indexRes.ok) throw new Error(`bulk-data index HTTP ${indexRes.status}`);
    const index = await indexRes.json();

    const entry = index.data.find((d) => d.type === 'default_cards');
    if (!entry) throw new Error('default_cards entry not found');

    const lastCached = db.prepare("SELECT value FROM bulk_meta WHERE key='bulk_updated_at'").get();
    if (lastCached && lastCached.value === entry.updated_at) {
      console.log('[bulk] Cache is current, skipping download.');
      return;
    }

    console.log(`[bulk] Downloading default_cards…`);

    const upsert = db.prepare(`
      INSERT INTO card_cache
        (scryfall_id, name, set_code, set_name, image_uri, mana_cost, type_line,
         oracle_text, colors, rarity, prices_usd, cached_at)
      VALUES
        (@scryfall_id, @name, @set_code, @set_name, @image_uri, @mana_cost, @type_line,
         @oracle_text, @colors, @rarity, @prices_usd, datetime('now'))
      ON CONFLICT(scryfall_id) DO UPDATE SET
        name=excluded.name, set_code=excluded.set_code, set_name=excluded.set_name,
        image_uri=excluded.image_uri, mana_cost=excluded.mana_cost, type_line=excluded.type_line,
        oracle_text=excluded.oracle_text, colors=excluded.colors, rarity=excluded.rarity,
        prices_usd=excluded.prices_usd, cached_at=excluded.cached_at
    `);
    const flushBatch = db.transaction((rows) => { for (const r of rows) upsert.run(r); });

    let total = 0;
    await streamBulkJson(entry.download_uri, (batch) => {
      flushBatch(batch.map(cardToRow));
      total += batch.length;
      if (total % 10000 === 0) console.log(`[bulk] …${total} cards`);
    }, 500);

    db.prepare("INSERT OR REPLACE INTO bulk_meta (key,value) VALUES ('bulk_updated_at',?)").run(entry.updated_at);
    console.log(`[bulk] Done. ${total} cards cached.`);
  } catch (err) {
    console.error('[bulk] Refresh failed:', err.message);
  }
}

function cardToRow(c) {
  return {
    scryfall_id: c.id,
    name:        c.name,
    set_code:    c.set ?? null,
    set_name:    c.set_name ?? null,
    image_uri:   c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
    mana_cost:   c.mana_cost ?? null,
    type_line:   c.type_line ?? null,
    oracle_text: c.oracle_text ?? null,
    colors:      c.colors ? JSON.stringify(c.colors) : null,
    rarity:      c.rarity ?? null,
    prices_usd:  c.prices?.usd ? parseFloat(c.prices.usd) : null,
  };
}

function streamBulkJson(url, onBatch, batchSize = 500) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': SCRYFALL_UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302)
        return streamBulkJson(res.headers.location, onBatch, batchSize).then(resolve).catch(reject);
      if (res.statusCode !== 200)
        return reject(new Error(`HTTP ${res.statusCode}`));

      const stream = res.headers['content-encoding'] === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      stream.on('error', reject);

      let batch = [];
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const t = line.trim();
        if (t === '[' || t === ']' || t === '') return;
        try { batch.push(JSON.parse(t.endsWith(',') ? t.slice(0, -1) : t)); } catch { /* skip */ }
        if (batch.length >= batchSize) { try { onBatch(batch); } catch (e) { reject(e); } batch = []; }
      });
      rl.on('close', () => { try { if (batch.length) onBatch(batch); resolve(); } catch (e) { reject(e); } });
      rl.on('error', reject);
    }).on('error', reject);
  });
}

function startBulkScheduler() {
  refreshBulkCache();
  setInterval(refreshBulkCache, BULK_REFRESH_MS);
}

// ─── Shape helpers ────────────────────────────────────────────────────────────
// Returns a Scryfall-shaped object so the frontend can use card.id, card.set_name, etc.
function cacheRowToScryfall(c) {
  return {
    id:          c.scryfall_id,
    name:        c.name,
    set:         c.set_code,
    set_name:    c.set_name ?? c.set_code,
    image_uris:  c.image_uri ? { normal: c.image_uri } : undefined,
    mana_cost:   c.mana_cost,
    type_line:   c.type_line,
    oracle_text: c.oracle_text,
    colors:      c.colors ? JSON.parse(c.colors) : [],
    rarity:      c.rarity,
    prices:      { usd: c.prices_usd != null ? String(c.prices_usd) : null },
  };
}

// Pulls card data from a full Scryfall card object sent by the frontend
function scryfallCardToRow(card, { quantity, foil, deck }) {
  return {
    name:        card.name,
    set_code:    card.set ?? null,
    set_name:    card.set_name ?? null,
    quantity:    quantity ?? 1,
    foil:        foil ? 1 : 0,
    deck:        deck || null,
    scryfall_id: card.id ?? null,
    image_uri:   card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
    mana_cost:   card.mana_cost ?? null,
    type_line:   card.type_line ?? null,
    oracle_text: card.oracle_text ?? null,
    colors:      card.colors ? JSON.stringify(card.colors) : null,
    rarity:      card.rarity ?? null,
    prices_usd:  card.prices?.usd ? parseFloat(card.prices.usd) : null,
  };
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Card search — returns { data: [...] } with Scryfall-shaped objects ─────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ data: [] });

  const cached = db.prepare(`
    SELECT * FROM card_cache
    WHERE lower(name) LIKE lower(?)
    ORDER BY name LIMIT 20
  `).all(`${q}%`);

  if (cached.length > 0) return res.json({ data: cached.map(cacheRowToScryfall) });

  try {
    const sfRes = await scryFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name`);
    if (sfRes.status === 404) return res.json({ data: [] });
    if (!sfRes.ok) throw new Error(`Scryfall HTTP ${sfRes.status}`);
    const data = await sfRes.json();
    return res.json({ data: (data.data || []).slice(0, 20) }); // pass through raw Scryfall objects
  } catch (err) {
    console.error('[search] failed:', err.message);
    return res.status(502).json({ error: 'Card search unavailable', detail: err.message });
  }
});

// ── Scryfall card lookup by set + collector number ────────────────────────────
app.get('/api/scryfall/card/:set/:num', async (req, res) => {
  const { set, num } = req.params;

  // Check local cache first
  const cached = db.prepare(
    'SELECT * FROM card_cache WHERE lower(set_code) = lower(?) AND scryfall_id LIKE ? LIMIT 1'
  ).get(set, `%`);
  // Cache doesn't store collector number, so always fall through to Scryfall for this endpoint
  try {
    const sfRes = await scryFetch(`https://api.scryfall.com/cards/${set.toLowerCase()}/${num}`);
    if (!sfRes.ok) return res.status(404).json({ error: 'Card not found' });
    const card = await sfRes.json();
    return res.json(card); // raw Scryfall object — frontend uses card.id, card.image_uris etc.
  } catch (err) {
    console.error('[set-lookup] failed:', err.message);
    return res.status(502).json({ error: 'Lookup failed', detail: err.message });
  }
});

// ── Collection CRUD ───────────────────────────────────────────────────────────
app.get('/api/cards', (req, res) => {
  const { search, deck, foil, sort = 'name', order = 'asc' } = req.query;
  const allowed = { name: 'name', added_at: 'added_at', quantity: 'quantity', prices_usd: 'prices_usd' };
  const col = allowed[sort] || 'name';
  const dir = order === 'desc' ? 'DESC' : 'ASC';

  let sql = 'SELECT * FROM collection WHERE 1=1';
  const params = [];

  if (search) { sql += ' AND lower(name) LIKE lower(?)'; params.push(`%${search}%`); }
  if (deck)   { sql += ' AND deck = ?'; params.push(deck); }
  if (foil !== undefined) { sql += ' AND foil = ?'; params.push(foil === 'true' ? 1 : 0); }

  sql += ` ORDER BY ${col} ${dir}`;
  res.json(db.prepare(sql).all(...params));
});

// Accepts { scryfall_card, quantity, foil, deck } — the shape AddCardView sends
app.post('/api/cards', (req, res) => {
  const { scryfall_card, quantity, foil, deck } = req.body;

  if (!scryfall_card || !scryfall_card.name)
    return res.status(400).json({ error: 'scryfall_card with name is required' });

  const row = scryfallCardToRow(scryfall_card, { quantity, foil, deck });

  const result = db.prepare(`
    INSERT INTO collection
      (name, set_code, set_name, quantity, foil, deck, scryfall_id, image_uri,
       mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES
      (@name, @set_code, @set_name, @quantity, @foil, @deck, @scryfall_id, @image_uri,
       @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd)
  `).run(row);

  res.status(201).json({ id: result.lastInsertRowid });
});

app.patch('/api/cards/:id', (req, res) => {
  const { quantity, foil, deck } = req.body;
  const updates = [], params = [];

  if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
  if (foil     !== undefined) { updates.push('foil = ?');     params.push(foil ? 1 : 0); }
  if (deck     !== undefined) { updates.push('deck = ?');     params.push(deck); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE collection SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

app.delete('/api/cards/:id', (req, res) => {
  db.prepare('DELETE FROM collection WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*)                                  AS total_entries,
      SUM(quantity)                             AS total_cards,
      SUM(foil)                                 AS foil_cards,
      COUNT(DISTINCT deck)                      AS deck_count,
      SUM(quantity * COALESCE(prices_usd, 0))   AS estimated_value
    FROM collection
  `).get();
  const cacheSize = db.prepare('SELECT COUNT(*) AS n FROM card_cache').get();
  res.json({ ...stats, cache_size: cacheSize.n });
});

// ── Decks ─────────────────────────────────────────────────────────────────────
app.get('/api/decks', (req, res) => {
  const decks = db.prepare(
    "SELECT DISTINCT deck FROM collection WHERE deck IS NOT NULL ORDER BY deck"
  ).all().map((r) => r.deck);
  res.json(decks);
});

// ── Bulk import — returns { added: [names], failed: [{ line, error }] } ────────
app.post('/api/import', (req, res) => {
  const lines      = (req.body.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const globalDeck = req.body.deck || null; // optional default deck from the UI dropdown
  const added  = [];
  const failed = [];

  const insertStmt = db.prepare(`
    INSERT INTO collection
      (name, set_code, set_name, quantity, foil, deck, scryfall_id, image_uri,
       mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES
      (@name, @set_code, @set_name, @quantity, @foil, @deck, @scryfall_id, @image_uri,
       @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd)
  `);

  for (const line of lines) {
    try {
      const [cardPart, deckPart] = line.split('|').map((s) => s.trim());
      const match = cardPart.match(/^(\d+)?\s*(foil\s+)?(.+)$/i);
      if (!match) throw new Error('Could not parse line');

      const quantity = parseInt(match[1] || '1', 10);
      const foil     = !!match[2];
      const name     = match[3].trim();
      // Per-line deck wins; fall back to globalDeck from the dropdown
      const deck     = deckPart || globalDeck;

      const cached = db.prepare(
        'SELECT * FROM card_cache WHERE lower(name) = lower(?) LIMIT 1'
      ).get(name);

      insertStmt.run({
        name,
        set_code:    cached?.set_code    ?? null,
        set_name:    cached?.set_name    ?? null,
        quantity,
        foil:        foil ? 1 : 0,
        deck,
        scryfall_id: cached?.scryfall_id ?? null,
        image_uri:   cached?.image_uri   ?? null,
        mana_cost:   cached?.mana_cost   ?? null,
        type_line:   cached?.type_line   ?? null,
        oracle_text: cached?.oracle_text ?? null,
        colors:      cached?.colors      ?? null,
        rarity:      cached?.rarity      ?? null,
        prices_usd:  cached?.prices_usd  ?? null,
      });

      added.push(quantity > 1 ? `${quantity}× ${name}` : name);
    } catch (err) {
      failed.push({ line, error: err.message });
    }
  }

  res.json({ added, failed });
});

// ── CSV export ────────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const rows   = db.prepare('SELECT * FROM collection ORDER BY name').all();
  const header = 'id,name,set_code,set_name,quantity,foil,deck,rarity,prices_usd,added_at\n';
  const body   = rows.map((r) =>
    [r.id, `"${r.name}"`, r.set_code ?? '', `"${r.set_name ?? ''}"`,
     r.quantity, r.foil ? 'yes' : 'no', r.deck ?? '',
     r.rarity ?? '', r.prices_usd ?? '', r.added_at].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collection.csv"');
  res.send(header + body);
});

// ── Cache status ──────────────────────────────────────────────────────────────
app.get('/api/cache/status', (req, res) => {
  const meta  = db.prepare("SELECT value FROM bulk_meta WHERE key='bulk_updated_at'").get();
  const count = db.prepare('SELECT COUNT(*) AS n FROM card_cache').get();
  res.json({ last_updated: meta?.value ?? null, card_count: count.n });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  startBulkScheduler();
});