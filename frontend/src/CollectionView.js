import React, { useState, useEffect } from 'react';

const API = '/api';
const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e', special: '#c879ff' };

function CardTile({ card, decks, groups, onUpdate, onDelete }) {
  const [editing, setEditing]     = useState(false);
  const [qty, setQty]             = useState(card.quantity);
  const [foil, setFoil]           = useState(!!card.foil);
  const [selDecks, setSelDecks]   = useState(card.decks || []);
  const [newDeck, setNewDeck]     = useState('');
  const [selGroups, setSelGroups] = useState(card.groups || []);
  const [newGroup, setNewGroup]     = useState('');
  const [flipped, setFlipped]     = useState(false);

  const toggleDeck  = (d) => setSelDecks(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  const toggleGroup = (g) => setSelGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const save = async () => {
    const finalDecks = newDeck.trim()
      ? [...new Set([...selDecks, newDeck.trim()])]
      : selDecks;
    const finalGroups = newGroup.trim()
      ? [...new Set([...selGroups, newGroup.trim()])]
      : selGroups;
    const res = await fetch(`${API}/cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: parseInt(qty), foil, decks: finalDecks, groups: finalGroups }),
    });
    const updated = await res.json();
    onUpdate(updated);
    setSelGroups(updated.groups || []);
    setNewGroup('');
    setSelDecks(updated.decks || []);
    setNewDeck('');
    setEditing(false);
  };

  const del = async () => {
    if (!window.confirm(`Remove ${card.name} from collection?`)) return;
    await fetch(`${API}/cards/${card.id}`, { method: 'DELETE' });
    onDelete(card.id);
  };

  const isFoil  = !!card.foil;
  const hasBack = !!card.image_back;
  const imgSrc  = flipped && hasBack ? card.image_back : card.image_uri;
  const price   = card.prices_usd ? `$${parseFloat(card.prices_usd).toFixed(2)}` : null;

  return (
    <div className={`card-tile ${isFoil ? 'foil' : ''}`}>
      <div className="card-img-wrap" onClick={() => hasBack && setFlipped(f => !f)}>
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

        {/* Deck badges */}
        {(card.decks || []).length > 0 && (
          <div className="card-badges">
            {card.decks.map(d => <span key={d} className="card-deck-badge">{d}</span>)}
          </div>
        )}
        {/* Group badges */}
        {(card.groups || []).length > 0 && (
          <div className="card-badges">
            {card.groups.map(g => <span key={g} className="card-group-badge">{g}</span>)}
          </div>
        )}

        {!editing ? (
          <div className="card-actions">
            <span className="card-qty">×{card.quantity}</span>
            <button className="btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn-sm btn-danger" onClick={del}>✕</button>
          </div>
        ) : (
          <div className="card-edit">
            <label>Qty
              <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} />
            </label>
            <label className="foil-toggle">
              <input type="checkbox" checked={foil} onChange={e => setFoil(e.target.checked)} />
              Foil
            </label>

            <label>Decks</label>
            <div className="multi-select-list">
              {decks.map(d => (
                <label key={d} className="multi-select-item">
                  <input type="checkbox" checked={selDecks.includes(d)} onChange={() => toggleDeck(d)} />
                  {d}
                </label>
              ))}
            </div>
            <input
              className="new-deck-input"
              placeholder="+ New deck name"
              value={newDeck}
              onChange={e => setNewDeck(e.target.value)}
            />

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
        )}
      </div>
    </div>
  );
}

export default function CollectionView({ cards: initialCards, decks, groups, fetchCards, refresh, showToast }) {
  const [cards, setCards]         = useState(initialCards);
  const [search, setSearch]       = useState('');
  const [filterDeck, setFilterDeck]   = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [filterFoil, setFilterFoil]   = useState('');
  const [sort, setSort]           = useState('name');
  const [order, setOrder]         = useState('asc');

  useEffect(() => { setCards(initialCards); }, [initialCards]);

  const applyFilters = async () => {
    const params = {};
    if (search)      params.search = search;
    if (filterDeck)  params.deck   = filterDeck;
    if (filterGroup) params.group  = filterGroup;
    if (filterFoil !== '') params.foil = filterFoil;
    params.sort  = sort;
    params.order = order;
    await fetchCards(params);
  };

  useEffect(() => { applyFilters(); }, [search, filterDeck, filterGroup, filterFoil, sort, order]);

  const handleUpdate = (updated) => {
    setCards(cs => cs.map(c => c.id === updated.id ? updated : c));
    refresh();
  };

  const handleDelete = (id) => {
    setCards(cs => cs.filter(c => c.id !== id));
    refresh();
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
        <span className="card-count">{cards.length} cards</span>
      </div>

      {cards.length === 0
        ? <div className="empty-state">No cards found. Add some to your collection!</div>
        : (
          <div className="card-grid">
            {cards.map(card => (
              <CardTile
                key={card.id}
                card={card}
                decks={decks}
                groups={groups}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )
      }
    </div>
  );
}