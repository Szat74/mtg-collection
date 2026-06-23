import React, { useState, useEffect } from 'react';

const API = '/api';

const FONTS = [
  { id: 'classic',  label: 'Classic',  display: "'Cinzel', serif",              body: "'Crimson Pro', Georgia, serif"  },
  { id: 'arcane',   label: 'Arcane',   display: "'Philosopher', serif",          body: "'EB Garamond', Georgia, serif"  },
  { id: 'elegant',  label: 'Elegant',  display: "'Playfair Display', serif",     body: "'Lora', Georgia, serif"         },
  { id: 'modern',   label: 'Modern',   display: "'Rajdhani', sans-serif",        body: "'Nunito', sans-serif"           },
  { id: 'grimoire', label: 'Grimoire', display: "'MedievalSharp', serif",        body: "'Merriweather', serif"          },
];

const THEMES = [
  { id: 'dark',     label: '☾ Dark'       },
  { id: 'light',    label: '☀ Light'      },
  { id: 'plains',   label: 'W Plains'     },
  { id: 'island',   label: 'U Island'     },
  { id: 'swamp',    label: 'B Swamp'      },
  { id: 'mountain', label: 'R Mountain'   },
  { id: 'forest',   label: 'G Forest'     },
  { id: 'boros',    label: 'WR Boros'     },
  { id: 'selesnya', label: 'GW Selesnya'  },
  { id: 'dimir',    label: 'UB Dimir'     },
  { id: 'rakdos',   label: 'BR Rakdos'    },
];

export default function SettingsView({ showToast }) {
  const [font, setFont]   = useState(() => localStorage.getItem('font')  || 'classic');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    const def = FONTS.find(f => f.id === font) || FONTS[0];
    document.documentElement.style.setProperty('--font-display', def.display);
    document.documentElement.style.setProperty('--font-body', def.body);
    localStorage.setItem('font', font);
    localStorage.setItem('font-display', def.display);
    localStorage.setItem('font-body', def.body);
  }, [font]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleExport = () => window.open(`${API}/export/csv`);

  const handleRefreshCache = async () => {
    showToast('Cache refresh started — this may take a few minutes…');
    await fetch(`${API}/cache/refresh`, { method: 'POST' });
  };

  return (
    <div className="settings-view">
      <div className="settings-card">
        <h2 className="settings-title">Settings</h2>

        <section className="settings-section">
          <h3 className="settings-section-title">Appearance</h3>
          <div className="settings-row">
            <label className="settings-label">Theme</label>
            <select
              className="settings-select"
              value={theme}
              onChange={e => setTheme(e.target.value)}
            >
              {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="settings-row">
            <label className="settings-label">Font Style</label>
            <select
              className="settings-select"
              value={font}
              onChange={e => setFont(e.target.value)}
            >
              {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">Data</h3>
          <div className="settings-row">
            <label className="settings-label">Export Collection</label>
            <button className="settings-btn" onClick={handleExport}>↓ Export CSV</button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <div className="settings-row">
              <label className="settings-label">Scryfall Cache</label>
              <button className="settings-btn" onClick={handleRefreshCache}>↻ Refresh Cache</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
