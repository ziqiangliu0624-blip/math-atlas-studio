import { useState } from 'react';
import { GEOMETRY_NAMES, normalizeGeometry } from '../math/geometry.js';

export default function GeometryCreator({ onCreate, onClose }) {
  const [kind, setKind] = useState('point');
  const [values, setValues] = useState({ ax: '0', ay: '0', bx: '2', by: '1', text: '文字标注' });
  const [error, setError] = useState('');
  const single = kind === 'point' || kind === 'text';
  return <form className="view-settings geometry-creator" onSubmit={e => {
    e.preventDefault();
    const number = key => values[key].trim() ? Number(values[key]) : NaN;
    try {
      const geometry = normalizeGeometry({ kind, points: [[number('ax'), number('ay')], ...(!single ? [[number('bx'), number('by')]] : [])], ...(kind === 'text' ? { text: values.text, fontSize: 16, rotation: 0 } : {}) });
      onCreate(geometry); onClose();
    } catch (err) { setError(err.message); }
  }}>
    <div className="view-settings-heading"><strong>用坐标创建几何对象</strong><button type="button" aria-label="关闭坐标创建" onClick={onClose}>×</button></div>
    <div className="export-fields"><label>对象类型<select aria-label="创建对象类型" value={kind} onChange={e => { setKind(e.target.value); setError(''); }}>{Object.entries(GEOMETRY_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>{[['ax', '起点 X'], ['ay', '起点 Y'], ...(!single ? [['bx', '终点 X'], ['by', '终点 Y']] : [])].map(([key, label]) => <label key={key}>{label}<input autoFocus={key === 'ax'} type="number" step="any" aria-label={label} value={values[key]} onChange={e => setValues({ ...values, [key]: e.target.value })} /></label>)}</div>
    {kind === 'text' && <label className="geometry-text">文字内容<textarea aria-label="创建文字内容" value={values.text} maxLength={500} onChange={e => setValues({ ...values, text: e.target.value })} /></label>}
    <div className="view-settings-bottom"><span>直线由两个不同点确定，向量从起点指向终点。</span><button className="text-button" type="submit">创建{GEOMETRY_NAMES[kind]}</button></div>{error && <div className="field-error" role="alert">{error}</div>}
  </form>;
}
