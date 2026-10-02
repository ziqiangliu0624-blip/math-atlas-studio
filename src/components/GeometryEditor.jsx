import { useState } from 'react';
import { GEOMETRY_NAMES, geometryCenter, normalizeGeometry, transformGeometry } from '../math/geometry.js';

function NumberField({ label, value, disabled, onCommit }) {
  return <label>{label}<input key={value} aria-label={label} type="number" step="any" defaultValue={value} disabled={disabled} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => {
    const raw = e.currentTarget.value.trim(), n = raw ? Number(raw) : NaN;
    if (n !== value && !onCommit(n)) e.currentTarget.value = String(value);
  }} /></label>;
}

export default function GeometryEditor({ layer, onChange, onInvalid, onDragTool }) {
  const geometry = layer.geometry;
  const [transform, setTransform] = useState({ dx: '0', dy: '0', angle: '90', factor: '2', px: '0', py: '0' });
  const change = next => {
    try { const normalized = normalizeGeometry(next); if (JSON.stringify(normalized) !== JSON.stringify(geometry)) onChange(normalized); return true; } catch (error) { onInvalid(error.message); return false; }
  };
  const apply = kind => {
    const numbers = Object.fromEntries(Object.entries(transform).map(([k, v]) => [k, v.trim() ? Number(v) : NaN]));
    try { change(transformGeometry(geometry, { kind, ...numbers, pivot: [numbers.px, numbers.py] })); } catch (error) { onInvalid(error.message); }
  };
  return <>
    <div className="inspector-section geometry-editor"><div className="field-heading"><span>{GEOMETRY_NAMES[geometry.kind]}的坐标</span><span className="field-kicker">GEOMETRY</span></div>
      {geometry.points.map((point, index) => <div className="geometry-point" key={index}><strong>{geometry.points.length === 1 ? '位置' : index === 0 ? '起点 A' : '终点 B'}</strong><div className="geometry-fields">{point.map((value, axis) => <NumberField key={axis} label={`${index === 0 ? 'A' : 'B'} ${axis === 0 ? 'X' : 'Y'}`} value={value} disabled={layer.locked} onCommit={n => change({ ...geometry, points: geometry.points.map((p, i) => i === index ? p.map((v, a) => a === axis ? n : v) : p) })} />)}</div></div>)}
      {geometry.kind === 'text' && <><label className="geometry-text">文字内容<textarea key={geometry.text} aria-label="文字内容" defaultValue={geometry.text} maxLength={500} disabled={layer.locked} onBlur={e => { if (!change({ ...geometry, text: e.currentTarget.value })) e.currentTarget.value = geometry.text; }} /></label><div className="geometry-fields"><NumberField label="字号" value={geometry.fontSize} disabled={layer.locked} onCommit={fontSize => change({ ...geometry, fontSize })} /><NumberField label="文字角度（°）" value={geometry.rotation} disabled={layer.locked} onCommit={rotation => change({ ...geometry, rotation })} /></div><label className="check-field geometry-reflection"><input type="checkbox" checked={geometry.reflected} disabled={layer.locked} onChange={e => change({ ...geometry, reflected: e.target.checked })} />翻转文字</label></>}
      <p className="domain-hint">拖动对象整体移动，拖动圆形控制点修改坐标。Esc 取消尚未完成的拖动。</p>
    </div>
    <form className="inspector-section geometry-transform" onSubmit={e => e.preventDefault()}><div className="field-heading"><span>几何变换</span><span className="field-kicker">TRANSFORM</span></div>
      <fieldset disabled={layer.locked}><div className="geometry-fields">{[['px', '中心 X'], ['py', '中心 Y']].map(([key, label]) => <label key={key}>{label}<input type="number" step="any" aria-label={label} value={transform[key]} onChange={e => setTransform({ ...transform, [key]: e.target.value })} /></label>)}</div>
      <div className="geometry-actions"><button type="button" onClick={() => setTransform({ ...transform, px: '0', py: '0' })}>原点</button><button type="button" onClick={() => { const [x, y] = geometryCenter(geometry); setTransform({ ...transform, px: String(x), py: String(y) }); }}>对象中心</button></div>
      <div className="geometry-fields">{[['dx', '平移 X'], ['dy', '平移 Y'], ['angle', '旋转角度（°）'], ['factor', '缩放倍数']].map(([key, label]) => <label key={key}>{label}<input type="number" step="any" aria-label={label} value={transform[key]} onChange={e => setTransform({ ...transform, [key]: e.target.value })} /></label>)}</div>
      <div className="geometry-actions">{[['translate', '平移'], ['rotate', '旋转'], ['scale', '缩放'], ['mirrorX', '水平镜像'], ['mirrorY', '垂直镜像']].map(([kind, label]) => <button type="button" key={kind} onClick={() => apply(kind)}>{label}</button>)}</div>
      <div className="geometry-actions"><button type="button" onClick={() => onDragTool('rotate')}>拖动旋转</button><button type="button" onClick={() => onDragTool('scale')}>拖动缩放</button></div></fieldset>
      <p className="domain-hint">正角度为逆时针。镜像沿通过所填中心的水平／垂直轴；拖动变换围绕对象中心。</p>
    </form>
  </>;
}
