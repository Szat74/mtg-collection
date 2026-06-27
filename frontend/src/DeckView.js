import React, { useState, useEffect } from 'react';
import { DeckManager } from './DeckManager';

const API = '/api';

const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e' };
const COLOR_PIP = {
  W: { bg: '#f9faf4', border: '#c8b96a', color: '#6b6340' },
  U: { bg: '#0e68ab', border: '#0a4f82', color: '#fff'    },
  B: { bg: '#1a1a1a', border: '#444',    color: '#ccc'    },
  R: { bg: '#d3202a', border: '#a01820', color: '#fff'    },
  G: { bg: '#00733e', border: '#005530', color: '#fff'    },
};
const SIZE_LIMITS = { commander: 100, standard: 60, pioneer: 60, modern: 60, legacy: 60, vintage: 60, pauper: 60 };
const VIOLATION_LABELS = { singleton: 'Singleton', color_identity: 'Color ID', copy_limit: '4-copy limit', rarity: 'Rarity' };

// ── Grouping helpers ──────────────────────────────────────────────────────────
const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'];
const COLOR_ORDER = ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolor', 'Colorless'];
const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

function getTypeGroup(type_line) {
  if (!type_line) return 'Other';
  for (const t of ['Planeswalker', 'Battle', 'Creature', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery']) {
    if (type_line.includes(t)) return t;
  }
  return 'Other';
}

function getColorGroup(color_identity) {
  const ci = Array.isArray(color_identity)
    ? color_identity
    : (color_identity ? JSON.parse(color_identity) : []);
  if (ci.length === 0) return 'Colorless';
  if (ci.length > 1)  return 'Multicolor';
  return COLOR_NAME[ci[0]] ?? 'Colorless';
}

function parseCmc(mana_cost) {
  if (!mana_cost) return 0;
  let total = 0;
  for (const m of mana_cost.matchAll(/\{([^}]+)\}/g)) {
    const v = m[1];
    if (/^\d+$/.test(v)) total += parseInt(v, 10);
    else if (v !== 'X') total += 1;
  }
  return total;
}

function sortCards(cards, sortBy) {
  return [...cards].sort((a, b) => {
    if (sortBy === 'cmc') {
      const diff = parseCmc(a.mana_cost) - parseCmc(b.mana_cost);
      if (diff !== 0) return diff;
    }
    return a.name.localeCompare(b.name);
  });
}

function groupCards(cards, groupBy, sortBy) {
  if (groupBy === 'none') return [{ label: null, cards: sortCards(cards, sortBy) }];
  const map = {};
  for (const card of cards) {
    const label = groupBy === 'type'
      ? getTypeGroup(card.type_line)
      : getColorGroup(card.color_identity);
    if (!map[label]) map[label] = [];
    map[label].push(card);
  }
  const order = groupBy === 'type' ? TYPE_ORDER : COLOR_ORDER;
  return order.filter(l => map[l]).map(l => ({ label: l, cards: sortCards(map[l], sortBy) }));
}

// ── Components ────────────────────────────────────────────────────────────────
function ColorPips({ colors }) {
  if (!colors?.length) return <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>◇ Colorless</span>;
  return (
    <span style={{ display: 'flex', gap: 3 }}>
      {['W','U','B','R','G'].filter(c => colors.includes(c)).map(c => {
        const p = COLOR_PIP[c];
        return (
          <span key={c} style={{
            background: p.bg, border: `1px solid ${p.border}`, color: p.color,
            width: 18, height: 18, borderRadius: '50%', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800,
          }}>{c}</span>
        );
      })}
    </span>
  );
}

function DeckCardTile({ card }) {
  const isFoil  = !!card.foil;
  const imgSrc  = card.image_uri ?? card.image_back ?? null;
  const rawPrice = isFoil
    ? (card.prices_usd_foil ?? card.prices_usd_etched ?? card.prices_usd)
    : (card.prices_usd ?? card.prices_usd_foil ?? card.prices_usd_etched);
  const price = rawPrice != null ? `$${parseFloat(rawPrice).toFixed(2)}` : null;
  const hasViolations = card.violations?.length > 0;

  return (
    <div className={`card-tile dv-card-tile ${isFoil ? 'foil' : ''} ${hasViolations ? 'has-violation' : ''}`}>
      {hasViolations && (
        <div className="dv-violation-badges">
          {card.violations.map((v, i) => (
            <span key={i} className="dv-violation-badge" title={v.message}>
              {VIOLATION_LABELS[v.type] ?? v.type}
            </span>
          ))}
        </div>
      )}
      <div className="card-img-wrap">
        {imgSrc
          ? <img src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-no-img">{card.name}</div>
        }
        {isFoil && <span className="foil-badge">✦ Foil</span>}
        {price && <span className="price-overlay">{price}</span>}
        {card.quantity > 1 && <span className="dv-qty-badge">×{card.quantity}</span>}
      </div>
      <div className="card-info">
        <div className="card-name">{card.name}</div>
        <div className="card-meta">
          <span className="rarity-dot" style={{ background: RARITY_COLOR[card.rarity] || '#888' }} />
          <span>{card.set_code?.toUpperCase()}{card.collector_number ? ` #${card.collector_number}` : ''}</span>
        </div>
        <div className="card-sub" style={{ fontSize: 10 }}>{card.type_line}</div>
      </div>
    </div>
  );
}

function DeckListRow({ card }) {
  const [expanded, setExpanded] = useState(false);
  const isFoil        = !!card.foil;
  const imgSrc        = card.image_uri ?? card.image_back ?? null;
  const hasViolations = card.violations?.length > 0;
  const ci = Array.isArray(card.color_identity)
    ? card.color_identity
    : (card.color_identity ? JSON.parse(card.color_identity) : []);

  return (
    <li className={`dv-list-row ${isFoil ? 'dv-list-row--foil' : ''}`} onMouseLeave={() => setExpanded(false)}>
      {/* Hover preview (only when not expanded) */}
      {imgSrc && !expanded && (
        <div className="dv-list-hover-img">
          <img src={imgSrc} alt={card.name} />
        </div>
      )}

      {/* Color pips */}
      <span className="dv-list-pips">
        {ci.length === 0
          ? <span className="dv-list-colorless">◇</span>
          : ['W','U','B','R','G'].filter(c => ci.includes(c)).map(c => {
              const p = COLOR_PIP[c];
              return (
                <span key={c} style={{
                  background: p.bg, border: `1px solid ${p.border}`, color: p.color,
                  width: 13, height: 13, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 800,
                  flexShrink: 0,
                }}>{c}</span>
              );
            })
        }
      </span>

      {/* Name — click to toggle image */}
      <span
        className={`dv-list-name ${imgSrc ? 'dv-list-name--clickable' : ''}`}
        onClick={() => imgSrc && setExpanded(e => !e)}
      >
        {card.name}
      </span>

      {/* Badges */}
      <span className="dv-list-right">
        {isFoil && <span className="dv-list-foil">✦</span>}
        {card.quantity > 1 && <span className="dv-list-qty">×{card.quantity}</span>}
        {hasViolations && (
          <span className="dv-list-violation" title={card.violations.map(v => v.message).join('; ')}>⚠</span>
        )}
      </span>

      {/* Expanded image */}
      {expanded && imgSrc && (
        <div className="dv-list-expanded-img" onClick={() => setExpanded(false)}>
          <img src={imgSrc} alt={card.name} />
        </div>
      )}
    </li>
  );
}

function CollapsibleGroup({ label, cards, groupBy, viewMode }) {
  const [open, setOpen] = useState(true);
  const total = cards.reduce((s, c) => s + (c.quantity || 1), 0);

  const groupIcon = groupBy === 'color' ? (
    label === 'White'      ? <span style={{ color: '#d4c98e' }}>W</span> :
    label === 'Blue'       ? <span style={{ color: '#5b9bd5' }}>U</span> :
    label === 'Black'      ? <span style={{ color: '#aaa' }}>B</span> :
    label === 'Red'        ? <span style={{ color: '#e05050' }}>R</span> :
    label === 'Green'      ? <span style={{ color: '#4db87a' }}>G</span> :
    label === 'Multicolor' ? <span style={{ color: '#c8b06a' }}>◈</span> :
                             <span style={{ color: '#777' }}>◇</span>
  ) : null;

  return (
    <div className="dv-list-group">
      <div className="dv-group-header" onClick={() => setOpen(o => !o)}>
        <span className="dv-group-chevron">{open ? '▾' : '▸'}</span>
        {groupIcon && <span className="dv-group-icon">{groupIcon}</span>}
        <span className="dv-group-label">{label}</span>
        <span className="dv-group-count">{total}</span>
      </div>
      {open && (viewMode === 'grid' ? (
        <div className="card-grid dv-card-grid">
          {cards.map(card => <DeckCardTile key={card.ids[0]} card={card} />)}
        </div>
      ) : (
        <ul className="dv-list-cards">
          {cards.map(card => <DeckListRow key={card.ids[0]} card={card} />)}
        </ul>
      ))}
    </div>
  );
}

function CommanderThumb({ name, image_uri }) {
  if (!name) return null;
  return (
    <div className="dv-cmd-thumb">
      {image_uri && <img src={image_uri} alt={name} />}
      <span className="dv-cmd-name">{name}</span>
    </div>
  );
}

function ViolationsBanner({ summary, cards }) {
  const [expanded, setExpanded] = useState(false);
  if (!summary?.violations) return null;

  const byType = {};
  for (const card of cards) {
    for (const v of card.violations) {
      byType[v.type] = (byType[v.type] || 0) + 1;
    }
  }
  const parts = Object.entries(byType).map(([t, n]) => `${VIOLATION_LABELS[t] ?? t} ×${n}`);

  return (
    <div className="dv-violations-banner">
      <div className="dv-violations-header" onClick={() => setExpanded(e => !e)}>
        <span>⚠ {summary.violations} violation{summary.violations !== 1 ? 's' : ''} — {parts.join(', ')}</span>
        <span className="dv-violations-toggle">{expanded ? '▴' : '▾'} details</span>
      </div>
      {expanded && (
        <ul className="dv-violations-list">
          {cards.filter(c => c.violations.length > 0).map(card => (
            <li key={card.ids[0]}>
              <strong>{card.name}</strong>:{' '}
              {card.violations.map(v => v.message).join('; ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function DeckView({ decks, refresh, showToast }) {
  const [selectedId, setSelectedId] = useState(null);
  const [deckData, setDeckData]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [viewMode, setViewMode]     = useState('grid');   // 'grid' | 'list'
  const [groupBy, setGroupBy]       = useState('type');   // 'none' | 'type' | 'color'
  const [sortBy, setSortBy]         = useState('name');   // 'name' | 'cmc'
  const [cmdImages]                 = useState({});

  const selectedDeck = decks.find(d => d.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) { setDeckData(null); return; }
    setLoading(true);
    fetch(`${API}/decks/${selectedId}/cards`)
      .then(r => r.json())
      .then(data => { setDeckData(data); setLoading(false); })
      .catch(() => { setDeckData(null); setLoading(false); });
  }, [selectedId, decks]);

  useEffect(() => {
    if (!selectedDeck) return;
    // images come from deckData cards, no separate fetch needed
  }, [selectedDeck]);

  const cmdImage     = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.commander_id))?.image_uri ?? null;
  const partnerImage = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.partner_id))?.image_uri ?? null;

  const sizeLimit  = selectedDeck ? (SIZE_LIMITS[selectedDeck.format] ?? null) : null;
  const totalCards = deckData?.summary?.total ?? 0;

  const sizeColor = sizeLimit
    ? (totalCards === sizeLimit ? 'var(--success)' : totalCards > sizeLimit ? 'var(--danger)' : 'var(--text-dim)')
    : 'var(--text-dim)';

  const groups = deckData?.cards?.length
    ? groupCards(deckData.cards, groupBy, sortBy)
    : [];

  return (
    <div className={`dv-root${selectedId ? ' dv-has-selection' : ''}`}>
      {/* ── Sidebar ── */}
      <div className="dv-sidebar">
        <div className="dv-sidebar-header">
          <span className="dv-sidebar-title">Decks</span>
          <DeckManager onDecksChanged={refresh} />
        </div>
        <div className="dv-deck-list">
          {decks.length === 0 && (
            <div className="dv-empty">No decks yet. Create one with the Decks button.</div>
          )}
          {decks.map(deck => (
            <div
              key={deck.id}
              className={`dv-deck-item ${deck.id === selectedId ? 'selected' : ''}`}
              onClick={() => setSelectedId(deck.id)}
            >
              <div className="dv-deck-item-main">
                <span className="dv-deck-item-name">{deck.name}</span>
                {deck.format && <span className="dv-deck-item-format">🔒 {deck.format}</span>}
              </div>
              <div className="dv-deck-item-sub">
                <ColorPips colors={deck.colors} />
                <span className="dv-deck-item-count">{deck.cardCount} cards</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Detail panel ── */}
      <div className="dv-detail">
        {!selectedDeck ? (
          <div className="dv-empty-detail">
            <span>Select a deck to view its cards</span>
          </div>
        ) : (
          <>
            <button className="dv-back-btn" onClick={() => setSelectedId(null)}>← Back</button>

            {/* Deck header */}
            <div className="dv-detail-header">
              <div className="dv-detail-title-row">
                <h2 className="dv-detail-name">{selectedDeck.name}</h2>
                {selectedDeck.format && <span className="dv-detail-format">🔒 {selectedDeck.format}</span>}
                <ColorPips colors={selectedDeck.colors} />
                <span className="dv-detail-count" style={{ color: sizeColor }}>
                  {totalCards}{sizeLimit ? ` / ${sizeLimit}` : ' cards'}
                  {sizeLimit && totalCards !== sizeLimit && (
                    <span style={{ fontSize: 10, marginLeft: 4 }}>
                      ({totalCards < sizeLimit ? `${sizeLimit - totalCards} short` : `${totalCards - sizeLimit} over`})
                    </span>
                  )}
                </span>

                {/* View toggle + sort controls */}
                {deckData?.cards?.length > 0 && (
                  <div className="dv-view-toggle">
                    <button
                      className={`dv-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                      onClick={() => setViewMode('grid')}
                      title="Card grid"
                    >⊞ Grid</button>
                    <button
                      className={`dv-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                      onClick={() => setViewMode('list')}
                      title="Grouped list"
                    >≡ List</button>
                    <span className="dv-toggle-divider" />
                    <select
                      className="dv-group-select"
                      value={groupBy}
                      onChange={e => setGroupBy(e.target.value)}
                      title="Group by"
                    >
                      <option value="none">No grouping</option>
                      <option value="type">By type</option>
                      <option value="color">By color</option>
                    </select>
                    <select
                      className="dv-group-select"
                      value={sortBy}
                      onChange={e => setSortBy(e.target.value)}
                      title="Sort within groups"
                    >
                      <option value="name">Sort: name</option>
                      <option value="cmc">Sort: CMC</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Commander(s) */}
              {selectedDeck.format === 'commander' && (
                <div className="dv-commanders">
                  <CommanderThumb name={selectedDeck.commander_name} image_uri={cmdImage} />
                  {selectedDeck.partner_name && (
                    <>
                      <span className="dv-cmd-plus">+</span>
                      <CommanderThumb name={selectedDeck.partner_name} image_uri={partnerImage} />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Violations banner */}
            {deckData && <ViolationsBanner summary={deckData.summary} cards={deckData.cards ?? []} />}

            {/* Cards */}
            {loading ? (
              <div className="dv-loading">Loading cards…</div>
            ) : !deckData ? (
              <div className="dv-loading" style={{ color: 'var(--danger)' }}>Could not load deck cards. Make sure the backend is running.</div>
            ) : deckData.cards.length === 0 ? (
              <div className="dv-empty-detail">No cards assigned to this deck yet.</div>
            ) : (
              <div className={viewMode === 'grid' ? 'dv-grid-view' : 'dv-list-view'}>
                {groups.map(({ label, cards }) =>
                  label === null ? (
                    viewMode === 'grid' ? (
                      <div key="all" className="card-grid dv-card-grid">
                        {cards.map(card => <DeckCardTile key={card.ids[0]} card={card} />)}
                      </div>
                    ) : (
                      <ul key="all" className="dv-list-cards">
                        {cards.map(card => <DeckListRow key={card.ids[0]} card={card} />)}
                      </ul>
                    )
                  ) : (
                    <CollapsibleGroup key={label} label={label} cards={cards} groupBy={groupBy} viewMode={viewMode} />
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        /* ── View toggle ─────────────────────────────────── */
        .dv-view-toggle {
          display: flex; align-items: center; gap: 5px; margin-left: auto; flex-shrink: 0;
        }
        .dv-toggle-btn {
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          font-size: 11px; font-family: var(--font-body); padding: 4px 10px;
          border-radius: 20px; cursor: pointer; transition: all 0.15s; white-space: nowrap;
        }
        .dv-toggle-btn:hover { color: var(--text); border-color: var(--accent); }
        .dv-toggle-btn.active {
          background: rgba(123,79,200,0.2); border-color: var(--accent); color: var(--accent);
        }
        .dv-group-select {
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          font-size: 11px; font-family: var(--font-body); padding: 4px 8px;
          border-radius: 20px; cursor: pointer; outline: none;
        }
        .dv-group-select:focus { border-color: var(--accent); }
        .dv-toggle-divider {
          width: 1px; height: 16px; background: var(--border); margin: 0 3px; flex-shrink: 0;
        }

        /* ── Grid view groups ────────────────────────────── */
        .dv-grid-view { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
        .dv-grid-group-label {
          display: flex; align-items: center; gap: 8px;
          font-family: var(--font-display); font-size: 13px; color: var(--text-dim);
          text-transform: uppercase; letter-spacing: 0.06em;
          padding: 10px 4px 4px; border-bottom: 1px solid var(--border); margin-bottom: 4px;
        }

        /* ── List view ───────────────────────────────────── */
        .dv-list-view {
          display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
        }
        .dv-list-group { display: flex; flex-direction: column; }
        .dv-group-header {
          display: flex; align-items: center; gap: 7px;
          padding: 6px 10px; cursor: pointer; user-select: none;
          border-bottom: 1px solid var(--border); margin-bottom: 2px;
        }
        .dv-group-header:hover { background: var(--bg3); border-radius: 6px; }
        .dv-group-chevron { font-size: 11px; color: var(--text-dim); width: 10px; }
        .dv-group-icon { font-size: 13px; font-weight: 700; width: 16px; text-align: center; }
        .dv-group-label {
          font-family: var(--font-display); font-size: 13px; font-weight: 600;
          color: var(--text); letter-spacing: 0.05em; text-transform: uppercase; flex: 1;
        }
        .dv-group-count {
          font-size: 11px; color: var(--text-dim);
          background: var(--bg3); border: 1px solid var(--border);
          padding: 1px 7px; border-radius: 10px;
        }
        .dv-list-cards {
          list-style: none; margin: 0; padding: 0 0 4px 0;
          display: flex; flex-direction: column; gap: 1px;
        }

        /* ── List row ────────────────────────────────────── */
        .dv-list-row {
          position: relative; display: flex; align-items: center; gap: 8px;
          padding: 5px 10px; border-radius: 5px; cursor: default;
          transition: background 0.1s;
        }
        .dv-list-row:hover { background: var(--bg3); }
        .dv-list-row--foil { background: linear-gradient(90deg, rgba(180,140,255,0.04), transparent); }
        .dv-list-pips {
          display: flex; align-items: center; gap: 2px; flex-shrink: 0; width: 48px;
        }
        .dv-list-colorless { font-size: 11px; color: var(--text-dim); }
        .dv-list-name {
          font-size: 13px; color: var(--text); flex: 1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .dv-list-name--clickable { cursor: pointer; }
        .dv-list-name--clickable:hover { color: var(--gold); text-decoration: underline; }
        .dv-list-expanded-img {
          position: absolute; left: 0; top: calc(100% + 4px); z-index: 200;
          width: 220px; border-radius: 10px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7); border: 1px solid var(--border);
          cursor: pointer;
        }
        .dv-list-expanded-img img { width: 100%; display: block; }
        .dv-list-right {
          display: flex; align-items: center; gap: 5px; flex-shrink: 0;
        }
        .dv-list-foil { font-size: 10px; color: var(--foil-a); }
        .dv-list-qty {
          font-size: 10px; color: var(--gold);
          background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25);
          padding: 0 5px; border-radius: 8px;
        }
        .dv-list-violation { font-size: 10px; color: var(--danger); }

        /* ── Hover image preview ─────────────────────────── */
        .dv-list-hover-img {
          display: none; position: absolute; left: calc(100% + 10px); top: 50%;
          transform: translateY(-50%); z-index: 200; pointer-events: none;
          width: 180px; border-radius: 8px; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.7); border: 1px solid var(--border);
        }
        .dv-list-hover-img img { width: 100%; display: block; }
        .dv-list-row:hover .dv-list-hover-img { display: block; }
      `}</style>
    </div>
  );
}
