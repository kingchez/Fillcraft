import { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { api } from '../api.js';

const DISPLAY_MAX_WIDTH = 640;
const GOOGLE_FONTS_QUICKLIST = ['Inter', 'Poppins', 'Nunito', 'Montserrat', 'Playfair Display', 'Roboto', 'Oswald', 'Lora'];
const HISTORY_LIMIT = 50;

function newId() {
  return crypto.randomUUID();
}

function iconSvgUrl(prefix, name, color) {
  const params = new URLSearchParams({ height: '512' });
  if (color) params.set('color', color);
  return `https://api.iconify.design/${prefix}/${name}.svg?${params.toString()}`;
}

export default function EditorPage({ designId, onBack }) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const historyRef = useRef({ stack: [], index: -1, suppress: false });
  const [design, setDesign] = useState(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1); // user-controlled, on top of baseScale
  const [selected, setSelected] = useState(null);
  const [multiSelected, setMultiSelected] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconQuery, setIconQuery] = useState('arrow');
  const [iconResults, setIconResults] = useState([]);
  const [canvasBg, setCanvasBg] = useState('#FFFFFF');

  // ---- Load the design and initialize the Fabric canvas ----
  useEffect(() => {
    let cancelled = false;
    let spaceHeld = false;
    let isPanning = false;
    let lastPanPoint = null;

    const onSpaceDown = (e) => {
      const canvas = fabricRef.current;
      if (e.code === 'Space' && !e.repeat && canvas) { spaceHeld = true; canvas.defaultCursor = 'grab'; canvas.selection = false; }
    };
    const onSpaceUp = (e) => {
      const canvas = fabricRef.current;
      if (e.code === 'Space' && canvas) { spaceHeld = false; canvas.defaultCursor = 'default'; canvas.selection = true; }
    };
    window.addEventListener('keydown', onSpaceDown);
    window.addEventListener('keyup', onSpaceUp);

    (async () => {
      const d = await api.getDesign(designId);
      if (cancelled) return;
      setDesign(d);
      setBaseScale(Math.min(DISPLAY_MAX_WIDTH / d.width, 1));

      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: d.width,
        height: d.height,
        backgroundColor: '#FFFFFF',
        preserveObjectStacking: true,
      });
      fabricRef.current = canvas;

      // ---- Pan: hold Space + drag, like Figma/Canva. Doesn't interfere
      // with normal object dragging, which has no modifier key. ----
      canvas.on('mouse:down', (opt) => {
        if (!spaceHeld) return;
        isPanning = true;
        lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
        canvas.defaultCursor = 'grabbing';
      });
      canvas.on('mouse:move', (opt) => {
        if (!isPanning || !lastPanPoint) return;
        const dx = opt.e.clientX - lastPanPoint.x;
        const dy = opt.e.clientY - lastPanPoint.y;
        lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
        canvas.relativePan({ x: dx, y: dy });
      });
      canvas.on('mouse:up', () => { isPanning = false; canvas.defaultCursor = spaceHeld ? 'grab' : 'default'; });

      try {
        await canvas.loadFromJSON(d.canvas_json || { objects: [] });
      } catch (err) {
        console.error('Failed to load canvas_json, starting from an empty canvas:', err);
      }
      const bgObj = canvas.getObjects().find((o) => o.id === 'background');
      if (bgObj) setCanvasBg(bgObj.fill || '#FFFFFF');
      canvas.requestRenderAll();

      const syncSelection = () => {
        const active = canvas.getActiveObject();
        setMultiSelected(active?.type === 'activeselection');
        setSelected(active ? snapshotObject(active) : null);
      };
      canvas.on('selection:created', syncSelection);
      canvas.on('selection:updated', syncSelection);
      canvas.on('selection:cleared', () => { setSelected(null); setMultiSelected(false); });
      canvas.on('object:modified', syncSelection);

      // ---- Undo/redo history ----
      const pushHistory = () => {
        if (historyRef.current.suppress) return;
        const json = canvas.toJSON(['id', 'fillcraftField']);
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.index + 1);
        h.stack.push(json);
        if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
        h.index = h.stack.length - 1;
      };
      pushHistory(); // initial state
      canvas.on('object:added', pushHistory);
      canvas.on('object:removed', pushHistory);
      canvas.on('object:modified', pushHistory);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onSpaceDown);
      window.removeEventListener('keyup', onSpaceUp);
      fabricRef.current?.dispose();
      fabricRef.current = null;
    };
  }, [designId]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function onKeyDown(e) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || canvas.getActiveObject()?.isEditing;
      if (typing) return;

      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.startsWith('Arrow')) {
        const obj = canvas.getActiveObject();
        if (!obj) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        obj.set({ left: obj.left + dx, top: obj.top + dy });
        obj.setCoords();
        canvas.requestRenderAll();
        refreshSelectedSnapshot();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function snapshotObject(obj) {
    return {
      id: obj.id,
      type: obj.type,
      left: Math.round(obj.left || 0),
      top: Math.round(obj.top || 0),
      width: Math.round(obj.getScaledWidth ? obj.getScaledWidth() : obj.width || 0),
      height: Math.round(obj.getScaledHeight ? obj.getScaledHeight() : obj.height || 0),
      angle: Math.round(obj.angle || 0),
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

  // ---- Undo / redo ----
  function undo() {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index -= 1;
    applyHistorySnapshot(h.stack[h.index]);
  }
  function redo() {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    applyHistorySnapshot(h.stack[h.index]);
  }
  async function applyHistorySnapshot(json) {
    const canvas = fabricRef.current;
    historyRef.current.suppress = true;
    await canvas.loadFromJSON(json);
    canvas.requestRenderAll();
    historyRef.current.suppress = false;
    setSelected(null);
  }

  // ---- Toolbar: add objects ----
  function addText() {
    const canvas = fabricRef.current;
    const t = new fabric.Textbox('New text', { id: newId(), left: 60, top: 60, width: 260, fontSize: 28, fontFamily: 'Inter', fill: '#111111', fontWeight: 'normal' });
    canvas.add(t);
    canvas.setActiveObject(t);
    setSelected(snapshotObject(t));
  }
  function addRect() {
    const canvas = fabricRef.current;
    const r = new fabric.Rect({ id: newId(), left: 60, top: 60, width: 180, height: 120, fill: '#D9A441' });
    canvas.add(r); canvas.setActiveObject(r); setSelected(snapshotObject(r));
  }
  function addCircle() {
    const canvas = fabricRef.current;
    const c = new fabric.Circle({ id: newId(), left: 60, top: 60, radius: 60, fill: '#4CC9F0' });
    canvas.add(c); canvas.setActiveObject(c); setSelected(snapshotObject(c));
  }
  function addTriangle() {
    const canvas = fabricRef.current;
    const t = new fabric.Triangle({ id: newId(), left: 60, top: 60, width: 120, height: 110, fill: '#A78BFA' });
    canvas.add(t); canvas.setActiveObject(t); setSelected(snapshotObject(t));
  }
  function addLine() {
    const canvas = fabricRef.current;
    const l = new fabric.Line([0, 0, 150, 0], { id: newId(), left: 60, top: 60, stroke: '#111111', strokeWidth: 4 });
    canvas.add(l); canvas.setActiveObject(l); setSelected(snapshotObject(l));
  }
  function addStar() {
    const canvas = fabricRef.current;
    const points = starPoints(5, 60, 28);
    const s = new fabric.Polygon(points, { id: newId(), left: 60, top: 60, fill: '#FF6B6B' });
    canvas.add(s); canvas.setActiveObject(s); setSelected(snapshotObject(s));
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
      canvas.add(img); canvas.setActiveObject(img); setSelected(snapshotObject(img));
    } catch (err) {
      setError(`Image upload failed: ${err.message}`);
    }
  }

  async function addIcon(prefix, name) {
    try {
      const url = iconSvgUrl(prefix, name, selected?.fill || '#111111');
      const img = await fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      img.set({ id: newId(), left: 100, top: 100, scaleX: 80 / img.width, scaleY: 80 / img.height });
      const canvas = fabricRef.current;
      canvas.add(img); canvas.setActiveObject(img); setSelected(snapshotObject(img));
      setIconPickerOpen(false);
    } catch (err) {
      setError(`Icon load failed: ${err.message}`);
    }
  }

  async function searchIcons(query) {
    setIconQuery(query);
    if (!query.trim()) { setIconResults([]); return; }
    try {
      const res = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=48`);
      const data = await res.json();
      setIconResults(data.icons || []);
    } catch {
      setIconResults([]);
    }
  }

  async function importSvg(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const { objects, options } = await fabric.loadSVGFromString(text);
      const valid = objects.filter(Boolean);
      if (!valid.length) throw new Error('No recognizable shapes found in this SVG');
      const group = fabric.util.groupSVGElements(valid, options);
      group.set({ id: newId(), left: 100, top: 100 });
      const canvas = fabricRef.current;
      canvas.add(group); canvas.setActiveObject(group); setSelected(snapshotObject(group));
    } catch (err) {
      setError(`SVG import failed: ${err.message}`);
    }
  }

  function deleteSelected() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (obj.type === 'activeselection') {
      obj.getObjects().forEach((o) => canvas.remove(o));
    } else {
      canvas.remove(obj);
    }
    canvas.discardActiveObject();
    setSelected(null);
  }

  function duplicateSelected() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.clone().then((clone) => {
      clone.set({ id: newId(), left: (obj.left || 0) + 20, top: (obj.top || 0) + 20 });
      canvas.add(clone);
      canvas.setActiveObject(clone);
      setSelected(snapshotObject(clone));
    });
  }

  // ---- Property panel edits ----
  function applyToSelected(props) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    obj.set(props);
    obj.setCoords();
    canvas.requestRenderAll();
    refreshSelectedSnapshot();
  }

  function applyBBox(patch) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const next = {};
    if (patch.left !== undefined) next.left = patch.left;
    if (patch.top !== undefined) next.top = patch.top;
    if (patch.angle !== undefined) next.angle = patch.angle;
    if (patch.width !== undefined) next.scaleX = patch.width / (obj.width || 1);
    if (patch.height !== undefined) next.scaleY = patch.height / (obj.height || 1);
    obj.set(next);
    obj.setCoords();
    canvas.requestRenderAll();
    refreshSelectedSnapshot();
  }

  function alignSelected(mode) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj || !design) return;
    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();
    const patch = {};
    if (mode === 'left') patch.left = 0;
    if (mode === 'center-h') patch.left = (design.width - w) / 2;
    if (mode === 'right') patch.left = design.width - w;
    if (mode === 'top') patch.top = 0;
    if (mode === 'center-v') patch.top = (design.height - h) / 2;
    if (mode === 'bottom') patch.top = design.height - h;
    obj.set(patch);
    obj.setCoords();
    canvas.requestRenderAll();
    refreshSelectedSnapshot();
  }

  function layerAction(action) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (action === 'front') canvas.bringObjectToFront(obj);
    else if (action === 'back') canvas.sendObjectToBack(obj);
    else if (action === 'forward') canvas.bringObjectForward(obj);
    else if (action === 'backward') canvas.sendObjectBackwards(obj);
    canvas.requestRenderAll();
  }

  function groupSelected() {
    const canvas = fabricRef.current;
    const active = canvas.getActiveObject();
    if (!active || active.type !== 'activeselection') return;
    const objects = active.getObjects();
    canvas.discardActiveObject();
    objects.forEach((o) => canvas.remove(o));
    const group = new fabric.Group(objects, { id: newId() });
    canvas.add(group);
    canvas.setActiveObject(group);
    setSelected(snapshotObject(group));
    setMultiSelected(false);
  }

  function ungroupSelected() {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'group') return;
    const objects = obj.removeAll();
    canvas.remove(obj);
    objects.forEach((o) => { if (!o.id) o.id = newId(); canvas.add(o); });
    const sel = new fabric.ActiveSelection(objects, { canvas });
    canvas.setActiveObject(sel);
    canvas.requestRenderAll();
    setMultiSelected(true);
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

  function updateCanvasBackground(color) {
    setCanvasBg(color);
    const canvas = fabricRef.current;
    const bgObj = canvas?.getObjects().find((o) => o.id === 'background');
    if (bgObj) {
      bgObj.set({ fill: color });
      canvas.requestRenderAll();
    }
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
    await saveDesign();
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

  const effectiveScale = baseScale * zoom;
  const displayW = (design?.width || 0) * effectiveScale;
  const displayH = (design?.height || 0) * effectiveScale;
  const isTextSelected = selected && (selected.type === 'textbox' || selected.type === 'text' || selected.type === 'i-text');
  const isGroupSelected = selected && selected.type === 'group';

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <button className="ghost-btn" onClick={onBack}>← Back</button>
        <span className="toolbar-sep" />
        <button onClick={addText} disabled={!design}>+ Text</button>
        <button onClick={addRect} disabled={!design}>▭</button>
        <button onClick={addCircle} disabled={!design}>◯</button>
        <button onClick={addTriangle} disabled={!design}>△</button>
        <button onClick={addLine} disabled={!design}>╱</button>
        <button onClick={addStar} disabled={!design}>★</button>
        <button onClick={() => setIconPickerOpen(true)} disabled={!design}>+ Icon</button>
        <label className="ghost-btn" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5 }}>
          + Image
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={addImage} disabled={!design} />
        </label>
        <label className="ghost-btn" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5 }}>
          Import SVG
          <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={importSvg} disabled={!design} />
        </label>
        <span className="toolbar-sep" />
        <button className="ghost-btn" onClick={undo} disabled={!design} title="Undo (Ctrl+Z)">↶</button>
        <button className="ghost-btn" onClick={redo} disabled={!design} title="Redo (Ctrl+Shift+Z)">↷</button>
        <span className="toolbar-sep" />
        <button className="ghost-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}>−</button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="ghost-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>+</button>
        <button className="ghost-btn" onClick={() => setZoom(1)}>Fit</button>
        <div style={{ flex: 1 }} />
        <button className="ghost-btn" onClick={saveDesign} disabled={saving || !design}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="primary-btn" onClick={openPreview} disabled={!design}>Preview autofill</button>
        <button className="danger-btn" onClick={handleDeleteDesign} disabled={!design}>🗑 Delete design</button>
      </div>

      {error && <div className="error-text" style={{ padding: '8px 16px' }}>{error}</div>}

      <div className="editor-body">
        <div className="canvas-viewport">
          <div className="canvas-stage" style={{ width: displayW || 400, height: displayH || 300, position: 'relative' }}>
            {!design && <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>Loading design…</div>}
            <div style={{ transform: `scale(${effectiveScale})`, transformOrigin: 'top left' }}>
              <canvas ref={canvasElRef} />
            </div>
          </div>
        </div>

        <div className="editor-sidebar">
          {!selected && design && (
            <>
              <h4>Canvas</h4>
              <div className="field">
                <label>Background color</label>
                <input type="color" value={canvasBg} onChange={(e) => updateCanvasBackground(e.target.value)} />
              </div>
              <div className="hint-text">{design.width} × {design.height}px — select an object to edit it, or mark it as an autofill field.</div>
            </>
          )}

          {multiSelected && (
            <>
              <h4>Multiple objects</h4>
              <button className="ghost-btn full" onClick={groupSelected}>Group</button>
              <button className="ghost-btn full" onClick={deleteSelected}>🗑 Delete selected</button>
            </>
          )}

          {selected && !multiSelected && (
            <>
              <h4>{selected.type}{selected.id === 'background' ? ' (canvas background)' : ''}</h4>

              <div className="field-row">
                <div className="field"><label>X</label><input type="number" value={selected.left} onChange={(e) => applyBBox({ left: Number(e.target.value) })} /></div>
                <div className="field"><label>Y</label><input type="number" value={selected.top} onChange={(e) => applyBBox({ top: Number(e.target.value) })} /></div>
              </div>
              <div className="field-row">
                <div className="field"><label>W</label><input type="number" value={selected.width} onChange={(e) => applyBBox({ width: Number(e.target.value) })} /></div>
                <div className="field"><label>H</label><input type="number" value={selected.height} onChange={(e) => applyBBox({ height: Number(e.target.value) })} /></div>
              </div>
              <div className="field">
                <label>Rotation</label>
                <input type="number" value={selected.angle} onChange={(e) => applyBBox({ angle: Number(e.target.value) })} />
              </div>

              <div className="field">
                <label>Align to canvas</label>
                <div className="align-row">
                  <button onClick={() => alignSelected('left')} title="Align left">⇤</button>
                  <button onClick={() => alignSelected('center-h')} title="Center horizontally">↔</button>
                  <button onClick={() => alignSelected('right')} title="Align right">⇥</button>
                  <button onClick={() => alignSelected('top')} title="Align top">⤒</button>
                  <button onClick={() => alignSelected('center-v')} title="Center vertically">↕</button>
                  <button onClick={() => alignSelected('bottom')} title="Align bottom">⤓</button>
                </div>
              </div>

              <div className="field">
                <label>Layer order</label>
                <div className="align-row">
                  <button onClick={() => layerAction('back')} title="Send to back">⇊</button>
                  <button onClick={() => layerAction('backward')} title="Send backward">↓</button>
                  <button onClick={() => layerAction('forward')} title="Bring forward">↑</button>
                  <button onClick={() => layerAction('front')} title="Bring to front">⇈</button>
                </div>
              </div>

              {isTextSelected && (
                <>
                  <div className="field">
                    <label>Font family</label>
                    <select value={selected.fontFamily || 'Inter'} onChange={(e) => applyToSelected({ fontFamily: e.target.value })}>
                      {GOOGLE_FONTS_QUICKLIST.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field-row">
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
                  <div className="field"><label>Text color</label><input type="color" value={selected.fill || '#111111'} onChange={(e) => applyToSelected({ fill: e.target.value })} /></div>
                </>
              )}

              {!isTextSelected && selected.type !== 'image' && selected.type !== 'group' && (
                <div className="field"><label>Fill color</label><input type="color" value={selected.fill || '#D9A441'} onChange={(e) => applyToSelected({ fill: e.target.value })} /></div>
              )}

              {(selected.type === 'rect' || selected.type === 'circle' || selected.type === 'triangle' || selected.type === 'line') && (
                <div className="field-row">
                  <div className="field"><label>Stroke</label><input type="color" value={selected.stroke || '#000000'} onChange={(e) => applyToSelected({ stroke: e.target.value })} /></div>
                  <div className="field"><label>Width</label><input type="number" value={selected.strokeWidth || 0} onChange={(e) => applyToSelected({ strokeWidth: Number(e.target.value) })} style={{ width: 60 }} /></div>
                </div>
              )}

              <div className="field">
                <label>Opacity</label>
                <input type="range" min="0" max="1" step="0.05" value={selected.opacity ?? 1} onChange={(e) => applyToSelected({ opacity: Number(e.target.value) })} />
              </div>

              <div className="field-row">
                <button className="ghost-btn" onClick={duplicateSelected} title="Ctrl+D">⧉ Duplicate</button>
                {isGroupSelected
                  ? <button className="ghost-btn" onClick={ungroupSelected}>Ungroup</button>
                  : selected.id !== 'background' && <button className="ghost-btn" onClick={deleteSelected} title="Delete">🗑 Delete</button>}
              </div>

              {selected.id !== 'background' && (
                <>
                  <hr />
                  <div className="field">
                    <label><input type="checkbox" checked={!!selected.fillcraftField} onChange={(e) => toggleField(e.target.checked)} /> Autofill field</label>
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
            </>
          )}
        </div>
      </div>

      {iconPickerOpen && (
        <div className="modal-backdrop" onClick={() => setIconPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add an icon</h3>
            <input type="text" value={iconQuery} placeholder="Search 200k+ icons…" onChange={(e) => searchIcons(e.target.value)} autoFocus />
            <div className="icon-grid">
              {iconResults.map((ref) => {
                const [prefix, name] = ref.split(':');
                return (
                  <button key={ref} className="icon-grid-item" onClick={() => addIcon(prefix, name)} title={ref}>
                    <img src={iconSvgUrl(prefix, name, '#333333')} alt={name} />
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={() => setIconPickerOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Preview autofill</h3>
            {Object.keys(previewValues).length === 0 && <div className="hint-text">No fields marked yet — mark an object as an autofill field first.</div>}
            {Object.entries(previewValues).map(([label, value]) => (
              <div className="field" key={label}>
                <label>{label}</label>
                <input type="text" value={value} onChange={(e) => setPreviewValues((v) => ({ ...v, [label]: e.target.value }))} />
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

function starPoints(spikes, outerR, innerR) {
  const pts = [];
  const step = Math.PI / spikes;
  let rot = -Math.PI / 2;
  const cx = outerR, cy = outerR;
  for (let i = 0; i < spikes; i++) {
    pts.push({ x: cx + Math.cos(rot) * outerR, y: cy + Math.sin(rot) * outerR });
    rot += step;
    pts.push({ x: cx + Math.cos(rot) * innerR, y: cy + Math.sin(rot) * innerR });
    rot += step;
  }
  return pts;
}
