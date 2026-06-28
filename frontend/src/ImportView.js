import React, { useState } from 'react';
import LocationSelect from './LocationSelect';

const API = '/api';

const EXAMPLE = `4 Lightning Bolt
2 foil Black Lotus
1 Counterspell | Control Deck
3 Llanowar Elves (LEA) 184
2 foil Thoughtseize (LRW) 145 | Midrange
MH3 42
2 foil ONE 115`;

export default function ImportView({ decks, refresh, showToast, setView }) {
  const [text, setText] = useState('');
  const [defaultDeck, setDefaultDeck] = useState('');  // deck id or '' or '__new__'
  const [newDeck, setNewDeck] = useState('');
  const [newLocationType, setNewLocationType] = useState('deck');  // 'deck' or 'binder'
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
          body: JSON.stringify({ name: newDeck.trim(), type: newLocationType }),
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
        <code>1 Card Name | Deck Name</code><br />
        <code>SET 000</code> &nbsp;|&nbsp;
        <code>2 foil SET 000</code> &nbsp;— set + collector # only, no name needed
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
            <label>Default Location (optional)</label>
            <LocationSelect
              decks={decks}
              value={defaultDeck}
              onChange={setDefaultDeck}
              placeholder="— none —"
              extraOptions={[{ value: '__new__', label: '+ New location…', isAction: true }]}
            />
            {defaultDeck === '__new__' && (
              <div className="iv-new-location">
                <div className="iv-type-toggle">
                  <button
                    type="button"
                    className={`iv-type-btn${newLocationType === 'deck' ? ' iv-type-btn--active' : ''}`}
                    onClick={() => setNewLocationType('deck')}
                  >Deck</button>
                  <button
                    type="button"
                    className={`iv-type-btn${newLocationType === 'binder' ? ' iv-type-btn--active' : ''}`}
                    onClick={() => setNewLocationType('binder')}
                  >📒 Binder</button>
                </div>
                <input
                  className="iv-name-input"
                  placeholder={newLocationType === 'binder' ? 'Binder name' : 'Deck name'}
                  value={newDeck}
                  onChange={e => setNewDeck(e.target.value)}
                />
              </div>
            )}
            <style>{`
              .iv-new-location { display: flex; flex-direction: column; gap: 6px; }
              .iv-type-toggle {
                display: flex; gap: 6px;
              }
              .iv-type-btn {
                flex: 1; padding: 6px 0; font-size: 13px; font-family: var(--font-body);
                background: var(--bg3); border: 1px solid var(--border); color: var(--text-dim);
                border-radius: var(--radius); cursor: pointer; transition: all 0.15s;
              }
              .iv-type-btn:hover { border-color: var(--accent); color: var(--text); }
              .iv-type-btn--active {
                background: rgba(123,79,200,0.18); border-color: var(--accent); color: var(--accent); font-weight: 600;
              }
              .iv-name-input {
                width: 100%; box-sizing: border-box;
                background: var(--bg3); border: 1px solid var(--border); color: var(--text);
                font-size: 13px; font-family: var(--font-body);
                padding: 7px 10px; border-radius: var(--radius); outline: none;
              }
              .iv-name-input:focus { border-color: var(--accent); }
            `}</style>
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