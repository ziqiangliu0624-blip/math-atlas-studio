import { useEffect, useState } from 'react';
import { validView, normalizeBox } from '../math/view.js';

export default function ViewSettings({ target, view, box, aspectLocked, onApply, onAspect, onBox, onClose }) {
  const initial = target === '2d' ? { x: [view.xmin, view.xmax], y: [view.ymin, view.ymax] } : box;
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(initial).map(([axis, pair]) => [axis, pair.map(String)])));
  const [error, setError] = useState('');
  useEffect(() => {
    const ranges = target === '2d' ? { x: [view.xmin, view.xmax], y: [view.ymin, view.ymax] } : box;
    setDraft(Object.fromEntries(Object.entries(ranges).map(([axis, pair]) => [axis, pair.map(String)])));
  }, [target, view, box]);
  const submit = event => {
    event.preventDefault();
    const parsed = Object.fromEntries(Object.entries(draft).map(([axis, pair]) => [axis, pair.map(value => value.trim() ? Number(value) : NaN)]));
    if (target === '2d') {
      const next = { xmin: parsed.x[0], xmax: parsed.x[1], ymin: parsed.y[0], ymax: parsed.y[1] };
      if (!validView(next)) { setError('请输入递增的有限范围；端点不超过 10¹²，跨度不能过小。'); return; }
      onApply(next);
    } else {
      if (JSON.stringify(normalizeBox(parsed)) !== JSON.stringify(parsed)) { setError('各轴范围须递增，跨度至少 0.001，端点在 −1000 到 1000 之间。'); return; }
      onBox(parsed);
    }
    setError('');
  };
  return <form className="view-settings" aria-label={`${target.toUpperCase()} 视图设置`} onSubmit={submit}>
    <div className="view-settings-heading"><strong>{target === '2d' ? '二维视图范围' : '三维坐标盒'}</strong><button type="button" onClick={onClose} aria-label="关闭视图设置">×</button></div>
    <div className="view-range-fields">{Object.entries(draft).map(([axis, pair]) => <div className="view-range-axis" key={axis}>
      <span>{axis.toUpperCase()}</span>{pair.map((value, edge) => <label key={edge}><span>{edge ? '最大值' : '最小值'}</span><input type="number" step="any" aria-label={`${target.toUpperCase()} ${axis.toUpperCase()} ${edge ? '最大值' : '最小值'}`} value={value} onChange={event => { setError(''); setDraft(before => ({ ...before, [axis]: before[axis].map((v, i) => i === edge ? event.target.value : v) })); }} /></label>)}
    </div>)}</div>
    <div className="view-settings-bottom">{target === '2d' && <label className="check-field"><input type="checkbox" checked={aspectLocked} onChange={event => onAspect(event.target.checked)} />等比例坐标</label>}<button className="text-button" type="submit">应用范围</button></div>
    <p>{target === '2d' ? '范围控制可见区域；等比例时扩展一轴以适配画布。按 Shift 拖动或启用框选放大。' : '坐标盒仅控制参考网格与边框。绘制域在图层属性中设置；相机缩放改变观察距离，不裁切图形。'}</p>
    {error && <div className="field-error" role="alert">{error}</div>}
  </form>;
}
