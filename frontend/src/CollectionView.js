import React, { useState, useEffect } from 'react';

const API = '/api';
const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e', special: '#c879ff' };

const COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

// ── Land section (compact list for basic lands) ───────────────────────────────
const LAND_ORDER = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest'];

function LandRow({ land, decks, onUpdate, onDelete }) {
  const [copies, setCopies] = useState(land.copies || []);

  useEffect(() => { setCopies(land.copies || []); }, [land]);

  const delAll = async () => {
    if (!window.confirm(`Remove all ${land.quantity} cop${land.quantity === 1 ? 'y' : 'ies'} of ${land.name} (${land.set_code?.toUpperCase()})?`)) return;
    await Promise.all(land.ids.map(id => fetch(`${API}/cards/${id}`, { method: 'DELETE' })));
    onDelete(land.ids);
  };

  // Assign one unassigned copy to a deck
  const increment = async (deckId) => {
    const copy = copies.find(c => !c.deck_id);
    if (!copy) return;
    const res = await fetch(`${API}/cards/${copy.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: deckId }),
    });
    const updated = await res.json();
    const next = copies.map(c => c.id === copy.id ? { ...c, deck_id: deckId } : c);
    setCopies(next);
    onUpdate([updated]);
  };

  // Return one copy from a deck back to unassigned
  const decrement = async (deckId) => {
    const copy = copies.find(c => c.deck_id === deckId);
    if (!copy) return;
    const res = await fetch(`${API}/cards/${copy.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: null }),
    });
    const updated = await res.json();
    const next = copies.map(c => c.id === copy.id ? { ...c, deck_id: null } : c);
    setCopies(next);
    onUpdate([updated]);
  };

  // Build per-deck counts
  const deckCountMap = {};
  let unassigned = 0;
  for (const copy of copies) {
    if (copy.deck_id) deckCountMap[copy.deck_id] = (deckCountMap[copy.deck_id] || 0) + 1;
    else unassigned++;
  }
  const assignedDecks = decks.filter(d => deckCountMap[d.id]);

  const isFoil = !!land.foil;
  const rawPrice = isFoil
    ? (land.prices_usd_foil ?? land.prices_usd_etched ?? land.prices_usd)
    : (land.prices_usd ?? land.prices_usd_foil ?? land.prices_usd_etched);
  const price = rawPrice != null ? `$${parseFloat(rawPrice).toFixed(2)}` : '—';

  return (
    <div className={`land-row${isFoil ? ' foil' : ''}`}>
      <div className="land-row-main">
        <div className="land-thumb-wrap">
          {land.image_uri
            ? <img className="land-thumb" src={land.image_uri} alt={land.name} loading="lazy" />
            : <div className="land-thumb land-thumb-empty" />
          }
          {isFoil && <span className="land-foil-badge">✦</span>}
        </div>
        <span className="land-set-badge">
          {land.set_code?.toUpperCase()}{land.collector_number ? ` #${land.collector_number}` : ''}
        </span>
        {isFoil && <span className="land-foil-label">Foil</span>}
        <span className="land-price">{price}</span>
        <span className="land-qty">×{land.quantity}</span>
        <button className="btn-sm btn-danger" onClick={delAll} title="Remove all copies">✕</button>
      </div>

      {/* Per-deck assignment rows */}
      <div className="land-deck-rows">
        {assignedDecks.map(deck => (
          <div key={deck.id} className="land-deck-row">
            <span className="land-deck-name">{deck.name}</span>
            <button
              className="btn-qty"
              onClick={() => decrement(deck.id)}
              disabled={!deckCountMap[deck.id]}
            >−</button>
            <span className="land-deck-count">{deckCountMap[deck.id] || 0}</span>
            <button
              className="btn-qty"
              onClick={() => increment(deck.id)}
              disabled={unassigned === 0}
              title={unassigned === 0 ? 'No unassigned copies' : undefined}
            >+</button>
          </div>
        ))}
        {/* Unassigned row — only shown if there are any, or if no decks assigned yet */}
        {(unassigned > 0 || assignedDecks.length === 0) && (
          <div className="land-deck-row land-deck-unassigned">
            <span className="land-deck-name">Unassigned</span>
            <span className="land-deck-count">{unassigned}</span>
            {decks.length > 0 && unassigned > 0 && (
              <select
                className="land-deck-assign-select"
                defaultValue=""
                onChange={e => { if (e.target.value) { increment(parseInt(e.target.value, 10)); e.target.value = ''; } }}
              >
                <option value="">+ assign to deck…</option>
                {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryTile({ land, decks, onUpdate }) {
  const [copies, setCopies] = useState(land.copies || []);
  const [editingDecks, setEditingDecks] = useState(false);
  useEffect(() => { setCopies(land.copies || []); }, [land]);

  const increment = async (deckId) => {
    const copy = copies.find(c => !c.deck_id);
    if (!copy) return;
    const res = await fetch(`${API}/cards/${copy.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: deckId }),
    });
    const updated = await res.json();
    setCopies(copies.map(c => c.id === copy.id ? { ...c, deck_id: deckId } : c));
    onUpdate([updated]);
  };

  const decrement = async (deckId) => {
    const copy = copies.find(c => c.deck_id === deckId);
    if (!copy) return;
    const res = await fetch(`${API}/cards/${copy.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck_id: null }),
    });
    const updated = await res.json();
    setCopies(copies.map(c => c.id === copy.id ? { ...c, deck_id: null } : c));
    onUpdate([updated]);
  };

  const deckCountMap = {};
  let unassigned = 0;
  for (const copy of copies) {
    if (copy.deck_id) deckCountMap[copy.deck_id] = (deckCountMap[copy.deck_id] || 0) + 1;
    else unassigned++;
  }
  const assignedDecks = decks.filter(d => deckCountMap[d.id]);

  const gFoil = !!land.foil;
  const gRawPrice = gFoil
    ? (land.prices_usd_foil ?? land.prices_usd_etched ?? land.prices_usd)
    : (land.prices_usd ?? land.prices_usd_foil ?? land.prices_usd_etched);
  const gPrice = gRawPrice != null ? `$${parseFloat(gRawPrice).toFixed(2)}` : '—';

  return (
    <div className={`land-gallery-tile${gFoil ? ' foil' : ''}${land.full_art ? ' full-art' : ''}`}>
      <div className="land-gallery-img-wrap">
        {land.image_uri
          ? <img src={land.image_uri} alt={land.name} loading="lazy" />
          : <div className="land-gallery-placeholder">{land.name}</div>
        }
        {gFoil && <span className="foil-badge">✦ Foil</span>}
        <span className="price-overlay">{gPrice}</span>
        {decks.length > 0 && (
          <button
            className={`land-gallery-edit-btn${editingDecks ? ' active' : ''}`}
            onClick={() => setEditingDecks(e => !e)}
          >
            {editingDecks ? 'Done' : 'Edit Decks'}
          </button>
        )}
      </div>
      <div className="land-gallery-info">
        <span className="land-set-badge">
          {land.set_code?.toUpperCase()}{land.collector_number ? ` #${land.collector_number}` : ''}
        </span>
        <span className="land-qty">×{land.quantity}</span>
      </div>
      {!editingDecks && (
        <div className="land-gallery-deck-summary">
          {assignedDecks.length > 0
            ? assignedDecks.map(d => (
                <span key={d.id} className="land-gallery-deck-chip">
                  {d.name} ×{deckCountMap[d.id]}
                </span>
              ))
            : unassigned > 0
              ? <span className="land-gallery-deck-chip unassigned">Unassigned</span>
              : null
          }
        </div>
      )}
      {editingDecks && (
        <div className="land-gallery-decks">
          {assignedDecks.map(deck => (
            <div key={deck.id} className="land-gallery-deck-row">
              <button className="btn-qty" onClick={() => decrement(deck.id)}>−</button>
              <span className="land-gallery-deck-name">{deck.name}</span>
              <span className="land-gallery-deck-count">{deckCountMap[deck.id]}</span>
              <button className="btn-qty" onClick={() => increment(deck.id)} disabled={unassigned === 0}>+</button>
            </div>
          ))}
          {unassigned > 0 && (
            <select
              className="land-deck-assign-select"
              defaultValue=""
              onChange={e => { if (e.target.value) { increment(parseInt(e.target.value, 10)); e.target.value = ''; } }}
            >
              <option value="">+ assign… ({unassigned} free)</option>
              {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}

function LandNameGroup({ groupKey, displayName, regular, fullArt, decks, onUpdate, onDelete }) {
  const [collapsed, setCollapsed] = useState(true);
  const [galleryMode, setGalleryMode] = useState(true);

  // Full-arts first in gallery, then regular
  const galleryLands = [...fullArt, ...regular];
  const total = galleryLands.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="land-name-group">
      <div className="land-name-heading" onClick={() => setCollapsed(c => !c)}>
        <span className="land-name-toggle">{collapsed ? '▸' : '▾'}</span>
        <span className="land-name-label">{displayName}</span>
        <span className="land-name-total">×{total}</span>
        {!collapsed && (
          <button
            className={`btn-sm land-gallery-btn ${galleryMode ? 'btn-save' : ''}`}
            onClick={e => { e.stopPropagation(); setGalleryMode(g => !g); }}
            title="Toggle gallery view"
          >
            {galleryMode ? '☰ List' : '⊞ Gallery'}
          </button>
        )}
      </div>

      {!collapsed && (
        galleryMode ? (
          <div className="land-gallery-grid">
            {galleryLands.map(land => (
              <GalleryTile key={land.ids[0]} land={land} decks={decks} onUpdate={onUpdate} />
            ))}
          </div>
        ) : (
          <>
            {regular.length > 0 && (
              <div className="land-art-group">
                {fullArt.length > 0 && <div className="land-art-label">Regular</div>}
                {regular.map(land => (
                  <LandRow key={land.ids[0]} land={land} decks={decks} onUpdate={onUpdate} onDelete={onDelete} />
                ))}
              </div>
            )}
            {fullArt.length > 0 && (
              <div className="land-art-group">
                <div className="land-art-label">Full Art</div>
                {fullArt.map(land => (
                  <LandRow key={land.ids[0]} land={land} decks={decks} onUpdate={onUpdate} onDelete={onDelete} />
                ))}
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

function LandSection({ lands, decks, onUpdate, onDelete }) {
  const [collapsed, setCollapsed] = useState(false);

  // Group by name (case-insensitive), then by full_art
  const byName = {};
  const canonicalName = {}; // lowercased key → display name (prefer title-case)
  for (const land of lands) {
    const key = land.name.toLowerCase();
    if (!byName[key]) {
      byName[key] = { regular: [], fullArt: [] };
      canonicalName[key] = land.name;
    }
    // Prefer the title-case version as the display name
    if (land.name[0] === land.name[0].toUpperCase()) canonicalName[key] = land.name;
    if (land.full_art) byName[key].fullArt.push(land);
    else               byName[key].regular.push(land);
  }

  const orderedNames = [
    ...LAND_ORDER.map(n => n.toLowerCase()).filter(k => byName[k]),
    ...Object.keys(byName).filter(k => !LAND_ORDER.map(n => n.toLowerCase()).includes(k)).sort(),
  ];

  const total = lands.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="land-section">
      <div className="land-section-header" onClick={() => setCollapsed(c => !c)}>
        <span className="land-section-title">Basic Lands ({total})</span>
        <span className="land-section-toggle">{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div className="land-section-body">
          {orderedNames.map(key => (
            <LandNameGroup
              key={key}
              groupKey={key}
              displayName={canonicalName[key]}
              regular={byName[key].regular}
              fullArt={byName[key].fullArt}
              decks={decks}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-copy deck row inside the edit panel ───────────────────────────────────
function CopyRow({ copy, index, decks, cardColorIdentity, onChange }) {
  const selectedDeck = decks.find(d => d.id === copy.deck_id) ?? null;

  const identityFits = (deck) => {
    if (deck.format !== 'commander' || !deck.commander_id || !deck.colors?.length) return true;
    if (!cardColorIdentity?.length) return true; // colorless fits anywhere
    return cardColorIdentity.every(c => deck.colors.includes(c));
  };

  const eligibleDecks = decks.filter(d => d.id === copy.deck_id || identityFits(d));

  return (
    <div className="copy-row">
      <span className="copy-label">Copy {index + 1}</span>
      <select
        value={copy.deck_id ?? ''}
        onChange={e => onChange(copy.id, e.target.value ? parseInt(e.target.value, 10) : null)}
      >
        <option value="">— unassigned —</option>
        {eligibleDecks.map(d => (
          <option key={d.id} value={d.id}>
            {d.name}{d.format === 'commander' && !d.commander_id ? ' ⚠ no commander' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Card tile (grouped) ───────────────────────────────────────────────────────
function CardTile({ card, decks, groups, onUpdate, onDelete, onAddCopy, onGroupCreated, bulkMode, selected, onSelect }) {
  const [editing, setEditing]       = useState(false);
  const [foil, setFoil]             = useState(!!card.foil);
  const [copies, setCopies]         = useState(card.copies || []);
  // selGroups: Set of group IDs (integers)
  const [selGroups, setSelGroups]   = useState(() => new Set((card.groups || []).map(g => g.id)));
  const [flipped, setFlipped]       = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  useEffect(() => {
    setCopies(card.copies || []);
    setSelGroups(new Set((card.groups || []).map(g => g.id)));
  }, [card]);

  const toggleGroup = (gid) =>
    setSelGroups(prev => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });

  const createGroupByName = async (name) => {
    if (!name) return;
    const res = await fetch(`${API}/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const g = await res.json();
      onGroupCreated(g);
      setSelGroups(prev => new Set([...prev, g.id]));
      setGroupSearch('');
    }
  };

  const setCopyDeck = (id, deckId) =>
    setCopies(prev => prev.map(c => c.id === id ? { ...c, deck_id: deckId } : c));

  const save = async () => {
    const groupIds = [...selGroups];

    const updated = await Promise.all(copies.map(copy =>
      fetch(`${API}/cards/${copy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          foil,
          deck_id: copy.deck_id ?? null,
          groups: groupIds,
        }),
      }).then(r => r.json())
    ));

    onUpdate(updated);
    setEditing(false);
  };

  const delAll = async () => {
    if (!window.confirm(`Remove all ${card.quantity} cop${card.quantity === 1 ? 'y' : 'ies'} of ${card.name}?`)) return;
    await Promise.all(card.ids.map(id => fetch(`${API}/cards/${id}`, { method: 'DELETE' })));
    onDelete(card.ids);
  };

  const delOneCopy = async () => {
    if (copies.length === 1) return;
    const unassigned = copies.find(c => !c.deck_id);
    const target = unassigned || copies[copies.length - 1];
    await fetch(`${API}/cards/${target.id}`, { method: 'DELETE' });
    onDelete([target.id]);
  };

  const isFoil  = !!card.foil;
  const hasBack = !!card.image_back;
  const imgSrc  = flipped && hasBack ? card.image_back : card.image_uri;

  const rawPrice = isFoil
    ? (card.prices_usd_foil ?? card.prices_usd_etched ?? card.prices_usd)
    : (card.prices_usd ?? card.prices_usd_foil ?? card.prices_usd_etched);
  const price = rawPrice ? `$${parseFloat(rawPrice).toFixed(2)}` : null;

  // Summarise deck assignments for badge display: deck name → count
  const deckCounts = {};
  for (const copy of (card.copies || [])) {
    if (copy.deck_id) {
      const deck = decks.find(d => d.id === copy.deck_id);
      const label = deck?.name ?? `#${copy.deck_id}`;
      deckCounts[label] = (deckCounts[label] || 0) + 1;
    }
  }

  return (
    <div
      className={`card-tile ${isFoil ? 'foil' : ''} ${bulkMode && selected ? 'bulk-selected' : ''}`}
      onClick={bulkMode ? () => onSelect(card.ids) : undefined}
      style={bulkMode ? { cursor: 'pointer' } : undefined}
    >
      {bulkMode && (
        <div className="bulk-checkbox" onClick={e => { e.stopPropagation(); onSelect(card.ids); }}>
          <input type="checkbox" checked={selected} onChange={() => onSelect(card.ids)} />
        </div>
      )}
      <div className="card-img-wrap" onClick={() => !bulkMode && hasBack && setFlipped(f => !f)}>
        {imgSrc
          ? <img src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-no-img">{card.name}</div>
        }
        {hasBack && <span className="flip-hint">↻</span>}
        {isFoil && <span className="foil-badge">✦ Foil</span>}
        {price && <span className="price-overlay">{price}</span>}
      </div>
      <div className="card-info">
        <div className="card-name">{card.name}</div>
        <div className="card-meta">
          <span className="rarity-dot" style={{ background: RARITY_COLOR[card.rarity] || '#888' }} />
          <span>
            {card.set_code?.toUpperCase()}
            {card.collector_number ? ` #${card.collector_number}` : ''}
          </span>
        </div>
        <div className="card-sub">{card.type_line}</div>

        {/* Deck badges */}
        {Object.keys(deckCounts).length > 0 && (
          <div className="card-badges">
            {Object.entries(deckCounts).map(([name, n]) => (
              <span key={name} className="card-deck-badge">
                {name}{n > 1 ? ` ×${n}` : ''}
              </span>
            ))}
          </div>
        )}
        {/* Group badges */}
        {(card.groups || []).length > 0 && (
          <div className="card-badges">
            {card.groups.map(g => <span key={g.id} className="card-group-badge">{g.name}</span>)}
          </div>
        )}

        {!editing && !bulkMode ? (
          <div className="card-actions">
            <button className="btn-qty" onClick={delOneCopy} title="Remove one copy">−</button>
            <span className="card-qty">×{card.quantity}</span>
            <button className="btn-qty" onClick={() => onAddCopy(card)} title="Add one copy">+</button>
            <button className="btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn-sm btn-danger" onClick={delAll} title="Remove all copies">✕</button>
          </div>
        ) : editing ? (
          <div className="card-edit">
            <label className="foil-toggle">
              <input type="checkbox" checked={foil} onChange={e => setFoil(e.target.checked)} />
              Foil
            </label>

            <label className="copies-label">
              Deck per copy
              <span className="deck-limit-hint"> (1 deck per physical card)</span>
            </label>
            <div className="copies-list">
              {copies.map((copy, i) => (
                <CopyRow
                  key={copy.id}
                  copy={copy}
                  index={i}
                  decks={decks}
                  cardColorIdentity={card.color_identity ? JSON.parse(card.color_identity) : []}
                  onChange={setCopyDeck}
                />
              ))}
            </div>

            <label>Groups</label>
            {/* Selected groups — uncheck to remove */}
            {selGroups.size > 0 && (
              <div className="group-selected-list">
                {(groups || []).filter(g => selGroups.has(g.id)).map(g => (
                  <label key={g.id} className="multi-select-item">
                    <input type="checkbox" checked onChange={() => toggleGroup(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
            {/* Searchable dropdown for adding groups */}
            <div className="group-search-wrap">
              <input
                className="new-group-input"
                placeholder="Search or create tag…"
                value={groupSearch}
                onChange={e => setGroupSearch(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const q = groupSearch.trim();
                    const match = (groups || []).find(g => g.name.toLowerCase() === q.toLowerCase());
                    if (match) { toggleGroup(match.id); setGroupSearch(''); }
                    else if (q) { createGroupByName(q); }
                  }
                  if (e.key === 'Escape') setGroupSearch('');
                }}
              />
              {groupSearch.trim() && (
                <div className="group-dropdown">
                  {(groups || [])
                    .filter(g => !selGroups.has(g.id) && g.name.toLowerCase().includes(groupSearch.toLowerCase()))
                    .map(g => (
                      <div key={g.id} className="group-dropdown-item"
                        onMouseDown={e => { e.preventDefault(); toggleGroup(g.id); setGroupSearch(''); }}>
                        {g.name}
                      </div>
                    ))
                  }
                  {!(groups || []).some(g => g.name.toLowerCase() === groupSearch.trim().toLowerCase()) && (
                    <div className="group-dropdown-item group-dropdown-create"
                      onMouseDown={e => { e.preventDefault(); createGroupByName(groupSearch.trim()); }}>
                      + Create "{groupSearch.trim()}"
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="edit-btns">
              <button className="btn-sm btn-save" onClick={save}>Save</button>
              <button className="btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Collection view ───────────────────────────────────────────────────────────
// decks: [{id, name, ...}], groups: [{id, name}]
export default function CollectionView({ cards: initialCards, decks, groups, onGroupCreated, refresh, showToast }) {
  const [cards, setCards]               = useState(initialCards);
  const [search, setSearch]             = useState('');
  const [filterDeck, setFilterDeck]     = useState('');   // deck id (string of int) or ''
  const [filterGroup, setFilterGroup]   = useState('');   // group id (string of int) or ''
  const [filterFoil, setFilterFoil]     = useState('');
  const [filterColors, setFilterColors] = useState(new Set());
  const [sort, setSort]                 = useState('prices_usd');
  const [order, setOrder]               = useState('desc');
  const [filtersOpen, setFiltersOpen]   = useState(false);

  const hasFilters = !!(filterDeck || filterGroup || filterFoil || filterColors.size > 0);
  const clearAllFilters = () => { setFilterDeck(''); setFilterGroup(''); setFilterFoil(''); setFilterColors(new Set()); };
  const activeFilterCount = [filterDeck, filterGroup, filterFoil].filter(Boolean).length + (filterColors.size > 0 ? 1 : 0);
  const SORT_LABELS = { name: 'Name', prices_usd: 'Price', rarity: 'Rarity', set_name: 'Set', added_at: 'Added' };
  const cycleSort = (field) => {
    if (sort === field) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(field); setOrder('asc'); }
  };

  // Bulk-edit state
  const [bulkMode, setBulkMode]           = useState(false);
  const [selectedIds, setSelectedIds]     = useState(new Set());
  const [bulkDeck, setBulkDeck]           = useState('');   // deck id or ''
  const [bulkGroup, setBulkGroup]         = useState('');   // group id or ''
  const [bulkBusy, setBulkBusy]           = useState(false);

  const applyFilters = async () => {
    const params = {};
    if (search)                params.search = search;
    if (filterDeck)            params.deck   = filterDeck;
    if (filterGroup)           params.group  = filterGroup;
    if (filterFoil !== '')     params.foil   = filterFoil;
    if (filterColors.size > 0) params.colors = [...filterColors].join(',');
    params.sort  = sort;
    params.order = order;
    try {
      const qs  = new URLSearchParams(params).toString();
      const res = await fetch(`${API}/cards${qs ? '?' + qs : ''}`);
      if (res.ok) setCards(await res.json());
    } catch {}
  };

  useEffect(() => { applyFilters(); }, [search, filterDeck, filterGroup, filterFoil, filterColors, sort, order]);

  // updatedRows are full collection rows returned by PATCH (with groups: [{id,name}], deck_id)
  const handleUpdate = (updatedRows) => {
    setCards(prev => {
      const rowMap = Object.fromEntries(updatedRows.map(r => [r.id, r]));
      return prev.map(card => {
        const newCopies = card.copies.map(c =>
          rowMap[c.id]
            ? { id: c.id, deck_id: rowMap[c.id].deck_id ?? null, groups: rowMap[c.id].groups || [] }
            : c
        );
        // Aggregate groups across all copies (by id, deduplicated)
        const groupMap = new Map();
        for (const copy of newCopies) {
          for (const g of (copy.groups || [])) groupMap.set(g.id, g);
        }
        return { ...card, copies: newCopies, groups: [...groupMap.values()] };
      });
    });
    refresh();
  };

  const handleDelete = (deletedIds) => {
    const delSet = new Set(deletedIds);
    setCards(prev =>
      prev
        .map(card => {
          const newCopies = card.copies.filter(c => !delSet.has(c.id));
          if (newCopies.length === 0) return null;
          const newIds = card.ids.filter(id => !delSet.has(id));
          const groupMap = new Map();
          for (const copy of newCopies) {
            for (const g of (copy.groups || [])) groupMap.set(g.id, g);
          }
          return { ...card, copies: newCopies, ids: newIds, quantity: newCopies.length, groups: [...groupMap.values()] };
        })
        .filter(Boolean)
    );
    refresh();
  };

  const handleAddCopy = async (card) => {
    const scryfall_card = {
      name: card.name, id: card.scryfall_id,
      set: card.set_code, set_name: card.set_name,
      collector_number: card.collector_number,
      image_uris: card.image_uri ? { normal: card.image_uri } : undefined,
      mana_cost: card.mana_cost, type_line: card.type_line,
      oracle_text: card.oracle_text,
      colors: card.colors ? JSON.parse(card.colors) : [],
      rarity: card.rarity,
      prices: {
        usd:        card.prices_usd        != null ? String(card.prices_usd)        : null,
        usd_foil:   card.prices_usd_foil   != null ? String(card.prices_usd_foil)   : null,
        usd_etched: card.prices_usd_etched != null ? String(card.prices_usd_etched) : null,
      },
    };
    const res = await fetch(`${API}/cards/copies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card, foil: card.foil, count: 1 }),
    });
    const { ids } = await res.json();
    const newCopy = { id: ids[0], deck_id: null, groups: [] };
    setCards(prev => prev.map(c => {
      if (c.ids[0] !== card.ids[0] && c.name !== card.name) return c;
      if (c.set_code !== card.set_code || c.collector_number !== card.collector_number) return c;
      return {
        ...c,
        quantity: c.quantity + 1,
        ids: [...c.ids, ids[0]],
        copies: [...c.copies, newCopy],
      };
    }));
    refresh();
  };

  const toggleSelectGroup = (ids) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      if (allSelected) ids.forEach(id => next.delete(id));
      else             ids.forEach(id => next.add(id));
      return next;
    });
  };

  const allIds = cards.flatMap(c => c.ids);
  const toggleAll = () => {
    if (selectedIds.size === allIds.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  };

  const exitBulk = () => {
    setBulkMode(false);
    setSelectedIds(new Set());
    setBulkDeck('');
    setBulkGroup('');
  };

  const bulkDelete = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Remove ${selectedIds.size} card cop${selectedIds.size === 1 ? 'y' : 'ies'} from collection?`)) return;
    setBulkBusy(true);
    await Promise.all([...selectedIds].map(id => fetch(`${API}/cards/${id}`, { method: 'DELETE' })));
    handleDelete([...selectedIds]);
    showToast(`Deleted ${selectedIds.size} cop${selectedIds.size === 1 ? 'y' : 'ies'}`);
    exitBulk();
    setBulkBusy(false);
  };

  const bulkAssignDeck = async () => {
    const deckId = bulkDeck ? parseInt(bulkDeck, 10) : null;
    if (!deckId || !selectedIds.size) return;
    setBulkBusy(true);
    const updated = await Promise.all([...selectedIds].map(id =>
      fetch(`${API}/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_id: deckId }),
      }).then(r => r.json())
    ));
    handleUpdate(updated);
    const deck = decks.find(d => d.id === deckId);
    showToast(`Assigned ${selectedIds.size} cop${selectedIds.size === 1 ? 'y' : 'ies'} to "${deck?.name ?? deckId}"`);
    exitBulk();
    setBulkBusy(false);
  };

  const bulkAssignGroup = async () => {
    const groupId = bulkGroup ? parseInt(bulkGroup, 10) : null;
    if (!groupId || !selectedIds.size) return;
    setBulkBusy(true);
    // For each selected copy, merge the new group id into its existing group ids
    const allRows = cards.flatMap(c => c.copies);
    const updated = await Promise.all([...selectedIds].map(id => {
      const copy = allRows.find(c => c.id === id);
      const existingIds = (copy?.groups || []).map(g => g.id);
      const newGroupIds = [...new Set([...existingIds, groupId])];
      return fetch(`${API}/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: newGroupIds }),
      }).then(r => r.json());
    }));
    handleUpdate(updated);
    const group = groups.find(g => g.id === groupId);
    showToast(`Assigned ${selectedIds.size} cop${selectedIds.size === 1 ? 'y' : 'ies'} to group "${group?.name ?? groupId}"`);
    exitBulk();
    setBulkBusy(false);
  };

  return (
    <div className="collection-view">
      <div className="filter-bar">
        <div className="filter-row-main">
          <input
            className="filter-input"
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            className={`btn-sm filter-toggle-btn${filtersOpen ? ' btn-save' : ''}${hasFilters ? ' filter-has-active' : ''}`}
            onClick={() => setFiltersOpen(o => !o)}
            title="Toggle filters"
          >
            {hasFilters ? `Filters (${activeFilterCount})` : 'Filters'}
          </button>
          <span className="card-count">{cards.reduce((s, c) => s + c.quantity, 0)} cards</span>
        </div>

        <div className={`filter-controls${filtersOpen ? ' filter-controls-open' : ''}`}>
          <select className={filterDeck ? 'filter-active' : ''} value={filterDeck} onChange={e => setFilterDeck(e.target.value)}>
            <option value="">All Decks</option>
            {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className={filterGroup ? 'filter-active' : ''} value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
            <option value="">All Groups</option>
            {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className={filterFoil ? 'filter-active' : ''} value={filterFoil} onChange={e => setFilterFoil(e.target.value)}>
            <option value="">All Finishes</option>
            <option value="true">Foil only</option>
            <option value="false">Non-foil only</option>
          </select>
          <div className="color-filter">
            {[
              { code: 'W', label: 'White', bg: '#f9faf4', color: '#6b6340' },
              { code: 'U', label: 'Blue',  bg: '#0e68ab', color: '#fff'    },
              { code: 'B', label: 'Black', bg: '#2a2a2a', color: '#ccc'    },
              { code: 'R', label: 'Red',   bg: '#d3202a', color: '#fff'    },
              { code: 'G', label: 'Green', bg: '#00733e', color: '#fff'    },
            ].map(({ code, label, bg, color }) => (
              <button
                key={code}
                title={label}
                className={`color-pip ${filterColors.has(code) ? 'active' : ''}`}
                style={{ '--pip-bg': bg, '--pip-color': color }}
                onClick={() => setFilterColors(prev => {
                  const next = new Set(prev);
                  next.has(code) ? next.delete(code) : next.add(code);
                  return next;
                })}
              >{code}</button>
            ))}
          </div>
          <div className="sort-group">
            {Object.entries(SORT_LABELS).map(([field, label]) => (
              <button
                key={field}
                className={`sort-btn${sort === field ? ' sort-btn-active' : ''}`}
                onClick={() => cycleSort(field)}
              >
                {label}{sort === field ? (order === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button className="btn-sm filter-clear-btn" onClick={clearAllFilters}>✕ Clear</button>
          )}
          <button
            className={`btn-sm ${bulkMode ? 'btn-save' : ''}`}
            onClick={() => bulkMode ? exitBulk() : setBulkMode(true)}
          >
            {bulkMode ? 'Cancel' : '☑ Bulk'}
          </button>
        </div>
      </div>

      {bulkMode && (
        <div className="bulk-toolbar">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={selectedIds.size === allIds.length && allIds.length > 0}
              onChange={toggleAll}
            />
            {selectedIds.size === allIds.length && allIds.length > 0 ? 'Deselect all' : `Select all (${allIds.length})`}
          </label>

          <span className="bulk-count">{selectedIds.size} cop{selectedIds.size === 1 ? 'y' : 'ies'} selected</span>

          <div className="bulk-assign">
            <select value={bulkDeck} onChange={e => setBulkDeck(e.target.value)} disabled={bulkBusy}>
              <option value="">— Assign to deck —</option>
              {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button className="btn-sm btn-save" onClick={bulkAssignDeck}
              disabled={bulkBusy || !selectedIds.size || !bulkDeck}>
              Assign
            </button>
          </div>

          <div className="bulk-assign">
            <select value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} disabled={bulkBusy}>
              <option value="">— Assign to group —</option>
              {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button className="btn-sm btn-save" onClick={bulkAssignGroup}
              disabled={bulkBusy || !selectedIds.size || !bulkGroup}>
              Assign
            </button>
          </div>

          <button className="btn-sm btn-danger-solid" onClick={bulkDelete}
            disabled={bulkBusy || !selectedIds.size}>
            🗑 Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      )}

      {(() => {
        const landCards    = cards.filter(c => c.type_line?.startsWith('Basic Land'));
        const regularCards = cards.filter(c => !c.type_line?.startsWith('Basic Land'));
        return (
          <>
            {landCards.length > 0 && (
              <LandSection
                lands={landCards}
                decks={decks}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            )}
            {regularCards.length === 0 && landCards.length === 0
              ? <div className="empty-state">No cards found. Add some to your collection!</div>
              : regularCards.length > 0 && (
                <div className="card-grid">
                  {regularCards.map(card => (
                    <CardTile
                      key={card.ids[0]}
                      card={card}
                      decks={decks}
                      groups={groups}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      onAddCopy={handleAddCopy}
                      onGroupCreated={onGroupCreated}
                      bulkMode={bulkMode}
                      selected={card.ids.every(id => selectedIds.has(id))}
                      onSelect={toggleSelectGroup}
                    />
                  ))}
                </div>
              )
            }
          </>
        );
      })()}
    </div>
  );
}
