import React, { useState, useRef } from 'react';

const API = '/api';

export default function AddCardView({ decks, groups, refresh, showToast, setView }) {
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingPrints, setLoadingPrints] = useState(false);

  const [selectedName, setSelectedName] = useState(null);
  const [printings, setPrintings]       = useState([]);
  const [selectedCard, setSelectedCard] = useState(null);

  // Add-form state
  const [qty, setQty]             = useState(1);
  const [foil, setFoil]           = useState(false);
  const [selDecks, setSelDecks]   = useState([]);
  const [newDeck, setNewDeck]     = useState('');
  const [selGroups, setSelGroups] = useState([]);
  const [newGroup, setNewGroup]   = useState('');

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

  // Auto-enable foil for foil-only printings
  const selectCard = (card) => {
    setSelectedCard(card);
    if (!card.prices?.usd && (card.prices?.usd_foil || card.prices?.usd_etched)) {
      setFoil(true);
    }
  };

  // ── Step 2: load all printings for chosen name ─────────────────────────────
  const selectName = async (card) => {
    setSelectedName(card.name);
    setResults([]);
    setQuery(card.name);
    setSelectedCard(null);
    setLoadingPrints(true);
    try {
      const res    = await fetch(`${API}/printings/${encodeURIComponent(card.name)}`);
      const data   = await res.json();
      const prints = data.data || [];
      setPrintings(prints);
      // Auto-select first printing
      if (prints.length > 0) selectCard(prints[0]);
    } catch { setPrintings([]); showToast('Could not load printings', 'error'); }
    setLoadingPrints(false);
  };

  // ── Deck / group helpers ───────────────────────────────────────────────────
  const toggleDeck  = (d) => setSelDecks(prev  => prev.includes(d)  ? prev.filter(x => x !== d)  : [...prev, d]);
  const toggleGroup = (g) => setSelGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  // ── Add to collection ──────────────────────────────────────────────────────
  const addCard = async () => {
    if (!selectedCard) return;
    const finalDecks = newDeck.trim()
      ? [...new Set([...selDecks, newDeck.trim()])]
      : selDecks;
    const finalGroups = newGroup.trim()
      ? [...new Set([...selGroups, newGroup.trim()])]
      : selGroups;
    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scryfall_card: selectedCard,
        quantity: qty,
        foil,
        decks: finalDecks,
        groups: finalGroups,
      }),
    });

    if (res.ok) {
      showToast(`Added ${selectedCard.name} ×${qty}${foil ? ' (foil)' : ''}`);
      refresh();
      setQuery(''); setSelectedName(null); setSelectedCard(null); setPrintings([]);
      setQty(1); setFoil(false); setSelDecks([]); setNewDeck(''); setSelGroups([]);
    } else {
      showToast('Failed to add card', 'error');
    }
  };

  const previewImg = selectedCard
    ? (selectedCard.image_uris?.normal ?? selectedCard.card_faces?.[0]?.image_uris?.normal)
    : null;

  // Build dropdown label for a printing — uses foil price when foil is checked
	const printingLabel = (card) => {
	  const set      = card.set_name || card.set || '?';
	  const code     = (card.set || '???').toUpperCase();
	  const num      = card.collector_number ? `#${card.collector_number}` : '';
	  const rawPrice = foil
		? (card.prices?.usd_foil ?? card.prices?.usd_etched ?? card.prices?.usd)
		: (card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched);
	  const priceStr = rawPrice ? ` · $${parseFloat(rawPrice).toFixed(2)}` : '';
	  // Hint the user if this printing is foil-only
	  const foilHint = (!card.prices?.usd && (card.prices?.usd_foil || card.prices?.usd_etched)) ? ' ✦' : '';
	  return `${set} (${code}) ${num}${priceStr}${foilHint}`;
	};

  return (
    <div className="add-view">
      <div className="add-left">
        <h2 className="section-title">Add a Card</h2>

        {/* ── Name search ── */}
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

        {/* ── Add form (shown once a name is selected) ── */}
        {selectedName && (
          <div className="add-form">
            <div className="selected-name">
              Selected: <strong>{selectedName}</strong>
            </div>

            {/* Set / version dropdown */}
            <label>Set
              {loadingPrints
                ? <div className="searching">Loading printings…</div>
                : (
                  <select
                    value={selectedCard?.id || ''}
                    onChange={e => {
                      const card = printings.find(p => p.id === e.target.value);
                      if (card) selectCard(card);
                    }}
                  >
                    {printings.map(card => (
                      <option key={card.id} value={card.id}>
                        {printingLabel(card)}
                      </option>
                    ))}
                  </select>
                )
              }
            </label>

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

            <label>Groups <span className="label-hint">(select multiple)</span></label>
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

            <button className="btn-primary btn-add" onClick={addCard}>
              Add to Collection
            </button>
          </div>
        )}
      </div>

      {/* ── Right panel: card image ── */}
      <div className="add-right">
        {previewImg
          ? <img className="preview-img" src={previewImg} alt={selectedCard?.name} />
          : <div className="preview-placeholder">
              <span>Select a card<br />to preview</span>
            </div>
        }
      </div>
    </div>
  );
}