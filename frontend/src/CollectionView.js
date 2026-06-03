import React, { useState, useEffect } from 'react';

const API = '/api';
const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e', special: '#c879ff' };

// ── Per-copy deck row inside the edit panel ───────────────────────────────────
function CopyRow({ copy, index, decks, onChange }) {
  const deck = copy.decks?.[0] || '';
  return (
    <div className="copy-row">
      <span className="copy-label">Copy {index + 1}</span>
      <select
        value={deck}
        onChange={e => onChange(copy.id, e.target.value || null)}
      >
        <option value="">— unassigned —</option>
        {decks.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

// ── Card tile (grouped) ───────────────────────────────────────────────────────
function CardTile({ card, decks, groups, onUpdate, onDelete, onAddCopy, bulkMode, selected, onSelect }) {
  const [editing, setEditing]     = useState(false);
  const [foil, setFoil]           = useState(!!card.foil);
  // copies: array of { id, decks: [string|none] }
  const [copies, setCopies]       = useState(card.copies || []);
  const [selGroups, setSelGroups] = useState(card.groups || []);
  const [newGroup, setNewGroup]   = useState('');
  const [newDeck, setNewDeck]     = useState('');
  const [flipped, setFlipped]     = useState(false);

  useEffect(() => {
    setCopies(card.copies || []);
    setSelGroups(card.groups || []);
  }, [card]);

  const toggleGroup = (g) => setSelGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const setCopyDeck = (id, deck) => {
    setCopies(prev => prev.map(c => c.id === id ? { ...c, decks: deck ? [deck] : [] } : c));
  };

  const save = async () => {
    const finalGroups = newGroup.trim()
      ? [...new Set([...selGroups, newGroup.trim()])]
      : selGroups;

    // Patch each copy: update its deck and groups
    const updated = await Promise.all(copies.map(copy =>
      fetch(`${API}/cards/${copy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          foil,
          decks: copy.decks || [],
          groups: finalGroups,
        }),
      }).then(r => r.json())
    ));

    onUpdate(updated);
    setNewGroup('');
    setNewDeck('');
    setEditing(false);
  };

  const delAll = async () => {
    if (!window.confirm(`Remove all ${card.quantity} cop${card.quantity === 1 ? 'y' : 'ies'} of ${card.name}?`)) return;
    await Promise.all(card.ids.map(id => fetch(`${API}/cards/${id}`, { method: 'DELETE' })));
    onDelete(card.ids);
  };

  const delOneCopy = async () => {
    //Early break if copies = 1
    if (copies.length === 1) return;
    // Delete the last unassigned copy first, otherwise any copy
    const unassigned = copies.find(c => !c.decks?.length);
    const target = unassigned || copies[copies.length - 1];
    await fetch(`${API}/cards/${target.id}`, { method: 'DELETE' });
    onDelete([target.id]);
  };

  const isFoil  = !!card.foil;
  const hasBack = !!card.image_back;
  const imgSrc  = flipped && hasBack ? card.image_back : card.image_uri;
  const price   = card.prices_usd ? `$${parseFloat(card.prices_usd).toFixed(2)}` : null;

  // Summarise deck assignments for badge display
  const deckCounts = {};
  for (const copy of (card.copies || [])) {
    for (const d of (copy.decks || [])) {
      deckCounts[d] = (deckCounts[d] || 0) + 1;
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
      </div>
      {price && <div className="price-badge">{price}</div>}
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

        {/* Deck badges — show deck + copy count if >1 */}
        {Object.keys(deckCounts).length > 0 && (
          <div className="card-badges">
            {Object.entries(deckCounts).map(([d, n]) => (
              <span key={d} className="card-deck-badge">
                {d}{n > 1 ? ` ×${n}` : ''}
              </span>
            ))}
          </div>
        )}
        {/* Group badges */}
        {(card.groups || []).length > 0 && (
          <div className="card-badges">
            {card.groups.map(g => <span key={g} className="card-group-badge">{g}</span>)}
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
                  decks={newDeck ? [...decks, newDeck] : decks}
                  onChange={setCopyDeck}
                />
              ))}
            </div>


            <label>Groups</label>
            <div className="multi-select-list">
              {(groups || []).map(g => (
                <label key={g} className="multi-select-item">
                  <input type="checkbox" checked={selGroups.includes(g)} onChange={() => toggleGroup(g)} />
                  {g}
                </label>
              ))}
            </div>
            <input
              className="new-group-input"
              placeholder="+ New group name"
              value={newGroup}
              onChange={e => setNewGroup(e.target.value)}
            />

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
export default function CollectionView({ cards: initialCards, decks, groups, fetchCards, refresh, showToast }) {
  const [cards, setCards]               = useState(initialCards);
  const [search, setSearch]             = useState('');
  const [filterDeck, setFilterDeck]     = useState('');
  const [filterGroup, setFilterGroup]   = useState('');
  const [filterFoil, setFilterFoil]     = useState('');
  const [filterColors, setFilterColors] = useState(new Set());
  const [sort, setSort]                 = useState('name');
  const [order, setOrder]               = useState('asc');

  // Bulk-edit state
  const [bulkMode, setBulkMode]           = useState(false);
  const [selectedIds, setSelectedIds]     = useState(new Set()); // set of individual row ids
  const [bulkDeck, setBulkDeck]           = useState('');
  const [newBulkDeck, setNewBulkDeck]     = useState('');
  const [bulkGroup, setBulkGroup]         = useState('');
  const [newBulkGroup, setNewBulkGroup]   = useState('');
  const [bulkBusy, setBulkBusy]           = useState(false);

  useEffect(() => { setCards(initialCards); }, [initialCards]);

  const applyFilters = async () => {
    const params = {};
    if (search)                params.search = search;
    if (filterDeck)            params.deck   = filterDeck;
    if (filterGroup)           params.group  = filterGroup;
    if (filterFoil !== '')     params.foil   = filterFoil;
    if (filterColors.size > 0) params.colors = [...filterColors].join(',');
    params.sort  = sort;
    params.order = order;
    await fetchCards(params);
  };

  useEffect(() => { applyFilters(); }, [search, filterDeck, filterGroup, filterFoil, filterColors, sort, order]);

  // onUpdate receives an array of patched individual rows; re-merge into grouped cards
  const handleUpdate = (updatedRows) => {
    setCards(prev => {
      const rowMap = Object.fromEntries(updatedRows.map(r => [r.id, r]));
      return prev.map(card => {
        const newCopies = card.copies.map(c => rowMap[c.id] ? { id: c.id, decks: rowMap[c.id].decks, groups: rowMap[c.id].groups } : c);
        const decks  = [...new Set(newCopies.flatMap(c => c.decks  || []))];
        const groups = [...new Set(newCopies.flatMap(c => c.groups || []))];
        return { ...card, copies: newCopies, decks, groups };
      });
    });
    refresh();
  };

  // onDelete receives array of deleted ids
  const handleDelete = (deletedIds) => {
    const delSet = new Set(deletedIds);
    setCards(prev => {
      return prev
        .map(card => {
          const newCopies = card.copies.filter(c => !delSet.has(c.id));
          if (newCopies.length === 0) return null;
          const newIds = card.ids.filter(id => !delSet.has(id));
          const decks  = [...new Set(newCopies.flatMap(c => c.decks  || []))];
          const groups = [...new Set(newCopies.flatMap(c => c.groups || []))];
          return { ...card, copies: newCopies, ids: newIds, quantity: newCopies.length, decks, groups };
        })
        .filter(Boolean);
    });
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
      prices: { usd: card.prices_usd != null ? String(card.prices_usd) : null },
    };
    const res = await fetch(`${API}/cards/copies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card, foil: card.foil, count: 1 }),
    });
    const { ids } = await res.json();
    const newCopy = { id: ids[0], decks: [], groups: [] };
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

  // Bulk: selectedIds is a flat set of individual row ids
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
    setBulkDeck(''); setNewBulkDeck('');
    setBulkGroup(''); setNewBulkGroup('');
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
    const deck = bulkDeck === '__new__' ? newBulkDeck.trim() : bulkDeck;
    if (!deck || !selectedIds.size) return;
    setBulkBusy(true);
    const updated = await Promise.all([...selectedIds].map(id =>
      fetch(`${API}/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decks: [deck] }),
      }).then(r => r.json())
    ));
    handleUpdate(updated);
    showToast(`Assigned ${selectedIds.size} cop${selectedIds.size === 1 ? 'y' : 'ies'} to "${deck}"`);
    exitBulk();
    setBulkBusy(false);
  };

  const bulkAssignGroup = async () => {
    const group = bulkGroup === '__new__' ? newBulkGroup.trim() : bulkGroup;
    if (!group || !selectedIds.size) return;
    setBulkBusy(true);
    // For groups we merge rather than replace
    const allRows = cards.flatMap(c => c.copies);
    const updated = await Promise.all([...selectedIds].map(id => {
      const copy = allRows.find(c => c.id === id);
      const newGroups = [...new Set([...(copy?.groups || []), group])];
      return fetch(`${API}/cards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: newGroups }),
      }).then(r => r.json());
    }));
    handleUpdate(updated);
    showToast(`Assigned ${selectedIds.size} cop${selectedIds.size === 1 ? 'y' : 'ies'} to group "${group}"`);
    exitBulk();
    setBulkBusy(false);
  };

  return (
    <div className="collection-view">
      <div className="filter-bar">
        <input
          className="filter-input"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select value={filterDeck} onChange={e => setFilterDeck(e.target.value)}>
          <option value="">All Decks</option>
          {decks.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">All Groups</option>
          {(groups || []).map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={filterFoil} onChange={e => setFilterFoil(e.target.value)}>
          <option value="">Foil + Non-foil</option>
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
            >
              {code}
            </button>
          ))}
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="prices_usd">Sort: Price</option>
          <option value="rarity">Sort: Rarity</option>
          <option value="set_name">Sort: Set</option>
          <option value="added_at">Sort: Added</option>
        </select>
        <button className="btn-sm" onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')}>
          {order === 'asc' ? '↑' : '↓'}
        </button>
        <button
          className={`btn-sm ${bulkMode ? 'btn-save' : ''}`}
          onClick={() => bulkMode ? exitBulk() : setBulkMode(true)}
        >
          {bulkMode ? 'Cancel' : '☑ Bulk Edit'}
        </button>
        <span className="card-count">{cards.reduce((s, c) => s + c.quantity, 0)} cards</span>
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
              {decks.map(d => <option key={d} value={d}>{d}</option>)}
              <option value="__new__">+ New deck…</option>
            </select>
            {bulkDeck === '__new__' && (
              <input className="bulk-new-deck" placeholder="Deck name" value={newBulkDeck}
                onChange={e => setNewBulkDeck(e.target.value)} disabled={bulkBusy} />
            )}
            <button className="btn-sm btn-save" onClick={bulkAssignDeck}
              disabled={bulkBusy || !selectedIds.size || !bulkDeck || (bulkDeck === '__new__' && !newBulkDeck.trim())}>
              Assign
            </button>
          </div>

          <div className="bulk-assign">
            <select value={bulkGroup} onChange={e => setBulkGroup(e.target.value)} disabled={bulkBusy}>
              <option value="">— Assign to group —</option>
              {(groups || []).map(g => <option key={g} value={g}>{g}</option>)}
              <option value="__new__">+ New group…</option>
            </select>
            {bulkGroup === '__new__' && (
              <input className="bulk-new-deck" placeholder="Group name" value={newBulkGroup}
                onChange={e => setNewBulkGroup(e.target.value)} disabled={bulkBusy} />
            )}
            <button className="btn-sm btn-save" onClick={bulkAssignGroup}
              disabled={bulkBusy || !selectedIds.size || !bulkGroup || (bulkGroup === '__new__' && !newBulkGroup.trim())}>
              Assign
            </button>
          </div>

          <button className="btn-sm btn-danger-solid" onClick={bulkDelete}
            disabled={bulkBusy || !selectedIds.size}>
            🗑 Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      )}

      {cards.length === 0
        ? <div className="empty-state">No cards found. Add some to your collection!</div>
        : (
          <div className="card-grid">
            {cards.map(card => (
              <CardTile
                key={card.ids[0]}
                card={card}
                decks={decks}
                groups={groups}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onAddCopy={handleAddCopy}
                bulkMode={bulkMode}
                selected={card.ids.every(id => selectedIds.has(id))}
                onSelect={toggleSelectGroup}
              />
            ))}
          </div>
        )
      }
    </div>
  );
}