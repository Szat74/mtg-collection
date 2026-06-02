'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT     = process.env.PORT     || 3001;
const DB_PATH  = process.env.DB_PATH  || '/data/collection.db';
const BULK_REFRESH_MS = 12 * 60 * 60 * 1000;
const SCRYFALL_UA = `mtg-collection/1.0 (self-hosted; ${process.env.SCRYFALL_CONTACT_EMAIL || 'unknown'})`;

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS collection (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    set_code         TEXT,
    set_name         TEXT,
    collector_number TEXT,
    quantity         INTEGER NOT NULL DEFAULT 1,
    foil             INTEGER NOT NULL DEFAULT 0,
    deck             TEXT,
    scryfall_id      TEXT,
    image_uri        TEXT,
    image_back       TEXT,
    mana_cost        TEXT,
    type_line        TEXT,
    oracle_text      TEXT,
    colors           TEXT,
    rarity           TEXT,
    prices_usd       REAL,
    added_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_decks (
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    deck          TEXT    NOT NULL,
    PRIMARY KEY (collection_id, deck)
  );

  CREATE TABLE IF NOT EXISTS collection_groups (
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    group_name    TEXT    NOT NULL,
    PRIMARY KEY (collection_id, group_name)
  );

  CREATE TABLE IF NOT EXISTS card_cache (
    scryfall_id      TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    set_code         TEXT,
    set_name         TEXT,
    collector_number TEXT,
    image_uri        TEXT,
    image_back       TEXT,
    mana_cost        TEXT,
    type_line        TEXT,
    oracle_text      TEXT,
    colors           TEXT,
    rarity           TEXT,
    prices_usd       REAL,
    cached_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cache_name    ON card_cache (name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_cache_name_lc ON card_cache (lower(name));
  CREATE INDEX IF NOT EXISTS idx_cache_set     ON card_cache (set_code, scryfall_id);
  CREATE INDEX IF NOT EXISTS idx_coll_decks    ON collection_decks (deck);
  CREATE INDEX IF NOT EXISTS idx_coll_groups   ON collection_groups (group_name);

  CREATE TABLE IF NOT EXISTS bulk_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── Migrations — safe on both fresh and existing DBs ─────────────────────────
for (const sql of [
  'ALTER TABLE collection  ADD COLUMN set_name         TEXT',
  'ALTER TABLE collection  ADD COLUMN collector_number TEXT',
  'ALTER TABLE collection  ADD COLUMN image_back       TEXT',
  'ALTER TABLE card_cache  ADD COLUMN set_name         TEXT',
  'ALTER TABLE card_cache  ADD COLUMN collector_number TEXT',
  'ALTER TABLE card_cache  ADD COLUMN image_back       TEXT',
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// Drop legacy groups table — group names now live solely in collection_groups
try { db.exec('DROP TABLE IF EXISTS groups'); } catch { /* ignore */ }

// Backfill collection_decks from legacy deck column
db.exec(`
  INSERT OR IGNORE INTO collection_decks (collection_id, deck)
  SELECT id, deck FROM collection WHERE deck IS NOT NULL AND deck != '';
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

    console.log('[bulk] Downloading default_cards…');
    const upsert = db.prepare(`
      INSERT INTO card_cache
        (scryfall_id, name, set_code, set_name, collector_number, image_uri, image_back,
         mana_cost, type_line, oracle_text, colors, rarity, prices_usd, cached_at)
      VALUES
        (@scryfall_id, @name, @set_code, @set_name, @collector_number, @image_uri, @image_back,
         @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd, datetime('now'))
      ON CONFLICT(scryfall_id) DO UPDATE SET
        name=excluded.name, set_code=excluded.set_code, set_name=excluded.set_name,
        collector_number=excluded.collector_number,
        image_uri=excluded.image_uri, image_back=excluded.image_back,
        mana_cost=excluded.mana_cost, type_line=excluded.type_line,
        oracle_text=excluded.oracle_text, colors=excluded.colors,
        rarity=excluded.rarity, prices_usd=excluded.prices_usd, cached_at=excluded.cached_at
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
    scryfall_id:      c.id,
    name:             c.name,
    set_code:         c.set          ?? null,
    set_name:         c.set_name     ?? null,
    collector_number: c.collector_number ?? null,
    image_uri:        c.image_uris?.normal      ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
    image_back:       c.card_faces?.[1]?.image_uris?.normal ?? null,
    mana_cost:        c.mana_cost    ?? null,
    type_line:        c.type_line    ?? null,
    oracle_text:      c.oracle_text  ?? null,
    colors:           c.colors       ? JSON.stringify(c.colors) : null,
    rarity:           c.rarity       ?? null,
    prices_usd:       c.prices?.usd  ? parseFloat(c.prices.usd) : null,
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
function cacheRowToScryfall(c) {
  return {
    id:               c.scryfall_id,
    name:             c.name,
    set:              c.set_code,
    set_name:         c.set_name ?? c.set_code,
    collector_number: c.collector_number,
    image_uris:       c.image_uri ? { normal: c.image_uri } : undefined,
    card_faces:       c.image_back ? [
      { image_uris: { normal: c.image_uri } },
      { image_uris: { normal: c.image_back } },
    ] : undefined,
    mana_cost:        c.mana_cost,
    type_line:        c.type_line,
    oracle_text:      c.oracle_text,
    colors:           c.colors ? JSON.parse(c.colors) : [],
    rarity:           c.rarity,
    prices:           { usd: c.prices_usd != null ? String(c.prices_usd) : null },
  };
}

function scryfallCardToRow(card, { quantity, foil, deck, decks, groups }) {
  return {
    name:             card.name,
    set_code:         card.set          ?? null,
    set_name:         card.set_name     ?? null,
    collector_number: card.collector_number ?? null,
    quantity:         quantity ?? 1,
    foil:             foil ? 1 : 0,
    deck:             deck || null,
    scryfall_id:      card.id           ?? null,
    image_uri:        card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null,
    image_back:       card.card_faces?.[1]?.image_uris?.normal ?? null,
    mana_cost:        card.mana_cost    ?? null,
    type_line:        card.type_line    ?? null,
    oracle_text:      card.oracle_text  ?? null,
    colors:           card.colors       ? JSON.stringify(card.colors) : null,
    rarity:           card.rarity       ?? null,
    prices_usd:       card.prices?.usd  ? parseFloat(card.prices.usd) : null,
  };
}

// Attach decks and groups arrays to a collection row
function attachRelations(row) {
  const decks = db.prepare(
    'SELECT deck FROM collection_decks WHERE collection_id = ? ORDER BY deck'
  ).all(row.id).map(r => r.deck);
  const groups = db.prepare(
    'SELECT group_name FROM collection_groups WHERE collection_id = ? ORDER BY group_name'
  ).all(row.id).map(r => r.group_name);
  return { ...row, decks, groups };
}

const saveDecks = db.transaction((collectionId, decks) => {
  db.prepare('DELETE FROM collection_decks WHERE collection_id = ?').run(collectionId);
  for (const deck of decks) {
    if (deck && deck.trim())
      db.prepare('INSERT OR IGNORE INTO collection_decks (collection_id, deck) VALUES (?, ?)').run(collectionId, deck.trim());
  }
});

const saveGroups = db.transaction((collectionId, groups) => {
  db.prepare('DELETE FROM collection_groups WHERE collection_id = ?').run(collectionId);
  for (const g of groups) {
    if (g && g.trim()) {
      db.prepare('INSERT OR IGNORE INTO collection_groups (collection_id, group_name) VALUES (?, ?)').run(collectionId, g.trim());
    }
  }
});

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Card search — one result per unique card name ─────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ data: [] });

  // Deduplicate by name — only return one row per unique card name from cache
  const cached = db.prepare(`
    SELECT * FROM card_cache
    WHERE lower(name) LIKE lower(?)
    GROUP BY lower(name)
    ORDER BY name
    LIMIT 20
  `).all(`${q}%`);

  if (cached.length > 0) return res.json({ data: cached.map(cacheRowToScryfall) });

  // Fall back to Scryfall live search with unique=name
  try {
    const sfRes = await scryFetch(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=name&order=name`
    );
    if (sfRes.status === 404) return res.json({ data: [] });
    if (!sfRes.ok) throw new Error(`Scryfall HTTP ${sfRes.status}`);
    const data = await sfRes.json();
    return res.json({ data: (data.data || []).slice(0, 20) });
  } catch (err) {
    console.error('[search] failed:', err.message);
    return res.status(502).json({ error: 'Card search unavailable', detail: err.message });
  }
});

// ── All printings for a card name ─────────────────────────────────────────────
app.get('/api/printings/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  // Try cache first — all rows with this exact name
  const cached = db.prepare(
    'SELECT * FROM card_cache WHERE lower(name) = lower(?) ORDER BY set_code, collector_number'
  ).all(name);

  if (cached.length > 0) return res.json({ data: cached.map(cacheRowToScryfall) });

  // Fall back to Scryfall
  try {
    const sfRes = await scryFetch(
      `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(name)}"&unique=prints&order=released`
    );
    if (sfRes.status === 404) return res.json({ data: [] });
    if (!sfRes.ok) throw new Error(`Scryfall HTTP ${sfRes.status}`);
    const data = await sfRes.json();
    return res.json({ data: data.data || [] });
  } catch (err) {
    console.error('[printings] failed:', err.message);
    return res.status(502).json({ error: 'Printings lookup unavailable', detail: err.message });
  }
});

// ── Scryfall card lookup by set + collector number ────────────────────────────
app.get('/api/scryfall/card/:set/:num', async (req, res) => {
  const { set, num } = req.params;
  try {
    const sfRes = await scryFetch(`https://api.scryfall.com/cards/${set.toLowerCase()}/${num}`);
    if (!sfRes.ok) return res.status(404).json({ error: 'Card not found' });
    return res.json(await sfRes.json());
  } catch (err) {
    console.error('[set-lookup] failed:', err.message);
    return res.status(502).json({ error: 'Lookup failed', detail: err.message });
  }
});

// ── Collection — list ─────────────────────────────────────────────────────────
app.get('/api/cards', (req, res) => {
  const { search, deck, group, foil, sort = 'name', order = 'asc' } = req.query;
  const allowed = { name: 'c.name', added_at: 'c.added_at', quantity: 'c.quantity', prices_usd: 'c.prices_usd', set_name: 'c.set_name' };
  const col = allowed[sort] || 'c.name';
  const dir = order === 'desc' ? 'DESC' : 'ASC';

  let sql = 'SELECT DISTINCT c.* FROM collection c';
  const params = [];

  if (deck)  { sql += ' JOIN collection_decks  cd ON cd.collection_id = c.id AND cd.deck = ?';       params.push(deck); }
  if (group) { sql += ' JOIN collection_groups cg ON cg.collection_id = c.id AND cg.group_name = ?'; params.push(group); }

  sql += ' WHERE 1=1';
  if (search) { sql += ' AND lower(c.name) LIKE lower(?)';   params.push(`%${search}%`); }
  if (foil !== undefined && foil !== '') { sql += ' AND c.foil = ?'; params.push(foil === 'true' ? 1 : 0); }

  sql += ` ORDER BY ${col} ${dir}`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(attachRelations));
});

// ── Collection — add ──────────────────────────────────────────────────────────
app.post('/api/cards', (req, res) => {
  const { scryfall_card, quantity, foil, deck, decks = [], groups = [] } = req.body;
  if (!scryfall_card?.name) return res.status(400).json({ error: 'scryfall_card with name is required' });

  const row = scryfallCardToRow(scryfall_card, { quantity, foil, deck });
  const result = db.prepare(`
    INSERT INTO collection
      (name, set_code, set_name, collector_number, quantity, foil, deck, scryfall_id,
       image_uri, image_back, mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES
      (@name, @set_code, @set_name, @collector_number, @quantity, @foil, @deck, @scryfall_id,
       @image_uri, @image_back, @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd)
  `).run(row);

  const id = result.lastInsertRowid;
  // Merge deck from legacy field + decks array
  const allDecks = [...new Set([...(deck ? [deck] : []), ...decks])];
  saveDecks(id, allDecks);
  saveGroups(id, groups);

  res.status(201).json({ id });
});

// ── Collection — update ───────────────────────────────────────────────────────
app.patch('/api/cards/:id', (req, res) => {
  const { quantity, foil, deck, decks, groups } = req.body;
  const id = req.params.id;
  const updates = [], params = [];

  if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
  if (foil     !== undefined) { updates.push('foil = ?');     params.push(foil ? 1 : 0); }
  if (deck     !== undefined) { updates.push('deck = ?');     params.push(deck); }

  if (updates.length) {
    params.push(id);
    db.prepare(`UPDATE collection SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  if (decks  !== undefined) saveDecks(id, decks);
  if (groups !== undefined) saveGroups(id, groups);

  res.json(attachRelations(db.prepare('SELECT * FROM collection WHERE id = ?').get(id)));
});

// ── Collection — delete ───────────────────────────────────────────────────────
app.delete('/api/cards/:id', (req, res) => {
  db.prepare('DELETE FROM collection WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(quantity)                                     AS total,
      COUNT(*)                                          AS unique_count,
      SUM(CASE WHEN foil = 1 THEN quantity ELSE 0 END) AS foils,
      SUM(quantity * COALESCE(prices_usd, 0))           AS total_value
    FROM collection
  `).get();

  const byRarity = db.prepare(`
    SELECT COALESCE(rarity, 'unknown') AS rarity, SUM(quantity) AS n
    FROM collection GROUP BY rarity ORDER BY rarity
  `).all();

  // Per-deck: card count + total value
  const byDeck = db.prepare(`
    SELECT cd.deck,
           SUM(c.quantity)                              AS n,
           SUM(c.quantity * COALESCE(c.prices_usd, 0)) AS value
    FROM collection_decks cd
    JOIN collection c ON c.id = cd.collection_id
    GROUP BY cd.deck
    ORDER BY n DESC
  `).all();

  // Cards with no deck assignment
  const unassigned = db.prepare(`
    SELECT SUM(c.quantity) AS n, SUM(c.quantity * COALESCE(c.prices_usd, 0)) AS value
    FROM collection c
    WHERE NOT EXISTS (SELECT 1 FROM collection_decks cd WHERE cd.collection_id = c.id)
  `).get();

  if (unassigned.n > 0) byDeck.push({ deck: 'Unassigned', n: unassigned.n, value: unassigned.value });

  res.json({ ...totals, unique: totals.unique_count, byRarity, byDeck });
});

// ── Decks ─────────────────────────────────────────────────────────────────────
app.get('/api/decks', (req, res) => {
  const decks = db.prepare(
    'SELECT DISTINCT deck FROM collection_decks ORDER BY deck'
  ).all().map(r => r.deck);
  res.json(decks);
});

// ── Groups ────────────────────────────────────────────────────────────────────
app.get('/api/groups', (req, res) => {
  const groups = db.prepare(
    'SELECT DISTINCT group_name FROM collection_groups ORDER BY group_name'
  ).all().map(r => r.group_name);
  res.json(groups);
});

// ── Bulk import ───────────────────────────────────────────────────────────────
app.post('/api/import', (req, res) => {
  const lines      = (req.body.text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const globalDeck = req.body.deck || null;
  const added = [], failed = [];

  const insertStmt = db.prepare(`
    INSERT INTO collection
      (name, set_code, set_name, collector_number, quantity, foil, deck, scryfall_id,
       image_uri, image_back, mana_cost, type_line, oracle_text, colors, rarity, prices_usd)
    VALUES
      (@name, @set_code, @set_name, @collector_number, @quantity, @foil, @deck, @scryfall_id,
       @image_uri, @image_back, @mana_cost, @type_line, @oracle_text, @colors, @rarity, @prices_usd)
  `);

  for (const line of lines) {
    try {
      const [cardPart, deckPart] = line.split('|').map(s => s.trim());
      const match = cardPart.match(/^(\d+)?\s*(foil\s+)?(.+)$/i);
      if (!match) throw new Error('Could not parse line');

      const quantity = parseInt(match[1] || '1', 10);
      const foil     = !!match[2];
      const name     = match[3].trim();
      const deck     = deckPart || globalDeck;

      const cached = db.prepare(
        'SELECT * FROM card_cache WHERE lower(name) = lower(?) LIMIT 1'
      ).get(name);

      const result = insertStmt.run({
        name,
        set_code:         cached?.set_code         ?? null,
        set_name:         cached?.set_name         ?? null,
        collector_number: cached?.collector_number ?? null,
        quantity,
        foil:             foil ? 1 : 0,
        deck,
        scryfall_id:      cached?.scryfall_id      ?? null,
        image_uri:        cached?.image_uri        ?? null,
        image_back:       cached?.image_back       ?? null,
        mana_cost:        cached?.mana_cost        ?? null,
        type_line:        cached?.type_line        ?? null,
        oracle_text:      cached?.oracle_text      ?? null,
        colors:           cached?.colors           ?? null,
        rarity:           cached?.rarity           ?? null,
        prices_usd:       cached?.prices_usd       ?? null,
      });

      if (deck) saveDecks(result.lastInsertRowid, [deck]);
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
  const header = 'id,name,set_code,set_name,collector_number,quantity,foil,deck,rarity,prices_usd,added_at\n';
  const body   = rows.map(r =>
    [r.id, `"${r.name}"`, r.set_code ?? '', `"${r.set_name ?? ''}"`,
     r.collector_number ?? '', r.quantity, r.foil ? 'yes' : 'no',
     r.deck ?? '', r.rarity ?? '', r.prices_usd ?? '', r.added_at].join(',')
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