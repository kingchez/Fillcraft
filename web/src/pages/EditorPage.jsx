import { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { api } from '../api.js';

const DISPLAY_MAX_WIDTH = 700;
const GOOGLE_FONTS_QUICKLIST = ['Inter', 'Poppins', 'Nunito', 'Montserrat', 'Playfair Display', 'Roboto', 'Oswald', 'Lora'];

function newId() {
  return crypto.randomUUID();
}

export default function EditorPage({ designId, onBack }) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null); // the fabric.Canvas instance
  const [design, setDesign] = useState(null);
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState(null); // plain snapshot of the active object's relevant props
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ---- Load the design and initialize the Fabric canvas ----
  useEffect(() => {
    let cancelled = false;
    let canvas;

    (async () => {
      const d = await api.getDesign(designId);
      if (cancelled) return;
      setDesign(d);

      const s = Math.min(DISPLAY_MAX_WIDTH / d.width, 1);
      setScale(s);

      canvas = new fabric.Canvas(canvasElRef.current, {
        width: d.width,
        height: d.height,
        backgroundColor: '#FFFFFF',
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      try {
        await canvas.loadFromJSON(d.canvas_json || { objects: [] });
      } catch (err) {
        console.error('Failed to load canvas_json, starting from an empty canvas:', err);
      }
      canvas.requestRenderAll();

      const syncSelection = () => {
        const obj = canvas.getActiveObject();
        setSelected(obj ? snapshotObject(obj) : null);
      };
      canvas.on('selection:created', syncSelection);
      canvas.on('selection:updated', syncSelection);
      canvas.on('selection:cleared', () => setSelected(null));
      canvas.on('object:modified', syncSelection);
    })();

    return () => {
      cancelled = true;
      fabricRef.current?.dispose();
      fabricRef.current = null;
    };
  }, [designId]);

  function snapshotObject(obj) {
    return {
      id: obj.id,
      type: obj.type,
      fill: obj.fill,
      stroke: obj.stroke,
      strokeWidth: obj.strokeWidth,
      fontFamily: obj.fontFamily,
      fontSize: obj.fontSize,
      fontWeight: obj.fontWeight,
      fontStyle: obj.fontStyle,
      textAlign: obj.textAlign,
      text: obj.text,
      opacity: obj.opacity,
      fillcraftField: obj.fillcraftField || null,
    };
  }

  function refreshSelectedSnapshot() {
    const obj = fabricRef.current?.getActiveObject();
    if (obj) setSelected(snapshotObject(obj));
  }

  // ---- Toolbar: add objects ----
  function addText() {
    const canvas = fabricRef.current;
    const t = new fabric.Textbox('New text', {
      id: newId(),
      left: 60, top: 60, width: 260,
      fontSize: 28, fontFamily: 'Inter', fill: '#111111', fontWeight: 'normal',
    });
    canvas.add(t);
    canvas.setActiveObject(t);
    setSelected(snapshotObject(t));
  }

  function addRect() {
    const canvas = fabricRef.current;
    const r = new fabric.Rect({
      id: newId(), left: 60, top: 60, width: 180, height: 120,
      fill: '#D9A441', rx: 0, ry: 0,
    });
    canvas.add(r);
    canvas.setActiveObject(r);
    setSelected(snapshotObject(r));
  }

  function addCircle() {
    const canvas = fabricRef.current;
    const c = new fabric.Circle({ id: newId(), left: 60, top: 60, radius: 60, fill: '#4CC9F0' });
    canvas.add(c);
    canvas.setActiveObject(c);
    setSelected(snapshotObject(c));
  }

  async function addImage(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await api.uploadImage(file);
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      img.set({ id: newId(), left: 80, top: 80, scaleX: 220 / img.width, scaleY: 220 / img.height });
      const canvas = fabricRef.current;
      canvas.add(img);
      canvas.setActiveObject(img);
      setSelected(snapshotObject(img));
    } catch (err) {
      setError(`Image upload failed: ${err.message}`);
    }
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    canvas.remove(obj);
    canvas.discardActiveObject();
    setSelected(null);
  }

  // ---- Property panel edits ----
  function applyToSelected(props) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set(props);
    canvas.requestRenderAll();
    refreshSelectedSnapshot();
  }

  function toggleField(makeField) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (makeField) {
      const isText = obj.type === 'textbox' || obj.type === 'text' || obj.type === 'i-text';
      obj.fillcraftField = {
        label: obj.fillcraftField?.label || (isText ? (obj.text || 'field').slice(0, 20).toLowerCase().replace(/\s+/g, '_') : 'image_field'),
        field_type: isText ? 'text' : 'image',
        max_characters: obj.fillcraftField?.max_characters ?? 200,
      };
    } else {
      obj.fillcraftField = null;
    }
    refreshSelectedSnapshot();
  }

  function updateFieldMeta(patch) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj || !obj.fillcraftField) return;
    obj.fillcraftField = { ...obj.fillcraftField, ...patch };
    refreshSelectedSnapshot();
  }

  // ---- Save ----
  const saveDesign = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setSaving(true);
    setError('');
    try {
      const json = canvas.toJSON(['id', 'fillcraftField']);
      const updated = await api.updateDesign(designId, { canvas_json: json });
      setDesign(updated);
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [designId]);

  // ---- Preview ----
  async function openPreview() {
    await saveDesign(); // preview should reflect what's actually saved
    const fresh = await api.getDesign(designId);
    const initialValues = {};
    for (const f of fresh.fields || []) initialValues[f.label] = f.default_value || '';
    setPreviewValues(initialValues);
    setPreviewOpen(true);
    await runPreview(initialValues);
  }

  async function runPreview(values) {
    setPreviewLoading(true);
    try {
      const blob = await api.autofillPreview(designId, values);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(`Preview failed: ${err.message}`);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDeleteDesign() {
    if (!design) return;
    if (!confirm(`Delete "${design.name}"? This can't be undone.`)) return;
    await api.deleteDesign(designId);
    onBack();
  }

  const displayW = (design?.width || 0) * scale;
  const displayH = (design?.height || 0) * scale;
  const isTextSelected = selected && (selected.type === 'textbox' || selected.type === 'text' || selected.type === 'i-text');

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <button className="ghost-btn" onClick={onBack}>← Back</button>
        <button onClick={addText} disabled={!design}>+ Text</button>
        <button onClick={addRect} disabled={!design}>+ Rectangle</button>
        <button onClick={addCircle} disabled={!design}>+ Circle</button>
        <label className="ghost-btn" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5 }}>
          + Image
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={addImage} disabled={!design} />
        </label>
        <button className="ghost-btn" onClick={deleteSelected} disabled={!selected}>🗑 Delete selected</button>
        <div style={{ flex: 1 }} />
        <button className="ghost-btn" onClick={saveDesign} disabled={saving || !design}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="primary-btn" onClick={openPreview} disabled={!design}>Preview autofill</button>
        <button className="danger-btn" onClick={handleDeleteDesign} disabled={!design}>🗑 Delete design</button>
      </div>

      {error && <div className="error-text" style={{ padding: '8px 16px' }}>{error}</div>}

      <div className="editor-body">
        <div className="canvas-stage" style={{ width: displayW || 400, height: displayH || 300, position: 'relative' }}>
          {!design && <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>Loading design…</div>}
          <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <canvas ref={canvasElRef} />
          </div>
        </div>

        <div className="editor-sidebar">
          {!selected && <div className="hint-text">Select an object to edit its style, or mark it as an autofill field.</div>}

          {selected && (
            <>
              <h4>{selected.type}</h4>

              {isTextSelected && (
                <>
                  <div className="field">
                    <label>Font family</label>
                    <select value={selected.fontFamily || 'Inter'} onChange={(e) => applyToSelected({ fontFamily: e.target.value })}>
                      {GOOGLE_FONTS_QUICKLIST.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ display: 'flex', gap: 8 }}>
                    <input type="number" value={selected.fontSize || 24} onChange={(e) => applyToSelected({ fontSize: Number(e.target.value) })} style={{ width: 70 }} />
                    <select value={selected.fontWeight || 'normal'} onChange={(e) => applyToSelected({ fontWeight: e.target.value })}>
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                    </select>
                    <select value={selected.textAlign || 'left'} onChange={(e) => applyToSelected({ textAlign: e.target.value })}>
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Color</label>
                    <input type="color" value={selected.fill || '#111111'} onChange={(e) => applyToSelected({ fill: e.target.value })} />
                  </div>
                </>
              )}

              {!isTextSelected && selected.type !== 'image' && (
                <div className="field">
                  <label>Fill color</label>
                  <input type="color" value={selected.fill || '#D9A441'} onChange={(e) => applyToSelected({ fill: e.target.value })} />
                </div>
              )}

              <div className="field">
                <label>Opacity</label>
                <input type="range" min="0" max="1" step="0.05" value={selected.opacity ?? 1} onChange={(e) => applyToSelected({ opacity: Number(e.target.value) })} />
              </div>

              <hr />
              <div className="field">
                <label>
                  <input type="checkbox" checked={!!selected.fillcraftField} onChange={(e) => toggleField(e.target.checked)} />
                  {' '}Autofill field
                </label>
              </div>
              {selected.fillcraftField && (
                <>
                  <div className="field">
                    <label>Field label (used by the n8n API)</label>
                    <input type="text" value={selected.fillcraftField.label} onChange={(e) => updateFieldMeta({ label: e.target.value })} />
                  </div>
                  {selected.fillcraftField.field_type === 'text' && (
                    <div className="field">
                      <label>Max characters</label>
                      <input type="number" value={selected.fillcraftField.max_characters || 200} onChange={(e) => updateFieldMeta({ max_characters: Number(e.target.value) })} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {previewOpen && (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Preview autofill</h3>
            {Object.keys(previewValues).length === 0 && <div className="hint-text">No fields marked yet — mark an object as an autofill field first.</div>}
            {Object.entries(previewValues).map(([label, value]) => (
              <div className="field" key={label}>
                <label>{label}</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setPreviewValues((v) => ({ ...v, [label]: e.target.value }))}
                />
              </div>
            ))}
            <button className="primary-btn" onClick={() => runPreview(previewValues)} disabled={previewLoading}>
              {previewLoading ? 'Rendering…' : 'Re-render'}
            </button>
            {previewUrl && <img src={previewUrl} alt="Autofill preview" style={{ maxWidth: '100%', marginTop: 12, border: '1px solid #333' }} />}
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
