import { useEffect, useState } from 'react';
import { api } from '../api.js';

function FieldLabel({ label, hasOriginal, onRevert, hint }) {
  return (
    <div className="field-label-row">
      <label>{label}{hint ? <span className="field-hint"> {hint}</span> : null}</label>
      {hasOriginal && (
        <button type="button" className="revert-icon" title="Revert this property to the original" onClick={onRevert}>
          ↺ original
        </button>
      )}
    </div>
  );
}

export default function RegionInspector({ region, onChange, onReset, onDelete }) {
  const [googleFonts, setGoogleFonts] = useState([]);
  const [customFonts, setCustomFonts] = useState([]);
  const [uploadingFont, setUploadingFont] = useState(false);

  useEffect(() => {
    api.listGoogleFonts().then(setGoogleFonts).catch(() => {});
    api.listCustomFonts().then(setCustomFonts).catch(() => {});
  }, []);

  const style = region.current_style || {};
  const originalStyle = region.original_style || {};
  const originalProps = region.original_properties || {};

  function updateStyle(patch) {
    onChange({ current_style: { ...style, ...patch } });
  }

  // "Original" here always means: the value this property had the moment
  // the region was created/first saved — not an auto-detected value from
  // the source image. Pick it once, and you can always come back to it.
  function styleField(key) {
    const hasOriginal = originalStyle[key] !== undefined && originalStyle[key] !== null && originalStyle[key] !== style[key];
    return { hasOriginal, onRevert: () => updateStyle({ [key]: originalStyle[key] }) };
  }
  function propField(key) {
    const hasOriginal = originalProps[key] !== undefined && originalProps[key] !== null && originalProps[key] !== region[key];
    return { hasOriginal, onRevert: () => onChange({ [key]: originalProps[key] }) };
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

      {region.type === 'text' && (
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
            <FieldLabel label="Font family" {...styleField('font_family')} />
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
            <div>
              <FieldLabel label="Size" {...styleField('font_size')} />
              <input type="number" value={style.font_size ?? 24} onChange={(e) => updateStyle({ font_size: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Color" {...styleField('color')} />
              <input type="color" value={style.color ?? '#111111'} onChange={(e) => updateStyle({ color: e.target.value })} />
            </div>
          </div>

          <div className="field row2">
            <div>
              <FieldLabel label="Weight" {...styleField('font_weight')} />
              <select value={style.font_weight ?? 'normal'} onChange={(e) => updateStyle({ font_weight: e.target.value })}>
                <option value="normal">Normal</option>
                <option value="bold">Bold</option>
              </select>
            </div>
            <div>
              <FieldLabel label="Style" {...styleField('italic')} />
              <select value={style.italic ? 'italic' : 'normal'} onChange={(e) => updateStyle({ italic: e.target.value === 'italic' })}>
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>

          <div className="field">
            <FieldLabel label="Alignment" {...styleField('align')} />
            <select value={style.align ?? 'left'} onChange={(e) => updateStyle({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>

          <div className="field row2">
            <div>
              <FieldLabel label="Line height" {...styleField('line_height')} />
              <input type="number" step="0.1" value={style.line_height ?? 1.3} onChange={(e) => updateStyle({ line_height: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Letter spacing" {...styleField('letter_spacing')} />
              <input type="number" step="0.5" value={style.letter_spacing ?? 0} onChange={(e) => updateStyle({ letter_spacing: Number(e.target.value) })} />
            </div>
          </div>

          <div className="field">
            <FieldLabel label="Text transform" {...styleField('text_transform')} />
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
            <div>
              <FieldLabel label="Opacity" {...styleField('opacity')} />
              <input type="number" step="0.1" min="0" max="1" value={style.opacity ?? 1} onChange={(e) => updateStyle({ opacity: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Rotation°" {...styleField('rotation')} />
              <input type="number" value={style.rotation ?? 0} onChange={(e) => updateStyle({ rotation: Number(e.target.value) })} />
            </div>
          </div>

          <div className="field">
            <label><input type="checkbox" checked={region.auto_shrink_to_fit !== false} onChange={(e) => onChange({ auto_shrink_to_fit: e.target.checked })} /> Auto-shrink to fit box</label>
          </div>

          <button className="ghost-btn full" onClick={onReset}>↺ Reset all properties to original</button>
        </>
      )}

      {region.type === 'image' && (
        <>
          <div className="field">
            <FieldLabel label="Fit mode" {...propField('fit_mode')} />
            <select value={region.fit_mode ?? 'cover'} onChange={(e) => onChange({ fit_mode: e.target.value })}>
              <option value="cover">Cover (crop to fill)</option>
              <option value="contain">Contain (fit inside, no crop)</option>
              <option value="fill">Fill (stretch)</option>
            </select>
          </div>
          <div className="field">
            <FieldLabel label="Filter" {...propField('filter')} />
            <select value={region.filter ?? ''} onChange={(e) => onChange({ filter: e.target.value || null })}>
              <option value="">None</option>
              <option value="grayscale">Grayscale</option>
              <option value="duotone">Duotone</option>
            </select>
          </div>
          <div className="field row2">
            <div>
              <FieldLabel label="Corner radius" {...propField('corner_radius')} />
              <input type="number" value={region.corner_radius ?? 0} onChange={(e) => onChange({ corner_radius: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Rotation°" {...propField('rotation')} />
              <input type="number" value={region.rotation ?? 0} onChange={(e) => onChange({ rotation: Number(e.target.value) })} />
            </div>
          </div>
          <div className="field row2">
            <div>
              <FieldLabel label="Border width" {...propField('border_width')} />
              <input type="number" value={region.border_width ?? 0} onChange={(e) => onChange({ border_width: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Border color" {...propField('border_color')} />
              <input type="color" value={region.border_color ?? '#000000'} onChange={(e) => onChange({ border_color: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <FieldLabel label="Opacity" {...propField('opacity')} />
            <input type="number" step="0.1" min="0" max="1" value={region.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
          </div>
          <button className="ghost-btn full" onClick={onReset}>↺ Reset all properties to original</button>
        </>
      )}

      {region.type === 'shape' && (
        <>
          <div className="field">
            <FieldLabel label="Shape" {...propField('shape_type')} />
            <select value={region.shape_type ?? 'rectangle'} onChange={(e) => onChange({ shape_type: e.target.value })}>
              <option value="rectangle">Rectangle</option>
              <option value="circle">Circle / ellipse</option>
              <option value="line">Line</option>
              <option value="arrow">Arrow</option>
              <option value="polygon">Polygon</option>
            </select>
          </div>
          {region.shape_type === 'polygon' && (
            <div className="field">
              <FieldLabel label="Sides" {...propField('sides')} />
              <input type="number" min="3" value={region.sides ?? 6} onChange={(e) => onChange({ sides: Number(e.target.value) })} />
            </div>
          )}
          <div className="field row2">
            <div>
              <FieldLabel label="Fill color" {...propField('fill_color')} />
              <input type="color" value={region.fill_color ?? '#D9A441'} onChange={(e) => onChange({ fill_color: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="Corner radius" {...propField('corner_radius')} />
              <input type="number" value={region.corner_radius ?? 0} onChange={(e) => onChange({ corner_radius: Number(e.target.value) })} disabled={region.shape_type !== 'rectangle'} />
            </div>
          </div>
          <div className="field row2">
            <div>
              <FieldLabel label="Stroke color" {...propField('stroke_color')} />
              <input type="color" value={region.stroke_color ?? '#000000'} onChange={(e) => onChange({ stroke_color: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="Stroke width" {...propField('stroke_width')} />
              <input type="number" value={region.stroke_width ?? 0} onChange={(e) => onChange({ stroke_width: Number(e.target.value) })} />
            </div>
          </div>
          <div className="field row2">
            <div>
              <FieldLabel label="Opacity" {...propField('opacity')} />
              <input type="number" step="0.1" min="0" max="1" value={region.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Rotation°" {...propField('rotation')} />
              <input type="number" value={region.rotation ?? 0} onChange={(e) => onChange({ rotation: Number(e.target.value) })} />
            </div>
          </div>
          <button className="ghost-btn full" onClick={onReset}>↺ Reset all properties to original</button>
        </>
      )}

      {region.type === 'icon' && (
        <>
          <div className="field">
            <FieldLabel label="Icon" hint="format: prefix:name — browse icon-sets.iconify.design" {...propField('icon_name')} />
            <input type="text" value={region.icon_name ?? ''} onChange={(e) => onChange({ icon_name: e.target.value })} placeholder="mdi:heart" />
          </div>
          {region.icon_name && (
            <div className="icon-preview">
              <img
                src={`https://api.iconify.design/${region.icon_name.replace(':', '/')}.svg?color=${encodeURIComponent(region.icon_color || '#000000')}`}
                alt="icon preview"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
          )}
          <div className="field">
            <FieldLabel label="Color" {...propField('icon_color')} />
            <input type="color" value={region.icon_color ?? '#D9A441'} onChange={(e) => onChange({ icon_color: e.target.value })} />
          </div>
          <div className="field row2">
            <div>
              <FieldLabel label="Opacity" {...propField('opacity')} />
              <input type="number" step="0.1" min="0" max="1" value={region.opacity ?? 1} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
            </div>
            <div>
              <FieldLabel label="Rotation°" {...propField('rotation')} />
              <input type="number" value={region.rotation ?? 0} onChange={(e) => onChange({ rotation: Number(e.target.value) })} />
            </div>
          </div>
          <button className="ghost-btn full" onClick={onReset}>↺ Reset all properties to original</button>
        </>
      )}

      <button className="danger-btn full" onClick={onDelete}>Delete region</button>
    </div>
  );
}
