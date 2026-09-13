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
      : templates.filter((t) => (t.category_ids || []).includes(activeCategory));

  async function handleDeleteCategory(e, cat) {
    e.stopPropagation();
    const count = templates.filter((t) => (t.category_ids || []).includes(cat.id)).length;
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
                style={{ '--card-accent': colorForCategoryId(categories, (t.category_ids || [])[0]) }}
              >
                <div className="template-card-accent" />
                <div className="template-thumb">
                  <img src={t.thumbnail_url || t.source_image_url} alt={t.name} />
                </div>
                <div className="template-name">{t.name}</div>
                <div className="template-meta">
                  {(t.template_regions || []).length} region
                  {(t.template_regions || []).length === 1 ? '' : 's'}
                  {t.usage_count > 0 && <span className="usage-badge"> · used {t.usage_count}×</span>}
                </div>
                {(t.category_ids || []).length > 0 && (
                  <div className="template-cat-dots">
                    {t.category_ids.map((cid) => (
                      <span key={cid} className="mini-dot" style={{ background: colorForCategoryId(categories, cid) }} />
                    ))}
                  </div>
                )}
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
  const [categoryIds, setCategoryIds] = useState([]);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggleCategory(id) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit() {
    if (!file) { setError('Choose an image file first.'); return; }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('name', name || file.name);
      fd.append('category_ids', JSON.stringify(categoryIds));
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
          <label>Categories (optional — pick none, one, or several)</label>
          <div className="category-checklist">
            {categories.length === 0 && <div className="hint-text">No categories yet.</div>}
            {categories.map((c) => (
              <label key={c.id} className="category-check-row">
                <input
                  type="checkbox"
                  checked={categoryIds.includes(c.id)}
                  onChange={() => toggleCategory(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
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
  const [categoryIds, setCategoryIds] = useState([]);

  function toggleCategory(id) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

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
        category_ids: categoryIds,
      });
      if (template.elements_auto_detected > 0) {
        alert(`Imported "${design.title}" — auto-detected ${template.elements_auto_detected} region${template.elements_auto_detected === 1 ? '' : 's'} from the design. Review them in the editor before using.`);
      }
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

        <div className="field">
          <label>Search your designs</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search by title…"
          />
        </div>
        <div className="field">
          <label>Import into categories (optional — pick none, one, or several)</label>
          <div className="category-checklist row">
            {categories.map((c) => (
              <label key={c.id} className="category-check-row">
                <input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                {c.name}
              </label>
            ))}
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
