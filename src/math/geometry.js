export const GEOMETRY_NAMES = { point: '点', segment: '线段', line: '直线', vector: '向量', text: '文字' };
export const isGeometry = layer => layer?.type === 'geometry';

export function normalizeGeometry(value) {
  if (!value || !Object.hasOwn(GEOMETRY_NAMES, value.kind)) throw new Error('几何对象类型无效');
  const count = ['point', 'text'].includes(value.kind) ? 1 : 2;
  if (!Array.isArray(value.points) || value.points.length !== count || !value.points.every(p =>
    Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9))) {
    throw new Error('坐标须为 −10亿 到 10亿 之间的有限数值');
  }
  if (value.kind === 'line' && Math.hypot(value.points[1][0] - value.points[0][0], value.points[1][1] - value.points[0][1]) < 1e-9) {
    throw new Error('直线需要两个不同的点');
  }
  const result = { kind: value.kind, points: value.points.map(p => [...p]) };
  if (value.kind === 'text') {
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 500) throw new Error('文字须为 1–500 个字符');
    if (value.fontSize != null && (!Number.isFinite(value.fontSize) || value.fontSize < 10 || value.fontSize > 96)) throw new Error('字号须在 10–96 之间');
    if (value.rotation != null && !Number.isFinite(value.rotation)) throw new Error('文字角度须为有限数值');
    result.text = value.text;
    result.reflected = value.reflected === true;
    result.fontSize = value.fontSize ?? 16;
    result.rotation = ((value.rotation ?? 0) % 360 + 360) % 360;
  }
  return result;
}

export function geometryCenter(geometry) {
  return [0, 1].map(axis => geometry.points.reduce((sum, p) => sum + p[axis], 0) / geometry.points.length);
}

// Transform world coordinates, never screen pixels. Positive angles turn counterclockwise.
export function transformGeometry(geometry, { kind, dx = 0, dy = 0, angle = 0, factor = 1, pivot = [0, 0] }) {
  if (![dx, dy, angle, factor, ...pivot].every(Number.isFinite) || pivot.length !== 2) throw new Error('变换值须为有限数值');
  if (!['translate', 'rotate', 'scale', 'mirrorX', 'mirrorY'].includes(kind)) throw new Error('变换类型无效');
  if (kind === 'scale' && (factor <= 0 || factor > 1e6)) throw new Error('缩放倍数须大于 0，且不超过 100万');
  const radians = angle * Math.PI / 180;
  const points = geometry.points.map(([x, y]) => {
    if (kind === 'translate') return [x + dx, y + dy];
    const u = x - pivot[0], v = y - pivot[1];
    if (kind === 'rotate') return [pivot[0] + u * Math.cos(radians) - v * Math.sin(radians), pivot[1] + u * Math.sin(radians) + v * Math.cos(radians)];
    if (kind === 'scale') return [pivot[0] + u * factor, pivot[1] + v * factor];
    return kind === 'mirrorX' ? [x, pivot[1] - v] : [pivot[0] - u, y];
  });
  let rotation = geometry.rotation ?? 0;
  if (kind === 'rotate') rotation += angle;
  if (kind === 'mirrorX') rotation = -rotation;
  if (kind === 'mirrorY') rotation = 180 - rotation;
  return normalizeGeometry({ ...geometry, points, rotation, reflected: ['mirrorX', 'mirrorY'].includes(kind) ? !geometry.reflected : geometry.reflected,
    fontSize: geometry.kind === 'text' && kind === 'scale' ? Math.max(10, Math.min(96, geometry.fontSize * factor)) : geometry.fontSize });
}

export function clipInfiniteLine(points, view) {
  const [a, b] = points, d = [b[0] - a[0], b[1] - a[1]];
  if (Math.hypot(...d) < 1e-9) return null;
  let low = -Infinity, high = Infinity;
  for (const [axis, min, max] of [[0, view.xmin, view.xmax], [1, view.ymin, view.ymax]]) {
    if (d[axis] === 0) { if (a[axis] < min || a[axis] > max) return null; continue; }
    const t1 = (min - a[axis]) / d[axis], t2 = (max - a[axis]) / d[axis];
    low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
  }
  return low > high ? null : [low, high].map(t => [a[0] + t * d[0], a[1] + t * d[1]]);
}

export function geometrySummary(geometry) {
  const format = p => `(${p.map(n => Number(n.toPrecision(5))).join(', ')})`;
  return geometry.kind === 'text' ? geometry.text : `${GEOMETRY_NAMES[geometry.kind]} ${geometry.points.map(format).join(' → ')}`;
}

export function exportDimensions(options, fallback) {
  const width = Number(options.width ?? fallback.width), height = Number(options.height ?? fallback.height), scale = Number(options.scale ?? 1);
  if (![width, height, scale].every(Number.isFinite) || !Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || scale < 1 || scale > 4) throw new Error('宽高须为至少 64 的整数，倍率须在 1–4 之间');
  const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
  if (pixelWidth > 8192 || pixelHeight > 8192 || pixelWidth * pixelHeight > 16e6) throw new Error('导出上限为 8192 像素 / 边、1600万总像素');
  return { width, height, scale, pixelWidth, pixelHeight, transparent: options.transparent === true };
}

// Preserve the current screen proportions while containing the complete viewport.
export function containExportView(view, size, output) {
  const ratio = (output.width / output.height) / (size.width / size.height);
  const cx = (view.xmin + view.xmax) / 2, cy = (view.ymin + view.ymax) / 2;
  const halfX = (view.xmax - view.xmin) / 2 * Math.max(1, ratio);
  const halfY = (view.ymax - view.ymin) / 2 * Math.max(1, 1 / ratio);
  return { xmin: cx - halfX, xmax: cx + halfX, ymin: cy - halfY, ymax: cy + halfY };
}
