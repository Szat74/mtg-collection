import React, { useState, useRef } from 'react';
import LocationSelect from './LocationSelect';

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
  const [qty, setQty]               = useState(1);
  const [finish, setFinish]         = useState('normal'); // 'normal' | 'foil' | 'etched'
  const [selDeckId, setSelDeckId]   = useState('');
  const [selGroupIds, setSelGroupIds] = useState(new Set());
  const [groupSearch, setGroupSearch] = useState('');

  const debounce = useRef(null);

  // Detect "SET #NUM" or "SET NUM" pattern, e.g. "MH3 42" or "ONE #115"
  const parseSetNum = (q) => {
    const m = q.trim().match(/^([a-zA-Z0-9]{2,6})\s+#?(\d+[a-zA-Z]?)$/);
    return m ? { set: m[1], num: m[2] } : null;
  };

  // ── Direct set+number lookup ───────────────────────────────────────────────
  const searchBySetNum = async (set, num) => {
    setLoadingSearch(true);
    setResults([]);
    try {
      const res = await fetch(`${API}/scryfall/card/${encodeURIComponent(set)}/${encodeURIComponent(num)}`);
      if (res.ok) {
        const card = await res.json();
        // Go straight to the add form with this exact printing selected
        setSelectedName(card.name);
        setPrintings([card]);
        selectCard(card);
      } else {
        showToast(`No card found for ${set.toUpperCase()} #${num}`, 'error');
      }
    } catch { showToast('Set/number lookup failed', 'error'); }
    setLoadingSearch(false);
  };

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
    const parsed = parseSetNum(v);
    if (parsed) {
      debounce.current = setTimeout(() => searchBySetNum(parsed.set, parsed.num), 400);
    } else {
      debounce.current = setTimeout(() => searchByName(v), 400);
    }
  };

  const selectCard = (card) => {
    setSelectedCard(card);
    const finishes = card.finishes || [];
    if (finishes.length && finishes.every(f => f === 'etched')) {
      setFinish('etched');
    } else if (!card.prices?.usd && card.prices?.usd_etched && !card.prices?.usd_foil) {
      setFinish('etched');
    } else if (!card.prices?.usd && card.prices?.usd_foil) {
      setFinish('foil');
    } else {
      setFinish('normal');
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

  const toggleGroup = (gId) =>
    setSelGroupIds(prev => {
      const next = new Set(prev);
      next.has(gId) ? next.delete(gId) : next.add(gId);
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
      refresh(); // so the groups list updates
      setSelGroupIds(prev => new Set([...prev, g.id]));
      setGroupSearch('');
    }
  };

  // ── Add to collection ──────────────────────────────────────────────────────
  const addCard = async () => {
    if (!selectedCard) return;

    const res = await fetch(`${API}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scryfall_card: selectedCard,
        quantity: qty,
        foil: finish === 'foil',
        etched: finish === 'etched',
        deck_id: selDeckId ? parseInt(selDeckId, 10) : null,
        groups: [...selGroupIds],
      }),
    });

    if (res.ok) {
      const finishLabel = finish === 'foil' ? ' (foil)' : finish === 'etched' ? ' (etched)' : '';
      showToast(`Added ${selectedCard.name} ×${qty}${finishLabel}`);
      refresh();
      setQuery(''); setSelectedName(null); setSelectedCard(null); setPrintings([]);
      setQty(1); setFinish('normal'); setSelDeckId(''); setSelGroupIds(new Set()); setGroupSearch('');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'Failed to add card', 'error');
    }
  };

  const previewImg = selectedCard
    ? (selectedCard.image_uris?.normal ?? selectedCard.card_faces?.[0]?.image_uris?.normal)
    : null;

  const printingLabel = (card) => {
    const set      = card.set_name || card.set || '?';
    const code     = (card.set || '???').toUpperCase();
    const num      = card.collector_number ? `#${card.collector_number}` : '';
    const rawPrice = finish === 'etched'
      ? (card.prices?.usd_etched ?? card.prices?.usd_foil ?? card.prices?.usd)
      : finish === 'foil'
        ? (card.prices?.usd_foil ?? card.prices?.usd_etched ?? card.prices?.usd)
        : (card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched);
    const priceStr = rawPrice ? ` · $${parseFloat(rawPrice).toFixed(2)}` : '';
    const foilHint = (!card.prices?.usd && (card.prices?.usd_foil || card.prices?.usd_etched)) ? ' ✦' : '';
    return `${set} (${code}) ${num}${priceStr}${foilHint}`;
  };

  return (
    <div className="add-view">
      <style>{`
        .av-finish-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .av-finish-label { font-size: 13px; color: var(--text-dim); white-space: nowrap; }
        .av-finish-toggle { display: flex; gap: 6px; }
        .av-finish-btn {
          padding: 5px 12px; font-size: 13px; font-family: var(--font-body);
          background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
          border-radius: var(--radius); cursor: pointer; transition: all 0.15s;
        }
        .av-finish-btn:hover { border-color: var(--accent); color: var(--text); }
        .av-finish-btn--active { background: rgba(123,79,200,0.18); border-color: var(--accent); color: var(--accent); font-weight: 600; }
        .av-finish-btn--etched.av-finish-btn--active { background: rgba(200,160,0,0.15); border-color: #c8a000; color: #c8a000; }
      `}</style>
      <div className="add-left">
        <h2 className="section-title">Add a Card</h2>

        {/* ── Name search ── */}
        <div className="search-block">
          <input
            className="search-input"
            placeholder="Card name  or  SET #number (e.g. MH3 42)"
            value={query}
            onChange={handleQueryChange}
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
            </div>
            <div className="av-finish-row">
              <span className="av-finish-label">Finish</span>
              <div className="av-finish-toggle">
                <button type="button" className={`av-finish-btn${finish === 'normal' ? ' av-finish-btn--active' : ''}`} onClick={() => setFinish('normal')}>Normal</button>
                <button type="button" className={`av-finish-btn${finish === 'foil' ? ' av-finish-btn--active' : ''}`} onClick={() => setFinish('foil')}>✦ Foil</button>
                {!!(selectedCard?.prices?.usd_etched || selectedCard?.etched_only) && (
                  <button type="button" className={`av-finish-btn${finish === 'etched' ? ' av-finish-btn--active av-finish-btn--etched' : ''}`} onClick={() => setFinish('etched')}>⬡ Etched</button>
                )}
              </div>
            </div>

            <label>Location</label>
            <LocationSelect
              decks={decks.filter(d => {
                if (d.format !== 'commander' || !d.commander_id || !d.colors?.length) return true;
                const cardIdentity = selectedCard?.color_identity || [];
                if (!cardIdentity.length) return true;
                return cardIdentity.every(c => d.colors.includes(c));
              }).map(d => ({
                ...d,
                name: d.format === 'commander' && !d.commander_id ? `${d.name} ⚠` : d.name,
              }))}
              value={selDeckId}
              onChange={setSelDeckId}
            />

            <label>Groups</label>
            {selGroupIds.size > 0 && (
              <div className="group-selected-list">
                {(groups || []).filter(g => selGroupIds.has(g.id)).map(g => (
                  <label key={g.id} className="multi-select-item">
                    <input type="checkbox" checked onChange={() => toggleGroup(g.id)} />
                    {g.name}
                  </label>
                ))}
              </div>
            )}
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
                    else if (q) createGroupByName(q);
                  }
                  if (e.key === 'Escape') setGroupSearch('');
                }}
              />
              {groupSearch.trim() && (
                <div className="group-dropdown">
                  {(groups || [])
                    .filter(g => !selGroupIds.has(g.id) && g.name.toLowerCase().includes(groupSearch.toLowerCase()))
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