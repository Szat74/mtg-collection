import React from 'react';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];
const RARITY_COLOR = { common: '#c0c0c0', uncommon: '#a8c4d4', rare: '#d4af37', mythic: '#e85c2e' };

function fmt(val) {
  if (val == null || isNaN(val)) return '$0.00';
  return '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function StatsView({ stats }) {
  if (!stats) return <div className="stats-loading">Loading stats…</div>;

  const sortedRarity = [...(stats.byRarity || [])].sort(
    (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
  );
  const maxRarity = Math.max(...sortedRarity.map(r => r.n), 1);
  const deckRows   = (stats.byDeck || []).filter(d => d.type !== 'binder');
  const binderRows = (stats.byDeck || []).filter(d => d.type === 'binder');

  return (
    <div className="stats-view">
      <h2 className="section-title">Collection Stats</h2>

      {/* ── Top stat cards ── */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-num">{stats.total ?? 0}</div>
          <div className="stat-label">Total Cards</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.unique ?? 0}</div>
          <div className="stat-label">Unique Printings</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.foils ?? 0}</div>
          <div className="stat-label">Foil Copies</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{deckRows.filter(d => d.deck !== 'Unassigned').length}</div>
          <div className="stat-label">Decks</div>
        </div>
        <div className="stat-card stat-card-highlight">
          <div className="stat-num">{fmt(stats.total_value)}</div>
          <div className="stat-label">Collection Value</div>
        </div>
      </div>

      <div className="stats-charts">
        {/* ── By Rarity ── */}
        <div className="chart-block">
          <h3>By Rarity</h3>
          {sortedRarity.map(r => (
            <div key={r.rarity} className="bar-row">
              <span className="bar-label">{r.rarity}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(r.n / maxRarity) * 100}%`, background: RARITY_COLOR[r.rarity] || '#888' }}
                />
              </div>
              <span className="bar-num">{r.n}</span>
            </div>
          ))}
        </div>

        {/* ── By Deck ── */}
        <div className="chart-block">
          <h3>By Deck</h3>
          {deckRows.length === 0 && <p className="empty-note">No deck assignments yet.</p>}
          {deckRows.map(d => (
            <div key={d.deck} className="location-stat-row">
              <span className="location-stat-name">{d.deck}</span>
              <span className="location-stat-info">{d.n} cards · <span className="location-stat-value">{fmt(d.value)}</span></span>
            </div>
          ))}
        </div>

        {/* ── By Binder ── */}
        {binderRows.length > 0 && (
          <div className="chart-block">
            <h3>By Binder</h3>
            {binderRows.map(d => (
              <div key={d.deck} className="location-stat-row">
                <span className="location-stat-name">📒 {d.deck}</span>
                <span className="location-stat-info">{d.n} cards · <span className="location-stat-value">{fmt(d.value)}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}