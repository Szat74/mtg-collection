const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const fetch = require('node-fetch');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3001;
const DB_PATH = '/data/collection.db';

app.use(cors());
app.use(express.json());

// ── Database setup ────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scryfall_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    set_code    TEXT NOT NULL,
    set_name    TEXT NOT NULL,
    collector_number TEXT NOT NULL,
    mana_cost   TEXT,
    type_line   TEXT,
    rarity      TEXT,
    image_uri   TEXT,
    image_back  TEXT,
    colors      TEXT,
    cmc         REAL,
    quantity    INTEGER NOT NULL DEFAULT 1,
    foil        INTEGER NOT NULL DEFAULT 0,
    deck        TEXT DEFAULT '',
    added_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS decks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Scryfall helpers ──────────────────────────────────────────────────────────
const SCRYFALL = 'https://api.scryfall.com';

async function scryfallGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MTG-Collection/1.0' } });
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  return res.json();
}

function cardFromScryfall(c, qty = 1, foil = false, deck = '') {
  const imgUris = c.image_uris || (c.card_faces && c.card_faces[0]?.image_uris) || {};
  const imgBack = c.card_faces && c.card_faces[1]?.image_uris?.normal || null;
  return {
    scryfall_id: c.id,
    name: c.name,
    set_code: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    mana_cost: c.mana_cost || (c.card_faces?.[0]?.mana_cost ?? ''),
    type_line: c.type_line || '',
    rarity: c.rarity,
    image_uri: imgUris.normal || imgUris.large || imgUris.small || '',
    image_back: imgBack,
    colors: JSON.stringify(c.colors || c.card_faces?.[0]?.colors || []),
    cmc: c.cmc || 0,
    quantity: qty,
    foil: foil ? 1 : 0,
    deck,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Search Scryfall
app.get('/api/scryfall/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  try {
    const data = await scryfallGet(`${SCRYFALL}/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get card by set + collector number
app.get('/api/scryfall/card/:set/:number', async (req, res) => {
  const { set, number } = req.params;
  try {
    const data = await scryfallGet(`${SCRYFALL}/cards/${set}/${number}`);
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: 'Card not found' });
  }
});

// Get all cards in collection
app.get('/api/cards', (req, res) => {
  const { deck, foil, search, sort = 'name', order = 'asc' } = req.query;
  const allowed = ['name', 'cmc', 'rarity', 'set_name', 'added_at'];
  const sortCol = allowed.includes(sort) ? sort : 'name';
  const sortDir = order === 'desc' ? 'DESC' : 'ASC';

  let where = [];
  const params = {};
  if (deck)   { where.push("deck = :deck");         params.deck = deck; }
  if (foil !== undefined) { where.push("foil = :foil"); params.foil = foil === 'true' ? 1 : 0; }
  if (search) { where.push("name LIKE :search");    params.search = `%${search}%`; }

  const sql = `SELECT * FROM cards ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortCol} ${sortDir}`;
  const cards = db.prepare(sql).all(params);
  res.json(cards.map(c => ({ ...c, colors: JSON.parse(c.colors || '[]') })));
});

// Get collection stats
app.get('/api/stats', (req, res) => {
  const total      = db.prepare('SELECT SUM(quantity) as n FROM cards').get().n || 0;
  const unique     = db.prepare('SELECT COUNT(*) as n FROM cards').get().n || 0;
  const foils      = db.prepare('SELECT SUM(quantity) as n FROM cards WHERE foil=1').get().n || 0;
  const byRarity   = db.prepare('SELECT rarity, SUM(quantity) as n FROM cards GROUP BY rarity').all();
  const byDeck     = db.prepare("SELECT COALESCE(NULLIF(deck,''), 'Unassigned') as deck, COUNT(*) as n FROM cards GROUP BY deck").all();
  res.json({ total, unique, foils, byRarity, byDeck });
});

// Add a single card
app.post('/api/cards', (req, res) => {
  const { scryfall_card, quantity = 1, foil = false, deck = '' } = req.body;
  if (!scryfall_card) return res.status(400).json({ error: 'Missing scryfall_card' });

  const data = cardFromScryfall(scryfall_card, quantity, foil, deck);

  // If same scryfall_id + foil + deck already exists, just increment
  const existing = db.prepare(
    'SELECT id, quantity FROM cards WHERE scryfall_id=? AND foil=? AND deck=?'
  ).get(data.scryfall_id, data.foil, data.deck);

  if (existing) {
    db.prepare('UPDATE cards SET quantity=quantity+? WHERE id=?').run(quantity, existing.id);
    const updated = db.prepare('SELECT * FROM cards WHERE id=?').get(existing.id);
    return res.json({ ...updated, colors: JSON.parse(updated.colors || '[]') });
  }

  const info = db.prepare(`
    INSERT INTO cards (scryfall_id,name,set_code,set_name,collector_number,mana_cost,type_line,rarity,image_uri,image_back,colors,cmc,quantity,foil,deck)
    VALUES (@scryfall_id,@name,@set_code,@set_name,@collector_number,@mana_cost,@type_line,@rarity,@image_uri,@image_back,@colors,@cmc,@quantity,@foil,@deck)
  `).run(data);

  const created = db.prepare('SELECT * FROM cards WHERE id=?').get(info.lastInsertRowid);
  res.status(201).json({ ...created, colors: JSON.parse(created.colors || '[]') });
});

// Update a card (qty, foil, deck)
app.patch('/api/cards/:id', (req, res) => {
  const { id } = req.params;
  const { quantity, foil, deck } = req.body;
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  if (!card) return res.status(404).json({ error: 'Not found' });

  const newQty  = quantity !== undefined ? quantity : card.quantity;
  const newFoil = foil     !== undefined ? (foil ? 1 : 0) : card.foil;
  const newDeck = deck     !== undefined ? deck : card.deck;

  if (newQty <= 0) {
    db.prepare('DELETE FROM cards WHERE id=?').run(id);
    return res.json({ deleted: true });
  }

  db.prepare('UPDATE cards SET quantity=?, foil=?, deck=? WHERE id=?').run(newQty, newFoil, newDeck, id);
  const updated = db.prepare('SELECT * FROM cards WHERE id=?').get(id);
  res.json({ ...updated, colors: JSON.parse(updated.colors || '[]') });
});

// Delete a card
app.delete('/api/cards/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM cards WHERE id=?').run(id);
  res.json({ deleted: true });
});

// ── Bulk import ───────────────────────────────────────────────────────────────
// Accepts plain text: one card per line, format:
//   [qty] [foil] Card Name [| deck name]
//   e.g.  "4 Black Lotus", "2 foil Lightning Bolt | Burn Deck"
app.post('/api/import', async (req, res) => {
  const { text, deck: defaultDeck = '' } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results = { added: [], failed: [] };

  for (const line of lines) {
    try {
      const [cardPart, deckPart] = line.split('|').map(s => s.trim());
      const deckName = deckPart || defaultDeck;

      const foil = /^foil\s+/i.test(cardPart);
      const stripped = cardPart.replace(/^foil\s+/i, '');
      const qtyMatch = stripped.match(/^(\d+)\s+(.+)$/);
      const qty  = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      const name = qtyMatch ? qtyMatch[2] : stripped;

      const data = await scryfallGet(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(name)}`);
      const card = cardFromScryfall(data, qty, foil, deckName);
      const colors = card.colors;
      card.colors = typeof colors === 'string' ? colors : JSON.stringify(colors);

      const existing = db.prepare(
        'SELECT id FROM cards WHERE scryfall_id=? AND foil=? AND deck=?'
      ).get(card.scryfall_id, card.foil, card.deck);

      if (existing) {
        db.prepare('UPDATE cards SET quantity=quantity+? WHERE id=?').run(qty, existing.id);
      } else {
        db.prepare(`
          INSERT INTO cards (scryfall_id,name,set_code,set_name,collector_number,mana_cost,type_line,rarity,image_uri,image_back,colors,cmc,quantity,foil,deck)
          VALUES (@scryfall_id,@name,@set_code,@set_name,@collector_number,@mana_cost,@type_line,@rarity,@image_uri,@image_back,@colors,@cmc,@quantity,@foil,@deck)
        `).run(card);
      }
      results.added.push(name);
    } catch (e) {
      results.failed.push({ line, error: e.message });
    }
  }

  res.json(results);
});

// ── CSV export ────────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const cards = db.prepare('SELECT * FROM cards').all();
  const header = 'name,set_code,set_name,collector_number,quantity,foil,deck,rarity,mana_cost,type_line\n';
  const rows = cards.map(c =>
    [c.name, c.set_code, c.set_name, c.collector_number, c.quantity,
     c.foil ? 'foil' : '', c.deck, c.rarity,
     (c.mana_cost || '').replace(/,/g, ''), (c.type_line || '').replace(/,/g, ' ')
    ].map(v => `"${v}"`).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="mtg-collection.csv"');
  res.send(header + rows);
});

// ── Decks ─────────────────────────────────────────────────────────────────────
app.get('/api/decks', (req, res) => {
  const decks = db.prepare("SELECT DISTINCT deck FROM cards WHERE deck != '' ORDER BY deck").all();
  res.json(decks.map(d => d.deck));
});

app.listen(PORT, () => console.log(`MTG Collection API running on port ${PORT}`));
