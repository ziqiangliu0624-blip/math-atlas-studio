export const START_VIEW = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 };
export const DEFAULT_BOX = { x: [-6, 6], y: [-6, 6], z: [-6, 6] };

export function validView(view) {
  if (!view) return false;
  const values = ['xmin', 'xmax', 'ymin', 'ymax'].map(key => view[key]);
  const scale = Math.max(1, ...values.map(Math.abs));
  const minimum = Math.max(1e-10, Number.EPSILON * scale * 32);
  return values.every(Number.isFinite) && scale <= 1e12 &&
    view.xmax - view.xmin > minimum && view.ymax - view.ymin > minimum &&
    view.xmax - view.xmin <= 1e12 && view.ymax - view.ymin <= 1e12;
}

// Contain the requested rectangle; equal units expand an axis instead of cropping.
export function equalAspect(view, size, locked) {
  if (!locked || !size?.width || !size?.height || !validView(view)) return view;
  const units = Math.max((view.xmax - view.xmin) / size.width, (view.ymax - view.ymin) / size.height);
  const cx = (view.xmax + view.xmin) / 2, cy = (view.ymax + view.ymin) / 2;
  const result = { xmin: cx - units * size.width / 2, xmax: cx + units * size.width / 2,
    ymin: cy - units * size.height / 2, ymax: cy + units * size.height / 2 };
  return validView(result) ? result : view;
}

export function normalizeStyle(layer = {}) {
  return { lineWidth: Number.isFinite(layer.lineWidth) ? Math.max(1, Math.min(12, layer.lineWidth)) : 2.3,
    lineStyle: ['solid', 'dashed', 'dotted'].includes(layer.lineStyle) ? layer.lineStyle : 'solid',
    opacity: Number.isFinite(layer.opacity) ? Math.max(0, Math.min(1, layer.opacity)) : 1,
    locked: layer.locked === true };
}

export function normalizeBox(box) {
  return Object.fromEntries(['x', 'y', 'z'].map(axis => {
    const pair = box?.[axis];
    return [axis, Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite) &&
      pair[1] - pair[0] >= 0.001 && pair.every(n => Math.abs(n) <= 1000) ? [...pair] : [...DEFAULT_BOX[axis]]];
  }));
}

export function probeSignature(layer, params) {
  return layer.type === 'geometry' ? JSON.stringify(layer.geometry) : JSON.stringify([layer.expression, layer.domain, params]);
}

export function normalizeProbes(probes, layers) {
  const result = {};
  for (const source of ['2d', '3d']) {
    const probe = probes?.[source];
    const axes = source === '3d' ? ['x', 'y', 'z'] : ['x', 'y'];
    if (!probe || !axes.every(axis => Number.isFinite(probe.point?.[axis]))) continue;
    if (probe.layerId && !layers.some(layer => layer.id === probe.layerId)) continue;
    if (source === '3d' && !probe.layerId) continue;
    result[source] = { layerId: probe.layerId || null, point: Object.fromEntries(axes.map(axis => [axis, probe.point[axis]])),
      signature: typeof probe.signature === 'string' ? probe.signature : '' };
  }
  return result;
}
