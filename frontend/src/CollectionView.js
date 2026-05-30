import React, { useState, useEffect } from 'react';

const API = '/api';
const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e', special: '#c879ff' };

function CardTile({ card, decks, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(card.quantity);
  const [foil, setFoil] = useState(!!card.foil);
  const [deck, setDeck] = useState(card.deck || '');
  const [newDeck, setNewDeck] = useState('');
  const [flipped, setFlipped] = useState(false);

  const save = async () => {
    const finalDeck = deck === '__new__' ? newDeck : deck;
    const res = await fetch(`${API}/cards/${card.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: parseInt(qty), foil, deck: finalDeck }),
    });
    const updated = await res.json();
    onUpdate(updated);
    setEditing(false);
  };

  const del = async () => {
    if (!window.confirm(`Remove ${card.name} from collection?`)) return;
    await fetch(`${API}/cards/${card.id}`, { method: 'DELETE' });
    onDelete(card.id);
  };

  const imgSrc = flipped && card.image_back ? card.image_back : card.image_uri;

  return (
    <div className={`card-tile ${foil ? 'foil' : ''}`}>
      <div className="card-img-wrap" onClick={() => card.image_back && setFlipped(f => !f)}>
        {imgSrc
          ? <img src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-no-img">{card.name}</div>
        }
        {card.image_back && <span className="flip-hint">↻</span>}
        {card.foil && <span className="foil-badge">✦ Foil</span>}
      </div>
      <div className="card-info">
        <div className="card-name">{card.name}</div>
        <div className="card-meta">
          <span className="rarity-dot" style={{ background: RARITY_COLOR[card.rarity] || '#888' }} />
          <span>{card.set_code?.toUpperCase()} #{card.collector_number}</span>
        </div>
        <div className="card-sub">{card.type_line}</div>
        {card.deck && <div className="card-deck-badge">{card.deck}</div>}

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
            <label>Deck
              <select value={deck} onChange={e => setDeck(e.target.value)}>
                <option value="">— none —</option>
                {decks.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__new__">+ New deck…</option>
              </select>
            </label>
            {deck === '__new__' && (
              <input placeholder="Deck name" value={newDeck} onChange={e => setNewDeck(e.target.value)} />
            )}
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

export default function CollectionView({ cards: initialCards, decks, fetchCards, refresh, showToast }) {
  const [cards, setCards] = useState(initialCards);
  const [search, setSearch] = useState('');
  const [filterDeck, setFilterDeck] = useState('');
  const [filterFoil, setFilterFoil] = useState('');
  const [sort, setSort] = useState('name');
  const [order, setOrder] = useState('asc');

  useEffect(() => { setCards(initialCards); }, [initialCards]);

  const applyFilters = async () => {
    const params = {};
    if (search)     params.search = search;
    if (filterDeck) params.deck = filterDeck;
    if (filterFoil !== '') params.foil = filterFoil;
    params.sort = sort;
    params.order = order;
    await fetchCards(params);
  };

  useEffect(() => { applyFilters(); }, [search, filterDeck, filterFoil, sort, order]);

  const handleUpdate = (updated) => {
    if (updated.deleted) {
      setCards(cs => cs.filter(c => c.id !== updated.id));
    } else {
      setCards(cs => cs.map(c => c.id === updated.id ? updated : c));
    }
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
        <select value={filterFoil} onChange={e => setFilterFoil(e.target.value)}>
          <option value="">Foil + Non-foil</option>
          <option value="true">Foil only</option>
          <option value="false">Non-foil only</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="cmc">Sort: CMC</option>
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
