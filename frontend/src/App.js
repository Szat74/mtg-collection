import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import CollectionView from './CollectionView';
import AddCardView from './AddCardView';
import ImportView from './ImportView';
import StatsView from './StatsView';
import SettingsView from './SettingsView';
import DeckView from './DeckView';
import BinderView from './BinderView';

const API = '/api';

export default function App() {
  const [view, setView]   = useState('collection');
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
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
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await fetch(`${API}/cards${qs ? '?' + qs : ''}`);
      if (!res.ok) return;
      setCards(await res.json());
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/stats`);
      if (!res.ok) return;
      setStats(await res.json());
    } catch {}
  }, []);

  const fetchDecks = useCallback(async () => {
    try {
      const res = await fetch(`${API}/decks`);
      if (!res.ok) return;
      setDecks(await res.json());
    } catch {}
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`${API}/groups`);
      if (!res.ok) return;
      setGroups(await res.json());
    } catch {}
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
              { id: 'decks',      label: 'Decks' },
              { id: 'binders',    label: 'Binders' },
              { id: 'add',        label: 'Add Card' },
              { id: 'import',     label: 'Bulk Import' },
              { id: 'stats',      label: 'Stats' },
              { id: 'settings',   label: 'Settings' },
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
        </div>
      </header>

      <main className="app-main">
        {view === 'collection' && (
          <CollectionView
            cards={cards} decks={decks} groups={groups}
            onGroupCreated={g => setGroups(prev => [...prev, g].sort((a, b) => a.name.localeCompare(b.name)))}
            refresh={refresh} showToast={showToast}
          />
        )}
        {view === 'decks' && (
          <DeckView decks={decks.filter(d => d.type !== 'binder')} refresh={refresh} showToast={showToast} />
        )}
        {view === 'binders' && (
          <BinderView binders={decks.filter(d => d.type === 'binder')} refresh={refresh} showToast={showToast} />
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
        {view === 'settings' && (
          <SettingsView showToast={showToast} />
        )}
      </main>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      {showScrollTop && (
        <button
          className="scroll-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
        >
          ↑
        </button>
      )}
    </div>
  );
}