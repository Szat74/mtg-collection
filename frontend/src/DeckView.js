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

export default function DeckView({ decks, refresh, showToast }) {
  const [selectedId, setSelectedId]   = useState(null);
  const [deckData, setDeckData]       = useState(null);   // { summary, cards }
  const [loading, setLoading]         = useState(false);
  const [cmdImages, setCmdImages]     = useState({});     // collectionId → image_uri

  const selectedDeck = decks.find(d => d.id === selectedId) ?? null;

  // Load cards+violations when deck changes
  useEffect(() => {
    if (!selectedId) { setDeckData(null); return; }
    setLoading(true);
    fetch(`${API}/decks/${selectedId}/cards`)
      .then(r => r.json())
      .then(data => { setDeckData(data); setLoading(false); })
      .catch(() => { setDeckData(null); setLoading(false); });
  }, [selectedId, decks]); // re-load when decks list changes (e.g. after commander set)

  // Fetch commander/partner thumbnails
  useEffect(() => {
    if (!selectedDeck) return;
    const ids = [selectedDeck.commander_id, selectedDeck.partner_id].filter(Boolean);
    for (const id of ids) {
      if (cmdImages[id]) continue;
      fetch(`${API}/cards`)
        .then(() => {}) // no-op; we'll get image from deckData cards
        .catch(() => {});
    }
  }, [selectedDeck]);

  // Extract commander/partner images from deckData cards
  const cmdImage     = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.commander_id))?.image_uri ?? null;
  const partnerImage = deckData?.cards?.find(c => c.ids.includes(selectedDeck?.partner_id))?.image_uri ?? null;

  const sizeLimit  = selectedDeck ? (SIZE_LIMITS[selectedDeck.format] ?? null) : null;
  const totalCards = deckData?.summary?.total ?? 0;

  const sizeColor = sizeLimit
    ? (totalCards === sizeLimit ? 'var(--success)' : totalCards > sizeLimit ? 'var(--danger)' : 'var(--text-dim)')
    : 'var(--text-dim)';

  return (
    <div className="dv-root">
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
                {deck.format && (
                  <span className="dv-deck-item-format">🔒 {deck.format}</span>
                )}
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
            {/* Deck header */}
            <div className="dv-detail-header">
              <div className="dv-detail-title-row">
                <h2 className="dv-detail-name">{selectedDeck.name}</h2>
                {selectedDeck.format && (
                  <span className="dv-detail-format">🔒 {selectedDeck.format}</span>
                )}
                <ColorPips colors={selectedDeck.colors} />
                <span className="dv-detail-count" style={{ color: sizeColor }}>
                  {totalCards}{sizeLimit ? ` / ${sizeLimit}` : ' cards'}
                  {sizeLimit && totalCards !== sizeLimit && (
                    <span style={{ fontSize: 10, marginLeft: 4 }}>
                      ({totalCards < sizeLimit ? `${sizeLimit - totalCards} short` : `${totalCards - sizeLimit} over`})
                    </span>
                  )}
                </span>
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

            {/* Card grid */}
            {loading ? (
              <div className="dv-loading">Loading cards…</div>
            ) : !deckData ? (
              <div className="dv-loading" style={{ color: 'var(--danger)' }}>Could not load deck cards. Make sure the backend is running.</div>
            ) : deckData.cards.length === 0 ? (
              <div className="dv-empty-detail">No cards assigned to this deck yet.</div>
            ) : (
              <div className="card-grid dv-card-grid">
                {deckData.cards.map(card => (
                  <DeckCardTile key={card.ids[0]} card={card} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
