import { useState } from 'react';
import DesignsPage from './pages/DesignsPage.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  const [view, setView] = useState({ name: 'list' }); // { name: 'list' } | { name: 'editor', designId }

  return (
    <div className="app-shell">
      {view.name !== 'editor' && (
        <header className="app-header">
          <div className="brand-group" onClick={() => setView({ name: 'list' })}>
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" width="30" height="30">
                <defs>
                  <linearGradient id="markGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FF6B6B" />
                    <stop offset="50%" stopColor="#A78BFA" />
                    <stop offset="100%" stopColor="#4CC9F0" />
                  </linearGradient>
                </defs>
                <rect x="3" y="3" width="34" height="34" rx="10" fill="url(#markGrad)" />
                <rect x="11" y="11" width="12" height="9" rx="2" fill="white" fillOpacity="0.95" />
                <circle cx="27.5" cy="15.5" r="4.5" fill="white" fillOpacity="0.95" />
                <rect x="11" y="24" width="18" height="5" rx="2.5" fill="white" fillOpacity="0.7" />
              </svg>
            </div>
            <div className="brand-text">
              <span className="brand-name">Fillcraft</span>
              <span className="brand-sub">✨ design + autofill, built by you</span>
            </div>
          </div>
        </header>
      )}
      <main className="app-main">
        {view.name === 'list' && (
          <DesignsPage onOpenDesign={(id) => setView({ name: 'editor', designId: id })} />
        )}
        {view.name === 'editor' && (
          <EditorPage designId={view.designId} onBack={() => setView({ name: 'list' })} />
        )}
      </main>
    </div>
  );
}
