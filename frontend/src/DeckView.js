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
    // Proxies always sort after owned cards within a group
    if (!!a.is_proxy !== !!b.is_proxy) return a.is_proxy ? 1 : -1;
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

function DeckCardTile({ card, onRemove, onProxyInc, onProxyDec }) {
  const [flipped, setFlipped] = useState(false);
  const isFoil   = !!card.foil;
  const isEtched = !!card.etched;
  const hasBack  = !!card.image_back;
  const imgSrc   = flipped && hasBack ? card.image_back : (card.image_uri ?? card.image_back ?? null);
  const rawPrice = isEtched
    ? (card.prices_usd_etched ?? card.prices_usd_foil ?? card.prices_usd)
    : isFoil
      ? (card.prices_usd_foil ?? card.prices_usd_etched ?? card.prices_usd)
      : (card.prices_usd ?? card.prices_usd_foil ?? card.prices_usd_etched);
  const price = rawPrice != null ? `$${parseFloat(rawPrice).toFixed(2)}` : null;
  const hasViolations = card.violations?.length > 0;

  return (
    <div className={`card-tile dv-card-tile ${isEtched ? 'etched' : isFoil ? 'foil' : ''} ${hasViolations ? 'has-violation' : ''} ${card.is_proxy ? 'dv-proxy-tile' : ''}`}>
      {card.is_proxy && <div className="dv-proxy-banner">PROXY</div>}
      <div className="dv-violation-badges">
        {hasViolations && card.violations.map((v, i) => (
          <span key={i} className="dv-violation-badge" title={v.message}>
            {VIOLATION_LABELS[v.type] ?? v.type}
          </span>
        ))}
        {hasBack && <span className="flip-hint" title="Click to flip">↻</span>}
      </div>
      {onRemove && (
        <button className="dv-tile-remove" onClick={e => { e.stopPropagation(); onRemove(card); }} title={card.is_proxy ? 'Remove proxy' : 'Remove from deck'}>✕</button>
      )}
      <div className="card-img-wrap" onClick={() => hasBack && setFlipped(f => !f)}>
        {imgSrc
          ? <img src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-no-img">{card.name}</div>
        }
        {isEtched ? <span className="foil-badge etched-badge">⬡ Etched</span> : isFoil && <span className="foil-badge">✦ Foil</span>}
        {price && <span className="price-overlay">{price}</span>}
        {card.quantity > 1 && !card.is_proxy && <span className="dv-qty-badge">×{card.quantity}</span>}
      </div>
      <div className="card-info">
        <div className="card-name">{card.name}</div>
        <div className="card-meta">
          <span className="rarity-dot" style={{ background: RARITY_COLOR[card.rarity] || '#888' }} />
          <span>{card.set_code?.toUpperCase()}{card.collector_number ? ` #${card.collector_number}` : ''}</span>
        </div>
        <div className="card-sub" style={{ fontSize: 10 }}>{card.type_line}</div>
        {card.is_proxy && (
          <div className="dv-proxy-qty-row">
            <button className="dv-proxy-qty-btn" onClick={() => onProxyDec(card)}>−</button>
            <span className="dv-proxy-qty-count">×{card.quantity}</span>
            <button className="dv-proxy-qty-btn" onClick={() => onProxyInc(card)}>+</button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeckListRow({ card, onRemove, onProxyInc, onProxyDec }) {
  const [expanded, setExpanded] = useState(false);
  const [flipped, setFlipped]   = useState(false);
  const [expandUp, setExpandUp] = useState(false);
  const rowRef = useRef(null);
  const isFoil        = !!card.foil;
  const isEtched      = !!card.etched;
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
      setExpandUp(rect.bottom + 340 > window.innerHeight);
    }
    setExpanded(e => !e);
  }

  return (
    <li ref={rowRef} className={`dv-list-row ${isEtched ? 'dv-list-row--etched' : isFoil ? 'dv-list-row--foil' : ''} ${card.is_proxy ? 'dv-list-row--proxy' : ''}`} onMouseLeave={() => setExpanded(false)}>
      {imgSrc && !expanded && (
        <div className="dv-list-hover-img">
          <img src={imgSrc} alt={card.name} />
        </div>
      )}

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

      <span
        className={`dv-list-name ${imgSrc ? 'dv-list-name--clickable' : ''}`}
        onClick={handleNameClick}
      >
        {card.name}
      </span>

      <span className="dv-list-right">
        {card.is_proxy && <span className="dv-list-proxy-badge">PROXY</span>}
        {isEtched ? <span className="dv-list-foil dv-list-etched">⬡</span> : isFoil && <span className="dv-list-foil">✦</span>}
        {card.is_proxy ? (
          <>
            <button className="dv-proxy-qty-btn dv-proxy-qty-btn--sm" onClick={() => onProxyDec(card)}>−</button>
            <span className="dv-list-qty">×{card.quantity}</span>
            <button className="dv-proxy-qty-btn dv-proxy-qty-btn--sm" onClick={() => onProxyInc(card)}>+</button>
          </>
        ) : (
          card.quantity > 1 && <span className="dv-list-qty">×{card.quantity}</span>
        )}
        {hasViolations && (
          <span className="dv-list-violation" title={card.violations.map(v => v.message).join('; ')}>⚠</span>
        )}
        {onRemove && (
          <button className="dv-list-remove" onClick={() => onRemove(card)} title={card.is_proxy ? 'Remove proxy' : 'Remove from deck'}>✕</button>
        )}
      </span>

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

function CollapsibleGroup({ label, cards, flipCards = [], groupBy, viewMode, onRemove, onProxyInc, onProxyDec }) {
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
          {cards.map(card => <DeckCardTile key={card.is_proxy ? `proxy-${card.ids[0]}` : card.ids[0]} card={card} onRemove={onRemove} onProxyInc={onProxyInc} onProxyDec={onProxyDec} />)}
          {flipCards.map(card => <DeckCardTile key={`flip-${card.ids[0]}`} card={card} onRemove={onRemove} onProxyInc={onProxyInc} onProxyDec={onProxyDec} />)}
        </div>
      ) : (
        <ul className="dv-list-cards">
          {cards.map(card => <DeckListRow key={card.is_proxy ? `proxy-${card.ids[0]}` : card.ids[0]} card={card} onRemove={onRemove} onProxyInc={onProxyInc} onProxyDec={onProxyDec} />)}
          {flipCards.length > 0 && (
            <li className="dv-flip-divider">↻ also plays as {label.toLowerCase()}</li>
          )}
          {flipCards.map(card => <DeckListRow key={`flip-${card.ids[0]}`} card={card} onRemove={onRemove} onProxyInc={onProxyInc} onProxyDec={onProxyDec} />)}
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
            <li key={card.is_proxy ? `proxy-${card.ids[0]}` : card.ids[0]}>
              <strong>{card.name}</strong>{card.is_proxy ? ' (proxy)' : ''}:{' '}
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

  // addMode: null | 'collect' | 'collection' | 'proxy'
  const [addMode, setAddMode]           = useState(null);

  // Shared Scryfall search state (used by 'collect' and 'proxy' modes)
  const [addQuery, setAddQuery]         = useState('');
  const [addResults, setAddResults]     = useState([]);
  const [addPrintings, setAddPrintings] = useState([]);
  const [addSelected, setAddSelected]   = useState(null);
  const [addFinish, setAddFinish]       = useState('normal'); // 'normal' | 'foil' | 'etched'
  const [addLoading, setAddLoading]     = useState(false);
  const [proxyQty, setProxyQty]         = useState(1);
  const addDebounce = useRef(null);

  // Collection search state (used by 'collection' mode)
  const [collSearch, setCollSearch]   = useState('');
  const [collResults, setCollResults] = useState([]);
  const [collLoading, setCollLoading] = useState(false);
  const collDebounce = useRef(null);

  const selectedDeck = decks.find(d => d.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) { setDeckData(null); return; }
    setLoading(true);
    fetch(`${API}/decks/${selectedId}/cards`)
      .then(r => r.json())
      .then(data => { setDeckData(data); setLoading(false); })
      .catch(() => { setDeckData(null); setLoading(false); });
  }, [selectedId, decks]);

  const cmdImage     = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.commander_id))?.image_uri ?? null;
  const partnerImage = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.partner_id))?.image_uri ?? null;

  const sizeLimit  = selectedDeck ? (SIZE_LIMITS[selectedDeck.format] ?? null) : null;
  const totalCards = deckData?.summary?.total ?? 0;
  const proxyCount = deckData?.summary?.proxies ?? 0;

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

  // ── Panel helpers ───────────────────────────────────────────────────────────
  const resetAddPanel = () => {
    setAddQuery(''); setAddResults([]); setAddPrintings([]); setAddSelected(null);
    setAddFinish('normal'); setProxyQty(1);
    setCollSearch(''); setCollResults([]);
  };

  const toggleMode = (mode) => {
    setAddMode(m => {
      resetAddPanel();
      return m === mode ? null : mode;
    });
  };

  // ── Scryfall search (shared by 'collect' + 'proxy') ─────────────────────────
  const parseSetNum = (q) => {
    const m = q.trim().match(/^([a-zA-Z0-9]{2,6})\s+#?(\d+[a-zA-Z]?)$/);
    return m ? { set: m[1], num: m[2] } : null;
  };

  const selectAddCard = (card) => {
    setAddSelected(card);
    const finishes = card.finishes || [];
    if (finishes.length && finishes.every(f => f === 'etched')) {
      setAddFinish('etched');
    } else if (!card.prices?.usd && card.prices?.usd_etched && !card.prices?.usd_foil) {
      setAddFinish('etched');
    } else if (!card.prices?.usd && card.prices?.usd_foil) {
      setAddFinish('foil');
    } else {
      setAddFinish('normal');
    }
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

  // ── Mode: Add & Collect ─────────────────────────────────────────────────────
  const handleAddCard = async () => {
    if (!addSelected || !selectedId) return;
    setAddLoading(true);
    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card: addSelected, foil: addFinish === 'foil', etched: addFinish === 'etched', deck_id: selectedId }),
    });
    if (res.ok) {
      showToast(`Added ${addSelected.name}`);
      reloadDeck();
      refresh();
      setAddQuery(''); setAddResults([]); setAddPrintings([]); setAddSelected(null); setAddFinish('normal');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to add card', 'error');
    }
    setAddLoading(false);
  };

  // ── Mode: Add Proxy ─────────────────────────────────────────────────────────
  const handleAddProxy = async () => {
    if (!addSelected || !selectedId) return;
    setAddLoading(true);
    const res = await fetch(`${API}/decks/${selectedId}/proxies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card: addSelected, foil: addFinish === 'foil', etched: addFinish === 'etched', quantity: proxyQty }),
    });
    if (res.ok) {
      showToast(`Added ${proxyQty > 1 ? `${proxyQty}× ` : ''}${addSelected.name} (proxy)`);
      reloadDeck();
      setAddQuery(''); setAddResults([]); setAddPrintings([]); setAddSelected(null); setAddFinish('normal'); setProxyQty(1);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to add proxy', 'error');
    }
    setAddLoading(false);
  };

  // ── Mode: From Collection ───────────────────────────────────────────────────
  const handleCollSearch = (v) => {
    setCollSearch(v);
    setCollResults([]);
    clearTimeout(collDebounce.current);
    if (v.length < 2) return;
    collDebounce.current = setTimeout(async () => {
      setCollLoading(true);
      try {
        const res = await fetch(`${API}/cards?search=${encodeURIComponent(v)}&unassigned=true`);
        let data = await res.json();
        // Filter by commander color identity if applicable
        if (selectedDeck?.format === 'commander' && selectedDeck.colors?.length) {
          data = data.filter(card => {
            const ci = card.color_identity ? JSON.parse(card.color_identity) : [];
            return ci.every(c => selectedDeck.colors.includes(c));
          });
        }
        // Filter out pauper non-commons (grey out instead — show but mark)
        setCollResults(data);
      } catch {}
      setCollLoading(false);
    }, 300);
  };

  const handleCollAssign = async (card) => {
    const unassignedCopy = card.copies?.find(c => !c.deck_id);
    if (!unassignedCopy) return;
    const res = await fetch(`${API}/cards/${unassignedCopy.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: selectedId }),
    });
    if (res.ok) {
      showToast(`Added ${card.name} from collection`);
      reloadDeck();
      refresh();
      // Remove from results so user can see remaining unassigned cards
      setCollResults(prev => {
        const updated = prev.map(c => {
          if (c.name !== card.name || c.set_code !== card.set_code) return c;
          const newCopies = c.copies.map((cp, i) =>
            i === c.copies.findIndex(x => !x.deck_id) ? { ...cp, deck_id: selectedId } : cp
          );
          const remaining = newCopies.filter(cp => !cp.deck_id).length;
          return remaining > 0 ? { ...c, copies: newCopies, quantity: remaining } : null;
        }).filter(Boolean);
        return updated;
      });
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to assign card', 'error');
    }
  };

  // ── Remove handlers ─────────────────────────────────────────────────────────
  const handleRemove = useCallback(async (card) => {
    if (card.is_proxy) {
      const res = await fetch(`${API}/decks/${selectedId}/proxies/${card.ids[0]}`, { method: 'DELETE' });
      if (res.ok) { showToast(`Removed ${card.name} proxy`); reloadDeck(); }
      else showToast('Failed to remove proxy', 'error');
    } else {
      const res = await fetch(`${API}/cards/${card.ids[0]}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_id: null }),
      });
      if (res.ok) { showToast(`Removed ${card.name} from deck`); reloadDeck(); refresh(); }
      else showToast('Failed to remove card', 'error');
    }
  }, [selectedId, reloadDeck, refresh, showToast]);

  const handleProxyInc = useCallback(async (card) => {
    const res = await fetch(`${API}/decks/${selectedId}/proxies/${card.ids[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: card.quantity + 1 }),
    });
    if (res.ok) reloadDeck();
    else showToast('Failed to update proxy', 'error');
  }, [selectedId, reloadDeck, showToast]);

  const handleProxyDec = useCallback(async (card) => {
    if (card.quantity <= 1) return handleRemove(card);
    const res = await fetch(`${API}/decks/${selectedId}/proxies/${card.ids[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: card.quantity - 1 }),
    });
    if (res.ok) reloadDeck();
    else showToast('Failed to update proxy', 'error');
  }, [selectedId, reloadDeck, showToast, handleRemove]);

  // ── Export ──────────────────────────────────────────────────────────────────
  function exportDeck() {
    if (!deckData?.cards?.length || !selectedDeck) return;
    const lines = [];
    const commanderIds = [selectedDeck.commander_id, selectedDeck.partner_id].filter(Boolean);
    const commanders = deckData.cards.filter(c => !c.is_proxy && c.ids.some(id => commanderIds.includes(id)));
    const mainboard  = deckData.cards.filter(c => !c.is_proxy && !c.ids.some(id => commanderIds.includes(id)));
    const proxyCards = deckData.cards.filter(c => c.is_proxy);
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
    if (proxyCards.length) {
      lines.push('');
      lines.push('// Proxies');
      proxyCards.forEach(c => lines.push(fmt(c)));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${selectedDeck.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Scryfall search panel (shared JSX for 'collect' and 'proxy') ─────────────
  const scryfallPanel = (onConfirm, confirmLabel) => (
    <>
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
      {addResults.length > 0 && (
        <ul className="dv-add-results">
          {addResults.map(c => (
            <li key={c.id} className="dv-add-result" onClick={() => selectAddName(c)}>
              {c.name}
            </li>
          ))}
        </ul>
      )}
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
            <div className="dv-finish-toggle">
              <button type="button" className={`dv-finish-btn${addFinish === 'normal' ? ' dv-finish-btn--active' : ''}`} onClick={() => setAddFinish('normal')}>Normal</button>
              <button type="button" className={`dv-finish-btn${addFinish === 'foil' ? ' dv-finish-btn--active' : ''}`} onClick={() => setAddFinish('foil')}>✦ Foil</button>
              {!!(addSelected?.prices?.usd_etched || addSelected?.etched_only) && (
                <button type="button" className={`dv-finish-btn${addFinish === 'etched' ? ' dv-finish-btn--active dv-finish-btn--etched' : ''}`} onClick={() => setAddFinish('etched')}>⬡ Etched</button>
              )}
            </div>
            {addMode === 'proxy' && (
              <label className="dv-add-foil-label">
                Qty:
                <input
                  type="number" min="1" max="99"
                  className="dv-proxy-qty-input"
                  value={proxyQty}
                  onChange={e => setProxyQty(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </label>
            )}
            <button className="dv-add-confirm-btn" onClick={onConfirm} disabled={addLoading}>
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );

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
                  {proxyCount > 0 && (
                    <span className="dv-proxy-count-hint">
                      {proxyCount} prox{proxyCount === 1 ? 'y' : 'ies'}
                    </span>
                  )}
                  {sizeLimit && totalCards !== sizeLimit && (
                    <span style={{ fontSize: 10, marginLeft: 4 }}>
                      ({totalCards < sizeLimit ? `${sizeLimit - totalCards} short` : `${totalCards - sizeLimit} over`})
                    </span>
                  )}
                </span>

                {/* Add buttons — always visible when a deck is selected */}
                <div className="dv-view-toggle">
                  <button
                    className={`dv-toggle-btn${addMode === 'collection' ? ' active' : ''}`}
                    onClick={() => toggleMode('collection')}
                    title="Assign a card from your collection to this deck"
                  >+ From Collection</button>
                  <button
                    className={`dv-toggle-btn${addMode === 'collect' ? ' active' : ''}`}
                    onClick={() => toggleMode('collect')}
                    title="Add a new card to your collection and this deck"
                  >+ Add &amp; Collect</button>
                  <button
                    className={`dv-toggle-btn dv-proxy-add-btn${addMode === 'proxy' ? ' active' : ''}`}
                    onClick={() => toggleMode('proxy')}
                    title="Add a proxy card (not added to collection)"
                  >+ Add Proxy</button>

                  {/* View / sort controls — only when there are cards */}
                  {deckData?.cards?.length > 0 && (<>
                    <span className="dv-toggle-divider" />
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
                  </>)}
                </div>
              </div>

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

            {deckData && <ViolationsBanner summary={deckData.summary} cards={deckData.cards ?? []} />}

            {/* ── Add panels ── */}
            {addMode === 'collection' && (
              <div className="dv-add-panel">
                <div className="dv-add-panel-label">From Collection — assign an unassigned card to this deck</div>
                <div className="dv-add-search-row">
                  <input
                    className="dv-add-input"
                    placeholder="Search your collection…"
                    value={collSearch}
                    onChange={e => handleCollSearch(e.target.value)}
                    autoFocus
                  />
                  {collLoading && <span className="dv-add-spinner">…</span>}
                </div>
                {collResults.length > 0 && (
                  <ul className="dv-add-results dv-coll-results">
                    {collResults.map(card => {
                      const unassigned = card.copies?.filter(c => !c.deck_id).length ?? 0;
                      const isPauperIllegal = selectedDeck?.format === 'pauper' && card.rarity && card.rarity !== 'common';
                      return (
                        <li
                          key={card.ids[0]}
                          className={`dv-add-result dv-coll-result${isPauperIllegal ? ' dv-coll-result--warn' : ''}`}
                          onClick={() => handleCollAssign(card)}
                        >
                          <span className="dv-coll-name">{card.name}</span>
                          <span className="dv-coll-meta">
                            {card.set_code?.toUpperCase()}{card.collector_number ? ` #${card.collector_number}` : ''}
                            {card.foil ? ' ✦' : ''}
                          </span>
                          <span className="dv-coll-avail">{unassigned} available</span>
                          {isPauperIllegal && <span className="dv-coll-warn" title={`Not a common (${card.rarity})`}>⚠ {card.rarity}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {collSearch.length >= 2 && !collLoading && collResults.length === 0 && (
                  <div className="dv-add-empty">No unassigned cards match{selectedDeck?.format === 'commander' ? ' (color identity filtered)' : ''}.</div>
                )}
              </div>
            )}

            {addMode === 'collect' && (
              <div className="dv-add-panel">
                <div className="dv-add-panel-label">Add &amp; Collect — add card to collection and assign to deck</div>
                {scryfallPanel(handleAddCard, 'Add to deck')}
              </div>
            )}

            {addMode === 'proxy' && (
              <div className="dv-add-panel dv-proxy-panel">
                <div className="dv-add-panel-label dv-proxy-panel-label">Add Proxy — not added to your collection</div>
                {scryfallPanel(handleAddProxy, 'Add proxy')}
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
                <button className="dv-add-inline-btn" onClick={() => toggleMode('collect')}>+ Add a card</button>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'dv-grid-view' : 'dv-list-view'}>
                {groups.map(({ label, cards, flipCards }) =>
                  label === null ? (
                    viewMode === 'grid' ? (
                      <div key="all" className="card-grid dv-card-grid">
                        {cards.map(card => <DeckCardTile key={card.is_proxy ? `proxy-${card.ids[0]}` : card.ids[0]} card={card} onRemove={handleRemove} onProxyInc={handleProxyInc} onProxyDec={handleProxyDec} />)}
                      </div>
                    ) : (
                      <ul key="all" className="dv-list-cards">
                        {cards.map(card => <DeckListRow key={card.is_proxy ? `proxy-${card.ids[0]}` : card.ids[0]} card={card} onRemove={handleRemove} onProxyInc={handleProxyInc} onProxyDec={handleProxyDec} />)}
                      </ul>
                    )
                  ) : (
                    <CollapsibleGroup key={label} label={label} cards={cards} flipCards={flipCards} groupBy={groupBy} viewMode={viewMode} onRemove={handleRemove} onProxyInc={handleProxyInc} onProxyDec={handleProxyDec} />
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
          display: flex; align-items: center; gap: 5px; margin-left: auto; flex-shrink: 0; flex-wrap: wrap;
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
        .dv-proxy-add-btn { border-color: rgba(200,160,0,0.4); color: #c8a000; }
        .dv-proxy-add-btn:hover { border-color: #c8a000; color: #e0b800; }
        .dv-proxy-add-btn.active { background: rgba(200,160,0,0.15); border-color: #c8a000; color: #e0b800; }
        .dv-group-select {
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          font-size: 11px; font-family: var(--font-body); padding: 4px 8px;
          border-radius: 20px; cursor: pointer; outline: none;
        }
        .dv-group-select:focus { border-color: var(--accent); }
        .dv-toggle-divider {
          width: 1px; height: 16px; background: var(--border); margin: 0 3px; flex-shrink: 0;
        }

        /* ── Proxy count hint ────────────────────────────── */
        .dv-proxy-count-hint {
          font-size: 10px; margin-left: 6px; padding: 1px 6px;
          background: rgba(200,160,0,0.15); border: 1px solid rgba(200,160,0,0.4);
          color: #c8a000; border-radius: 8px;
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
        .dv-list-row--proxy {
          border-left: 2px dashed rgba(200,160,0,0.5);
          padding-left: 8px;
        }
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
        .dv-list-etched { color: #c8a000; }
        .dv-list-row--etched { background: linear-gradient(90deg, rgba(200,160,0,0.06), transparent); }
        .dv-finish-toggle { display: flex; gap: 5px; margin-bottom: 6px; }
        .dv-finish-btn {
          padding: 4px 10px; font-size: 12px; font-family: var(--font-body);
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          border-radius: var(--radius); cursor: pointer; transition: all 0.15s;
        }
        .dv-finish-btn:hover { border-color: var(--accent); color: var(--text); }
        .dv-finish-btn--active { background: rgba(123,79,200,0.18); border-color: var(--accent); color: var(--accent); font-weight: 600; }
        .dv-finish-btn--etched.dv-finish-btn--active { background: rgba(200,160,0,0.15); border-color: #c8a000; color: #c8a000; }
        .dv-list-qty {
          font-size: 10px; color: var(--gold);
          background: rgba(201,168,76,0.12); border: 1px solid rgba(201,168,76,0.25);
          padding: 0 5px; border-radius: 8px;
        }
        .dv-list-violation { font-size: 10px; color: var(--danger); }
        .dv-list-proxy-badge {
          font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
          background: rgba(200,160,0,0.18); border: 1px solid rgba(200,160,0,0.5);
          color: #c8a000; padding: 1px 5px; border-radius: 4px;
        }

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

        /* ── Proxy tile ──────────────────────────────────── */
        .dv-proxy-tile {
          border: 2px dashed rgba(200,160,0,0.6) !important;
          box-shadow: 0 0 0 1px rgba(200,160,0,0.15) !important;
        }
        .dv-proxy-banner {
          position: absolute; top: 8px; right: 8px; z-index: 12;
          background: rgba(0,0,0,0.75); color: #c8a000;
          font-size: 9px; font-weight: 800; letter-spacing: 0.1em;
          padding: 2px 6px; border-radius: 3px;
          border: 1px solid rgba(200,160,0,0.6);
          pointer-events: none;
        }
        .dv-proxy-qty-row {
          display: flex; align-items: center; gap: 6px; margin-top: 4px;
        }
        .dv-proxy-qty-count {
          font-size: 12px; color: var(--gold); min-width: 24px; text-align: center;
        }
        .dv-proxy-qty-btn {
          background: var(--bg3); border: 1px solid var(--border); color: var(--text);
          width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
          font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center;
          padding: 0;
        }
        .dv-proxy-qty-btn:hover { border-color: #c8a000; color: #c8a000; }
        .dv-proxy-qty-btn--sm { width: 16px; height: 16px; font-size: 11px; }

        /* ── Add-card panel ──────────────────────────────── */
        .dv-add-panel {
          border: 1px solid var(--border); border-radius: 8px;
          background: var(--bg2); padding: 12px; margin-bottom: 12px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .dv-proxy-panel { border-color: rgba(200,160,0,0.4); }
        .dv-add-panel-label {
          font-size: 11px; color: var(--text-dim); font-style: italic;
        }
        .dv-proxy-panel-label { color: #c8a000; }
        .dv-add-search-row { display: flex; align-items: center; gap: 8px; }
        .dv-add-input {
          flex: 1; background: var(--bg3); border: 1px solid var(--border);
          color: var(--text); font-size: 13px; font-family: var(--font-body);
          padding: 6px 10px; border-radius: 6px; outline: none;
        }
        .dv-add-input:focus { border-color: var(--accent); }
        .dv-add-spinner { color: var(--text-dim); font-size: 13px; }
        .dv-add-empty { font-size: 12px; color: var(--text-dim); padding: 4px 0; }
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
        .dv-coll-results { max-height: 260px; }
        .dv-coll-result {
          display: flex; align-items: center; gap: 10px; cursor: pointer;
        }
        .dv-coll-result--warn { opacity: 0.7; }
        .dv-coll-name { flex: 1; font-size: 13px; }
        .dv-coll-meta { font-size: 11px; color: var(--text-dim); }
        .dv-coll-avail {
          font-size: 11px; color: var(--success);
          background: rgba(0,180,80,0.08); border: 1px solid rgba(0,180,80,0.2);
          padding: 1px 6px; border-radius: 8px;
        }
        .dv-coll-warn { font-size: 10px; color: var(--danger); }
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
        .dv-proxy-qty-input {
          width: 48px; background: var(--bg3); border: 1px solid var(--border);
          color: var(--text); font-size: 13px; font-family: var(--font-body);
          padding: 2px 6px; border-radius: 4px; outline: none; text-align: center;
        }
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
