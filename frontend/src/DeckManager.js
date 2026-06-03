import React, { useState, useEffect, useRef } from 'react';

const API = '/api';

const COLOR_PIP = {
  W: { bg: '#f9faf4', border: '#c8b96a', color: '#6b6340', label: 'White' },
  U: { bg: '#0e68ab', border: '#0a4f82', color: '#fff',    label: 'Blue'  },
  B: { bg: '#1a1a1a', border: '#444',    color: '#ccc',    label: 'Black' },
  R: { bg: '#d3202a', border: '#a01820', color: '#fff',    label: 'Red'   },
  G: { bg: '#00733e', border: '#005530', color: '#fff',    label: 'Green' },
};

function ColorPips({ colors }) {
  if (!colors || colors.length === 0) return <span className="dm-colorless">◇</span>;
  return (
    <span className="dm-pips">
      {['W','U','B','R','G'].filter(c => colors.includes(c)).map(c => {
        const pip = COLOR_PIP[c];
        return (
          <span key={c} className="dm-pip" title={pip.label}
            style={{ background: pip.bg, border: `1px solid ${pip.border}`, color: pip.color }}>
            {c}
          </span>
        );
      })}
    </span>
  );
}

function DeckRow({ deck, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal]   = useState(deck.name);
  const inputRef                = useRef(null);

  useEffect(() => { if (renaming) inputRef.current?.focus(); }, [renaming]);

  // Keep nameVal in sync if deck.name changes externally
  useEffect(() => { setNameVal(deck.name); }, [deck.name]);

  const commitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== deck.name) onRename(deck.name, trimmed);
    setRenaming(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter')  commitRename();
    if (e.key === 'Escape') { setNameVal(deck.name); setRenaming(false); }
  };

  return (
    <div className="dm-deck-row">
      <div className="dm-deck-left">
        {renaming ? (
          <input ref={inputRef} className="dm-rename-input"
            value={nameVal} onChange={e => setNameVal(e.target.value)}
            onBlur={commitRename} onKeyDown={handleKey} />
        ) : (
          <span className="dm-deck-name">{deck.name}</span>
        )}
        <ColorPips colors={deck.colors} />
      </div>
      <div className="dm-deck-right">
        <span className="dm-card-count">{deck.cardCount} cards</span>
        {renaming ? (
          <button className="dm-btn dm-btn-save" onClick={commitRename}>✓</button>
        ) : (
          <button className="dm-btn dm-btn-ghost" onClick={() => setRenaming(true)} title="Rename">✎</button>
        )}
        <button className="dm-btn dm-btn-danger" onClick={() => onDelete(deck.name)}
          title="Delete deck (cards stay)">✕</button>
      </div>
    </div>
  );
}

export function DeckManager({ onDecksChanged }) {
  const [open, setOpen]       = useState(false);
  const [decks, setDecks]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast]     = useState(null);
  const newInputRef           = useRef(null);

  useEffect(() => { if (open) loadDecks(); }, [open]);
  useEffect(() => { if (creating) newInputRef.current?.focus(); }, [creating]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const loadDecks = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/decks`);
      const data = await res.json();
      // data is [{ name, cardCount, colors }]
      setDecks(data);
    } catch {
      setDecks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API}/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to create deck');
        return;
      }
      setNewName('');
      setCreating(false);
      await loadDecks();
      onDecksChanged?.();
      showToast(`Deck "${name}" created`);
    } catch {
      showToast('Failed to create deck');
    }
  };

  const handleRename = async (oldName, newNameVal) => {
    try {
      const res = await fetch(`${API}/decks/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newNameVal }),
      });
      if (!res.ok) { showToast('Rename failed'); return; }
      await loadDecks();
      onDecksChanged?.();
      showToast(`Renamed to "${newNameVal}"`);
    } catch {
      showToast('Rename failed');
    }
  };

  const handleDelete = async (name) => {
    if (!window.confirm(`Delete deck "${name}"? Cards will be unassigned but not removed.`)) return;
    try {
      await fetch(`${API}/decks/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await loadDecks();
      onDecksChanged?.();
      showToast(`Deck "${name}" deleted`);
    } catch {
      showToast('Delete failed');
    }
  };

  return (
    <>
      <button className="dm-fab" onClick={() => setOpen(o => !o)}
        title="Deck Manager" aria-label="Open Deck Manager">
        <span className="dm-fab-icon">⬡</span>
        <span className="dm-fab-label">Decks</span>
      </button>

      {open && <div className="dm-backdrop" onClick={() => setOpen(false)} />}

      {open && (
        <div className="dm-modal" role="dialog" aria-modal="true">
          <div className="dm-header">
            <h2 className="dm-title">Deck Manager</h2>
            <button className="dm-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="dm-body">
            {loading ? (
              <div className="dm-empty">Loading decks…</div>
            ) : decks.length === 0 ? (
              <div className="dm-empty">No decks yet. Create one below.</div>
            ) : (
              <div className="dm-list">
                {decks.map(deck => (
                  <DeckRow key={deck.name} deck={deck}
                    onRename={handleRename} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>

          <div className="dm-footer">
            {creating ? (
              <div className="dm-create-row">
                <input ref={newInputRef} className="dm-create-input"
                  placeholder="New deck name…" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                  }} />
                <button className="dm-btn dm-btn-save" onClick={handleCreate}
                  disabled={!newName.trim()}>Create</button>
                <button className="dm-btn dm-btn-ghost"
                  onClick={() => { setCreating(false); setNewName(''); }}>Cancel</button>
              </div>
            ) : (
              <button className="dm-btn dm-btn-primary" onClick={() => setCreating(true)}>
                + New Deck
              </button>
            )}
          </div>

          {toast && <div className="dm-toast">{toast}</div>}
        </div>
      )}

      <style>{`
        .dm-fab {
          position: fixed; bottom: 24px; right: 24px; z-index: 900;
          display: flex; align-items: center; gap: 7px;
          padding: 10px 18px 10px 14px;
          background: #1a1a2e; border: 1px solid #3a3a5c; border-radius: 28px;
          color: #c8b06a; font-family: 'Georgia', serif; font-size: 14px;
          font-weight: 600; letter-spacing: 0.04em; cursor: pointer;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(200,176,106,0.15);
          transition: background 0.18s, box-shadow 0.18s, transform 0.12s;
        }
        .dm-fab:hover {
          background: #22223a;
          box-shadow: 0 6px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(200,176,106,0.35);
          transform: translateY(-1px);
        }
        .dm-fab-icon { font-size: 17px; line-height: 1; }
        .dm-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55);
          z-index: 950; animation: dm-fade-in 0.15s ease;
        }
        .dm-modal {
          position: fixed; bottom: 78px; right: 24px; z-index: 1000;
          width: 400px; max-width: calc(100vw - 32px); max-height: 70vh;
          display: flex; flex-direction: column;
          background: #12121e; border: 1px solid #2e2e4a; border-radius: 14px;
          box-shadow: 0 16px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,176,106,0.1);
          overflow: hidden; animation: dm-slide-up 0.2s cubic-bezier(0.22,1,0.36,1);
          font-family: 'Georgia', serif;
        }
        .dm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 20px 14px; border-bottom: 1px solid #2a2a40;
          background: #0e0e1a; flex-shrink: 0;
        }
        .dm-title {
          margin: 0; font-size: 16px; font-weight: 700; color: #c8b06a;
          letter-spacing: 0.06em; text-transform: uppercase;
        }
        .dm-close {
          background: none; border: none; color: #666; font-size: 15px;
          cursor: pointer; padding: 2px 6px; border-radius: 4px;
          transition: color 0.15s, background 0.15s;
        }
        .dm-close:hover { color: #ccc; background: #2a2a3a; }
        .dm-body {
          flex: 1; overflow-y: auto; padding: 10px 0;
          scrollbar-width: thin; scrollbar-color: #2e2e4a #0e0e1a;
        }
        .dm-empty {
          text-align: center; color: #555; font-size: 13px;
          padding: 28px 20px; font-style: italic;
        }
        .dm-list { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; }
        .dm-deck-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 9px 12px; border-radius: 8px; background: #1a1a2c;
          border: 1px solid transparent; transition: border-color 0.15s, background 0.15s;
        }
        .dm-deck-row:hover { background: #1e1e32; border-color: #2e2e4a; }
        .dm-deck-left {
          display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
        }
        .dm-deck-name {
          color: #ddd; font-size: 14px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;
        }
        .dm-deck-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .dm-card-count { font-size: 11px; color: #666; letter-spacing: 0.03em; white-space: nowrap; }
        .dm-pips { display: flex; gap: 3px; flex-shrink: 0; }
        .dm-pip {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; border-radius: 50%;
          font-size: 9px; font-weight: 800; font-family: sans-serif; flex-shrink: 0;
        }
        .dm-colorless { color: #555; font-size: 14px; }
        .dm-rename-input {
          background: #0e0e1a; border: 1px solid #4a4a6a; border-radius: 5px;
          color: #ddd; font-size: 13px; font-family: 'Georgia', serif;
          padding: 3px 8px; width: 140px; outline: none;
        }
        .dm-rename-input:focus { border-color: #c8b06a; }
        .dm-footer {
          padding: 12px 16px; border-top: 1px solid #2a2a40;
          background: #0e0e1a; flex-shrink: 0;
        }
        .dm-create-row { display: flex; gap: 7px; align-items: center; }
        .dm-create-input {
          flex: 1; background: #1a1a2c; border: 1px solid #3a3a5c; border-radius: 6px;
          color: #ddd; font-size: 13px; font-family: 'Georgia', serif;
          padding: 6px 10px; outline: none; transition: border-color 0.15s;
        }
        .dm-create-input:focus { border-color: #c8b06a; }
        .dm-btn {
          border: none; border-radius: 6px; font-size: 12px;
          font-family: 'Georgia', serif; font-weight: 600; padding: 5px 11px;
          cursor: pointer; transition: background 0.15s, opacity 0.15s; white-space: nowrap;
        }
        .dm-btn:disabled { opacity: 0.4; cursor: default; }
        .dm-btn-primary {
          background: #c8b06a; color: #0e0e1a; width: 100%;
          padding: 8px; font-size: 13px; letter-spacing: 0.04em;
        }
        .dm-btn-primary:hover:not(:disabled) { background: #d4be7a; }
        .dm-btn-save { background: #2a6e3f; color: #9fe8b0; }
        .dm-btn-save:hover:not(:disabled) { background: #347a4a; }
        .dm-btn-ghost { background: #2a2a40; color: #aaa; }
        .dm-btn-ghost:hover { background: #33334a; color: #ddd; }
        .dm-btn-danger { background: #3a1a1a; color: #e07070; }
        .dm-btn-danger:hover { background: #4a2020; color: #f08080; }
        .dm-toast {
          position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
          background: #1e2e1e; border: 1px solid #2e4e2e; color: #8ec88e;
          font-size: 12px; padding: 6px 16px; border-radius: 20px;
          white-space: nowrap; pointer-events: none;
          animation: dm-toast-pop 2.5s ease forwards;
        }
        @keyframes dm-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes dm-slide-up {
          from { opacity: 0; transform: translateY(16px) scale(0.97) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes dm-toast-pop {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px) }
          15%  { opacity: 1; transform: translateX(-50%) translateY(0) }
          75%  { opacity: 1 }
          100% { opacity: 0 }
        }
      `}</style>
    </>
  );
}