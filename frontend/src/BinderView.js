import React, { useState, useEffect, useRef } from 'react';

const API = '/api';

const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e' };

// ── Card tile ─────────────────────────────────────────────────────────────────
function BinderCardTile({ card }) {
  const isFoil   = !!card.foil;
  const imgSrc   = card.image_uri ?? card.image_back ?? null;
  const rawPrice = isFoil
    ? (card.prices_usd_foil ?? card.prices_usd_etched ?? card.prices_usd)
    : (card.prices_usd ?? card.prices_usd_foil ?? card.prices_usd_etched);
  const price = rawPrice != null ? `$${parseFloat(rawPrice).toFixed(2)}` : null;

  return (
    <div className={`card-tile dv-card-tile ${isFoil ? 'foil' : ''}`}>
      <div className="card-img-wrap">
        {imgSrc
          ? <img src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-no-img">{card.name}</div>
        }
        {isFoil && <span className="foil-badge">✦ Foil</span>}
        {price && <span className="price-overlay">{price}</span>}
        {card.quantity > 1 && <span className="dv-qty-badge">×{card.quantity}</span>}
      </div>
      <div className="card-info">
        <div className="card-name">{card.name}</div>
        <div className="card-meta">
          <span className="rarity-dot" style={{ background: RARITY_COLOR[card.rarity] || '#888' }} />
          <span>{card.set_code?.toUpperCase()}{card.collector_number ? ` #${card.collector_number}` : ''}</span>
        </div>
        <div className="card-sub" style={{ fontSize: 10 }}>{card.type_line}</div>
      </div>
    </div>
  );
}

// ── Binder row (inside modal) ─────────────────────────────────────────────────
function BinderRow({ binder, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(binder.name);
  const [descVal, setDescVal] = useState(binder.description || '');
  const inputRef              = useRef(null);

  useEffect(() => {
    setNameVal(binder.name);
    setDescVal(binder.description || '');
  }, [binder]);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commitEdit = () => {
    const trimmed = nameVal.trim();
    if (!trimmed) return;
    onSave(binder.id, { name: trimmed, description: descVal.trim() || null });
    setEditing(false);
  };

  const cancelEdit = () => {
    setNameVal(binder.name);
    setDescVal(binder.description || '');
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="bm-row bm-row--editing">
        <div className="bm-edit-fields">
          <input ref={inputRef} className="bm-input" value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') cancelEdit(); }}
            placeholder="Binder name" />
          <textarea className="bm-textarea" placeholder="Description (optional)"
            value={descVal} onChange={e => setDescVal(e.target.value)} rows={2} />
        </div>
        <div className="bm-row-right">
          <button className="bm-btn bm-btn-save" onClick={commitEdit}>✓ Save</button>
          <button className="bm-btn bm-btn-ghost" onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bm-row">
      <div className="bm-row-left">
        <div className="bm-row-main">
          <span className="bm-row-icon">📒</span>
          <span className="bm-row-name">{binder.name}</span>
        </div>
        {binder.description && (
          <span className="bm-row-desc">{binder.description}</span>
        )}
      </div>
      <div className="bm-row-right">
        <span className="bm-card-count">{binder.cardCount} cards</span>
        <button className="bm-btn bm-btn-ghost" onClick={() => setEditing(true)} title="Edit binder">✎</button>
        <button className="bm-btn bm-btn-danger" onClick={() => onDelete(binder)} title="Delete binder (cards stay)">✕</button>
      </div>
    </div>
  );
}

// ── Binder Manager modal ──────────────────────────────────────────────────────
function BinderManager({ onBindersChanged }) {
  const [open, setOpen]         = useState(false);
  const [binders, setBinders]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [toast, setToast]       = useState(null);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const newInputRef           = useRef(null);

  useEffect(() => { if (open) loadBinders(); }, [open]);
  useEffect(() => { if (creating) newInputRef.current?.focus(); }, [creating]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const loadBinders = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/decks`);
      const data = await res.json();
      setBinders(data.filter(d => d.type === 'binder'));
    } catch { setBinders([]); }
    finally { setLoading(false); }
  };

  const resetNewForm = () => { setNewName(''); setNewDesc(''); setCreating(false); };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API}/decks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: newDesc.trim() || null, type: 'binder' }),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Failed to create binder');
        return;
      }
      resetNewForm();
      await loadBinders();
      onBindersChanged?.();
      showToast(`Binder "${name}" created`);
    } catch { showToast('Failed to create binder'); }
  };

  const handleSave = async (id, fields) => {
    try {
      const res = await fetch(`${API}/decks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Save failed');
        return;
      }
      await loadBinders();
      onBindersChanged?.();
      showToast(fields.name ? `Saved "${fields.name}"` : 'Saved');
    } catch { showToast('Save failed'); }
  };

  const handleDelete = async (binder) => {
    if (!window.confirm(`Delete binder "${binder.name}"? Cards will be unassigned but not removed.`)) return;
    try {
      await fetch(`${API}/decks/${binder.id}`, { method: 'DELETE' });
      await loadBinders();
      onBindersChanged?.();
      showToast(`Binder "${binder.name}" deleted`);
    } catch { showToast('Delete failed'); }
  };

  return (
    <>
      <button className="bm-fab" onClick={() => setOpen(o => !o)} title="Binder Manager" aria-label="Open Binder Manager">
        <span className="bm-fab-icon">📒</span>
        <span className="bm-fab-label">Binders</span>
      </button>

      {open && <div className="bm-backdrop" onClick={() => setOpen(false)} />}

      {open && (
        <div className="bm-modal" role="dialog" aria-modal="true">
          <div className="bm-header">
            <h2 className="bm-title">Binder Manager</h2>
            <button className="bm-close" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="bm-body">
            {loading ? (
              <div className="bm-empty">Loading binders…</div>
            ) : binders.length === 0 ? (
              <div className="bm-empty">No binders yet. Create one below.</div>
            ) : (
              <div className="bm-list">
                {binders.map(binder => (
                  <BinderRow key={binder.id} binder={binder}
                    onSave={handleSave} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </div>

          <div className="bm-footer">
            {creating ? (
              <div className="bm-create-form">
                <input ref={newInputRef} className="bm-input"
                  placeholder="Binder name…" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newName.trim()) handleCreate();
                    if (e.key === 'Escape') resetNewForm();
                  }} />
                <textarea className="bm-textarea" placeholder="Description (optional)"
                  value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} />
                <div className="bm-create-actions">
                  <button className="bm-btn bm-btn-primary" onClick={handleCreate}
                    disabled={!newName.trim()}>Create Binder</button>
                  <button className="bm-btn bm-btn-ghost" onClick={resetNewForm}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="bm-btn bm-btn-primary bm-btn-full" onClick={() => setCreating(true)}>
                + New Binder
              </button>
            )}
          </div>

          {toast && <div className="bm-toast">{toast}</div>}
        </div>
      )}
    </>
  );
}

// ── Main BinderView ───────────────────────────────────────────────────────────
export default function BinderView({ binders, refresh, showToast }) {
  const [selectedId, setSelectedId] = useState(null);
  const [binderData, setBinderData] = useState(null);
  const [loading, setLoading]       = useState(false);

  const selectedBinder = binders.find(b => b.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) { setBinderData(null); return; }
    setLoading(true);
    fetch(`${API}/decks/${selectedId}/cards`)
      .then(r => r.json())
      .then(data => { setBinderData(data); setLoading(false); })
      .catch(() => { setBinderData(null); setLoading(false); });
  }, [selectedId, binders]);

  const totalCards = binderData?.summary?.total ?? 0;

  return (
    <div className={`dv-root${selectedId ? ' dv-has-selection' : ''}`}>
      {/* ── Sidebar ── */}
      <div className="dv-sidebar">
        <div className="dv-sidebar-header">
          <span className="dv-sidebar-title">Binders</span>
          <BinderManager onBindersChanged={refresh} />
        </div>
        <div className="dv-deck-list">
          {binders.length === 0 && (
            <div className="dv-empty">No binders yet. Create one with the Binders button.</div>
          )}
          {binders.map(binder => (
            <div
              key={binder.id}
              className={`dv-deck-item bm-deck-item ${binder.id === selectedId ? 'bm-selected' : ''}`}
              onClick={() => setSelectedId(binder.id)}
            >
              <div className="dv-deck-item-main">
                <span className="bm-sidebar-icon">📒</span>
                <span className="dv-deck-item-name">{binder.name}</span>
              </div>
              <div className="dv-deck-item-sub">
                {binder.description && (
                  <span className="bm-sidebar-desc">{binder.description}</span>
                )}
                <span className="dv-deck-item-count">{binder.cardCount} cards</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Detail panel ── */}
      <div className="dv-detail">
        {!selectedBinder ? (
          <div className="dv-empty-detail">
            <span>Select a binder to view its cards</span>
          </div>
        ) : (
          <>
            <button className="dv-back-btn" onClick={() => setSelectedId(null)}>← Back</button>

            <div className="dv-detail-header bm-detail-header">
              <div className="dv-detail-title-row">
                <span className="bm-detail-icon">📒</span>
                <h2 className="dv-detail-name bm-detail-name">{selectedBinder.name}</h2>
                <span className="bm-count-pill">{totalCards} {totalCards === 1 ? 'card' : 'cards'}</span>
              </div>
              {selectedBinder.description && (
                <p className="bm-detail-desc">{selectedBinder.description}</p>
              )}
            </div>

            {loading ? (
              <div className="dv-loading">Loading cards…</div>
            ) : !binderData ? (
              <div className="dv-loading" style={{ color: 'var(--danger)' }}>Could not load binder cards.</div>
            ) : binderData.cards.length === 0 ? (
              <div className="dv-empty-detail">No cards assigned to this binder yet.</div>
            ) : (
              <div className="card-grid dv-card-grid">
                {binderData.cards.map(card => (
                  <BinderCardTile key={card.ids[0]} card={card} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        /* ── FAB ─────────────────────────────────────────── */
        .bm-fab {
          position: fixed; bottom: 80px; right: 24px; z-index: 900;
          display: flex; align-items: center; gap: 7px;
          padding: 10px 18px 10px 14px;
          background: #0f1f12; border: 1px solid #2a4a2e; border-radius: 28px;
          color: var(--success); font-family: var(--font-body); font-size: 14px;
          font-weight: 600; letter-spacing: 0.04em; cursor: pointer;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(63,173,110,0.15);
          transition: background 0.18s, box-shadow 0.18s, transform 0.12s;
        }
        .bm-fab:hover {
          background: #152a18;
          box-shadow: 0 6px 28px rgba(0,0,0,0.6), 0 0 0 1px rgba(63,173,110,0.4);
          transform: translateY(-1px);
        }
        .bm-fab-icon { font-size: 16px; line-height: 1; }
        .bm-fab-label { line-height: 1; }

        /* ── Backdrop + Modal ────────────────────────────── */
        .bm-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55);
          z-index: 950; animation: bm-fade-in 0.15s ease;
        }
        .bm-modal {
          position: fixed; bottom: 134px; right: 24px; z-index: 1000;
          width: 400px; max-width: calc(100vw - 32px); max-height: 72vh;
          display: flex; flex-direction: column;
          background: #11181a; border: 1px solid #1e3828; border-radius: 14px;
          box-shadow: 0 16px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(63,173,110,0.12);
          overflow: hidden; animation: bm-slide-up 0.2s cubic-bezier(0.22,1,0.36,1);
          font-family: var(--font-body);
        }
        .bm-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 15px 20px 13px; border-bottom: 1px solid #1e3828;
          background: #0c1410; flex-shrink: 0;
        }
        .bm-title {
          margin: 0; font-size: 15px; font-weight: 700;
          font-family: var(--font-display); color: var(--success);
          letter-spacing: 0.08em; text-transform: uppercase;
        }
        .bm-close {
          background: none; border: none; color: #557a5e; font-size: 15px;
          cursor: pointer; padding: 2px 6px; border-radius: 4px;
          transition: color 0.15s, background 0.15s;
        }
        .bm-close:hover { color: var(--success); background: #1e3828; }

        /* ── Body + List ─────────────────────────────────── */
        .bm-body {
          flex: 1; overflow-y: auto; padding: 8px 0;
          scrollbar-width: thin; scrollbar-color: #1e3828 #0c1410;
        }
        .bm-empty {
          text-align: center; color: #557a5e; font-size: 13px;
          padding: 28px 20px; font-style: italic;
        }
        .bm-list { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; }

        /* ── Binder row ──────────────────────────────────── */
        .bm-row {
          display: flex; align-items: flex-start; justify-content: space-between;
          padding: 9px 12px; border-radius: 8px; background: #141e16;
          border: 1px solid transparent; transition: border-color 0.15s, background 0.15s;
          gap: 8px;
        }
        .bm-row:hover { background: #182212; border-color: #2a4a2e; }
        .bm-row--editing {
          flex-direction: column; align-items: stretch; gap: 10px;
          background: #111a13; border-color: #2a4a2e;
        }
        .bm-row-left { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
        .bm-row-main { display: flex; align-items: center; gap: 7px; }
        .bm-row-icon { font-size: 13px; flex-shrink: 0; }
        .bm-row-name {
          color: var(--text); font-size: 14px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
        }
        .bm-row-desc { font-size: 11px; color: #557a5e; font-style: italic; }
        .bm-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .bm-card-count { font-size: 11px; color: #557a5e; white-space: nowrap; }
        .bm-edit-fields { display: flex; flex-direction: column; gap: 8px; }

        /* ── Footer ──────────────────────────────────────── */
        .bm-footer {
          padding: 12px 16px; border-top: 1px solid #1e3828;
          background: #0c1410; flex-shrink: 0;
        }
        .bm-create-form { display: flex; flex-direction: column; gap: 8px; }
        .bm-create-actions { display: flex; gap: 7px; }

        /* ── Inputs ──────────────────────────────────────── */
        .bm-input, .bm-textarea {
          background: #0c1410; border: 1px solid #2a4a2e; border-radius: 6px;
          color: var(--text); font-size: 13px; font-family: var(--font-body);
          padding: 6px 10px; outline: none; transition: border-color 0.15s;
          width: 100%; box-sizing: border-box;
        }
        .bm-input:focus, .bm-textarea:focus { border-color: var(--success); }
        .bm-textarea { resize: vertical; min-height: 44px; }

        /* ── Buttons ─────────────────────────────────────── */
        .bm-btn {
          border: none; border-radius: 6px; font-size: 12px;
          font-family: var(--font-body); font-weight: 600; padding: 5px 11px;
          cursor: pointer; transition: background 0.15s, opacity 0.15s; white-space: nowrap;
        }
        .bm-btn:disabled { opacity: 0.4; cursor: default; }
        .bm-btn-primary {
          background: var(--success); color: #071008;
          font-size: 13px; letter-spacing: 0.04em;
        }
        .bm-btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
        .bm-btn-full { width: 100%; padding: 8px; }
        .bm-btn-save { background: #1d4a28; color: #7de8a0; }
        .bm-btn-save:hover:not(:disabled) { background: #245c32; }
        .bm-btn-ghost { background: #1a2a1c; color: #7aaa88; }
        .bm-btn-ghost:hover { background: #22362a; color: #b0d8b8; }
        .bm-btn-danger { background: #2e1010; color: #cc6666; }
        .bm-btn-danger:hover { background: #3c1818; color: #e08080; }

        /* ── Toast ───────────────────────────────────────── */
        .bm-toast {
          position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
          background: #112518; border: 1px solid #2a5030; color: var(--success);
          font-size: 12px; padding: 6px 16px; border-radius: 20px;
          white-space: nowrap; pointer-events: none;
          animation: bm-toast-pop 2.5s ease forwards;
        }

        /* ── Animations ──────────────────────────────────── */
        @keyframes bm-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes bm-slide-up {
          from { opacity: 0; transform: translateY(16px) scale(0.97) }
          to   { opacity: 1; transform: translateY(0) scale(1) }
        }
        @keyframes bm-toast-pop {
          0%   { opacity: 0; transform: translateX(-50%) translateY(6px) }
          15%  { opacity: 1; transform: translateX(-50%) translateY(0) }
          75%  { opacity: 1 }
          100% { opacity: 0 }
        }

        /* ── Sidebar item overrides ──────────────────────── */
        .bm-deck-item {
          border-left: 2px solid transparent;
          transition: border-left-color 0.15s, background 0.15s;
        }
        .bm-deck-item:hover { border-left-color: #2a5a34; }
        .bm-deck-item.bm-selected {
          background: var(--bg3); border-color: var(--success);
          border-left-color: var(--success);
        }
        .bm-sidebar-icon { font-size: 13px; flex-shrink: 0; margin-right: 2px; }
        .bm-sidebar-desc {
          font-size: 10px; color: var(--text-dim); font-style: italic;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;
        }

        /* ── Detail header overrides ─────────────────────── */
        .bm-detail-header { border-bottom: 1px solid var(--border); padding-bottom: 14px; margin-bottom: 4px; }
        .bm-detail-icon { font-size: 20px; flex-shrink: 0; }
        .bm-detail-name { font-family: var(--font-display) !important; font-size: 22px !important; }
        .bm-count-pill {
          margin-left: auto;
          background: rgba(63,173,110,0.12); border: 1px solid rgba(63,173,110,0.3);
          color: var(--success); font-size: 12px; font-weight: 600;
          padding: 3px 10px; border-radius: 20px; white-space: nowrap;
        }
        .bm-detail-desc {
          margin: 0; font-size: 13px; color: var(--text-dim); font-style: italic;
        }
      `}</style>
    </div>
  );
}
