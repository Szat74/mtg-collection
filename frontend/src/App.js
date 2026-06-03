import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import CollectionView from './CollectionView';
import AddCardView from './AddCardView';
import ImportView from './ImportView';
import StatsView from './StatsView';
import { DeckManager } from './DeckManager';

const API = '/api';

export default function App() {
  const [view, setView]   = useState('collection');
  const [cards, setCards] = useState([]);
  const [stats, setStats] = useState(null);
  const [decks, setDecks] = useState([]);
  const [groups, setGroups] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchCards = useCallback(async (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}/cards${qs ? '?' + qs : ''}`);
    setCards(await res.json());
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API}/stats`);
    setStats(await res.json());
  }, []);

  const fetchDecks = useCallback(async () => {
    const res = await fetch(`${API}/decks`);
    const data = await res.json();
    setDecks(data.map(d => d.name));  // ← this line is critical
  }, []);

  const fetchGroups = useCallback(async () => {
    const res = await fetch(`${API}/groups`);
    setGroups(await res.json());
  }, []);

  useEffect(() => {
    fetchCards();
    fetchStats();
    fetchDecks();
    fetchGroups();
  }, [fetchCards, fetchStats, fetchDecks, fetchGroups]);

  const refresh = () => { fetchCards(); fetchStats(); fetchDecks(); fetchGroups(); };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-symbol">⬡</span>
            <span className="logo-text">Arcane Index</span>
          </div>
          <nav className="nav">
            {[
              { id: 'collection', label: 'Collection' },
              { id: 'add',        label: 'Add Card' },
              { id: 'import',     label: 'Bulk Import' },
              { id: 'stats',      label: 'Stats' },
            ].map(({ id, label }) => (
              <button
                key={id}
                className={`nav-btn ${view === id ? 'active' : ''}`}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button className="export-btn" onClick={() => window.open(`${API}/export/csv`)}>
            ↓ Export CSV
          </button>
        </div>
      </header>

      <main className="app-main">
        {view === 'collection' && (
		  <>
            <CollectionView
              cards={cards} decks={decks} groups={groups}
              fetchCards={fetchCards} refresh={refresh} showToast={showToast}
            />
            <DeckManager onDecksChanged={refresh} />
          </>
        )}
        {view === 'add' && (
          <AddCardView
            decks={decks} groups={groups}
            refresh={refresh} showToast={showToast} setView={setView}
          />
        )}
        {view === 'import' && (
          <ImportView decks={decks} refresh={refresh} showToast={showToast} setView={setView} />
        )}
        {view === 'stats' && (
          <StatsView stats={stats} />
        )}
      </main>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}