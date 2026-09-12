import { useEffect, useState } from 'react';
import { api, getStoredApiKey, setStoredApiKey } from '../api.js';
import { colorForIndex, colorForCategoryId } from '../utils/palette.js';

export default function TemplatesPage({ onOpenTemplate }) {
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [showCanvaImport, setShowCanvaImport] = useState(false);
  const [canvaStatus, setCanvaStatus] = useState({ configured: false, connected: false });
  const [banner, setBanner] = useState(null);

  async function refresh() {
    setLoading(true);
    const [t, c] = await Promise.all([api.listTemplates(), api.listCategories()]);
    setTemplates(t);
    setCategories(c);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    api.canvaStatus().then(setCanvaStatus).catch(() => {});

    // Detect the redirect back from Canva's OAuth flow (?canva=connected / ?canva=error&message=...)
    const params = new URLSearchParams(window.location.search);
    const canvaResult = params.get('canva');
    if (canvaResult === 'connected') {
      setBanner({ type: 'success', text: 'Canva connected — you can now import designs directly.' });
      api.canvaStatus().then(setCanvaStatus).catch(() => {});
    } else if (canvaResult === 'error') {
      setBanner({ type: 'error', text: `Canva connection failed: ${params.get('message') || 'unknown error'}` });
    }
    if (canvaResult) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const filtered =
    activeCategory === 'all'
      ? templates
      : templates.filter((t) => t.category_id === activeCategory);

  async function handleDeleteCategory(e, cat) {
    e.stopPropagation();
    const count = templates.filter((t) => t.category_id === cat.id).length;
    const warning =
      count > 0
        ? `Delete "${cat.name}"? ${count} template${count === 1 ? '' : 's'} in it will become uncategorized (not deleted).`
        : `Delete "${cat.name}"?`;
    if (!confirm(warning)) return;
    if (activeCategory === cat.id) setActiveCategory('all');
    await api.deleteCategory(cat.id);
    refresh();
  }

  async function handleCanvaDisconnect() {
    if (!confirm('Disconnect Canva? You can reconnect any time.')) return;
    await api.canvaDisconnect();
    setCanvaStatus((s) => ({ ...s, connected: false }));
  }

  return (
    <div className="templates-page">
      <div className="sidebar">
        <div className="sidebar-title">Categories</div>
        <div
          className={`category-item ${activeCategory === 'all' ? 'active' : ''}`}
          onClick={() => setActiveCategory('all')}
        >
          <span className="cat-dot all-dot" />
          All templates
        </div>
        {categories.map((c, i) => (
          <div
            key={c.id}
            className={`category-item ${activeCategory === c.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(c.id)}
          >
            <span className="cat-dot" style={{ background: colorForIndex(i) }} />
            <span className="category-name">{c.name}</span>
            <span className="cat-delete" title="Delete category" onClick={(e) => handleDeleteCategory(e, c)}>
              ✕
            </span>
          </div>
        ))}
        <button className="ghost-btn full new-cat-btn" onClick={() => setShowNewCategory(true)}>
          + New category
        </button>

        <div className="sidebar-title canva-title">Canva</div>
        {canvaStatus.connected ? (
          <>
            <div className="canva-status connected">● Connected</div>
            <button className="ghost-btn full" onClick={handleCanvaDisconnect}>Disconnect</button>
          </>
        ) : canvaStatus.configured ? (
          <a className="ghost-btn full canva-connect-link" href="/api/canva/connect">Connect to Canva</a>
        ) : (
          <div className="hint-text">Add CANVA_CLIENT_ID/SECRET/REDIRECT_URI to enable.</div>
        )}

        <div className="sidebar-title canva-title">Preview access</div>
        <ApiKeySettings />
      </div>

      <div className="content">
        {banner && (
          <div className={`banner ${banner.type}`}>
            {banner.text}
            <span className="banner-close" onClick={() => setBanner(null)}>✕</span>
          </div>
        )}
        <div className="content-header">
          <h2>Templates</h2>
          <div className="header-actions">
            {canvaStatus.connected && (
              <button className="ghost-btn" onClick={() => setShowCanvaImport(true)}>
                🎨 Import from Canva
              </button>
            )}
            <button className="primary-btn" onClick={() => setShowUpload(true)}>
              + Upload template
            </button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No templates yet. Upload one to get started.</div>
        ) : (
          <div className="template-grid">
            {filtered.map((t) => (
              <div
                key={t.id}
                className="template-card"
                onClick={() => onOpenTemplate(t.id)}
                style={{ '--card-accent': colorForCategoryId(categories, t.category_id) }}
              >
                <div className="template-card-accent" />
                <div className="template-thumb">
                  <img src={t.thumbnail_url || t.source_image_url} alt={t.name} />
                </div>
                <div className="template-name">{t.name}</div>
                <div className="template-meta">
                  {(t.template_regions || []).length} region
                  {(t.template_regions || []).length === 1 ? '' : 's'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUpload && (
        <UploadModal
          categories={categories}
          onClose={() => setShowUpload(false)}
          onCreated={(t) => {
            setShowUpload(false);
            refresh().then(() => onOpenTemplate(t.id));
          }}
        />
      )}

      {showNewCategory && (
        <NewCategoryModal
          onClose={() => setShowNewCategory(false)}
          onCreated={() => {
            setShowNewCategory(false);
            refresh();
          }}
        />
      )}

      {showCanvaImport && (
        <CanvaImportModal
          categories={categories}
          onClose={() => setShowCanvaImport(false)}
          onImported={(t) => {
            setShowCanvaImport(false);
            refresh().then(() => onOpenTemplate(t.id));
          }}
        />
      )}
    </div>
  );
}

function UploadModal({ categories, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!file) { setError('Choose an image file first.'); return; }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('name', name || file.name);
      if (categoryId) fd.append('category_id', categoryId);
      const template = await api.createTemplate(fd);
      onCreated(template);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Upload template</h3>
        <div className="field">
          <label>Template image (exported from Canva as PNG/JPG)</label>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Instagram Quote Post" />
        </div>
        <div className="field">
          <label>Category (optional — leave blank if this template doesn't need one)</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={submit} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload & annotate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApiKeySettings() {
  const [key, setKey] = useState(getStoredApiKey());
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setStoredApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="api-key-settings">
      <p className="hint-text">
        Needed for the "Preview autofill" button in the editor (same key as <code>FILLCRAFT_API_KEY</code> in Dokploy). Stored only in this browser.
      </p>
      <input
        type="password"
        placeholder="Paste your API key…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <button className="ghost-btn full" onClick={handleSave}>{saved ? 'Saved ✓' : 'Save'}</button>
    </div>
  );
}

function NewCategoryModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createCategory(name.trim());
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New category</h3>
        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={submit} disabled={busy}>Create</button>
        </div>
      </div>
    </div>
  );
}

function CanvaImportModal({ categories, onClose, onImported }) {
  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [continuation, setContinuation] = useState(null);
  const [importingId, setImportingId] = useState(null);
  const [categoryId, setCategoryId] = useState('');

  async function load(opts = {}) {
    setLoading(true);
    setError('');
    try {
      const result = await api.canvaListDesigns({ query: query || undefined, ...opts });
      setDesigns((prev) => (opts.continuation ? [...prev, ...result.items] : result.items));
      setContinuation(result.continuation);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleImport(design) {
    setImportingId(design.id);
    try {
      const template = await api.canvaImportDesign(design.id, {
        name: design.title,
        category_id: categoryId || null,
      });
      onImported(template);
    } catch (err) {
      setError(`Failed to import "${design.title}": ${err.message}`);
      setImportingId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Import from Canva</h3>

        <div className="field row2">
          <div style={{ flex: 2 }}>
            <label>Search your designs</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              placeholder="Search by title…"
            />
          </div>
          <div>
            <label>Import into category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="error-text">{error}</div>}

        {loading && designs.length === 0 ? (
          <div className="empty-state">Loading your Canva designs…</div>
        ) : designs.length === 0 ? (
          <div className="empty-state">No designs found.</div>
        ) : (
          <div className="canva-design-grid">
            {designs.map((d) => (
              <div key={d.id} className="canva-design-card">
                <div className="canva-design-thumb">
                  {d.thumbnail_url ? <img src={d.thumbnail_url} alt={d.title} /> : <div className="no-thumb">No preview</div>}
                </div>
                <div className="canva-design-title">{d.title}</div>
                <button
                  className="primary-btn full"
                  onClick={() => handleImport(d)}
                  disabled={importingId !== null}
                >
                  {importingId === d.id ? 'Importing…' : 'Import'}
                </button>
              </div>
            ))}
          </div>
        )}

        {continuation && !loading && (
          <button className="ghost-btn full" onClick={() => load({ continuation })}>Load more</button>
        )}

        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
