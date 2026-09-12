import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';
import RegionInspector from '../components/RegionInspector.jsx';

const DISPLAY_MAX_WIDTH = 640;

const DEFAULT_TEXT_STYLE = {
  font_family: 'Inter',
  font_size: 28,
  color: '#111111',
  font_weight: 'normal',
  italic: false,
  align: 'left',
  line_height: 1.3,
  letter_spacing: 0,
  text_transform: 'none',
  underline: false,
  strikethrough: false,
  opacity: 1,
  rotation: 0,
};

const MODE_TYPE = {
  'draw-text': 'text',
  'draw-image': 'image',
  'draw-shape': 'shape',
  'draw-icon': 'icon',
};

export default function EditorPage({ templateId, onBack }) {
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('select'); // 'select' | 'draw-text' | 'draw-image'
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null); // in-progress drawn box, display coords
  const [drag, setDrag] = useState(null); // { kind: 'move'|'resize', regionId, startX, startY, origBox }
  const containerRef = useRef(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const load = useCallback(async () => {
    const t = await api.getTemplate(templateId);
    setTemplate(t);
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  if (!template) return <div className="empty-state">Loading template…</div>;

  const scale = Math.min(DISPLAY_MAX_WIDTH / template.width, 1);
  const displayW = template.width * scale;
  const displayH = template.height * scale;

  const regions = template.template_regions || [];
  const selected = regions.find((r) => r.id === selectedId) || null;

  function toNatural(displayVal) { return displayVal / scale; }

  function getOffset(e) {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleMouseDown(e) {
    if (mode === 'select') return; // handled per-region
    const { x, y } = getOffset(e);
    setDraft({ x, y, w: 0, h: 0, startX: x, startY: y });
  }

  function handleMouseMove(e) {
    if (draft) {
      const { x, y } = getOffset(e);
      setDraft((d) => ({
        ...d,
        x: Math.min(d.startX, x),
        y: Math.min(d.startY, y),
        w: Math.abs(x - d.startX),
        h: Math.abs(y - d.startY),
      }));
      return;
    }
    if (drag) {
      const { x, y } = getOffset(e);
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      setTemplate((t) => ({
        ...t,
        template_regions: t.template_regions.map((r) => {
          if (r.id !== drag.regionId) return r;
          if (drag.kind === 'move') {
            return { ...r, x: toNatural(drag.origBox.x * scale + dx), y: toNatural(drag.origBox.y * scale + dy) };
          }
          return {
            ...r,
            width: Math.max(10, toNatural(drag.origBox.width * scale + dx)),
            height: Math.max(10, toNatural(drag.origBox.height * scale + dy)),
          };
        }),
      }));
    }
  }

  async function handleMouseUp() {
    if (draft) {
      const box = draft;
      setDraft(null);
      if (box.w > 8 && box.h > 8) {
        const type = MODE_TYPE[mode] || 'text';
        const payload = {
          type,
          x: toNatural(box.x), y: toNatural(box.y),
          width: toNatural(box.w), height: toNatural(box.h),
        };
        if (type === 'text') {
          payload.original_style = DEFAULT_TEXT_STYLE;
          payload.current_style = DEFAULT_TEXT_STYLE;
          payload.max_characters = 200;
        } else if (type === 'image') {
          payload.fit_mode = 'cover';
        } else if (type === 'shape') {
          payload.shape_type = 'rectangle';
          payload.fill_color = '#D9A441';
        } else if (type === 'icon') {
          payload.icon_name = 'mdi:star';
          payload.icon_color = '#D9A441';
        }
        const region = await api.createRegion(templateId, payload);
        setTemplate((t) => ({ ...t, template_regions: [...t.template_regions, region] }));
        setSelectedId(region.id);
        setMode('select');
      }
      return;
    }
    if (drag) {
      const region = template.template_regions.find((r) => r.id === drag.regionId);
      setDrag(null);
      await api.updateRegion(templateId, region.id, {
        x: region.x, y: region.y, width: region.width, height: region.height,
      });
    }
  }

  function startMove(e, region) {
    if (mode !== 'select') return;
    e.stopPropagation();
    setSelectedId(region.id);
    const { x, y } = getOffset(e);
    setDrag({ kind: 'move', regionId: region.id, startX: x, startY: y, origBox: region });
  }

  function startResize(e, region) {
    e.stopPropagation();
    const { x, y } = getOffset(e);
    setDrag({ kind: 'resize', regionId: region.id, startX: x, startY: y, origBox: region });
  }

  async function handleUpdateRegion(patch) {
    if (!selected) return;
    const updated = await api.updateRegion(templateId, selected.id, patch);
    setTemplate((t) => ({
      ...t,
      template_regions: t.template_regions.map((r) => (r.id === updated.id ? updated : r)),
    }));
  }

  async function handleResetStyle() {
    if (!selected) return;
    const updated = await api.resetRegionStyle(templateId, selected.id);
    setTemplate((t) => ({
      ...t,
      template_regions: t.template_regions.map((r) => (r.id === updated.id ? updated : r)),
    }));
  }

  async function handleDeleteRegion() {
    if (!selected) return;
    await api.deleteRegion(templateId, selected.id);
    setTemplate((t) => ({ ...t, template_regions: t.template_regions.filter((r) => r.id !== selected.id) }));
    setSelectedId(null);
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const blob = await api.autofillPreview(templateId, previewValues);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewBusy(false);
    }
  }

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <button className="ghost-btn" onClick={onBack}>← Back</button>
        <input
          className="template-name-input"
          value={template.name}
          onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
          onBlur={(e) => api.updateTemplate(templateId, { name: e.target.value })}
        />
        <div className="mode-buttons">
          <button className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>Select / Move</button>
          <button className={mode === 'draw-text' ? 'active' : ''} onClick={() => setMode('draw-text')}>+ Text</button>
          <button className={mode === 'draw-image' ? 'active' : ''} onClick={() => setMode('draw-image')}>+ Image</button>
          <button className={mode === 'draw-shape' ? 'active' : ''} onClick={() => setMode('draw-shape')}>+ Shape</button>
          <button className={mode === 'draw-icon' ? 'active' : ''} onClick={() => setMode('draw-icon')}>+ Icon</button>
        </div>
        <button className="primary-btn" onClick={() => setPreviewOpen(true)}>Preview autofill</button>
      </div>

      <div className="editor-body">
        <div
          className="canvas-stage"
          ref={containerRef}
          style={{ width: displayW, height: displayH, cursor: mode === 'select' ? 'default' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setDraft(null); setDrag(null); }}
        >
          <img src={template.source_image_url} alt={template.name} draggable={false} style={{ width: displayW, height: displayH }} />

          {regions.map((r) => (
            <div
              key={r.id}
              className={`region-box ${r.type} ${selectedId === r.id ? 'selected' : ''}`}
              style={{
                left: r.x * scale, top: r.y * scale,
                width: r.width * scale, height: r.height * scale,
              }}
              onMouseDown={(e) => startMove(e, r)}
              onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}
            >
              <span className="region-label">{r.label}</span>
              {selectedId === r.id && (
                <div className="resize-handle" onMouseDown={(e) => startResize(e, r)} />
              )}
            </div>
          ))}

          {draft && (
            <div
              className={`region-box draft ${MODE_TYPE[mode] || 'text'}`}
              style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }}
            />
          )}
        </div>

        <div className="editor-sidebar">
          <div className="sidebar-title">Regions ({regions.length})</div>
          <div className="region-list">
            {regions.map((r) => (
              <div
                key={r.id}
                className={`region-list-item ${selectedId === r.id ? 'active' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className={`type-dot ${r.type}`} />
                {r.label}
              </div>
            ))}
            {regions.length === 0 && (
              <div className="hint-text">Use the draw buttons above, then drag on the image to mark a region.</div>
            )}
          </div>

          {selected && (
            <RegionInspector
              region={selected}
              onChange={handleUpdateRegion}
              onReset={handleResetStyle}
              onDelete={handleDeleteRegion}
            />
          )}
        </div>
      </div>

      {previewOpen && (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>Preview autofill</h3>
            <div className="preview-layout">
              <div className="preview-fields">
                {regions.filter((r) => r.type === 'text' || r.type === 'image').map((r) => (
                  <div className="field" key={r.id}>
                    <label>{r.label} {r.type === 'text' && r.max_characters ? `(max ${r.max_characters} chars)` : ''}</label>
                    {r.type === 'text' ? (
                      <textarea
                        value={previewValues[r.label] || ''}
                        onChange={(e) => setPreviewValues((v) => ({ ...v, [r.label]: e.target.value }))}
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder="Image URL"
                        value={previewValues[r.label] || ''}
                        onChange={(e) => setPreviewValues((v) => ({ ...v, [r.label]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
                {regions.some((r) => r.type === 'shape' || r.type === 'icon') && (
                  <div className="hint-text">Shapes and icons render automatically using their saved styling — nothing to fill in for those.</div>
                )}
                <button className="primary-btn" onClick={runPreview} disabled={previewBusy}>
                  {previewBusy ? 'Rendering…' : 'Render preview'}
                </button>
                {previewError && <div className="error-text">{previewError}</div>}
              </div>
              <div className="preview-result">
                {previewUrl ? <img src={previewUrl} alt="preview" /> : <div className="hint-text">Render to see the result here.</div>}
              </div>
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
