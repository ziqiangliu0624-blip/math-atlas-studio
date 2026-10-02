import { clipInfiniteLine } from '../math/geometry.js';

export function drawGeometry(ctx, layer, view, width, height, selected = false) {
  const g = layer.geometry;
  const screen = ([x, y]) => [(x - view.xmin) * width / (view.xmax - view.xmin), (view.ymax - y) * height / (view.ymax - view.ymin)];
  const handles = g.points.map(screen), segments = [];
  let textBox = null;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  ctx.strokeStyle = layer.color; ctx.fillStyle = layer.color; ctx.lineWidth = layer.lineWidth ?? 2.3;
  ctx.globalAlpha = layer.opacity ?? 1; ctx.lineCap = 'round';
  if (g.kind === 'point') {
    ctx.beginPath(); ctx.arc(...handles[0], 4 + ctx.lineWidth, 0, Math.PI * 2); ctx.fill();
    segments.push([...handles[0], ...handles[0]]);
  } else if (g.kind === 'text') {
    ctx.font = `${g.fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    const lines = g.text.split('\n');
    const w = Math.max(...lines.map(line => ctx.measureText(line).width)), h = lines.length * g.fontSize * 1.3;
    const angle = -g.rotation * Math.PI / 180;
    textBox = { x: handles[0][0], y: handles[0][1], width: w, height: h, angle, reflected: g.reflected };
    ctx.save(); ctx.translate(...handles[0]); ctx.rotate(angle); if (g.reflected) ctx.scale(1, -1);
    lines.forEach((line, i) => ctx.fillText(line, 0, i * g.fontSize * 1.3));
    if (selected) { ctx.globalAlpha *= .5; ctx.strokeRect(-3, -3, w + 6, h + 6); }
    ctx.restore();
  } else {
    const points = g.kind === 'line' ? clipInfiniteLine(g.points, view)?.map(screen) : handles;
    if (points) {
      const [a, b] = points;
      ctx.setLineDash(layer.lineStyle === 'dashed' ? [ctx.lineWidth * 4, ctx.lineWidth * 2] : layer.lineStyle === 'dotted' ? [.01, ctx.lineWidth * 2.5] : []);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); segments.push([...a, ...b]);
      if (g.kind === 'vector' && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1) {
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]), length = 10 + ctx.lineWidth * 1.5;
        const arms = [-.45, .45].map(offset => [b[0] - length * Math.cos(angle + offset), b[1] - length * Math.sin(angle + offset)]);
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(...b); arms.forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.fill();
        arms.forEach(p => segments.push([...b, ...p]));
      }
    }
  }
  if (selected && !layer.locked) {
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = '#fbfcfe'; ctx.lineWidth = 1.5;
    for (const p of handles) { ctx.beginPath(); ctx.arc(...p, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
  return { id: layer.id, segments, handles, textBox, hitRadius: g.kind === 'point' ? 4 + (layer.lineWidth ?? 2.3) : 0 };
}

export function textHitDistance(position, box) {
  if (!box) return Infinity;
  const dx = position.px - box.x, dy = position.py - box.y;
  const x = dx * Math.cos(box.angle) + dy * Math.sin(box.angle), y = (-dx * Math.sin(box.angle) + dy * Math.cos(box.angle)) * (box.reflected ? -1 : 1);
  return Math.hypot(Math.max(0, -x, x - box.width), Math.max(0, -y, y - box.height));
}
