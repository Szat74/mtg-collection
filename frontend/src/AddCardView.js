import React, { useState, useRef } from 'react';

const API = '/api';

export default function AddCardView({ decks, groups, refresh, showToast, setView }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [selectedName, setSelectedName] = useState(null);   // card name chosen from search
  const [printings, setPrintings]   = useState([]);          // all versions of that name
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingPrints, setLoadingPrints] = useState(false);
  const [selectedCard, setSelectedCard]   = useState(null);  // specific printing chosen

  // Add-form state
  const [qty, setQty]         = useState(1);
  const [foil, setFoil]       = useState(false);
  const [selDecks, setSelDecks] = useState([]);
  const [newDeck, setNewDeck] = useState('');
  const [selGroups, setSelGroups] = useState([]);

  const debounce = useRef(null);

  // ── Step 1: search by name (deduplicated) ──────────────────────────────────
  const searchByName = async (q) => {
    if (q.length < 2) { setResults([]); return; }
    setLoadingSearch(true);
    try {
      const res  = await fetch(`${API}/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.data || []);
    } catch { setResults([]); }
    setLoadingSearch(false);
  };

  const handleQueryChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    setSelectedName(null);
    setSelectedCard(null);
    setPrintings([]);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => searchByName(v), 400);
  };

  // ── Step 2: load all printings for the chosen name ─────────────────────────
  const selectName = async (card) => {
    setSelectedName(card.name);
    setResults([]);
    setQuery(card.name);
    setSelectedCard(null);
    setLoadingPrints(true);
    try {
      const res  = await fetch(`${API}/printings/${encodeURIComponent(card.name)}`);
      const data = await res.json();
      setPrintings(data.data || []);
    } catch { setPrintings([]); showToast('Could not load printings', 'error'); }
    setLoadingPrints(false);
  };

  // ── Step 3: pick a specific printing ──────────────────────────────────────
  const selectPrinting = (card) => {
    setSelectedCard(card);
  };

  // ── Deck multi-select helpers ──────────────────────────────────────────────
  const toggleDeck = (d) =>
    setSelDecks(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);

  const toggleGroup = (g) =>
    setSelGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  // ── Add to collection ──────────────────────────────────────────────────────
  const addCard = async () => {
    if (!selectedCard) return;
    const finalDecks = newDeck.trim()
      ? [...new Set([...selDecks, newDeck.trim()])]
      : selDecks;

    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scryfall_card: selectedCard,
        quantity: qty,
        foil,
        decks: finalDecks,
        groups: selGroups,
      }),
    });

    if (res.ok) {
      showToast(`Added ${selectedCard.name} ×${qty}${foil ? ' (foil)' : ''}`);
      refresh();
      // Reset everything
      setQuery(''); setSelectedName(null); setSelectedCard(null); setPrintings([]);
      setQty(1); setFoil(false); setSelDecks([]); setNewDeck(''); setSelGroups([]);
    } else {
      showToast('Failed to add card', 'error');
    }
  };

  const previewImg = selectedCard
    ? (selectedCard.image_uris?.normal ?? selectedCard.card_faces?.[0]?.image_uris?.normal)
    : null;

  return (
    <div className="add-view">
      <div className="add-left">
        <h2 className="section-title">Add a Card</h2>

        {/* ── Step 1: name search ── */}
        <div className="search-block">
          <input
            className="search-input"
            placeholder="Type a card name…"
            value={query}
            onChange={handleQueryChange}
            autoFocus
          />
          {loadingSearch && <div className="searching">Searching…</div>}
          {results.length > 0 && (
            <div className="search-results">
              {results.map(card => (
                <div
                  key={card.id}
                  className="result-row"
                  onClick={() => selectName(card)}
                >
                  <span className="result-name">{card.name}</span>
                  <span className="result-set">{card.type_line}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Step 2: version picker ── */}
        {selectedName && (
          <div className="version-picker">
            <div className="version-picker-title">
              Select printing of <strong>{selectedName}</strong>
            </div>
            {loadingPrints && <div className="searching">Loading printings…</div>}
            {!loadingPrints && printings.length === 0 && (
              <div className="searching">No printings found.</div>
            )}
            <div className="printings-grid">
              {printings.map(card => {
                const img = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
                const price = card.prices?.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : '—';
                const isSelected = selectedCard?.id === card.id;
                return (
                  <div
                    key={card.id}
                    className={`printing-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => selectPrinting(card)}
                  >
                    {img && <img src={img} alt={card.name} loading="lazy" />}
                    <div className="printing-info">
                      <span className="printing-set">{card.set_name}</span>
                      <span className="printing-num">#{card.collector_number}</span>
                      <span className="printing-price">{price}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Step 3: add form ── */}
        {selectedCard && (
          <div className="add-form">
            <div className="selected-name">
              <strong>{selectedCard.name}</strong>
              &nbsp;— {selectedCard.set_name} #{selectedCard.collector_number}
              {selectedCard.prices?.usd && (
                <span className="selected-price">&nbsp;· ${parseFloat(selectedCard.prices.usd).toFixed(2)}</span>
              )}
            </div>

            <div className="form-row">
              <label>Quantity
                <input type="number" min="1" max="99" value={qty}
                  onChange={e => setQty(parseInt(e.target.value) || 1)} />
              </label>
              <label className="foil-toggle">
                <input type="checkbox" checked={foil} onChange={e => setFoil(e.target.checked)} />
                Foil
              </label>
            </div>

            <label>Decks <span className="label-hint">(select multiple)</span></label>
            <div className="multi-select-list">
              {decks.map(d => (
                <label key={d} className="multi-select-item">
                  <input type="checkbox" checked={selDecks.includes(d)}
                    onChange={() => toggleDeck(d)} />
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

            <label>Groups <span className="label-hint">(select multiple)</span></label>
            <div className="multi-select-list">
              {(groups || []).map(g => (
                <label key={g} className="multi-select-item">
                  <input type="checkbox" checked={selGroups.includes(g)}
                    onChange={() => toggleGroup(g)} />
                  {g}
                </label>
              ))}
            </div>

            <button className="btn-primary btn-add" onClick={addCard}>
              Add to Collection
            </button>
          </div>
        )}
      </div>

      <div className="add-right">
        {previewImg
          ? <img className="preview-img" src={previewImg} alt={selectedCard?.name} />
          : <div className="preview-placeholder">
              <span>Select a printing<br />to preview</span>
            </div>
        }
      </div>
    </div>
  );
}