import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { colorForIndex, colorForCategoryId } from '../utils/palette.js';

export default function TemplatesPage({ onOpenTemplate }) {
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);

  async function refresh() {
    setLoading(true);
    const [t, c] = await Promise.all([api.listTemplates(), api.listCategories()]);
    setTemplates(t);
    setCategories(c);
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

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
      </div>

      <div className="content">
        <div className="content-header">
          <h2>Templates</h2>
          <button className="primary-btn" onClick={() => setShowUpload(true)}>
            + Upload template
          </button>
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
