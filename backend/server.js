'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream/promises');
const zlib = require('zlib');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/collection.db';
const BULK_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 hours

// Scryfall requires a descriptive User-Agent for all API requests
const SCRYFALL_UA = 'mtg-collection/1.0 (self-hosted; contact your-email@example.com)';

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS collection (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    set_code    TEXT,
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
  
  CREATE TABLE IF NOT EXISTS bulk_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── HTTPS-safe fetch helper ──────────────────────────────────────────────────
// Node's global fetch (v18+) works fine with https, but we add a UA header
// and a timeout so Docker networking issues surface quickly.
async function scryFetch(url, options = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': SCRYFALL_UA,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

// ─── Bulk-data cache ──────────────────────────────────────────────────────────

/**
 * Downloads the Scryfall "oracle_cards" bulk file and upserts every card
 * into card_cache.  Runs in a background async loop.
 */
async function refreshBulkCache() {
  console.log('[bulk] Starting Scryfall bulk-data refresh…');
  try {
    // Step 1: fetch the bulk-data index
    const indexRes = await scryFetch('https://api.scryfall.com/bulk-data');
    if (!indexRes.ok) {
      throw new Error(`bulk-data index HTTP ${indexRes.status}`);
    }
    const index = await indexRes.json();

    // Step 2: find the oracle_cards entry (one canonical card per Oracle ID)
    const entry = index.data.find((d) => d.type === 'oracle_cards');
    if (!entry) throw new Error('oracle_cards entry not found in bulk-data index');

    const downloadUri = entry.download_uri;
    const updatedAt  = entry.updated_at;

    // Skip if we already cached this exact snapshot
    const lastCached = db.prepare("SELECT value FROM bulk_meta WHERE key='bulk_updated_at'").get();
    if (lastCached && lastCached.value === updatedAt) {
      console.log('[bulk] Cache is current, skipping download.');
      return;
    }

    console.log(`[bulk] Downloading oracle_cards from ${downloadUri} …`);

    // Step 3: stream-download and parse (file is gzip-encoded JSON array)
    const cards = await fetchBulkJson(downloadUri);

    console.log(`[bulk] Inserting ${cards.length} cards into card_cache…`);

    const upsert = db.prepare(`
      INSERT INTO card_cache
        (scryfall_id, name, set_code, image_uri, mana_cost, type_line,
         oracle_text, colors, rarity, prices_usd, cached_at)
      VALUES
        (@scryfall_id, @name, @set_code, @image_uri, @mana_cost, @type_line,
         @oracle_text, @colors, @rarity, @prices_usd, datetime('now'))
      ON CONFLICT(scryfall_id) DO UPDATE SET
        name        = excluded.name,
        set_code    = excluded.set_code,
        image_uri   = excluded.image_uri,
        mana_cost   = excluded.mana_cost,
        type_line   = excluded.type_line,
        oracle_text = excluded.oracle_text,
        colors      = excluded.colors,
        rarity      = excluded.rarity,
        prices_usd  = excluded.prices_usd,
        cached_at   = excluded.cached_at
    `);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) upsert.run(row);
    });

    // Map Scryfall card objects to our row shape
    const rows = cards.map((c) => ({
      scryfall_id: c.id,
      name:        c.name,
      set_code:    c.set ?? null,
      image_uri:   c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
      mana_cost:   c.mana_cost ?? null,
      type_line:   c.type_line ?? null,
      oracle_text: c.oracle_text ?? null,
      colors:      c.colors ? JSON.stringify(c.colors) : null,
      rarity:      c.rarity ?? null,
      prices_usd:  c.prices?.usd ? parseFloat(c.prices.usd) : null,
    }));

    insertMany(rows);

    db.prepare("INSERT OR REPLACE INTO bulk_meta (key, value) VALUES ('bulk_updated_at', ?)")
      .run(updatedAt);

    console.log('[bulk] Refresh complete.');
  } catch (err) {
    console.error('[bulk] Refresh failed:', err.message);
  }
}

/**
 * Fetches a (potentially gzip-encoded) JSON array from a URL using
 * Node's https module directly, returning the parsed array.
 * This avoids any issues with fetch + large streaming bodies in some runtimes.
 */
function fetchBulkJson(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': SCRYFALL_UA } }, (res) => {
      // Follow one redirect (Scryfall returns 302 → data.scryfall.io)
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBulkJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching bulk data`));
      }

      const chunks = [];
      let stream = res;

      if (res.headers['content-encoding'] === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      }

      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

/** Schedule a refresh now and every 12 hours. */
function startBulkScheduler() {
  refreshBulkCache(); // run immediately on startup
  setInterval(refreshBulkCache, BULK_REFRESH_MS);
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// ── Card search (hits local cache first, falls back to live Scryfall) ─────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  // 1. Try local cache (fuzzy prefix match)
  const cached = db.prepare(`
    SELECT * FROM card_cache
    WHERE lower(name) LIKE lower(?)
    ORDER BY name
    LIMIT 20
  `).all(`${q}%`);

  if (cached.length > 0) {
    return res.json(cached.map(formatCacheRow));
  }

  // 2. Fall back to live Scryfall /cards/search
  try {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=name`;
    const sfRes = await scryFetch(url);

    if (sfRes.status === 404) return res.json([]); // no results
    if (!sfRes.ok) throw new Error(`Scryfall HTTP ${sfRes.status}`);

    const data = await sfRes.json();
    const cards = (data.data || []).slice(0, 20).map(formatScryfallCard);
    return res.json(cards);
  } catch (err) {
    console.error('[search] Scryfall live search failed:', err.message);
    return res.status(502).json({ error: 'Card search unavailable', detail: err.message });
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
  if (deck)   { sql += ' AND deck = ?';                  params.push(deck); }
  if (foil !== undefined) { sql += ' AND foil = ?';      params.push(foil === 'true' ? 1 : 0); }

  sql += ` ORDER BY ${col} ${dir}`;
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/cards', (req, res) => {
  const { name, set_code, quantity = 1, foil = false, deck,
          scryfall_id, image_uri, mana_cost, type_line,
          oracle_text, colors, rarity, prices_usd } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(`
    INSERT INTO collection
      (name, set_code, quantity, foil, deck, scryfall_id, image_uri,
       mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, set_code, quantity, foil ? 1 : 0, deck || null,
         scryfall_id, image_uri, mana_cost, type_line,
         oracle_text, colors, rarity, prices_usd ?? null);

  res.status(201).json({ id: result.lastInsertRowid });
});

app.patch('/api/cards/:id', (req, res) => {
  const { quantity, foil, deck } = req.body;
  const updates = [];
  const params  = [];

  if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
  if (foil     !== undefined) { updates.push('foil = ?');     params.push(foil ? 1 : 0); }
  if (deck     !== undefined) { updates.push('deck = ?');     params.push(deck); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

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
      COUNT(*)           AS total_entries,
      SUM(quantity)      AS total_cards,
      SUM(foil)          AS foil_cards,
      COUNT(DISTINCT deck) AS deck_count,
      SUM(quantity * COALESCE(prices_usd, 0)) AS estimated_value
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

// ── Bulk import ───────────────────────────────────────────────────────────────
// Format: "4 foil Thoughtseize | Deck Name"
app.post('/api/import', async (req, res) => {
  const lines = (req.body.text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let imported = 0;

  const insertStmt = db.prepare(`
    INSERT INTO collection (name, quantity, foil, deck, scryfall_id, image_uri,
      mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES (@name, @quantity, @foil, @deck, @scryfall_id, @image_uri,
      @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd)
  `);

  for (const line of lines) {
    const [cardPart, deckPart] = line.split('|').map((s) => s.trim());
    const match = cardPart.match(/^(\d+)?\s*(foil\s+)?(.+)$/i);
    if (!match) continue;

    const quantity = parseInt(match[1] || '1', 10);
    const foil     = !!match[2];
    const name     = match[3].trim();
    const deck     = deckPart || null;

    // Look up card info from local cache
    const cached = db.prepare(
      'SELECT * FROM card_cache WHERE lower(name) = lower(?) LIMIT 1'
    ).get(name);

    insertStmt.run({
      name,
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
    imported++;
  }

  res.json({ imported });
});

// ── CSV export ────────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const rows  = db.prepare('SELECT * FROM collection ORDER BY name').all();
  const header = 'id,name,set_code,quantity,foil,deck,rarity,prices_usd,added_at\n';
  const body   = rows.map((r) =>
    [r.id, `"${r.name}"`, r.set_code, r.quantity, r.foil ? 'yes' : 'no',
     r.deck ?? '', r.rarity ?? '', r.prices_usd ?? '', r.added_at].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="collection.csv"');
  res.send(header + body);
});

// ── Bulk-cache status endpoint ─────────────────────────────────────────────────
app.get('/api/cache/status', (req, res) => {
  const meta  = db.prepare("SELECT value FROM bulk_meta WHERE key='bulk_updated_at'").get();
  const count = db.prepare('SELECT COUNT(*) AS n FROM card_cache').get();
  res.json({
    last_updated: meta?.value ?? null,
    card_count:   count.n,
    next_refresh: BULK_REFRESH_MS / 1000 / 60 + ' minutes',
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCacheRow(c) {
  return {
    scryfall_id: c.scryfall_id,
    name:        c.name,
    set_code:    c.set_code,
    image_uri:   c.image_uri,
    mana_cost:   c.mana_cost,
    type_line:   c.type_line,
    oracle_text: c.oracle_text,
    colors:      c.colors ? JSON.parse(c.colors) : [],
    rarity:      c.rarity,
    prices_usd:  c.prices_usd,
  };
}

function formatScryfallCard(c) {
  return {
    scryfall_id: c.id,
    name:        c.name,
    set_code:    c.set,
    image_uri:   c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
    mana_cost:   c.mana_cost,
    type_line:   c.type_line,
    oracle_text: c.oracle_text,
    colors:      c.colors ?? [],
    rarity:      c.rarity,
    prices_usd:  c.prices?.usd ? parseFloat(c.prices.usd) : null,
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  startBulkScheduler();
});
