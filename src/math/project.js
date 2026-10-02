import { parsePlot, findParameters } from './engine.js';
import { normalizeDomain } from './domain.js';
import { START_VIEW, validView, normalizeStyle, normalizeBox, normalizeProbes } from './view.js';
import { isGeometry, normalizeGeometry } from './geometry.js';
const COLORS = ['#5368d9', '#ef785b', '#16a6a0', '#a56ad9', '#e6a72e', '#467fb6'];

export function normalizeProject(data) {
  if (!data || typeof data !== 'object' || ![1, 2].includes(data.schemaVersion) || !Array.isArray(data.layers) || data.layers.length > 200) {
    throw new Error('工程格式不受支持');
  }
  const layers = data.layers.map((layer, index) => {
    if (isGeometry(layer)) {
      return { id: typeof layer.id === 'string' && layer.id ? layer.id : crypto.randomUUID(),
        name: typeof layer.name === 'string' ? layer.name.slice(0, 100) : `几何 ${index + 1}`,
        type: 'geometry', geometry: normalizeGeometry(layer.geometry),
        color: /^#[0-9a-fA-F]{6}$/.test(layer.color) ? layer.color : COLORS[index % COLORS.length],
        visible: layer.visible !== false, ...normalizeStyle(layer) };
    }
    if (layer?.type && layer.type !== 'expression') throw new Error(`第 ${index + 1} 个图层类型无效`);
    if (!layer || typeof layer !== 'object' || typeof layer.expression !== 'string' || layer.expression.length > 5000) {
      throw new Error(`第 ${index + 1} 个图层无效`);
    }
    const parsed = parsePlot(layer.expression);
    const plotKind = parsed.error ? parsePlot(layer.lastValidExpression || layer.expression).kind : parsed.kind;
    const domain = normalizeDomain(layer.domain, plotKind);
    return {
      id: typeof layer.id === 'string' && layer.id ? layer.id : crypto.randomUUID(),
      name: typeof layer.name === 'string' ? layer.name.slice(0, 100) : `图层 ${index + 1}`,
      type: 'expression', expression: layer.expression,
      lastValidExpression: typeof layer.lastValidExpression === 'string' ? layer.lastValidExpression : layer.expression,
      color: typeof layer.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(layer.color) ? layer.color : COLORS[index % COLORS.length],
      visible: layer.visible !== false, ...normalizeStyle(layer),
      domain
    };
  });
  if (new Set(layers.map(layer => layer.id)).size !== layers.length) throw new Error('图层标识重复');
  const params = {};
  if (data.params && typeof data.params === 'object' && !Array.isArray(data.params)) {
    for (const [key, value] of Object.entries(data.params)) {
      if (/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(key) && Number.isFinite(value)) params[key] = value;
    }
  }
  const ranges = {};
  if (data.ranges && typeof data.ranges === 'object' && !Array.isArray(data.ranges)) {
    for (const [key, range] of Object.entries(data.ranges)) {
      if (Array.isArray(range) && range.length === 3 && range.every(Number.isFinite) && range[1] > range[0] && range[2] > 0) ranges[key] = range;
    }
  }
  for (const layer of layers) {
    if (isGeometry(layer)) continue;
    try {
      for (const key of findParameters(layer.expression)) {
        if (!Number.isFinite(params[key])) params[key] = 1;
        if (!ranges[key]) ranges[key] = [-5, 5, 0.1];
      }
    } catch { /* expression error is shown in the inspector */ }
  }
  const view2d = validView(data.view2d) ? data.view2d : { ...START_VIEW };
  const camera = data.camera3d;
  const camera3d = camera && ['perspective', 'orthographic'].includes(camera.projection) &&
    Array.isArray(camera.position) && camera.position.length === 3 && camera.position.every(Number.isFinite) &&
    Array.isArray(camera.target) && camera.target.length === 3 && camera.target.every(Number.isFinite) &&
    Number.isFinite(camera.zoom) && camera.zoom > 0
    ? { projection: camera.projection, position: camera.position, target: camera.target, zoom: camera.zoom } : null;
  return {
    schemaVersion: 2,
    name: typeof data.name === 'string' ? data.name.slice(0, 100) : '未命名工程',
    exampleId: typeof data.exampleId === 'string' ? data.exampleId : null,
    layers, params, ranges, view2d, aspectLocked: data.aspectLocked === true,
    box3d: normalizeBox(data.box3d), probes: normalizeProbes(data.probes, layers),
    mode: ['2d', '3d', 'split'].includes(data.mode) ? data.mode : '2d',
    coordinateSystem: data.coordinateSystem === 'polar' ? 'polar' : 'cartesian',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    camera3d
  };
}

