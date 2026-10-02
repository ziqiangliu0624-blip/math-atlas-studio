import { useState } from 'react';
import { exportDimensions } from '../math/geometry.js';

export default function ExportSettings({ canvas, target, onExport, onClose }) {
  const [options, setOptions] = useState({ width: String(Math.max(64, Math.round(canvas?.clientWidth || 1200))), height: String(Math.max(64, Math.round(canvas?.clientHeight || 800))), scale: '1', transparent: false });
  const [error, setError] = useState('');
  let dimensions;
  try { dimensions = exportDimensions(options, {}); } catch { /* Submit shows validation. */ }
  return <form className="view-settings export-settings" onSubmit={e => { e.preventDefault(); try { const next = exportDimensions(options, {}); setError(''); onExport(target, next); } catch (err) { setError(err.message); } }}>
    <div className="view-settings-heading"><strong>导出 {target.toUpperCase()} 画布 PNG</strong><button type="button" aria-label="关闭导出设置" onClick={onClose}>×</button></div>
    <div className="export-fields">{[['width', '图像宽度'], ['height', '图像高度']].map(([key, label]) => <label key={key}>{label}<input type="number" min="64" max="8192" step="1" aria-label={label} value={options[key]} onChange={e => setOptions({ ...options, [key]: e.target.value })} /></label>)}<label>清晰度倍率<select aria-label="清晰度倍率" value={options.scale} onChange={e => setOptions({ ...options, scale: e.target.value })}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}×</option>)}</select></label><label className="check-field"><input type="checkbox" checked={options.transparent} onChange={e => setOptions({ ...options, transparent: e.target.checked })} />透明背景</label></div>
    <div className="view-settings-bottom"><span>{dimensions ? `输出 ${dimensions.pixelWidth} × ${dimensions.pixelHeight} 像素` : '请选择有效尺寸'}</span><button className="text-button" type="submit">保存 PNG</button></div>{error && <div className="field-error" role="alert">{error}</div>}
    <p>保留坐标网格，隐藏选中控制点。调整宽高会扩展画面以保留当前范围。</p>
  </form>;
}
