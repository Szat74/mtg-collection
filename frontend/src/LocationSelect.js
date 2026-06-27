import React, { useState, useEffect, useRef } from 'react';

export default function LocationSelect({ decks, value, onChange, placeholder = '— No location —', extraOptions = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const allOptions = [
    { value: '', label: placeholder, type: 'none' },
    ...decks.map(d => ({
      value: String(d.id),
      label: d.name,
      isBinder: d.type === 'binder',
      format: d.format,
      commander_id: d.commander_id,
      type: d.type,
    })),
    ...extraOptions,
  ];

  const selected = allOptions.find(o => o.value === String(value ?? '')) ?? allOptions[0];

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choose = (opt) => { onChange(opt.value); setOpen(false); };

  return (
    <div className="loc-select" ref={ref}>
      <button
        type="button"
        className={`loc-select-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span className="loc-select-label">
          {selected.isBinder && <span className="loc-select-icon">📒</span>}
          {selected.label}
        </span>
        <span className="loc-select-arrow">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="loc-select-dropdown">
          {allOptions.map(opt => (
            <div
              key={opt.value}
              className={`loc-select-option ${opt.value === String(value ?? '') ? 'selected' : ''} ${opt.isAction ? 'loc-select-action' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(opt); }}
            >
              {opt.isBinder && <span className="loc-select-icon">📒</span>}
              {opt.label}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .loc-select { position: relative; width: 100%; }
        .loc-select-trigger {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          background: var(--bg3); border: 1px solid var(--border); color: var(--text);
          padding: 8px 12px; border-radius: var(--radius); font-size: 0.95rem;
          cursor: pointer; text-align: left; font-family: var(--font-body);
          transition: border-color 0.15s;
        }
        .loc-select-trigger:hover, .loc-select-trigger.open { border-color: var(--accent); outline: none; }
        .loc-select-label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .loc-select-icon { flex-shrink: 0; }
        .loc-select-arrow { color: var(--text-dim); font-size: 10px; margin-left: 8px; flex-shrink: 0; }
        .loc-select-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 200;
          background: var(--bg2); border: 1px solid var(--accent); border-radius: var(--radius);
          box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden;
        }
        .loc-select-option {
          display: flex; align-items: center; gap: 6px;
          padding: 9px 12px; font-size: 0.93rem; color: var(--text);
          cursor: pointer; transition: background 0.1s;
        }
        .loc-select-option:hover { background: var(--bg3); }
        .loc-select-option.selected { background: rgba(123,79,200,0.18); color: var(--accent); }
        .loc-select-action { color: var(--text-dim); border-top: 1px solid var(--border); font-style: italic; }
        .loc-select-action:hover { color: var(--text); }
      `}</style>
    </div>
  );
}
