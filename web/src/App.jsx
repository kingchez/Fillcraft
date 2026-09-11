import { useState } from 'react';
import TemplatesPage from './pages/TemplatesPage.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  const [view, setView] = useState({ name: 'list' }); // { name: 'list' } | { name: 'editor', templateId }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" onClick={() => setView({ name: 'list' })}>
          Fillcraft
        </div>
        <div className="brand-sub">personal Canva autofill engine</div>
      </header>
      <main className="app-main">
        {view.name === 'list' && (
          <TemplatesPage onOpenTemplate={(id) => setView({ name: 'editor', templateId: id })} />
        )}
        {view.name === 'editor' && (
          <EditorPage templateId={view.templateId} onBack={() => setView({ name: 'list' })} />
        )}
      </main>
    </div>
  );
}
