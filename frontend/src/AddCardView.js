import React, { useState, useRef } from 'react';

const API = '/api';

export default function AddCardView({ decks, refresh, showToast, setView }) {
  const [query, setQuery] = useState('');
  const [setCode, setSetCode] = useState('');
  const [collNum, setCollNum] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState(1);
  const [foil, setFoil] = useState(false);
  const [deck, setDeck] = useState('');
  const [newDeck, setNewDeck] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('name'); // 'name' | 'set'
  const debounce = useRef(null);

  const searchByName = async (q) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/scryfall/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.data || []);
    } catch { setResults([]); }
    setLoading(false);
  };

  const handleQueryChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => searchByName(v), 400);
  };

  const searchBySet = async () => {
    if (!setCode || !collNum) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/scryfall/card/${setCode.toLowerCase()}/${collNum}`);
      const data = await res.json();
      if (data.id) { setSelected(data); setResults([]); }
      else showToast('Card not found', 'error');
    } catch { showToast('Card not found', 'error'); }
    setLoading(false);
  };

  const addCard = async () => {
    if (!selected) return;
    const finalDeck = deck === '__new__' ? newDeck : deck;
    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scryfall_card: selected, quantity: qty, foil, deck: finalDeck }),
    });
    if (res.ok) {
      showToast(`Added ${selected.name} ×${qty}${foil ? ' (foil)' : ''}`);
      refresh();
      setSelected(null);
      setResults([]);
      setQuery('');
      setSetCode('');
      setCollNum('');
      setQty(1);
      setFoil(false);
    } else {
      showToast('Failed to add card', 'error');
    }
  };

  const img = selected
    ? (selected.image_uris?.normal || selected.card_faces?.[0]?.image_uris?.normal)
    : null;

  return (
    <div className="add-view">
      <div className="add-left">
        <h2 className="section-title">Add a Card</h2>

        <div className="mode-tabs">
          <button className={mode === 'name' ? 'active' : ''} onClick={() => setMode('name')}>Search by Name</button>
          <button className={mode === 'set' ? 'active' : ''} onClick={() => setMode('set')}>Set + Collector #</button>
        </div>

        {mode === 'name' && (
          <div className="search-block">
            <input
              className="search-input"
              placeholder="Type a card name…"
              value={query}
              onChange={handleQueryChange}
              autoFocus
            />
            {loading && <div className="searching">Searching Scryfall…</div>}
            {results.length > 0 && (
              <div className="search-results">
                {results.slice(0, 20).map(card => (
                  <div
                    key={card.id}
                    className={`result-row ${selected?.id === card.id ? 'selected' : ''}`}
                    onClick={() => { setSelected(card); setResults([]); setQuery(card.name); }}
                  >
                    <span className="result-name">{card.name}</span>
                    <span className="result-set">{card.set_name} ({card.set?.toUpperCase()})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'set' && (
          <div className="search-block">
            <div className="set-row">
              <input placeholder="Set code (e.g. dmr)" value={setCode} onChange={e => setSetCode(e.target.value)} />
              <input placeholder="Collector # (e.g. 123)" value={collNum} onChange={e => setCollNum(e.target.value)} />
              <button className="btn-primary" onClick={searchBySet} disabled={loading}>Lookup</button>
            </div>
          </div>
        )}

        {selected && (
          <div className="add-form">
            <div className="selected-name">Selected: <strong>{selected.name}</strong> — {selected.set_name}</div>
            <div className="form-row">
              <label>Quantity
                <input type="number" min="1" max="99" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
              </label>
              <label className="foil-toggle">
                <input type="checkbox" checked={foil} onChange={e => setFoil(e.target.checked)} />
                Foil
              </label>
            </div>
            <label>Deck
              <select value={deck} onChange={e => setDeck(e.target.value)}>
                <option value="">— none —</option>
                {decks.map(d => <option key={d} value={d}>{d}</option>)}
                <option value="__new__">+ New deck…</option>
              </select>
            </label>
            {deck === '__new__' && (
              <input placeholder="New deck name" value={newDeck} onChange={e => setNewDeck(e.target.value)} />
            )}
            <button className="btn-primary btn-add" onClick={addCard}>
              Add to Collection
            </button>
          </div>
        )}
      </div>

      <div className="add-right">
        {img
          ? <img className="preview-img" src={img} alt={selected?.name} />
          : <div className="preview-placeholder">
              <span>Select a card<br />to preview</span>
            </div>
        }
      </div>
    </div>
  );
}
