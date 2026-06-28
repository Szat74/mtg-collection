import React, { useState, useEffect, useRef, useCallback } from 'react';
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

const TYPE_KEYS = ['Planeswalker', 'Battle', 'Creature', 'Land', 'Artifact', 'Enchantment', 'Instant', 'Sorcery'];

// Returns [{type, primary}] — one entry per distinct type found across all faces.
// Face 0 is "primary"; additional faces are secondary (flip contributions).
function getTypeGroups(type_line) {
  if (!type_line) return [{ type: 'Other', primary: true }];
  const faces = type_line.split(' // ');
  const seen = new Set();
  const result = [];
  faces.forEach((face, i) => {
    for (const t of TYPE_KEYS) {
      if (face.includes(t) && !seen.has(t)) {
        seen.add(t);
        result.push({ type: t, primary: i === 0 });
      }
    }
  });
  return result.length ? result : [{ type: 'Other', primary: true }];
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
  if (groupBy === 'none') return [{ label: null, cards: sortCards(cards, sortBy), flipCards: [] }];
  const map = {};
  for (const card of cards) {
    if (groupBy === 'type') {
      const groups = getTypeGroups(card.type_line);
      // If all faces share the same type, it's a pure card in one group
      const allSame = groups.every(g => g.type === groups[0].type);
      groups.forEach(({ type, primary }) => {
        if (!map[type]) map[type] = { pure: [], flip: [] };
        if (primary || allSame) map[type].pure.push(card);
        else map[type].flip.push(card);
      });
    } else {
      const label = getColorGroup(card.color_identity);
      if (!map[label]) map[label] = { pure: [], flip: [] };
      map[label].pure.push(card);
    }
  }
  const order = groupBy === 'type' ? TYPE_ORDER : COLOR_ORDER;
  return order.filter(l => map[l]).map(l => ({
    label: l,
    cards:     sortCards(map[l].pure, sortBy),
    flipCards: sortCards(map[l].flip, sortBy),
  }));
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

function DeckCardTile({ card, onRemove }) {
  const [flipped, setFlipped] = useState(false);
  const isFoil  = !!card.foil;
  const hasBack = !!card.image_back;
  const imgSrc  = flipped && hasBack ? card.image_back : (card.image_uri ?? card.image_back ?? null);
  const rawPrice = isFoil
    ? (card.prices_usd_foil ?? card.prices_usd_etched ?? card.prices_usd)
    : (card.prices_usd ?? card.prices_usd_foil ?? card.prices_usd_etched);
  const price = rawPrice != null ? `$${parseFloat(rawPrice).toFixed(2)}` : null;
  const hasViolations = card.violations?.length > 0;

  return (
    <div className={`card-tile dv-card-tile ${isFoil ? 'foil' : ''} ${hasViolations ? 'has-violation' : ''}`}>
      <div className="dv-violation-badges">
        {hasViolations && card.violations.map((v, i) => (
          <span key={i} className="dv-violation-badge" title={v.message}>
            {VIOLATION_LABELS[v.type] ?? v.type}
          </span>
        ))}
        {hasBack && <span className="flip-hint" title="Click to flip">↻</span>}
      </div>
      {onRemove && (
        <button className="dv-tile-remove" onClick={e => { e.stopPropagation(); onRemove(card); }} title="Remove from deck">✕</button>
      )}
      <div className="card-img-wrap" onClick={() => hasBack && setFlipped(f => !f)}>
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

function DeckListRow({ card, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const [flipped, setFlipped]   = useState(false);
  const [expandUp, setExpandUp] = useState(false);
  const rowRef = useRef(null);
  const isFoil        = !!card.foil;
  const hasBack       = !!card.image_back;
  const imgSrc        = flipped && hasBack ? card.image_back : (card.image_uri ?? card.image_back ?? null);
  const hasViolations = card.violations?.length > 0;
  const ci = Array.isArray(card.color_identity)
    ? card.color_identity
    : (card.color_identity ? JSON.parse(card.color_identity) : []);

  function handleNameClick() {
    if (!imgSrc) return;
    if (!expanded && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      // card image ~320px tall + optional flip button
      setExpandUp(rect.bottom + 340 > window.innerHeight);
    }
    setExpanded(e => !e);
  }

  return (
    <li ref={rowRef} className={`dv-list-row ${isFoil ? 'dv-list-row--foil' : ''}`} onMouseLeave={() => setExpanded(false)}>
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
        onClick={handleNameClick}
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
        {onRemove && (
          <button className="dv-list-remove" onClick={() => onRemove(card)} title="Remove from deck">✕</button>
        )}
      </span>

      {/* Expanded image */}
      {expanded && imgSrc && (
        <div className={`dv-list-expanded-img${expandUp ? ' dv-list-expanded-img--up' : ''}`}>
          <img src={imgSrc} alt={card.name} onClick={() => setExpanded(false)} />
          {hasBack && (
            <button className="dv-list-flip-btn" onClick={() => setFlipped(f => !f)} title="Flip card">↻ Flip</button>
          )}
        </div>
      )}
    </li>
  );
}

function CollapsibleGroup({ label, cards, flipCards = [], groupBy, viewMode, onRemove }) {
  const [open, setOpen] = useState(true);
  const pureTotal = cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const flipTotal = flipCards.reduce((s, c) => s + (c.quantity || 1), 0);
  const countLabel = flipTotal > 0 ? `${pureTotal} (${pureTotal + flipTotal})` : `${pureTotal}`;

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
        <span className="dv-group-count">{countLabel}</span>
      </div>
      {open && (viewMode === 'grid' ? (
        <div className="card-grid dv-card-grid">
          {cards.map(card => <DeckCardTile key={card.ids[0]} card={card} onRemove={onRemove} />)}
          {flipCards.map(card => <DeckCardTile key={`flip-${card.ids[0]}`} card={card} onRemove={onRemove} />)}
        </div>
      ) : (
        <ul className="dv-list-cards">
          {cards.map(card => <DeckListRow key={card.ids[0]} card={card} onRemove={onRemove} />)}
          {flipCards.length > 0 && (
            <li className="dv-flip-divider">↻ also plays as {label.toLowerCase()}</li>
          )}
          {flipCards.map(card => <DeckListRow key={`flip-${card.ids[0]}`} card={card} onRemove={onRemove} />)}
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
  const [viewMode, setViewMode]     = useState('grid');
  const [groupBy, setGroupBy]       = useState('type');
  const [sortBy, setSortBy]         = useState('name');

  // Add-card panel
  const [showAdd, setShowAdd]           = useState(false);
  const [addQuery, setAddQuery]         = useState('');
  const [addResults, setAddResults]     = useState([]);
  const [addPrintings, setAddPrintings] = useState([]);
  const [addSelected, setAddSelected]   = useState(null);
  const [addFoil, setAddFoil]           = useState(false);
  const [addLoading, setAddLoading]     = useState(false);
  const addDebounce = useRef(null);

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

  const reloadDeck = useCallback(() => {
    if (!selectedId) return;
    fetch(`${API}/decks/${selectedId}/cards`)
      .then(r => r.json())
      .then(data => setDeckData(data))
      .catch(() => {});
  }, [selectedId]);

  // ── Add-panel search ────────────────────────────────────────────────────────
  const parseSetNum = (q) => {
    const m = q.trim().match(/^([a-zA-Z0-9]{2,6})\s+#?(\d+[a-zA-Z]?)$/);
    return m ? { set: m[1], num: m[2] } : null;
  };

  const selectAddCard = (card) => {
    setAddSelected(card);
    setAddFoil(!card.prices?.usd && !!(card.prices?.usd_foil || card.prices?.usd_etched));
  };

  const handleAddQuery = (v) => {
    setAddQuery(v);
    setAddSelected(null);
    setAddPrintings([]);
    setAddResults([]);
    clearTimeout(addDebounce.current);
    const parsed = parseSetNum(v);
    if (parsed) {
      addDebounce.current = setTimeout(async () => {
        setAddLoading(true);
        try {
          const res = await fetch(`${API}/scryfall/card/${encodeURIComponent(parsed.set)}/${encodeURIComponent(parsed.num)}`);
          if (res.ok) { const c = await res.json(); setAddPrintings([c]); selectAddCard(c); setAddQuery(c.name); }
          else showToast(`No card found for ${parsed.set.toUpperCase()} #${parsed.num}`, 'error');
        } catch { showToast('Lookup failed', 'error'); }
        setAddLoading(false);
      }, 400);
    } else if (v.length >= 2) {
      addDebounce.current = setTimeout(async () => {
        setAddLoading(true);
        try {
          const res = await fetch(`${API}/search?q=${encodeURIComponent(v)}`);
          const data = await res.json();
          setAddResults(data.data || []);
        } catch { setAddResults([]); }
        setAddLoading(false);
      }, 300);
    }
  };

  const selectAddName = async (card) => {
    setAddResults([]);
    setAddQuery(card.name);
    setAddLoading(true);
    try {
      const res = await fetch(`${API}/printings/${encodeURIComponent(card.name)}`);
      const data = await res.json();
      const prints = data.data || [];
      setAddPrintings(prints);
      if (prints.length > 0) selectAddCard(prints[0]);
    } catch { showToast('Could not load printings', 'error'); }
    setAddLoading(false);
  };

  const handleAddCard = async () => {
    if (!addSelected || !selectedId) return;
    setAddLoading(true);
    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card: addSelected, foil: addFoil, deck_id: selectedId }),
    });
    if (res.ok) {
      showToast(`Added ${addSelected.name}`);
      reloadDeck();
      refresh();
      setAddQuery(''); setAddResults([]); setAddPrintings([]); setAddSelected(null); setAddFoil(false);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to add card', 'error');
    }
    setAddLoading(false);
  };

  // ── Remove one copy from deck (unassign) ────────────────────────────────────
  const handleRemove = useCallback(async (card) => {
    const id = card.ids[0];
    const res = await fetch(`${API}/cards/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: null }),
    });
    if (res.ok) {
      showToast(`Removed ${card.name} from deck`);
      reloadDeck();
      refresh();
    } else {
      showToast('Failed to remove card', 'error');
    }
  }, [reloadDeck, refresh, showToast]);

  function exportDeck() {
    if (!deckData?.cards?.length || !selectedDeck) return;
    const lines = [];
    const commanderIds = [selectedDeck.commander_id, selectedDeck.partner_id].filter(Boolean);
    const commanders = deckData.cards.filter(c => c.ids.some(id => commanderIds.includes(id)));
    const mainboard  = deckData.cards.filter(c => !c.ids.some(id => commanderIds.includes(id)));
    const fmt = (c, qty = c.quantity) => {
      const set = c.set_code ? ` (${c.set_code.toUpperCase()})` : '';
      const num = c.collector_number ? ` ${c.collector_number}` : '';
      return `${qty} ${c.name}${set}${num}`;
    };
    if (commanders.length) {
      lines.push('// Commander');
      commanders.forEach(c => lines.push(fmt(c, 1)));
      lines.push('');
      lines.push('// Deck');
    }
    mainboard.forEach(c => lines.push(fmt(c)));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${selectedDeck.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
                    <button className="dv-toggle-btn" onClick={exportDeck} title="Export decklist as text">⬇ Export</button>
                    <span className="dv-toggle-divider" />
                    <button
                      className={`dv-toggle-btn${showAdd ? ' active' : ''}`}
                      onClick={() => { setShowAdd(s => !s); setAddQuery(''); setAddResults([]); setAddPrintings([]); setAddSelected(null); }}
                      title="Add card to deck"
                    >+ Add</button>
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

            {/* Add-card panel */}
            {showAdd && (
              <div className="dv-add-panel">
                <div className="dv-add-search-row">
                  <input
                    className="dv-add-input"
                    placeholder="Card name or SET #number…"
                    value={addQuery}
                    onChange={e => handleAddQuery(e.target.value)}
                    autoFocus
                  />
                  {addLoading && <span className="dv-add-spinner">…</span>}
                </div>

                {/* Name results dropdown */}
                {addResults.length > 0 && (
                  <ul className="dv-add-results">
                    {addResults.map(c => (
                      <li key={c.id} className="dv-add-result" onClick={() => selectAddName(c)}>
                        {c.name}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Printings picker */}
                {addPrintings.length > 0 && (
                  <div className="dv-add-printings">
                    {addPrintings.map(p => {
                      const label = `${(p.set_name || p.set || '').slice(0, 24)} #${p.collector_number}`;
                      return (
                        <button
                          key={p.id}
                          className={`dv-add-printing-btn${addSelected?.id === p.id ? ' active' : ''}`}
                          onClick={() => selectAddCard(p)}
                        >{label}</button>
                      );
                    })}
                  </div>
                )}

                {/* Preview + confirm row */}
                {addSelected && (
                  <div className="dv-add-confirm-row">
                    {(addSelected.image_uris?.normal ?? addSelected.card_faces?.[0]?.image_uris?.normal) && (
                      <img
                        className="dv-add-preview"
                        src={addSelected.image_uris?.normal ?? addSelected.card_faces?.[0]?.image_uris?.normal}
                        alt={addSelected.name}
                      />
                    )}
                    <div className="dv-add-confirm-actions">
                      <label className="dv-add-foil-label">
                        <input type="checkbox" checked={addFoil} onChange={e => setAddFoil(e.target.checked)} />
                        Foil
                      </label>
                      <button className="dv-add-confirm-btn" onClick={handleAddCard} disabled={addLoading}>
                        Add to deck
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Cards */}
            {loading ? (
              <div className="dv-loading">Loading cards…</div>
            ) : !deckData ? (
              <div className="dv-loading" style={{ color: 'var(--danger)' }}>Could not load deck cards. Make sure the backend is running.</div>
            ) : deckData.cards.length === 0 ? (
              <div className="dv-empty-detail">
                No cards yet.{' '}
                <button className="dv-add-inline-btn" onClick={() => setShowAdd(true)}>+ Add a card</button>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'dv-grid-view' : 'dv-list-view'}>
                {groups.map(({ label, cards, flipCards }) =>
                  label === null ? (
                    viewMode === 'grid' ? (
                      <div key="all" className="card-grid dv-card-grid">
                        {cards.map(card => <DeckCardTile key={card.ids[0]} card={card} onRemove={handleRemove} />)}
                      </div>
                    ) : (
                      <ul key="all" className="dv-list-cards">
                        {cards.map(card => <DeckListRow key={card.ids[0]} card={card} onRemove={handleRemove} />)}
                      </ul>
                    )
                  ) : (
                    <CollapsibleGroup key={label} label={label} cards={cards} flipCards={flipCards} groupBy={groupBy} viewMode={viewMode} onRemove={handleRemove} />
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
        }
        .dv-list-expanded-img--up { top: auto; bottom: calc(100% + 4px); }
        .dv-list-expanded-img img { width: 100%; display: block; cursor: pointer; }
        .dv-list-flip-btn {
          display: block; width: 100%; padding: 5px 0;
          background: var(--bg2); border: none; border-top: 1px solid var(--border);
          color: var(--text); font-size: 12px; cursor: pointer;
        }
        .dv-list-flip-btn:hover { background: var(--bg3); }
        .dv-list-right {
          display: flex; align-items: center; gap: 5px; flex-shrink: 0;
        }
        .dv-flip-divider {
          list-style: none; padding: 3px 10px; font-size: 10px;
          color: var(--text-dim); font-style: italic;
          border-top: 1px dashed var(--border); margin-top: 2px;
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

        /* ── Remove buttons ──────────────────────────────── */
        .dv-tile-remove {
          position: absolute; top: 5px; left: 5px; z-index: 10;
          background: rgba(0,0,0,0.65); color: #fff; border: none;
          width: 20px; height: 20px; border-radius: 50%; font-size: 10px;
          cursor: pointer; display: none; align-items: center; justify-content: center;
          line-height: 1;
        }
        .dv-card-tile:hover .dv-tile-remove { display: flex; }
        .dv-tile-remove:hover { background: var(--danger); }
        .dv-list-remove {
          background: none; border: none; color: var(--text-dim);
          font-size: 12px; cursor: pointer; padding: 0 2px; opacity: 0;
          transition: opacity 0.1s;
        }
        .dv-list-row:hover .dv-list-remove { opacity: 1; }
        .dv-list-remove:hover { color: var(--danger); }

        /* ── Add-card panel ──────────────────────────────── */
        .dv-add-panel {
          border: 1px solid var(--border); border-radius: 8px;
          background: var(--bg2); padding: 12px; margin-bottom: 12px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .dv-add-search-row { display: flex; align-items: center; gap: 8px; }
        .dv-add-input {
          flex: 1; background: var(--bg3); border: 1px solid var(--border);
          color: var(--text); font-size: 13px; font-family: var(--font-body);
          padding: 6px 10px; border-radius: 6px; outline: none;
        }
        .dv-add-input:focus { border-color: var(--accent); }
        .dv-add-spinner { color: var(--text-dim); font-size: 13px; }
        .dv-add-results {
          list-style: none; margin: 0; padding: 0;
          border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
          max-height: 200px; overflow-y: auto;
        }
        .dv-add-result {
          padding: 7px 12px; font-size: 13px; cursor: pointer;
          border-bottom: 1px solid var(--border);
        }
        .dv-add-result:last-child { border-bottom: none; }
        .dv-add-result:hover { background: var(--bg3); color: var(--gold); }
        .dv-add-printings {
          display: flex; flex-wrap: wrap; gap: 5px;
        }
        .dv-add-printing-btn {
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          font-size: 11px; font-family: var(--font-body); padding: 3px 8px;
          border-radius: 4px; cursor: pointer;
        }
        .dv-add-printing-btn:hover { border-color: var(--accent); color: var(--text); }
        .dv-add-printing-btn.active { border-color: var(--accent); color: var(--accent); background: rgba(123,79,200,0.12); }
        .dv-add-confirm-row { display: flex; align-items: flex-start; gap: 12px; }
        .dv-add-preview { width: 80px; border-radius: 5px; flex-shrink: 0; }
        .dv-add-confirm-actions { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
        .dv-add-foil-label { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text-dim); cursor: pointer; }
        .dv-add-confirm-btn {
          background: var(--accent); color: #fff; border: none;
          font-size: 13px; font-family: var(--font-body); padding: 6px 16px;
          border-radius: 6px; cursor: pointer;
        }
        .dv-add-confirm-btn:hover { opacity: 0.85; }
        .dv-add-confirm-btn:disabled { opacity: 0.5; cursor: default; }
        .dv-add-inline-btn {
          background: none; border: none; color: var(--accent);
          font-size: 13px; cursor: pointer; text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
