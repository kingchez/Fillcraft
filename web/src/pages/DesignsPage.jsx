import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { colorForIndex, colorForCategoryId } from '../utils/palette.js';

export default function DesignsPage({ onOpenDesign }) {
  const [designs, setDesigns] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);

  async function refresh() {
    setLoading(true);
    const [d, c] = await Promise.all([api.listDesigns(), api.listCategories()]);
    setDesigns(d);
    setCategories(c);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  const filtered =
    activeCategory === 'all' ? designs : designs.filter((d) => (d.category_ids || []).includes(activeCategory));

  async function handleDeleteCategory(e, cat) {
    e.stopPropagation();
    const count = designs.filter((d) => (d.category_ids || []).includes(cat.id)).length;
    const warning = count > 0
      ? `Delete "${cat.name}"? ${count} design${count === 1 ? '' : 's'} in it will become uncategorized (not deleted).`
      : `Delete "${cat.name}"?`;
    if (!confirm(warning)) return;
    if (activeCategory === cat.id) setActiveCategory('all');
    await api.deleteCategory(cat.id);
    refresh();
  }

  async function handleDeleteDesign(e, d) {
    e.stopPropagation();
    if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    await api.deleteDesign(d.id);
    refresh();
  }

  return (
    <div className="templates-page">
      <div className="sidebar">
        <div className="sidebar-title">Categories</div>
        <div className={`category-item ${activeCategory === 'all' ? 'active' : ''}`} onClick={() => setActiveCategory('all')}>
          <span className="cat-dot all-dot" />
          All designs
        </div>
        {categories.map((c, i) => (
          <div key={c.id} className={`category-item ${activeCategory === c.id ? 'active' : ''}`} onClick={() => setActiveCategory(c.id)}>
            <span className="cat-dot" style={{ background: colorForIndex(i) }} />
            <span className="category-name">{c.name}</span>
            <span className="cat-delete" title="Delete category" onClick={(e) => handleDeleteCategory(e, c)}>✕</span>
          </div>
        ))}
        <button className="ghost-btn full new-cat-btn" onClick={() => setShowNewCategory(true)}>+ New category</button>

        <div className="sidebar-title canva-title">API access</div>
        <ApiKeySettings />
      </div>

      <div className="content">
        <div className="content-header">
          <h2>Designs</h2>
          <div className="header-actions">
            <button className="primary-btn" onClick={() => setShowNew(true)}>+ New design</button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No designs yet. Create one to start.</div>
        ) : (
          <div className="template-grid">
            {filtered.map((d) => (
              <div
                key={d.id}
                className="template-card"
                onClick={() => onOpenDesign(d.id)}
                style={{ '--card-accent': colorForCategoryId(categories, (d.category_ids || [])[0]) }}
              >
                <div className="template-card-accent" />
                <span className="cat-delete template-delete" title="Delete design" onClick={(e) => handleDeleteDesign(e, d)}>✕</span>
                <div className="template-thumb">
                  {d.thumbnail_url ? <img src={d.thumbnail_url} alt={d.name} /> : <div className="no-thumb">No preview</div>}
                </div>
                <div className="template-name">{d.name}</div>
                <div className="template-meta">
                  {(d.fields || []).length} field{(d.fields || []).length === 1 ? '' : 's'}
                  {d.usage_count > 0 && <span className="usage-badge"> · used {d.usage_count}×</span>}
                </div>
                {(d.category_ids || []).length > 0 && (
                  <div className="template-cat-dots">
                    {d.category_ids.map((cid) => <span key={cid} className="mini-dot" style={{ background: colorForCategoryId(categories, cid) }} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <NewDesignModal
          categories={categories}
          onClose={() => setShowNew(false)}
          onCreated={(d) => {
            setShowNew(false);
            refresh().then(() => onOpenDesign(d.id));
          }}
        />
      )}

      {showNewCategory && (
        <NewCategoryModal onClose={() => setShowNewCategory(false)} onCreated={() => { setShowNewCategory(false); refresh(); }} />
      )}
    </div>
  );
}

const CANVAS_PRESETS = [
  { label: 'Square (1080×1080)', width: 1080, height: 1080 },
  { label: 'Story / Reel (1080×1920)', width: 1080, height: 1920 },
  { label: 'Landscape (1600×900)', width: 1600, height: 900 },
  { label: 'Custom', width: null, height: null },
];

function NewDesignModal({ categories, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [categoryIds, setCategoryIds] = useState([]);
  const [preset, setPreset] = useState(CANVAS_PRESETS[0]);
  const [customW, setCustomW] = useState(1080);
  const [customH, setCustomH] = useState(1080);
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggleCategory(id) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const width = preset.width ?? Number(customW);
      const height = preset.height ?? Number(customH);
      const design = await api.createBlankDesign({
        name: name || 'Untitled Design',
        width, height,
        background_color: bgColor,
        category_ids: categoryIds,
      });
      onCreated(design);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>New design</h3>
        <div className="field">
          <label>Canvas size</label>
          <select value={CANVAS_PRESETS.indexOf(preset)} onChange={(e) => setPreset(CANVAS_PRESETS[Number(e.target.value)])}>
            {CANVAS_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
        </div>
        {preset.width === null && (
          <div className="field" style={{ display: 'flex', gap: 10 }}>
            <input type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} placeholder="Width px" />
            <input type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} placeholder="Height px" />
          </div>
        )}
        <div className="field">
          <label>Background color</label>
          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
        </div>
        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Instagram Quote Post" />
        </div>
        <div className="field">
          <label>Categories (optional)</label>
          <div className="category-checklist">
            {categories.length === 0 && <div className="hint-text">No categories yet.</div>}
            {categories.map((c) => (
              <label key={c.id} className="category-check-row">
                <input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create & start designing'}</button>
        </div>
      </div>
    </div>
  );
}

function ApiKeySettings() {
  const [key, setKey] = useState(api.getApiKey());
  const [saved, setSaved] = useState(false);

  function handleSave() {
    api.setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="api-key-settings">
      <p className="hint-text">
        Needed for "Preview autofill" and n8n's autofill calls (same key as <code>FILLCRAFT_API_KEY</code> in Dokploy). Stored only in this browser.
      </p>
      <input type="password" placeholder="Paste your API key…" value={key} onChange={(e) => setKey(e.target.value)} />
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
