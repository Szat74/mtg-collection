import React, { useState } from 'react';

const API = '/api';

const EXAMPLE = `4 Lightning Bolt
2 foil Black Lotus
1 Counterspell | Control Deck
3 Llanowar Elves (LEA) 184
2 foil Thoughtseize (LRW) 145 | Midrange`;

export default function ImportView({ decks, refresh, showToast, setView }) {
  const [text, setText] = useState('');
  const [defaultDeck, setDefaultDeck] = useState('');  // deck id or '' or '__new__'
  const [newDeck, setNewDeck] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const runImport = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setResults(null);
    let deckId = null;
    if (defaultDeck === '__new__' && newDeck.trim()) {
      // Create the deck first, then use its id
      try {
        const dr = await fetch(`${API}/decks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newDeck.trim() }),
        });
        if (dr.ok) { const d = await dr.json(); deckId = d.id; refresh(); }
      } catch {}
    } else if (defaultDeck && defaultDeck !== '__new__') {
      deckId = parseInt(defaultDeck, 10);
    }
    try {
      const res = await fetch(`${API}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, deck_id: deckId }),
      });
      const data = await res.json();
      setResults(data);
      refresh();
      if (data.added.length > 0) showToast(`Imported ${data.added.length} card(s)`);
    } catch {
      showToast('Import failed', 'error');
    }
    setLoading(false);
  };

  return (
    <div className="import-view">
      <h2 className="section-title">Bulk Import</h2>
      <p className="import-hint">
        One card per line. Supported formats:<br />
        <code>Card Name</code> &nbsp;|&nbsp;
        <code>4 Card Name</code> &nbsp;|&nbsp;
        <code>2 foil Card Name</code> &nbsp;|&nbsp;
        <code>1 Card Name (SET) 000</code> &nbsp;|&nbsp;
        <code>1 Card Name | Deck Name</code>
      </p>

      <div className="import-body">
        <div className="import-left">
          <textarea
            className="import-textarea"
            placeholder={EXAMPLE}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={16}
          />
          <div className="import-opts">
            <label>Default Deck (optional)
              <select value={defaultDeck} onChange={e => setDefaultDeck(e.target.value)}>
                <option value="">— none —</option>
                {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                <option value="__new__">+ New deck…</option>
              </select>
            </label>
            {defaultDeck === '__new__' && (
              <input placeholder="Deck name" value={newDeck} onChange={e => setNewDeck(e.target.value)} />
            )}
            <button className="btn-primary" onClick={runImport} disabled={loading || !text.trim()}>
              {loading ? 'Importing…' : `Import ${text.trim().split('\n').filter(Boolean).length} lines`}
            </button>
          </div>
        </div>

        <div className="import-right">
          {results && (
            <div className="import-results">
              <div className="result-section success">
                <h3>✓ Added ({results.added.length})</h3>
                <ul>{results.added.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
              {results.failed.length > 0 && (
                <div className="result-section errors">
                  <h3>✕ Failed ({results.failed.length})</h3>
                  <ul>{results.failed.map((f, i) => (
                    <li key={i}><span className="fail-line">{f.line}</span><span className="fail-err">{f.error}</span></li>
                  ))}</ul>
                </div>
              )}
            </div>
          )}
          {!results && (
            <div className="import-preview-hint">
              <p>Fuzzy name matching — "lightning bolt" works fine.</p>
              <p>Pinpoint a printing with <code>(SET) collector_number</code> — e.g. <code>Lightning Bolt (M11) 149</code>.</p>
              <p>Deck can be set per-line with <code>| Deck Name</code> or globally via the dropdown.</p>
              <p>Foil prefix: <code>foil Card Name</code></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}