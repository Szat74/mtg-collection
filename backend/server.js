'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const readline = require('readline');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT            = process.env.PORT     || 3001;
const DB_PATH         = process.env.DB_PATH  || '/data/collection.db';
const BULK_REFRESH_MS = 12 * 60 * 60 * 1000;
const SCRYFALL_UA     = `mtg-collection/1.0 (self-hosted; ${process.env.SCRYFALL_CONTACT_EMAIL || 'unknown'})`;

// ─── Database setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS card_cache (
    scryfall_id       TEXT PRIMARY KEY,
    name              TEXT,
    set_code          TEXT,
    set_name          TEXT,
    collector_number  TEXT,
    image_uri         TEXT,
    image_back        TEXT,
    mana_cost         TEXT,
    type_line         TEXT,
    oracle_text       TEXT,
    colors            TEXT,
    rarity            TEXT,
    prices_usd        REAL,
    prices_usd_foil   REAL,
    prices_usd_etched REAL,
    foil_only         INTEGER,
    cached_at         TEXT
  );

  CREATE TABLE IF NOT EXISTS decks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT UNIQUE NOT NULL,
    colors       TEXT,
    description  TEXT,
    format       TEXT,
    commander_id INTEGER REFERENCES collection(id) ON DELETE SET NULL,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    scryfall_id  TEXT REFERENCES card_cache(scryfall_id),
    name         TEXT NOT NULL,
    deck_id      INTEGER REFERENCES decks(id) ON DELETE SET NULL,
    foil         INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_groups (
    collection_id INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
    group_id      INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS bulk_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cache_name    ON card_cache (name COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_cache_name_lc ON card_cache (lower(name));
  CREATE INDEX IF NOT EXISTS idx_cache_set     ON card_cache (set_code, scryfall_id);
  CREATE INDEX IF NOT EXISTS idx_coll_deck_id  ON collection (deck_id);
  CREATE INDEX IF NOT EXISTS idx_coll_groups   ON collection_groups (group_id);
`);

// Migrations
try { db.exec('ALTER TABLE card_cache ADD COLUMN color_identity TEXT'); } catch {}
try { db.exec('ALTER TABLE card_cache ADD COLUMN full_art INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE card_cache ADD COLUMN keywords TEXT'); } catch {}
try { db.exec('ALTER TABLE decks ADD COLUMN partner_id INTEGER REFERENCES collection(id) ON DELETE SET NULL'); } catch {}
try { db.exec("ALTER TABLE decks ADD COLUMN type TEXT NOT NULL DEFAULT 'deck'"); } catch {}

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
         mana_cost, type_line, oracle_text, colors, color_identity, full_art, keywords, rarity,
         prices_usd, prices_usd_foil, prices_usd_etched, foil_only, cached_at)
      VALUES
        (@scryfall_id, @name, @set_code, @set_name, @collector_number, @image_uri, @image_back,
         @mana_cost, @type_line, @oracle_text, @colors, @color_identity, @full_art, @keywords, @rarity,
         @prices_usd, @prices_usd_foil, @prices_usd_etched, @foil_only, datetime('now'))
      ON CONFLICT(scryfall_id) DO UPDATE SET
        name=excluded.name, set_code=excluded.set_code, set_name=excluded.set_name,
        collector_number=excluded.collector_number,
        image_uri=excluded.image_uri, image_back=excluded.image_back,
        mana_cost=excluded.mana_cost, type_line=excluded.type_line,
        oracle_text=excluded.oracle_text, colors=excluded.colors,
        color_identity=excluded.color_identity, full_art=excluded.full_art,
        keywords=excluded.keywords, rarity=excluded.rarity,
        prices_usd=excluded.prices_usd, prices_usd_foil=excluded.prices_usd_foil,
        prices_usd_etched=excluded.prices_usd_etched, foil_only=excluded.foil_only,
        cached_at=excluded.cached_at
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

function parsePrices(prices = {}) {
  return {
    prices_usd:        prices.usd        ? parseFloat(prices.usd)        : null,
    prices_usd_foil:   prices.usd_foil   ? parseFloat(prices.usd_foil)   : null,
    prices_usd_etched: prices.usd_etched ? parseFloat(prices.usd_etched) : null,
  };
}

function formatPrices(row) {
  return {
    usd:        row.prices_usd        != null ? String(row.prices_usd)        : null,
    usd_foil:   row.prices_usd_foil   != null ? String(row.prices_usd_foil)   : null,
    usd_etched: row.prices_usd_etched != null ? String(row.prices_usd_etched) : null,
  };
}

function cardToRow(c) {
  return {
    scryfall_id:      c.id,
    name:             c.name,
    set_code:         c.set              ?? null,
    set_name:         c.set_name         ?? null,
    collector_number: c.collector_number ?? null,
    image_uri:        c.image_uris?.normal      ?? c.card_faces?.[0]?.image_uris?.normal ?? null,
    image_back:       c.card_faces?.[1]?.image_uris?.normal ?? null,
    mana_cost:        c.mana_cost    ?? null,
    type_line:        c.type_line    ?? c.card_faces?.[0]?.type_line ?? null,
    oracle_text:      c.oracle_text  ?? null,
    colors:           c.colors          ? JSON.stringify(c.colors)          : null,
    color_identity:   c.color_identity  ? JSON.stringify(c.color_identity)  : null,
    full_art:         c.full_art        ? 1 : 0,
    keywords:         c.keywords?.length ? JSON.stringify(c.keywords)       : null,
    rarity:           c.rarity       ?? null,
    ...parsePrices(c.prices),
    foil_only: (c.foil === true && c.nonfoil === false) ? 1 : 0,
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
    colors:           c.colors          ? JSON.parse(c.colors)          : [],
    color_identity:   c.color_identity  ? JSON.parse(c.color_identity)  : [],
    full_art:         !!c.full_art,
    rarity:           c.rarity,
    prices:           formatPrices(c),
  };
}

// Merge card_cache metadata into a flat collection row for API responses
function mergeCache(collRow) {
  if (!collRow) return null;
  const cache = collRow.scryfall_id
    ? db.prepare('SELECT * FROM card_cache WHERE scryfall_id = ?').get(collRow.scryfall_id)
    : null;
  return {
    ...collRow,
    // card metadata fields — null when unmatched
    set_code:         cache?.set_code         ?? null,
    set_name:         cache?.set_name         ?? null,
    collector_number: cache?.collector_number ?? null,
    image_uri:        cache?.image_uri        ?? null,
    image_back:       cache?.image_back       ?? null,
    mana_cost:        cache?.mana_cost        ?? null,
    type_line:        cache?.type_line        ?? null,
    oracle_text:      cache?.oracle_text      ?? null,
    colors:           cache?.colors          ?? null,
    color_identity:   cache?.color_identity  ?? null,
    full_art:         cache?.full_art        ?? 0,
    keywords:         cache?.keywords        ?? null,
    rarity:           cache?.rarity          ?? null,
    prices_usd:       cache?.prices_usd       ?? null,
    prices_usd_foil:  cache?.prices_usd_foil  ?? null,
    prices_usd_etched:cache?.prices_usd_etched?? null,
    foil_only:        cache?.foil_only        ?? null,
  };
}

// Attach groups array (as group objects { id, name }) to a collection row
function attachRelations(row) {
  const groups = db.prepare(`
    SELECT g.id, g.name FROM groups g
    JOIN collection_groups cg ON cg.group_id = g.id
    WHERE cg.collection_id = ?
    ORDER BY g.name
  `).all(row.id);
  return { ...row, groups };
}

const saveGroups = db.transaction((collectionId, groupIds) => {
  db.prepare('DELETE FROM collection_groups WHERE collection_id = ?').run(collectionId);
  for (const gid of groupIds) {
    if (gid != null) {
      db.prepare('INSERT OR IGNORE INTO collection_groups (collection_id, group_id) VALUES (?, ?)')
        .run(collectionId, gid);
    }
  }
});

// Group raw rows into aggregated cards for the frontend.
// Returns one object per (scryfall_id OR name, foil) combination.
function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.scryfall_id || `unmatched-${row.id}`}||${row.name}||${row.foil}`;
    if (!map.has(key)) {
      map.set(key, { ...row, quantity: 0, ids: [], copies: [] });
    }
    const entry = map.get(key);
    entry.quantity++;
    entry.ids.push(row.id);
    entry.copies.push({ id: row.id, deck_id: row.deck_id, groups: row.groups });
  }
  // Aggregate groups across copies for badge display
  for (const entry of map.values()) {
    entry.groups = [...new Map(
      entry.copies.flatMap(c => (c.groups || []).map(g => [g.id, g]))
    ).values()];
  }
  return [...map.values()];
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Card search ───────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ data: [] });

  const cached = db.prepare(`
    SELECT * FROM card_cache
    WHERE lower(name) LIKE lower(?)
    GROUP BY lower(name)
    ORDER BY name
    LIMIT 20
  `).all(`${q}%`);

  if (cached.length > 0) return res.json({ data: cached.map(cacheRowToScryfall) });

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
  const cached = db.prepare(
    'SELECT * FROM card_cache WHERE lower(name) = lower(?) ORDER BY set_code, collector_number'
  ).all(name);
  if (cached.length > 0) return res.json({ data: cached.map(cacheRowToScryfall) });
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

// ── Collection — list (grouped) ───────────────────────────────────────────────
app.get('/api/cards', (req, res) => {
  const { search, deck, group, foil, colors, set, unmatched, sort = 'name', order = 'asc' } = req.query;

  const sortMap = {
    name:       'c.name',
    added_at:   'c.added_at',
    set_name:   'cc.set_name',
    prices_usd: 'CAST(COALESCE(cc.prices_usd_foil, cc.prices_usd, cc.prices_usd_etched) AS REAL)',
    rarity:     "CASE cc.rarity WHEN 'common' THEN 1 WHEN 'uncommon' THEN 2 WHEN 'rare' THEN 3 WHEN 'mythic' THEN 4 ELSE 5 END",
  };
  const col = sortMap[sort] || 'c.name';
  const dir = order === 'desc' ? 'DESC' : 'ASC';

  let sql = `
    SELECT c.id, c.scryfall_id, c.name, c.deck_id, c.foil, c.added_at
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
  `;
  const params = [];

  const deckIds  = deck  ? deck.split(',').map(v => parseInt(v, 10)).filter(Boolean) : [];
  const groupIds = group ? group.split(',').map(v => parseInt(v, 10)).filter(Boolean) : [];
  const setCodes = set   ? set.split(',').map(v => v.trim().toLowerCase()).filter(Boolean) : [];

  if (deckIds.length === 1) {
    sql += ' JOIN decks d ON d.id = c.deck_id AND d.id = ?';
    params.push(deckIds[0]);
  } else if (deckIds.length > 1) {
    sql += ` JOIN decks d ON d.id = c.deck_id AND d.id IN (${deckIds.map(() => '?').join(',')})`;
    params.push(...deckIds);
  }
  if (groupIds.length === 1) {
    sql += ' JOIN collection_groups cg ON cg.collection_id = c.id AND cg.group_id = ?';
    params.push(groupIds[0]);
  } else if (groupIds.length > 1) {
    sql += ` JOIN collection_groups cg ON cg.collection_id = c.id AND cg.group_id IN (${groupIds.map(() => '?').join(',')})`;
    params.push(...groupIds);
  }

  sql += ' WHERE 1=1';

  if (unmatched === 'true') {
    sql += ' AND c.scryfall_id IS NULL';
  }
  if (search) {
    sql += ' AND lower(c.name) LIKE lower(?)';
    params.push(`%${search}%`);
  }
  if (foil !== undefined && foil !== '') {
    sql += ' AND c.foil = ?';
    params.push(foil === 'true' ? 1 : 0);
  }
  if (setCodes.length === 1) {
    sql += ' AND lower(cc.set_code) = ?';
    params.push(setCodes[0]);
  } else if (setCodes.length > 1) {
    sql += ` AND lower(cc.set_code) IN (${setCodes.map(() => '?').join(',')})`;
    params.push(...setCodes);
  }
  if (colors) {
    const selected = colors.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    if (selected.length > 0) {
      const allColors = ['W', 'U', 'B', 'R', 'G'];
      const excluded = allColors.filter(c => !selected.includes(c));
      for (const excl of excluded) {
        sql += ` AND (cc.colors IS NULL OR cc.colors NOT LIKE ?)`;
        params.push(`%"${excl}"%`);
      }
    }
  }

  sql += ` ORDER BY ${col} ${dir}`;

  const rows = db.prepare(sql).all(...params)
    .map(row => attachRelations(mergeCache(row)));

  res.json(groupRows(rows));
});

// ── Collection — add one copy ─────────────────────────────────────────────────
app.post('/api/cards', (req, res) => {
  const { scryfall_card, foil, deck_id, groups = [] } = req.body;
  if (!scryfall_card?.name) return res.status(400).json({ error: 'scryfall_card with name is required' });

  // Ensure card is in cache if we have a scryfall id
  if (scryfall_card.id) {
    const existing = db.prepare('SELECT 1 FROM card_cache WHERE scryfall_id = ?').get(scryfall_card.id);
    if (!existing) {
      db.prepare(`
        INSERT OR IGNORE INTO card_cache
          (scryfall_id, name, set_code, set_name, collector_number, image_uri, image_back,
           mana_cost, type_line, oracle_text, colors, color_identity, full_art, rarity,
           prices_usd, prices_usd_foil, prices_usd_etched, foil_only, cached_at)
        VALUES
          (@scryfall_id, @name, @set_code, @set_name, @collector_number, @image_uri, @image_back,
           @mana_cost, @type_line, @oracle_text, @colors, @color_identity, @full_art, @rarity,
           @prices_usd, @prices_usd_foil, @prices_usd_etched, @foil_only, datetime('now'))
      `).run(cardToRow(scryfall_card));
    }
  }

  // Enforce commander color identity (union of commander + partner)
  if (deck_id) {
    const deck = db.prepare('SELECT format, commander_id, partner_id FROM decks WHERE id = ?').get(deck_id);
    if (deck?.format === 'commander' && deck.commander_id) {
      const cmdInfo     = getCommanderInfo(deck.commander_id);
      const partnerInfo = getCommanderInfo(deck.partner_id);
      const deckIdentity = [...new Set([...cmdInfo.colors, ...partnerInfo.colors])];
      if (deckIdentity.length > 0) {
        const cardIdentity = scryfall_card.color_identity || [];
        const invalid = cardIdentity.filter(c => !deckIdentity.includes(c));
        if (invalid.length > 0) {
          return res.status(400).json({
            error: `"${scryfall_card.name}" has color identity [${cardIdentity.join(',')}] which is outside the commander's identity [${deckIdentity.join(',')}]`,
          });
        }
      }
    }
  }

  const isFoil = foil ? 1 : (scryfall_card.foil === true && scryfall_card.nonfoil === false ? 1 : 0);

  const result = db.prepare(`
    INSERT INTO collection (scryfall_id, name, deck_id, foil)
    VALUES (?, ?, ?, ?)
  `).run(scryfall_card.id ?? null, scryfall_card.name, deck_id ?? null, isFoil);

  const id = result.lastInsertRowid;
  saveGroups(id, groups);

  res.status(201).json({ id });
});

// ── Collection — add N copies (qty increment) ─────────────────────────────────
app.post('/api/cards/copies', (req, res) => {
  const { scryfall_card, foil, count = 1 } = req.body;
  if (!scryfall_card?.name) return res.status(400).json({ error: 'scryfall_card with name is required' });

  if (scryfall_card.id) {
    const existing = db.prepare('SELECT 1 FROM card_cache WHERE scryfall_id = ?').get(scryfall_card.id);
    if (!existing) {
      db.prepare(`
        INSERT OR IGNORE INTO card_cache
          (scryfall_id, name, set_code, set_name, collector_number, image_uri, image_back,
           mana_cost, type_line, oracle_text, colors, color_identity, full_art, rarity,
           prices_usd, prices_usd_foil, prices_usd_etched, foil_only, cached_at)
        VALUES
          (@scryfall_id, @name, @set_code, @set_name, @collector_number, @image_uri, @image_back,
           @mana_cost, @type_line, @oracle_text, @colors, @color_identity, @full_art, @rarity,
           @prices_usd, @prices_usd_foil, @prices_usd_etched, @foil_only, datetime('now'))
      `).run(cardToRow(scryfall_card));
    }
  }

  const isFoil = foil ? 1 : (scryfall_card.foil === true && scryfall_card.nonfoil === false ? 1 : 0);
  const insertStmt = db.prepare(`
    INSERT INTO collection (scryfall_id, name, deck_id, foil) VALUES (?, ?, NULL, ?)
  `);

  const ids = db.transaction(() => {
    const result = [];
    for (let i = 0; i < count; i++)
      result.push(insertStmt.run(scryfall_card.id ?? null, scryfall_card.name, isFoil).lastInsertRowid);
    return result;
  })();

  res.status(201).json({ ids });
});

// ── Collection — update one copy ──────────────────────────────────────────────
// Supports: foil, deck_id, scryfall_id (to fix unmatched), groups (array of group IDs)
app.patch('/api/cards/:id', (req, res) => {
  const { foil, deck_id, scryfall_id, groups } = req.body;
  const id = req.params.id;
  const updates = [], params = [];

  if (foil !== undefined)        { updates.push('foil = ?');        params.push(foil ? 1 : 0); }
  if (deck_id !== undefined)     { updates.push('deck_id = ?');     params.push(deck_id ?? null); }
  if (scryfall_id !== undefined) { updates.push('scryfall_id = ?'); params.push(scryfall_id ?? null); }

  // Enforce commander color identity when moving a card into a commander deck
  if (deck_id != null) {
    const deck = db.prepare('SELECT format, commander_id, partner_id FROM decks WHERE id = ?').get(deck_id);
    if (deck?.format === 'commander' && deck.commander_id) {
      const cardRow = db.prepare(`
        SELECT cc.color_identity FROM collection c
        LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
        WHERE c.id = ?
      `).get(id);
      const cmdInfo     = getCommanderInfo(deck.commander_id);
      const partnerInfo = getCommanderInfo(deck.partner_id);
      const deckIdentity = [...new Set([...cmdInfo.colors, ...partnerInfo.colors])];
      if (deckIdentity.length > 0) {
        const cardIdentity = cardRow?.color_identity ? JSON.parse(cardRow.color_identity) : [];
        const invalid = cardIdentity.filter(c => !deckIdentity.includes(c));
        if (invalid.length > 0) {
          return res.status(400).json({
            error: `Card color identity [${cardIdentity.join(',')}] is outside the commander's identity [${deckIdentity.join(',')}]`,
          });
        }
      }
    }
  }

  if (updates.length) {
    params.push(id);
    db.prepare(`UPDATE collection SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }
  if (groups !== undefined) saveGroups(id, groups);

  const row = db.prepare('SELECT * FROM collection WHERE id = ?').get(id);
  res.json(attachRelations(mergeCache(row)));
});

// ── Collection — delete one copy ──────────────────────────────────────────────
app.delete('/api/cards/:id', (req, res) => {
  db.prepare('DELETE FROM collection WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*)                                                             AS total,
      COUNT(DISTINCT COALESCE(c.scryfall_id, c.name))                     AS unique_count,
      SUM(CASE WHEN c.foil = 1 THEN 1 ELSE 0 END)                         AS foils,
      SUM(CASE WHEN c.foil = 1
            THEN COALESCE(cc.prices_usd_foil, cc.prices_usd_etched, cc.prices_usd, 0)
            ELSE COALESCE(cc.prices_usd, 0)
          END)                                                             AS total_value
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
  `).get();

  const byRarity = db.prepare(`
    SELECT COALESCE(cc.rarity, 'unknown') AS rarity, COUNT(*) AS n
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
    GROUP BY rarity ORDER BY rarity
  `).all();

  const byDeck = db.prepare(`
    SELECT d.id, d.name AS deck, COALESCE(d.type, 'deck') AS type, COUNT(*) AS n,
      SUM(CASE WHEN c.foil = 1
            THEN COALESCE(cc.prices_usd_foil, cc.prices_usd_etched, cc.prices_usd, 0)
            ELSE COALESCE(cc.prices_usd, 0)
          END) AS value
    FROM decks d
    JOIN collection c ON c.deck_id = d.id
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
    GROUP BY d.id ORDER BY n DESC
  `).all();

  const unassigned = db.prepare(`
    SELECT COUNT(*) AS n,
      SUM(CASE WHEN c.foil = 1
            THEN COALESCE(cc.prices_usd_foil, cc.prices_usd_etched, cc.prices_usd, 0)
            ELSE COALESCE(cc.prices_usd, 0)
          END) AS value
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
    WHERE c.deck_id IS NULL
  `).get();

  if (unassigned.n > 0) byDeck.push({ deck: 'Unassigned', n: unassigned.n, value: unassigned.value });

  res.json({ ...totals, unique: totals.unique_count, byRarity, byDeck });
});

// ── Decks ─────────────────────────────────────────────────────────────────────
// Helper: fetch commander/partner info by collection id
function getCommanderInfo(collectionId) {
  if (!collectionId) return { name: null, colors: [], oracle_text: null, type_line: null };
  const row = db.prepare(`
    SELECT c.name, cc.color_identity, cc.oracle_text, cc.type_line
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
    WHERE c.id = ?
  `).get(collectionId);
  return {
    name:        row?.name        ?? null,
    colors:      row?.color_identity ? JSON.parse(row.color_identity) : [],
    oracle_text: row?.oracle_text ?? null,
    type_line:   row?.type_line   ?? null,
  };
}

app.get('/api/decks', (req, res) => {
  const rows = db.prepare('SELECT * FROM decks ORDER BY name').all();

  const result = rows.map((deck) => {
    const { cardCount } = db.prepare(
      'SELECT COUNT(*) AS cardCount FROM collection WHERE deck_id = ?'
    ).get(deck.id);

    const cmd     = getCommanderInfo(deck.commander_id);
    const partner = getCommanderInfo(deck.partner_id);

    // Derive colors: union of commander + partner color identities
    const derivedColors = deck.format === 'commander' && (deck.commander_id || deck.partner_id)
      ? [...new Set([...cmd.colors, ...partner.colors])]
      : (deck.colors ? JSON.parse(deck.colors) : []);

    return {
      id:               deck.id,
      name:             deck.name,
      type:             deck.type ?? 'deck',
      colors:           derivedColors,
      description:      deck.description,
      format:           deck.format,
      commander_id:     deck.commander_id,
      commander_name:   cmd.name,
      commander_colors: cmd.colors,
      partner_id:       deck.partner_id ?? null,
      partner_name:     partner.name,
      partner_colors:   partner.colors,
      created_at:       deck.created_at,
      cardCount,
    };
  });

  res.json(result);
});

app.post('/api/decks', (req, res) => {
  const { name, colors, description, format, type } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const deckType = type === 'binder' ? 'binder' : 'deck';
  try {
    // Insert with commander_id=NULL; caller can PATCH to set it afterward
    const result = db.prepare(
      'INSERT INTO decks (name, colors, description, format, commander_id, type) VALUES (?, ?, ?, ?, NULL, ?)'
    ).run(name.trim(), colors ? JSON.stringify(colors) : null, description ?? null, deckType === 'binder' ? null : (format ?? null), deckType);

    res.status(201).json({
      id: result.lastInsertRowid, name: name.trim(),
      type: deckType,
      colors: colors ?? [], description: description ?? null, format: deckType === 'binder' ? null : (format ?? null),
      commander_id: null, cardCount: 0,
    });
  } catch {
    res.status(409).json({ error: 'Deck already exists' });
  }
});

// Detect partner type from oracle_text
function detectPartnerType(oracleText) {
  if (!oracleText) return null;
  const t = oracleText.toLowerCase();
  if (t.includes("doctor's companion")) return 'doctors_companion';
  if (t.includes('friends forever'))    return 'friends_forever';
  if (/partner with /i.test(oracleText)) return 'partner_with';
  if (/\bpartner\b/i.test(oracleText))  return 'partner';
  return null;
}

// Extract the named partner from "Partner with [Name]" oracle text
function extractPartnerWithName(oracleText) {
  const m = (oracleText || '').match(/Partner with ([^\(]+)/i);
  return m ? m[1].trim() : null;
}

app.patch('/api/decks/:id', (req, res) => {
  const deckId = parseInt(req.params.id, 10);
  const { name, colors, description, format, commander_id, partner_id } = req.body;
  const updates = [], params = [];

  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  // Format lock: once set, format cannot be changed
  if (format !== undefined && deck.format !== null && deck.format !== format) {
    return res.status(400).json({ error: 'Format cannot be changed once set. Delete and recreate the deck to change format.' });
  }

  if (name        !== undefined) { updates.push('name = ?');         params.push(name.trim()); }
  if (colors      !== undefined) { updates.push('colors = ?');       params.push(colors ? JSON.stringify(colors) : null); }
  if (description !== undefined) { updates.push('description = ?');  params.push(description ?? null); }
  if (format      !== undefined) { updates.push('format = ?');       params.push(format ?? null); }

  const deckFormat = format ?? deck.format;

  if (commander_id !== undefined) {
    if (commander_id != null) {
      if (deckFormat === 'commander') {
        const card = db.prepare(`
          SELECT cc.type_line, cc.color_identity, cc.oracle_text FROM collection c
          LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
          WHERE c.id = ?
        `).get(commander_id);
        if (!card) return res.status(404).json({ error: 'Commander card not found in collection' });
        if (!card.type_line?.includes('Legendary')) {
          return res.status(400).json({ error: 'Commander must be a Legendary card' });
        }
        // Auto-derive colors from commander + existing partner
        if (colors === undefined) {
          const cmdCI      = card.color_identity ? JSON.parse(card.color_identity) : [];
          const existingPartnerId = partner_id !== undefined ? partner_id : deck.partner_id;
          const partnerInfo = getCommanderInfo(existingPartnerId);
          const combined   = [...new Set([...cmdCI, ...partnerInfo.colors])];
          updates.push('colors = ?');
          params.push(combined.length ? JSON.stringify(combined) : null);
        }
      }
    }
    updates.push('commander_id = ?');
    params.push(commander_id ?? null);
  }

  if (partner_id !== undefined) {
    if (partner_id != null) {
      if (deckFormat !== 'commander') {
        return res.status(400).json({ error: 'Partners are only supported for Commander format decks' });
      }
      const existingCmdId = commander_id !== undefined ? commander_id : deck.commander_id;
      if (!existingCmdId) {
        return res.status(400).json({ error: 'Set a commander before assigning a partner' });
      }
      const partnerCard = db.prepare(`
        SELECT cc.type_line, cc.color_identity, c.name FROM collection c
        LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
        WHERE c.id = ?
      `).get(partner_id);
      if (!partnerCard) return res.status(404).json({ error: 'Partner card not found in collection' });
      if (!partnerCard.type_line?.includes('Legendary')) {
        return res.status(400).json({ error: 'Partner must be a Legendary card' });
      }

      // Auto-derive colors from commander + partner
      if (colors === undefined) {
        const cmdInfo   = getCommanderInfo(existingCmdId);
        const partnerCI = partnerCard.color_identity ? JSON.parse(partnerCard.color_identity) : [];
        const combined  = [...new Set([...cmdInfo.colors, ...partnerCI])];
        updates.push('colors = ?');
        params.push(combined.length ? JSON.stringify(combined) : null);
      }
    }
    updates.push('partner_id = ?');
    params.push(partner_id ?? null);
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  try {
    params.push(deckId);
    db.prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
    res.json({ ...updated, colors: updated.colors ? JSON.parse(updated.colors) : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/decks/:id', (req, res) => {
  const deckId = parseInt(req.params.id, 10);
  db.transaction(() => {
    db.prepare('UPDATE collection SET deck_id = NULL WHERE deck_id = ?').run(deckId);
    db.prepare('DELETE FROM decks WHERE id = ?').run(deckId);
  })();
  res.json({ ok: true });
});

// ── Deck cards with violations ────────────────────────────────────────────────
const SIZE_LIMITS = { commander: 100, standard: 60, pioneer: 60, modern: 60, legacy: 60, vintage: 60, pauper: 60 };

app.get('/api/decks/:id/cards', (req, res) => {
  const deckId = parseInt(req.params.id, 10);
  const deck   = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  const format   = deck.format;
  const deckColors = (() => {
    const cmd     = getCommanderInfo(deck.commander_id);
    const partner = getCommanderInfo(deck.partner_id);
    return format === 'commander' ? [...new Set([...cmd.colors, ...partner.colors])] : [];
  })();

  const rows  = db.prepare(`
    SELECT c.id, c.scryfall_id, c.name, c.deck_id, c.foil, c.added_at
    FROM collection c
    WHERE c.deck_id = ?
    ORDER BY c.name
  `).all(deckId).map(row => attachRelations(mergeCache(row)));

  const grouped = groupRows(rows);

  // Build name → count map (for singleton / copy-limit checks)
  const nameCounts = {};
  for (const card of grouped) {
    const key = card.name.toLowerCase();
    nameCounts[key] = (nameCounts[key] || 0) + card.quantity;
  }

  const BASIC_NAMES = new Set(['plains','island','swamp','mountain','forest','wastes','snow-covered plains','snow-covered island','snow-covered swamp','snow-covered mountain','snow-covered forest']);
  const isBasic = (card) => {
    if (card.type_line?.startsWith('Basic Land')) return true;
    // Reversible basics have name "Plains // Plains" — check each face name
    const names = (card.name || '').split('//').map(n => n.trim().toLowerCase());
    return names.every(n => BASIC_NAMES.has(n));
  };

  const withViolations = grouped.map(card => {
    const violations = [];
    const nameKey = card.name.toLowerCase();

    if (deck.type === 'binder') {
      // Binders have no format rules
    } else if (format === 'commander') {
      if (!isBasic(card) && nameCounts[nameKey] > 1) {
        violations.push({ type: 'singleton', message: 'More than 1 copy (Commander singleton rule)' });
      }
      if (deckColors.length > 0 && !isBasic(card)) {
        const ci = card.color_identity ? JSON.parse(card.color_identity) : [];
        if (!ci.every(c => deckColors.includes(c))) {
          violations.push({ type: 'color_identity', message: 'Outside commander color identity' });
        }
      }
    } else if (format === 'pauper') {
      if (!isBasic(card) && nameCounts[nameKey] > 4) {
        violations.push({ type: 'copy_limit', message: 'More than 4 copies' });
      }
      if (card.rarity && card.rarity !== 'common') {
        violations.push({ type: 'rarity', message: `Not a common (${card.rarity})` });
      }
    } else if (['standard', 'pioneer', 'modern', 'legacy', 'vintage'].includes(format)) {
      if (!isBasic(card) && nameCounts[nameKey] > 4) {
        violations.push({ type: 'copy_limit', message: 'More than 4 copies' });
      }
    }

    return { ...card, violations };
  });

  const totalCards    = grouped.reduce((s, c) => s + c.quantity, 0);
  const violationCount = withViolations.reduce((s, c) => s + c.violations.length, 0);
  const sizeLimit      = SIZE_LIMITS[format] ?? null;

  res.json({
    summary: { total: totalCards, sizeLimit, violations: violationCount },
    cards:   withViolations,
  });
});

// ── Groups ────────────────────────────────────────────────────────────────────
app.get('/api/groups', (req, res) => {
  res.json(db.prepare('SELECT id, name, description FROM groups ORDER BY name').all());
});

app.post('/api/groups', (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const result = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(name.trim(), description ?? null);
    res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), description: description ?? null });
  } catch {
    res.status(409).json({ error: 'Group already exists' });
  }
});

app.patch('/api/groups/:id', (req, res) => {
  const { name, description } = req.body;
  const updates = [], params = [];
  if (name        !== undefined) { updates.push('name = ?');        params.push(name.trim()); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description ?? null); }
  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  try {
    params.push(req.params.id);
    db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT id, name, description FROM groups WHERE id = ?').get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/groups/:id', (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Bulk import ───────────────────────────────────────────────────────────────
// Regex for name-less set+collector# lines: e.g. "MH3 42", "2 foil ONE 115", "2 foil ONE #115"
const SET_NUM_ONLY_RE = /^(\d+\s+)?(foil\s+)?([A-Za-z0-9]{2,6})\s+#?(\d+[a-zA-Z]?)$/i;

async function resolveSetNum(setCode, collectorNumber) {
  // Check local cache first
  let cached = db.prepare(
    'SELECT * FROM card_cache WHERE lower(set_code) = lower(?) AND collector_number = ? LIMIT 1'
  ).get(setCode, collectorNumber);
  if (cached) return cached;

  // Fall back to Scryfall
  const r = await scryFetch(`https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/${encodeURIComponent(collectorNumber)}`);
  if (!r.ok) throw new Error(`Card ${setCode} #${collectorNumber} not found`);
  const card = await r.json();
  if (card.object === 'error') throw new Error(card.details || `Card ${setCode} #${collectorNumber} not found`);

  // Cache it
  db.prepare(`
    INSERT OR IGNORE INTO card_cache
      (scryfall_id, name, set_code, set_name, collector_number, image_uri, image_back,
       mana_cost, type_line, oracle_text, colors, color_identity, full_art, rarity,
       prices_usd, prices_usd_foil, prices_usd_etched, foil_only, cached_at)
    VALUES
      (@scryfall_id, @name, @set_code, @set_name, @collector_number, @image_uri, @image_back,
       @mana_cost, @type_line, @oracle_text, @colors, @color_identity, @full_art, @rarity,
       @prices_usd, @prices_usd_foil, @prices_usd_etched, @foil_only, datetime('now'))
  `).run(cardToRow(card));

  return db.prepare('SELECT * FROM card_cache WHERE scryfall_id = ?').get(card.id);
}

app.post('/api/import', async (req, res) => {
  const lines      = (req.body.text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const globalDeckId = req.body.deck_id ? parseInt(req.body.deck_id, 10) : null;
  const added = [], failed = [];

  for (const line of lines) {
    try {
      const [cardPart, deckPart] = line.split('|').map(s => s.trim());

      // Resolve deck_id: prefer pipe-delimited deck name, then global
      let deckId = globalDeckId;
      if (deckPart) {
        const deckRow = db.prepare('SELECT id FROM decks WHERE lower(name) = lower(?)').get(deckPart.trim());
        if (deckRow) deckId = deckRow.id;
      }

      // ── Set + collector# only (no card name) ──────────────────────────────
      const setNumMatch = cardPart.match(SET_NUM_ONLY_RE);
      if (setNumMatch) {
        const quantity        = parseInt((setNumMatch[1] || '1').trim(), 10);
        const foil            = !!setNumMatch[2];
        const setCode         = setNumMatch[3];
        const collectorNumber = setNumMatch[4];

        const cached  = await resolveSetNum(setCode, collectorNumber);
        const isFoil  = foil || (cached.foil_only ? 1 : 0);
        const name    = cached.name;

        db.transaction(() => {
          for (let i = 0; i < quantity; i++) {
            db.prepare('INSERT INTO collection (scryfall_id, name, deck_id, foil) VALUES (?, ?, ?, ?)')
              .run(cached.scryfall_id, name, deckId, isFoil ? 1 : 0);
          }
        })();

        added.push(quantity > 1 ? `${quantity}× ${name} (${setCode} #${collectorNumber})` : `${name} (${setCode} #${collectorNumber})`);
        continue;
      }

      // ── Name-based (existing logic) ───────────────────────────────────────
      const match = cardPart.match(/^(\d+)?\s*(foil\s+)?(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+?))?)?(?:\s+\*F\*)?$/i);
      if (!match) throw new Error('Could not parse line');

      const quantity        = parseInt(match[1] || '1', 10);
      const foil            = !!match[2] || /\*F\*$/i.test(cardPart);
      const name            = match[3].trim();
      const setCode         = match[4]?.toLowerCase() ?? null;
      const collectorNumber = match[5] ?? null;

      let cached = null;
      if (setCode && collectorNumber) {
        cached = db.prepare('SELECT * FROM card_cache WHERE lower(set_code) = lower(?) AND collector_number = ? LIMIT 1').get(setCode, collectorNumber);
      }
      if (!cached && setCode) {
        cached = db.prepare('SELECT * FROM card_cache WHERE lower(name) = lower(?) AND lower(set_code) = lower(?) LIMIT 1').get(name, setCode);
      }
      if (!cached) {
        cached = db.prepare('SELECT * FROM card_cache WHERE lower(name) = lower(?) LIMIT 1').get(name);
      }

      const isFoil = foil || (cached?.foil_only ? 1 : 0);

      db.transaction(() => {
        for (let i = 0; i < quantity; i++) {
          db.prepare('INSERT INTO collection (scryfall_id, name, deck_id, foil) VALUES (?, ?, ?, ?)')
            .run(cached?.scryfall_id ?? null, name, deckId, isFoil ? 1 : 0);
        }
      })();

      added.push(quantity > 1 ? `${quantity}× ${name}` : name);
    } catch (err) {
      failed.push({ line, error: err.message });
    }
  }

  res.json({ added, failed });
});

// ── CSV export ────────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, cc.set_code, cc.set_name, cc.collector_number,
           c.foil, d.name AS deck, cc.rarity, cc.prices_usd, c.added_at
    FROM collection c
    LEFT JOIN card_cache cc ON cc.scryfall_id = c.scryfall_id
    LEFT JOIN decks d ON d.id = c.deck_id
    ORDER BY c.name
  `).all();

  const header = 'id,name,set_code,set_name,collector_number,foil,deck,rarity,prices_usd,added_at\n';
  const body   = rows.map(r =>
    [r.id, `"${r.name}"`, r.set_code ?? '', `"${r.set_name ?? ''}"`,
     r.collector_number ?? '', r.foil ? 'yes' : 'no',
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

app.post('/api/cache/refresh', (req, res) => {
  db.prepare("DELETE FROM bulk_meta WHERE key='bulk_updated_at'").run();
  res.json({ ok: true, message: 'Bulk cache cleared — refresh starting in background' });
  refreshBulkCache();
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  startBulkScheduler();
});
