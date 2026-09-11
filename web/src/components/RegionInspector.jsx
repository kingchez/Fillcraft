import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function RegionInspector({ region, onChange, onReset, onDelete }) {
  const [googleFonts, setGoogleFonts] = useState([]);
  const [customFonts, setCustomFonts] = useState([]);
  const [uploadingFont, setUploadingFont] = useState(false);

  useEffect(() => {
    api.listGoogleFonts().then(setGoogleFonts).catch(() => {});
    api.listCustomFonts().then(setCustomFonts).catch(() => {});
  }, []);

  const style = region.current_style || {};

  function updateStyle(patch) {
    onChange({ current_style: { ...style, ...patch } });
  }

  async function handleFontUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const familyName = prompt('Name this font family (e.g. "Brand Sans"):', file.name.replace(/\.[^.]+$/, ''));
    if (!familyName) return;
    setUploadingFont(true);
    try {
      const fd = new FormData();
      fd.append('font', file);
      fd.append('family_name', familyName);
      const font = await api.uploadCustomFont(fd);
      setCustomFonts((f) => [...f, font]);
      updateStyle({ font_family: familyName });
    } finally {
      setUploadingFont(false);
    }
  }

  return (
    <div className="inspector">
      <div className="sidebar-title">
        {region.label} <span className="tag">{region.type}</span>
      </div>

      <div className="field row2">
        <div><label>X</label><input type="number" value={Math.round(region.x)} onChange={(e) => onChange({ x: Number(e.target.value) })} /></div>
        <div><label>Y</label><input type="number" value={Math.round(region.y)} onChange={(e) => onChange({ y: Number(e.target.value) })} /></div>
      </div>
      <div className="field row2">
        <div><label>Width</label><input type="number" value={Math.round(region.width)} onChange={(e) => onChange({ width: Number(e.target.value) })} /></div>
        <div><label>Height</label><input type="number" value={Math.round(region.height)} onChange={(e) => onChange({ height: Number(e.target.value) })} /></div>
      </div>

      {region.type === 'text' ? (
        <>
          <div className="field">
            <label>Max characters</label>
            <input
              type="number"
              value={region.max_characters ?? ''}
              onChange={(e) => onChange({ max_characters: e.target.value ? Number(e.target.value) : null })}
            />
          </div>

          <div className="field">
            <label>Font family</label>
            <select value={style.font_family || ''} onChange={(e) => updateStyle({ font_family: e.target.value })}>
              <optgroup label="Custom fonts">
                {customFonts.map((f) => <option key={f.id} value={f.family_name}>{f.family_name}</option>)}
              </optgroup>
              <optgroup label="Google Fonts">
                {googleFonts.map((f) => <option key={f} value={f}>{f}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label>Or upload a custom font file</label>
            <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} disabled={uploadingFont} />
          </div>

          <div className="field row2">
            <div><label>Size</label><input type="number" value={style.font_size ?? 24} onChange={(e) => updateStyle({ font_size: Number(e.target.value) })} /></div>
            <div><label>Color</label><input type="color" value={style.color ?? '#111111'} onChange={(e) => updateStyle({ color: e.target.value })} /></div>
          </div>

          <div className="field row2">
            <div>
              <label>Weight</label>
              <select value={style.font_weight ?? 'normal'} onChange={(e) => updateStyle({ font_weight: e.target.value })}>
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </div>
            <div>
              <label>Style</label>
              <select value={style.italic ? 'italic' : 'normal'} onChange={(e) => updateStyle({ italic: e.target.value === 'italic' })}>
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>Alignment</label>
            <select value={style.align ?? 'left'} onChange={(e) => updateStyle({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>

          <div className="field row2">
            <div><label>Line height</label><input type="number" step="0.1" value={style.line_height ?? 1.3} onChange={(e) => updateStyle({ line_height: Number(e.target.value) })} /></div>
            <div><label>Letter spacing</label><input type="number" step="0.5" value={style.letter_spacing ?? 0} onChange={(e) => updateStyle({ letter_spacing: Number(e.target.value) })} /></div>
          </div>

          <div className="field">
            <label>Text transform</label>
            <select value={style.text_transform ?? 'none'} onChange={(e) => updateStyle({ text_transform: e.target.value })}>
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>

          <div className="field row2 checkboxes">
            <label><input type="checkbox" checked={!!style.underline} onChange={(e) => updateStyle({ underline: e.target.checked })} /> Underline</label>
            <label><input type="checkbox" checked={!!style.strikethrough} onChange={(e) => updateStyle({ strikethrough: e.target.checked })} /> Strikethrough</label>
          </div>

          <div className="field row2">
            <div><label>Opacity</label><input type="number" step="0.1" min="0" max="1" value={style.opacity ?? 1} onChange={(e) => updateStyle({ opacity: Number(e.target.value) })} /></div>
            <div><label>Rotation°</label><input type="number" value={style.rotation ?? 0} onChange={(e) => updateStyle({ rotation: Number(e.target.value) })} /></div>
          </div>

          <div className="field">
            <label><input type="checkbox" checked={region.auto_shrink_to_fit !== false} onChange={(e) => onChange({ auto_shrink_to_fit: e.target.checked })} /> Auto-shrink to fit box</label>
          </div>

          <button className="ghost-btn full" onClick={onReset}>↺ Reset to original style</button>
        </>
      ) : (
        <>
          <div className="field">
            <label>Fit mode</label>
            <select value={region.fit_mode ?? 'cover'} onChange={(e) => onChange({ fit_mode: e.target.value })}>
              <option value="cover">Cover (crop to fill)</option>
              <option value="contain">Contain (fit inside, no crop)</option>
              <option value="fill">Fill (stretch)</option>
            </select>
          </div>
          <div className="field row2">
            <div><label>Corner radius</label><input type="number" value={region.corner_radius ?? 0} onChange={(e) => onChange({ corner_radius: Number(e.target.value) })} /></div>
            <div><label>Rotation°</label><input type="number" value={region.rotation ?? 0} onChange={(e) => onChange({ rotation: Number(e.target.value) })} /></div>
          </div>
          <div className="field row2">
            <div><label>Border width</label><input type="number" value={region.border_width ?? 0} onChange={(e) => onChange({ border_width: Number(e.target.value) })} /></div>
            <div><label>Border color</label><input type="color" value={region.border_color ?? '#000000'} onChange={(e) => onChange({ border_color: e.target.value })} /></div>
          </div>
          <div className="field">
            <label>Opacity</label>
            <input type="number" step="0.1" min="0" max="1" value={region.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
          </div>
        </>
      )}

      <button className="danger-btn full" onClick={onDelete}>Delete region</button>
    </div>
  );
}
