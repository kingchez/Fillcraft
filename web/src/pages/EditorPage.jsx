import { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { api } from '../api.js';

const HISTORY_LIMIT = 50;

function newId() {
  return crypto.randomUUID();
}

const loadedFonts = new Set();
function loadGoogleFontInBrowser(family) {
  if (!family) return Promise.resolve();
  if (!loadedFonts.has(family)) {
    loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:ital,wght@0,400;0,700;1,400&display=swap`;
    document.head.appendChild(link);
  }
  // A <link> only registers the @font-face description — it does NOT
  // guarantee the glyph file has actually finished downloading by the
  // time Fabric paints its next frame. That race is the real reason only
  // a few fonts ever appeared to "work": whichever ones happened to
  // already be loaded/cached painted correctly, and everything else
  // silently rendered in the fallback font with no visible error.
  // document.fonts.load() forces the browser to actually fetch + parse
  // the font and resolves once it's truly ready to paint.
  return document.fonts.load(`400 16px "${family}"`).catch(() => {});
}

// Custom fonts have no Google Fonts CSS endpoint — the browser needs a real
// @font-face rule pointing at the uploaded file's Supabase URL, or selecting
// one in the picker changes fontFamily but nothing visibly renders (the
// server-side renderer already registers these separately for the actual
// autofill/export output — this is purely for the in-editor preview).
const loadedCustomFontFamilies = new Set();
function loadCustomFontInBrowser(family, fileUrl) {
  if (!family || !fileUrl) return Promise.resolve();
  if (!loadedCustomFontFamilies.has(family)) {
    loadedCustomFontFamilies.add(family);
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: "${family.replace(/"/g, '')}"; src: url("${fileUrl}"); font-display: swap; }`;
    document.head.appendChild(style);
  }
  return document.fonts.load(`400 16px "${family}"`).catch(() => {});
}

function toHexColor(color) {
  if (!color) return '000000';
  if (color.startsWith('#')) return color.slice(1);
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('');
  return '000000';
}

function iconSvgUrl(prefix, name, color) {
  const params = new URLSearchParams({ height: '512', color: `#${toHexColor(color)}` });
  return `https://api.iconify.design/${prefix}/${name}.svg?${params.toString()}`;
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

// Scans the canvas for every distinct fontFamily currently in use (one
// level into groups) and makes sure each one is actually loaded in the
// browser before repainting. Without this, reopening a saved design shows
// every text object in the browser's fallback font until the user happens
// to reselect that exact font in the picker — the fonts were never broken,
// they just were never asked to load on open in the first place.
async function preloadFontsUsedInCanvas(canvas, customFontsList) {
  const families = new Set();
  const collect = (obj) => {
    if (obj.fontFamily) families.add(obj.fontFamily);
    if (typeof obj.getObjects === 'function') obj.getObjects().forEach(collect);
  };
  canvas.getObjects().forEach(collect);
  if (families.size === 0) return;

  await Promise.all([...families].map((family) => {
    const custom = customFontsList.find((f) => f.family_name === family);
    return custom ? loadCustomFontInBrowser(custom.family_name, custom.file_url) : loadGoogleFontInBrowser(family);
  }));
  canvas.requestRenderAll();
}

export default function EditorPage({ designId, onBack }) {
  const canvasElRef = useRef(null);
  const canvasViewportRef = useRef(null);
  const fabricRef = useRef(null);
  const historyRef = useRef({ stack: [], index: -1, suppress: false });
  const [design, setDesign] = useState(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [leftTab, setLeftTab] = useState('elements');
  const [uploads, setUploads] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [newFontName, setNewFontName] = useState('');
  const [fontUploading, setFontUploading] = useState(false);
  const [positionPopoverOpen, setPositionPopoverOpen] = useState(false);
  const [fieldPopoverOpen, setFieldPopoverOpen] = useState(false);
  const [googleFonts, setGoogleFonts] = useState([]);
  const [customFonts, setCustomFonts] = useState([]);

  // Shared with the initial-load fit calculation below — re-measures the
  // actual viewport and refits whenever it's plausible the AVAILABLE space
  // changed after load (panel collapsed/expanded, window resized). Without
  // this, the canvas was only ever sized correctly at the exact instant it
  // first loaded — collapsing the left panel (freeing up width) or resizing
  // the browser never re-fit it, so it could end up not matching the space
  // actually available, which is consistent with the cut-off-content report
  // on a design opened with the panel already collapsed.
  const refitToContainer = useCallback((d) => {
    const viewportEl = canvasViewportRef.current;
    if (!viewportEl) return;
    const padding = 64;
    const availW = Math.max(viewportEl.clientWidth - padding, 100);
    const availH = Math.max(viewportEl.clientHeight - padding, 100);
    setBaseScale(Math.min(availW / d.width, availH / d.height, 1));
  }, []);

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
      // Fit to the ACTUAL viewport, both dimensions — the old version only
      // ever capped width at a hardcoded 560px and ignored height entirely.
      // For a tall design (e.g. 1080x1920) that meant the canvas was
      // created taller than the visible viewport, and combined with the
      // centering CSS bug fixed alongside this (see .canvas-viewport),
      // that's exactly what caused "only part of the background is
      // visible, not the whole thing I'm designing on" — the canvas itself
      // was always the right size, the viewport just couldn't show or
      // scroll to all of it.
      const viewportEl = canvasViewportRef.current;
      const padding = 64; // breathing room so the canvas edge isn't flush against the viewport edge
      const availW = Math.max((viewportEl?.clientWidth || 800) - padding, 100);
      const availH = Math.max((viewportEl?.clientHeight || 600) - padding, 100);
      const initialScale = Math.min(availW / d.width, availH / d.height, 1);
      setBaseScale(initialScale);
      // The canvas element is created at the scaled-down DISPLAY size, not
      // the full design size — Fabric's own zoom then draws design-space
      // objects (whose left/top/width/height stay in design units) shrunk
      // to fit. Deliberately not using a CSS transform:scale() wrapper:
      // that leaves the canvas's backing store at full design size while
      // only the DOM box is visually scaled, and breaks Fabric's own
      // pointer-to-canvas coordinate math for dragging/selecting, since
      // Fabric assumes a 1:1 CSS-pixel mapping via getBoundingClientRect().
      const canvas = new fabric.Canvas(canvasElRef.current, {
        width: Math.round(d.width * initialScale),
        height: Math.round(d.height * initialScale),
        backgroundColor: '#FFFFFF',
        preserveObjectStacking: true,
      });
      canvas.setZoom(initialScale);
      fabricRef.current = canvas;

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

      // Fetched fresh here (not read from component state) so this can't
      // race the separate effect that populates the font-picker dropdown.
      api.listCustomFonts().then((fonts) => preloadFontsUsedInCanvas(canvas, fonts)).catch(() => {});

      const syncSelection = () => {
        const active = canvas.getActiveObject();
        setMultiSelected(active?.type === 'activeselection');
        setSelected(active ? snapshotObject(active) : null);
        setPositionPopoverOpen(false);
        setFieldPopoverOpen(false);
      };
      canvas.on('selection:created', syncSelection);
      canvas.on('selection:updated', syncSelection);
      canvas.on('selection:cleared', () => { setSelected(null); setMultiSelected(false); setPositionPopoverOpen(false); setFieldPopoverOpen(false); });
      canvas.on('object:modified', syncSelection);

      const pushHistory = () => {
        if (historyRef.current.suppress) return;
        const json = canvas.toObject(['id', 'fillcraftField']);
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.index + 1);
        h.stack.push(json);
        if (h.stack.length > HISTORY_LIMIT) h.stack.shift();
        h.index = h.stack.length - 1;
      };
      pushHistory();
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

  // Keeps the canvas's actual DOM size and Fabric's own zoom in sync with
  // baseScale/zoom after the initial mount (the +/-/Fit controls).
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !design) return;
    const scale = baseScale * zoom;
    canvas.setDimensions({
      width: Math.round(design.width * scale),
      height: Math.round(design.height * scale),
    });
    canvas.setZoom(scale);
    canvas.requestRenderAll();
  }, [zoom, baseScale, design?.id]);

  useEffect(() => {
    function onKeyDown(e) {
      const canvas = fabricRef.current;
      if (!canvas) return;
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || canvas.getActiveObject()?.isEditing;
      if (typing) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
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

  useEffect(() => {
    if (leftTab !== 'uploads') return;
    setUploadsLoading(true);
    api.listAssets().then(setUploads).catch(() => setUploads([])).finally(() => setUploadsLoading(false));
  }, [leftTab]);

  // Full font lists for the picker — was previously a ~26-name list
  // hardcoded in this file (a fraction of the 60 Google Fonts the server
  // actually supports) and never included custom-uploaded fonts at all.
  useEffect(() => {
    api.listGoogleFonts().then(setGoogleFonts).catch(() => setGoogleFonts([]));
    api.listCustomFonts().then(setCustomFonts).catch(() => setCustomFonts([]));
  }, []);

  // Re-fit when the left panel finishes its collapse/expand transition
  // (.left-panel has a 150ms width transition — measuring immediately on
  // toggle would grab the width mid-animation) and on window resize.
  // Previously the canvas was only ever sized once, at the exact instant
  // it first loaded — collapsing the panel (freeing up width) or resizing
  // the browser never re-fit it.
  useEffect(() => {
    if (!design) return;
    const t = setTimeout(() => refitToContainer(design), 200);
    return () => clearTimeout(t);
  }, [leftPanelOpen, design, refitToContainer]);

  useEffect(() => {
    if (!design) return;
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => refitToContainer(design), 150);
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, [design, refitToContainer]);

  useEffect(() => {
    if (!positionPopoverOpen && !fieldPopoverOpen) return;
    const onDocClick = () => { setPositionPopoverOpen(false); setFieldPopoverOpen(false); };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [positionPopoverOpen, fieldPopoverOpen]);

  function addUploadedImageToCanvas(asset) {
    fabric.FabricImage.fromURL(asset.url, { crossOrigin: 'anonymous' }).then((img) => {
      img.set({ id: newId(), left: 80, top: 80, scaleX: 220 / img.width, scaleY: 220 / img.height });
      const canvas = fabricRef.current;
      canvas.add(img); canvas.setActiveObject(img); setSelected(snapshotObject(img));
    });
  }

  async function handleDeleteUpload(e, asset) {
    e.stopPropagation();
    if (!confirm(`Remove "${asset.name}" from your uploads? This won't affect designs that already use it.`)) return;
    await api.deleteAsset(asset.key);
    setUploads((u) => u.filter((a) => a.key !== asset.key));
  }

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
      cornerRadius: obj.type === 'rect' ? (obj.rx || 0) : (obj.type === 'image' && obj.clipPath ? Math.round((obj.clipPath.rx || 0) * (obj.scaleX || 1)) : 0),
      fillcraftField: obj.fillcraftField || null,
    };
  }

  function refreshSelectedSnapshot() {
    const obj = fabricRef.current?.getActiveObject();
    if (obj) setSelected(snapshotObject(obj));
  }

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

  function addText() {
    const canvas = fabricRef.current;
    const t = new fabric.Textbox('New text', { id: newId(), left: 60, top: 60, width: 260, fontSize: 28, fontFamily: 'Inter', fill: '#111111', fontWeight: 'normal' });
    canvas.add(t); canvas.setActiveObject(t); setSelected(snapshotObject(t));
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
      if (leftTab === 'uploads') api.listAssets().then(setUploads).catch(() => {});
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
    if (obj.type === 'activeselection') obj.getObjects().forEach((o) => canvas.remove(o));
    else canvas.remove(obj);
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

  function applyCornerRadius(radius) {
    const canvas = fabricRef.current;
    const obj = canvas.getActiveObject();
    if (!obj) return;
    if (obj.type === 'rect') {
      obj.set({ rx: radius, ry: radius });
    } else if (obj.type === 'image') {
      obj.clipPath = radius > 0 ? new fabric.Rect({
        width: obj.width, height: obj.height,
        rx: radius / (obj.scaleX || 1), ry: radius / (obj.scaleY || 1),
        originX: 'center', originY: 'center',
      }) : null;
    }
    canvas.requestRenderAll();
    refreshSelectedSnapshot();
  }

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
    if (bgObj) { bgObj.set({ fill: color }); canvas.requestRenderAll(); }
  }

  function selectFont(family) {
    const custom = customFonts.find((f) => f.family_name === family);
    const loadPromise = custom ? loadCustomFontInBrowser(custom.family_name, custom.file_url) : loadGoogleFontInBrowser(family);
    applyToSelected({ fontFamily: family });
    // Re-render once the real glyphs are ready — applyToSelected() already
    // painted immediately with whatever was cached/fallback, so this is
    // what actually swaps it to the correct font a moment later.
    loadPromise.then(() => fabricRef.current?.requestRenderAll());
  }

  async function uploadFontFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const familyName = (newFontName || file.name.replace(/\.[^.]+$/, '')).trim();
    if (!familyName) { setError('Give the font a name before uploading.'); return; }
    setFontUploading(true);
    try {
      const font = await api.uploadCustomFont(file, familyName);
      setCustomFonts((f) => [...f, font]);
      setNewFontName('');
    } catch (err) {
      setError(`Font upload failed: ${err.message}`);
    } finally {
      setFontUploading(false);
    }
  }

  const saveDesign = useCallback(async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    setSaving(true);
    setError('');
    try {
      const json = canvas.toObject(['id', 'fillcraftField']);
      const updated = await api.updateDesign(designId, { canvas_json: json });
      setDesign(updated);
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [designId]);

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
  // Rounded the same way canvas.setDimensions() rounds the real canvas
  // backing store (see the zoom-sync effect above) — any mismatch between
  // this wrapper's CSS size and the canvas's actual pixel size leaves a
  // hairline gap on an edge where the wrapper's dark background shows
  // through, which is its own small version of the same "edges don't line
  // up" problem as the border-radius issue fixed alongside this.
  const displayW = Math.round((design?.width || 0) * effectiveScale);
  const displayH = Math.round((design?.height || 0) * effectiveScale);
  const isTextSelected = selected && (selected.type === 'textbox' || selected.type === 'text' || selected.type === 'i-text');
  const isGroupSelected = selected && selected.type === 'group';
  const isBackground = selected?.id === 'background';

  return (
    <div className="editor-page">
      <div className="editor-topbar">
        <button className="ghost-btn" onClick={onBack}>← Back</button>
        <span className="toolbar-sep" />

        {selected && !multiSelected && (
          <div className="context-bar">
            {isTextSelected && (
              <>
                <select
                  className="context-font-input"
                  value={selected.fontFamily || 'Inter'}
                  onChange={(e) => selectFont(e.target.value)}
                >
                  {customFonts.length > 0 && (
                    <optgroup label="Your fonts">
                      {customFonts.map((f) => <option key={f.family_name} value={f.family_name}>{f.family_name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Google Fonts">
                    {(googleFonts.length ? googleFonts : ['Inter']).map((f) => <option key={f} value={f}>{f}</option>)}
                  </optgroup>
                </select>
                <input type="number" className="context-num" value={selected.fontSize || 24} onChange={(e) => applyToSelected({ fontSize: Number(e.target.value) })} />
                <button className={`ctx-icon-btn ${selected.fontWeight === 'bold' ? 'active' : ''}`} onClick={() => applyToSelected({ fontWeight: selected.fontWeight === 'bold' ? 'normal' : 'bold' })} title="Bold"><b>B</b></button>
                <button className={`ctx-icon-btn ${selected.fontStyle === 'italic' ? 'active' : ''}`} onClick={() => applyToSelected({ fontStyle: selected.fontStyle === 'italic' ? 'normal' : 'italic' })} title="Italic"><i>I</i></button>
                <select value={selected.textAlign || 'left'} onChange={(e) => applyToSelected({ textAlign: e.target.value })}>
                  <option value="left">⇤</option>
                  <option value="center">↔</option>
                  <option value="right">⇥</option>
                </select>
                <input type="color" value={selected.fill || '#111111'} onChange={(e) => applyToSelected({ fill: e.target.value })} title="Text color" />
              </>
            )}

            {!isTextSelected && !isBackground && selected.type !== 'image' && selected.type !== 'group' && (
              <input type="color" value={selected.fill || '#D9A441'} onChange={(e) => applyToSelected({ fill: e.target.value })} title="Fill color" />
            )}
            {isBackground && (
              <input type="color" value={canvasBg} onChange={(e) => updateCanvasBackground(e.target.value)} title="Canvas background color" />
            )}

            {(selected.type === 'rect' || selected.type === 'circle' || selected.type === 'triangle' || selected.type === 'line') && (
              <>
                <input type="color" value={selected.stroke || '#000000'} onChange={(e) => applyToSelected({ stroke: e.target.value })} title="Stroke color" />
                <input type="number" className="context-num" value={selected.strokeWidth || 0} onChange={(e) => applyToSelected({ strokeWidth: Number(e.target.value) })} title="Stroke width" />
              </>
            )}

            {(selected.type === 'rect' || selected.type === 'image') && (
              <span className="ctx-slider-group" title="Corner radius">
                ⌐<input type="range" min="0" max={Math.round(Math.min(selected.width, selected.height) / 2)} value={selected.cornerRadius || 0} onChange={(e) => applyCornerRadius(Number(e.target.value))} />
              </span>
            )}

            <span className="ctx-slider-group" title="Opacity">
              ◐<input type="range" min="0" max="1" step="0.05" value={selected.opacity ?? 1} onChange={(e) => applyToSelected({ opacity: Number(e.target.value) })} />
            </span>

            <span className="toolbar-sep" />
            <div className="align-row compact">
              <button onClick={() => alignSelected('left')} title="Align left">⇤</button>
              <button onClick={() => alignSelected('center-h')} title="Center horizontally">↔</button>
              <button onClick={() => alignSelected('right')} title="Align right">⇥</button>
              <button onClick={() => alignSelected('top')} title="Align top">⤒</button>
              <button onClick={() => alignSelected('center-v')} title="Center vertically">↕</button>
              <button onClick={() => alignSelected('bottom')} title="Align bottom">⤓</button>
            </div>
            <div className="align-row compact">
              <button onClick={() => layerAction('back')} title="Send to back">⇊</button>
              <button onClick={() => layerAction('backward')} title="Send backward">↓</button>
              <button onClick={() => layerAction('forward')} title="Bring forward">↑</button>
              <button onClick={() => layerAction('front')} title="Bring to front">⇈</button>
            </div>
            <span className="toolbar-sep" />

            <div className="ctx-popover-anchor">
              <button
                className={`ctx-icon-btn ${positionPopoverOpen ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setPositionPopoverOpen((v) => !v); setFieldPopoverOpen(false); }}
                title="Position, size &amp; rotation"
              >⊹</button>
              {positionPopoverOpen && (
                <div className="ctx-popover" onClick={(e) => e.stopPropagation()}>
                  <div className="field-row">
                    <div className="field"><label>X</label><input type="number" value={selected.left} onChange={(e) => applyBBox({ left: Number(e.target.value) })} /></div>
                    <div className="field"><label>Y</label><input type="number" value={selected.top} onChange={(e) => applyBBox({ top: Number(e.target.value) })} /></div>
                  </div>
                  <div className="field-row">
                    <div className="field"><label>W</label><input type="number" value={selected.width} onChange={(e) => applyBBox({ width: Number(e.target.value) })} /></div>
                    <div className="field"><label>H</label><input type="number" value={selected.height} onChange={(e) => applyBBox({ height: Number(e.target.value) })} /></div>
                  </div>
                  <div className="field">
                    <label>Rotation — or drag the handle on the selected element</label>
                    <input type="number" value={selected.angle} onChange={(e) => applyBBox({ angle: Number(e.target.value) })} />
                  </div>
                  {isGroupSelected && <button className="ghost-btn full" onClick={ungroupSelected}>Ungroup</button>}
                </div>
              )}
            </div>

            {!isBackground && (
              <div className="ctx-popover-anchor">
                <button
                  className={`ctx-icon-btn ${selected.fillcraftField ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!selected.fillcraftField) { toggleField(true); setFieldPopoverOpen(true); }
                    else setFieldPopoverOpen((v) => !v);
                    setPositionPopoverOpen(false);
                  }}
                  title={selected.fillcraftField ? 'Autofill field — click to edit' : 'Mark as autofill field'}
                >🏷</button>
                {fieldPopoverOpen && selected.fillcraftField && (
                  <div className="ctx-popover" onClick={(e) => e.stopPropagation()}>
                    <div className="field">
                      <label>Field label (used by the n8n API)</label>
                      <input type="text" value={selected.fillcraftField.label} onChange={(e) => updateFieldMeta({ label: e.target.value })} autoFocus />
                    </div>
                    {selected.fillcraftField.field_type === 'text' && (
                      <div className="field">
                        <label>Max characters</label>
                        <input type="number" value={selected.fillcraftField.max_characters || 200} onChange={(e) => updateFieldMeta({ max_characters: Number(e.target.value) })} />
                      </div>
                    )}
                    <button className="ghost-btn full" onClick={() => { toggleField(false); setFieldPopoverOpen(false); }}>Remove field</button>
                  </div>
                )}
              </div>
            )}

            <span className="toolbar-sep" />
            <button className="ctx-icon-btn" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">⧉</button>
            {!isBackground && <button className="ctx-icon-btn danger" onClick={deleteSelected} title="Delete">🗑</button>}
          </div>
        )}

        {multiSelected && (
          <div className="context-bar">
            <button className="ghost-btn" onClick={groupSelected}>Group</button>
            <button className="ctx-icon-btn danger" onClick={deleteSelected} title="Delete selected">🗑</button>
          </div>
        )}

        {!selected && design && (
          <div className="context-bar">
            <span className="ctx-slider-group" title="Canvas background">
              <input type="color" value={canvasBg} onChange={(e) => updateCanvasBackground(e.target.value)} />
              <span className="hint-text">{design.width} × {design.height}px</span>
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button className="ghost-btn" onClick={saveDesign} disabled={saving || !design}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="primary-btn" onClick={openPreview} disabled={!design}>Preview autofill</button>
        <button className="danger-btn" onClick={handleDeleteDesign} disabled={!design}>🗑 Delete design</button>
      </div>

      {error && <div className="error-text" style={{ padding: '8px 16px' }}>{error}</div>}

      <div className="editor-body">
        <div className={`left-panel ${leftPanelOpen ? '' : 'collapsed'}`}>
          <button className="left-panel-toggle" onClick={() => setLeftPanelOpen((v) => !v)} title={leftPanelOpen ? 'Collapse' : 'Expand'}>
            {leftPanelOpen ? '‹' : '›'}
          </button>
          {leftPanelOpen && (
            <>
              <div className="left-panel-tabs">
                <button className={leftTab === 'elements' ? 'active' : ''} onClick={() => setLeftTab('elements')}>Elements</button>
                <button className={leftTab === 'uploads' ? 'active' : ''} onClick={() => setLeftTab('uploads')}>Uploads</button>
              </div>

              {leftTab === 'elements' && (
                <div className="left-panel-content">
                  <div className="left-section-title">Text</div>
                  <button className="left-panel-item wide" onClick={addText} disabled={!design}>+ Add text box</button>

                  <div className="left-section-title">Shapes &amp; lines</div>
                  <div className="shape-grid">
                    <button onClick={addRect} disabled={!design} title="Rectangle">▭</button>
                    <button onClick={addCircle} disabled={!design} title="Circle">◯</button>
                    <button onClick={addTriangle} disabled={!design} title="Triangle">△</button>
                    <button onClick={addLine} disabled={!design} title="Line">╱</button>
                    <button onClick={addStar} disabled={!design} title="Star">★</button>
                    <button onClick={() => setIconPickerOpen(true)} disabled={!design} title="Icon">☺</button>
                  </div>

                  <div className="left-section-title">Media</div>
                  <label className="left-panel-item wide" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5 }}>
                    + Upload image
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={addImage} disabled={!design} />
                  </label>
                  <label className="left-panel-item wide" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5 }}>
                    Import SVG
                    <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={importSvg} disabled={!design} />
                  </label>

                  <div className="left-section-title">Fonts</div>
                  <input
                    type="text" className="left-panel-item wide" placeholder="Font name (e.g. My Brand Sans)"
                    value={newFontName} onChange={(e) => setNewFontName(e.target.value)} disabled={!design}
                    style={{ marginBottom: 6 }}
                  />
                  <label className="left-panel-item wide" style={{ cursor: design && !fontUploading ? 'pointer' : 'default', opacity: design && !fontUploading ? 1 : 0.5 }}>
                    {fontUploading ? 'Uploading…' : '+ Upload font (.ttf, .otf, .woff, .woff2)'}
                    <input type="file" accept=".ttf,.otf,.woff,.woff2" style={{ display: 'none' }} onChange={uploadFontFile} disabled={!design || fontUploading} />
                  </label>
                  {customFonts.length > 0 && <div className="hint-text">{customFonts.length} custom font{customFonts.length === 1 ? '' : 's'} — pick it from the font dropdown on any text box.</div>}

                  <div className="left-section-title">History</div>
                  <div className="align-row">
                    <button onClick={undo} disabled={!design} title="Undo (Ctrl+Z)">↶ Undo</button>
                    <button onClick={redo} disabled={!design} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
                  </div>
                </div>
              )}

              {leftTab === 'uploads' && (
                <div className="left-panel-content">
                  <label className="left-panel-item wide" style={{ cursor: design ? 'pointer' : 'default', opacity: design ? 1 : 0.5, marginBottom: 12 }}>
                    + Upload new
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={addImage} disabled={!design} />
                  </label>
                  {uploadsLoading && <div className="hint-text">Loading…</div>}
                  {!uploadsLoading && uploads.length === 0 && <div className="hint-text">Nothing uploaded yet.</div>}
                  <div className="uploads-grid">
                    {uploads.map((a) => (
                      <div key={a.key} className="upload-item" onClick={() => addUploadedImageToCanvas(a)} title={a.name}>
                        <img src={a.url} alt={a.name} />
                        <span className="upload-item-menu" onClick={(e) => handleDeleteUpload(e, a)} title="Remove">⋯</span>
                        <div className="upload-item-name">{a.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="canvas-viewport" ref={canvasViewportRef}>
          <div className="canvas-stage" style={{ width: displayW || 400, height: displayH || 300, position: 'relative' }}>
            {!design && <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>Loading design…</div>}
            <canvas ref={canvasElRef} />
          </div>
        </div>
      </div>

      <div className="editor-bottombar">
        <button className="ghost-btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}>−</button>
        <input
          type="range" min="0.25" max="3" step="0.01" value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="zoom-slider"
        />
        <button className="ghost-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>+</button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="ghost-btn" onClick={() => setZoom(1)}>Fit</button>
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
