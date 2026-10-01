import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plot2D from './components/Plot2D.jsx';
import Plot3D from './components/Plot3D.jsx';
import { compile, findParameters, parsePlot } from './math/engine.js';
import { domainPair, normalizeDomain, withSurfaceAxis } from './math/domain.js';

const COLORS = ['#5368d9', '#ef785b', '#16a6a0', '#a56ad9', '#e6a72e', '#467fb6'];
const START_VIEW = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 };
const STORAGE_KEY = 'math-atlas-project-v1';
const RECOVERY_KEY = 'math-atlas-recoveries-v1';

const FORMULA_GUIDES = {
  function2d: { title: '二维函数', example: 'y = a*sin(x)', variables: 'y = … 使用 x；x = … 使用 y。a、b 等字母会生成参数滑块。' },
  polar2d: { title: '极坐标曲线', example: 'r = 2*cos(3*theta)', variables: 'theta（或 θ）是角度，r 是到原点的距离。' },
  parametric2d: { title: '二维参数曲线', example: 'x(t) = cos(t); y(t) = sin(t)', variables: '两个分量都用 t，用分号或换行分隔。' },
  surface3d: { title: '三维曲面', example: 'z = sin(x)*cos(y)', variables: 'x、y 是平面位置，z 是曲面的高度。' },
  curve3d: { title: '空间参数曲线', example: 'x(t) = cos(t); y(t) = sin(t); z(t) = t/5', variables: '三个分量都用 t，用分号或换行分隔。' }
};

const EXAMPLES = [
  {
    id: 'sine', title: '振幅与周期', group: '2D · 函数', symbol: '∿',
    description: '拖动 a 改变波峰高度，拖动 b 改变重复的快慢。',
    concept: 'y = a · sin(bx) 中，|a| 是振幅；b 越大，周期越短。',
    layers: [{ name: '正弦曲线', expression: 'y = a*sin(b*x)', color: COLORS[0], domain: [-10, 10] }],
    params: { a: 1, b: 1 }, ranges: { a: [-3, 3, 0.1], b: [0.2, 4, 0.1] },
    view: { ...START_VIEW }, mode: '2d'
  },
  {
    id: 'quadratic', title: '抛物线的移动', group: '2D · 函数', symbol: '⌒',
    description: '改变 h 和 k，观察抛物线顶点的位置。',
    concept: 'y = (x-h)²+k 的顶点在 (h, k)。',
    layers: [{ name: '抛物线', expression: 'y = (x-h)^2+k', color: COLORS[1], domain: [-8, 8] }],
    params: { h: 0, k: 0 }, ranges: { h: [-5, 5, 0.1], k: [-5, 5, 0.1] },
    view: { xmin: -7, xmax: 7, ymin: -5, ymax: 10 }, mode: '2d'
  },
  {
    id: 'polar', title: '极坐标玫瑰线', group: '2D · 坐标', symbol: '✺',
    description: '改变 n，看看花瓣的数量和方向如何变化。',
    concept: '极坐标用距离 r 和角度 θ 定位点；r = 3cos(nθ) 绘出玫瑰线。',
    layers: [{ name: '玫瑰线', expression: 'r = 3*cos(n*theta)', color: COLORS[3], domain: [0, 2 * Math.PI] }],
    params: { n: 4 }, ranges: { n: [1, 9, 1] },
    view: { xmin: -4.5, xmax: 4.5, ymin: -4.5, ymax: 4.5 }, mode: '2d', coordinateSystem: 'polar'
  },
  {
    id: 'surface', title: '波浪曲面', group: '3D · 曲面', symbol: '◈',
    description: '拖动 a 调整起伏，旋转视角观察峰与谷。',
    concept: 'z = a·sin(x)·cos(y) 把平面上每个 (x,y) 映射成一个高度。',
    layers: [{ name: '波浪曲面', expression: 'z = a*sin(x)*cos(y)', color: COLORS[0], domain: { x: [-5, 5], y: [-5, 5] } }],
    params: { a: 1.4 }, ranges: { a: [0, 3, 0.1] },
    view: { ...START_VIEW }, mode: '3d'
  },
  {
    id: 'helix', title: '空间螺旋线', group: '3D · 曲线', symbol: '↟',
    description: '旋转空间曲线，观察它在平面上的投影。',
    concept: 'x 和 y 在圆上运动时，z 随 t 增大，形成螺旋。',
    layers: [{ name: '螺旋线', expression: 'x(t)=2*cos(t); y(t)=2*sin(t); z(t)=0.2*t', color: COLORS[2], domain: [0, 8 * Math.PI] }],
    params: {}, ranges: {}, view: { ...START_VIEW }, mode: '3d'
  }
];

function makeLayer(partial, index = 0) {
  return {
    id: crypto.randomUUID(), name: partial.name || `图层 ${index + 1}`,
    expression: partial.expression || 'y = sin(x)',
    lastValidExpression: partial.expression || 'y = sin(x)',
    color: partial.color || COLORS[index % COLORS.length], visible: true,
    domain: partial.domain || [-10, 10]
  };
}

function projectFromExample(example) {
  return {
    schemaVersion: 1, name: example.title, exampleId: example.id,
    layers: example.layers.map((layer, index) => makeLayer(layer, index)),
    params: { ...example.params }, ranges: { ...example.ranges },
    view2d: { ...example.view }, mode: example.mode,
    coordinateSystem: example.coordinateSystem || 'cartesian',
    createdAt: new Date().toISOString()
  };
}

function normalizeProject(data) {
  if (!data || typeof data !== 'object' || data.schemaVersion !== 1 || !Array.isArray(data.layers) || data.layers.length > 200) {
    throw new Error('工程格式不受支持');
  }
  const layers = data.layers.map((layer, index) => {
    if (!layer || typeof layer !== 'object' || typeof layer.expression !== 'string' || layer.expression.length > 5000) {
      throw new Error(`第 ${index + 1} 个图层无效`);
    }
    const parsed = parsePlot(layer.expression);
    const plotKind = parsed.error ? parsePlot(layer.lastValidExpression || layer.expression).kind : parsed.kind;
    const domain = normalizeDomain(layer.domain, plotKind);
    return {
      id: typeof layer.id === 'string' && layer.id ? layer.id : crypto.randomUUID(),
      name: typeof layer.name === 'string' ? layer.name.slice(0, 100) : `图层 ${index + 1}`,
      expression: layer.expression,
      lastValidExpression: typeof layer.lastValidExpression === 'string' ? layer.lastValidExpression : layer.expression,
      color: typeof layer.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(layer.color) ? layer.color : COLORS[index % COLORS.length],
      visible: layer.visible !== false,
      domain
    };
  });
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
    try {
      for (const key of findParameters(layer.expression)) {
        if (!Number.isFinite(params[key])) params[key] = 1;
        if (!ranges[key]) ranges[key] = [-5, 5, 0.1];
      }
    } catch { /* expression error is shown in the inspector */ }
  }
  const candidateView = data.view2d;
  const view2d = candidateView && ['xmin', 'xmax', 'ymin', 'ymax'].every(key => Number.isFinite(candidateView[key])) && candidateView.xmax > candidateView.xmin && candidateView.ymax > candidateView.ymin
    ? candidateView : { ...START_VIEW };
  const camera = data.camera3d;
  const camera3d = camera && ['perspective', 'orthographic'].includes(camera.projection) &&
    Array.isArray(camera.position) && camera.position.length === 3 && camera.position.every(Number.isFinite) &&
    Array.isArray(camera.target) && camera.target.length === 3 && camera.target.every(Number.isFinite) &&
    Number.isFinite(camera.zoom) && camera.zoom > 0
    ? { projection: camera.projection, position: camera.position, target: camera.target, zoom: camera.zoom } : null;
  return {
    schemaVersion: 1,
    name: typeof data.name === 'string' ? data.name.slice(0, 100) : '未命名工程',
    exampleId: typeof data.exampleId === 'string' ? data.exampleId : null,
    layers, params, ranges, view2d,
    mode: ['2d', '3d', 'split'].includes(data.mode) ? data.mode : '2d',
    coordinateSystem: data.coordinateSystem === 'polar' ? 'polar' : 'cartesian',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
    camera3d
  };
}

function loadRecoveries() {
  try {
    const value = JSON.parse(localStorage.getItem(RECOVERY_KEY));
    return Array.isArray(value) ? value.filter(item => item && item.project && typeof item.savedAt === 'string').slice(0, 5) : [];
  } catch { return []; }
}

function safeLoadProject() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data) return normalizeProject(data);
  } catch { /* first launch or damaged recovery data */ }
  return projectFromExample(EXAMPLES[0]);
}

function readPlot(layer) {
  try {
    const plot = parsePlot(layer.expression);
    if (plot.error) return { error: plot.error };
    for (const expression of Object.values(plot.formulas || {})) compile(expression);
    return { plot };
  } catch (error) {
    return { error: error?.message || '表达式无法解析' };
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e4 || (Math.abs(value) < 1e-3 && value !== 0)) return value.toExponential(2);
  return Number(value.toFixed(3)).toString();
}

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    save: <><path d="M4 4h13l3 3v13H4z" /><path d="M7 4v6h9V4M7 20v-7h10v7" /></>,
    folder: <><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" /></>,
    eye: <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="M3 3l18 18M10 6.2A11 11 0 0 1 12 6c6 0 10 6 10 6a14 14 0 0 1-3.1 3.4M6.2 7.2C3.6 9 2 12 2 12s4 6 10 6a10.5 10.5 0 0 0 4.1-.8" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6" /></>,
    zoomIn: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M10.5 7.5v6m-3-3h6" /></>,
    zoomOut: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5m-8.5-10.5h6" /></>,
    fit: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><path d="M8 8h8v8H8z" /></>,
    reset: <><path d="M4 11a8 8 0 1 1 1.6 6M4 5v6h6" /></>,
    undo: <><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" /></>,
    redo: <><path d="m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h2" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--surface)" /><circle cx="16" cy="12" r="2" fill="var(--surface)" /><circle cx="8" cy="18" r="2" fill="var(--surface)" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.8.9-1.9 1.3-1.9 2.9M12 17h.01" /></>,
    moon: <><path d="M20 15.8A8 8 0 0 1 8.2 4 8 8 0 1 0 20 15.8Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
    chart: <><path d="M3 20V4m0 16h18M5 16c3-1 4-9 7-9s4 9 9 1" /></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5m-9 5L3 7m9 5v10" /></>
  };
  return <svg {...common}>{paths[name] || paths.chart}</svg>;
}

function IconButton({ icon, label, onClick, disabled = false, active = false, className = '' }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} onClick={onClick} disabled={disabled} title={label} aria-label={label}><Icon name={icon} /></button>;
}

function DomainRangeEditor({ label, id, range, onCommit, onInvalid, limit }) {
  const commitEdge = (edge, event) => {
    const input = event.currentTarget;
    const raw = input.value.trim();
    const value = raw ? Number(raw) : NaN;
    const next = [...range];
    next[edge] = value;
    if (!Number.isFinite(value) || next[1] <= next[0] || (limit && Math.abs(value) > limit)) {
      input.value = String(range[edge]);
      onInvalid?.(limit ? `请输入递增的范围，端点须在 −${limit} 到 ${limit} 之间` : '请输入递增的有限范围');
      return;
    }
    if (value !== range[edge]) onCommit(next);
  };
  return <div className="domain-axis"><div className="domain-axis-title">{label}</div><div className="domain-controls">
    <label>起点<input key={`${id}-min-${range[0]}`} type="number" defaultValue={range[0]} onBlur={event => commitEdge(0, event)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label>终点<input key={`${id}-max-${range[1]}`} type="number" defaultValue={range[1]} onBlur={event => commitEdge(1, event)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
  </div></div>;
}

function getFitView(layers, params, fallback) {
  const points = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    try {
      const plot = parsePlot(layer.lastValidExpression || layer.expression);
      const formulas = plot.formulas || {};
      const domain = Array.isArray(layer.domain) ? layer.domain : [fallback.xmin, fallback.xmax];
      const steps = 500;
      if (plot.kind === 'function2d') {
        const expression = formulas.y || formulas.x;
        const fn = compile(expression);
        for (let i = 0; i <= steps; i++) {
          const v = domain[0] + (domain[1] - domain[0]) * i / steps;
          const result = fn({ ...params, x: v, y: v });
          const x = formulas.x ? result : v;
          const y = formulas.x ? v : result;
          if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) < 1e4 && Math.abs(x) < 1e4) points.push([x, y]);
        }
      } else if (plot.kind === 'polar2d' || plot.kind === 'parametric2d') {
        const fx = formulas.x ? compile(formulas.x) : null;
        const fy = formulas.y ? compile(formulas.y) : null;
        const fr = formulas.r ? compile(formulas.r) : null;
        for (let i = 0; i <= steps; i++) {
          const t = domain[0] + (domain[1] - domain[0]) * i / steps;
          const scope = { ...params, t, theta: t };
          const r = fr?.(scope);
          const x = fr ? r * Math.cos(t) : fx?.(scope);
          const y = fr ? r * Math.sin(t) : fy?.(scope);
          if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
        }
      }
    } catch { /* invalid layer uses current view */ }
  }
  if (!points.length) return { ...START_VIEW };
  const xs = points.map(point => point[0]).sort((a, b) => a - b);
  const ys = points.map(point => point[1]).sort((a, b) => a - b);
  let xmin = xs[0], xmax = xs[xs.length - 1], ymin = ys[0], ymax = ys[ys.length - 1];
  const dx = Math.max(xmax - xmin, 2), dy = Math.max(ymax - ymin, 2);
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  return { xmin: cx - dx * 0.6, xmax: cx + dx * 0.6, ymin: cy - dy * 0.6, ymax: cy + dy * 0.6 };
}

export default function App() {
  const [project, setProject] = useState(safeLoadProject);
  const [selectedId, setSelectedId] = useState(() => project.layers[0]?.id);
  const [sidebarTab, setSidebarTab] = useState('layers');
  const [theme, setTheme] = useState(() => localStorage.getItem('math-atlas-theme') || 'light');
  const [status, setStatus] = useState({ message: '准备就绪' });
  const [toast, setToast] = useState('');
  const [filePath, setFilePath] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);
  const [showRight, setShowRight] = useState(false);
  const [viewCommand, setViewCommand] = useState({ id: 0, type: 'reset' });
  const [projection, setProjection] = useState('透视');
  const [recoveryItems, setRecoveryItems] = useState(loadRecoveries);
  const plot2dRef = useRef(null);
  const plot3dRef = useRef(null);
  const importRef = useRef(null);
  const past = useRef([]);
  const future = useRef([]);
  const revisionRef = useRef(0);

  const selectedLayer = project.layers.find(layer => layer.id === selectedId) || project.layers[0];
  const selectedValidation = selectedLayer ? readPlot(selectedLayer) : null;
  const selectedPlot = selectedValidation?.plot || (selectedLayer ? parsePlot(selectedLayer.lastValidExpression || selectedLayer.expression) : null);
  const selectedPlotKind = selectedPlot?.kind;
  const parsedFormula = selectedLayer ? parsePlot(selectedLayer.expression) : null;
  const formulaKind = parsedFormula && (!parsedFormula.error || Object.keys(parsedFormula.formulas).length)
    ? parsedFormula.kind
    : selectedLayer?.lastValidExpression ? parsePlot(selectedLayer.lastValidExpression).kind
      : project.mode === '3d' ? 'surface3d' : project.coordinateSystem === 'polar' ? 'polar2d' : 'function2d';
  const formulaGuide = FORMULA_GUIDES[formulaKind];
  const currentExample = EXAMPLES.find(example => example.id === project.exampleId);
  const selectedParams = useMemo(() => {
    try { return selectedLayer ? findParameters(selectedLayer.expression) : []; } catch { return []; }
  }, [selectedLayer?.expression]);
  const renderLayers = useMemo(() => project.layers.map(layer => {
    const valid = readPlot(layer);
    return valid.error ? { ...layer, expression: layer.lastValidExpression || layer.expression, stale: true } : layer;
  }), [project.layers]);
  const { has2dLayer, has3dLayer } = useMemo(() => {
    let has2dLayer = false, has3dLayer = false;
    for (const layer of renderLayers) {
      if (!layer.visible) continue;
      try {
        const kind = parsePlot(layer.expression).kind;
        if (kind === 'function2d' || kind === 'polar2d' || kind === 'parametric2d') has2dLayer = true;
        if (kind === 'surface3d' || kind === 'curve3d') has3dLayer = true;
      } catch { /* invalid layer is handled by the inspector */ }
    }
    return { has2dLayer, has3dLayer };
  }, [renderLayers]);
  const hasStale = project.layers.some(layer => readPlot(layer).error);

  const notify = useCallback(message => {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(''), 3600);
  }, []);

  const commit = useCallback(updater => {
    setProject(previous => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      if (next === previous) return previous;
      past.current = [...past.current.slice(-39), previous];
      future.current = [];
      revisionRef.current += 1;
      setDirty(true);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    setProject(previous => {
      const next = past.current.pop();
      future.current.push(previous);
      revisionRef.current += 1;
      setDirty(true);
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    setProject(previous => {
      const next = future.current.pop();
      past.current.push(previous);
      revisionRef.current += 1;
      setDirty(true);
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { notify('本地自动保存失败，请手动保存工程'); }
    }, 500);
    window.desktop?.setTitle(project.name);
    return () => window.clearTimeout(timer);
  }, [project, notify]);

  useEffect(() => {
    localStorage.setItem('math-atlas-theme', theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    setProjection(project.camera3d?.projection === 'orthographic' ? '正交' : '透视');
  }, [project.camera3d?.projection]);

  useEffect(() => {
    if (!selectedId || !project.layers.some(layer => layer.id === selectedId)) {
      setSelectedId(project.layers[0]?.id);
    }
  }, [project.layers, selectedId]);

  const stashRecovery = useCallback(snapshot => {
    try {
      const next = [{ savedAt: new Date().toISOString(), project: snapshot }, ...loadRecoveries()].slice(0, 5);
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(next));
      setRecoveryItems(next);
      return true;
    } catch { notify('本地恢复副本未能保存，请先手动保存工程'); return false; }
  }, [notify]);

  const switchProject = useCallback((next, path = null, isDirty = false) => {
    if (dirty && !stashRecovery(project)) return false;
    past.current = [];
    future.current = [];
    revisionRef.current += 1;
    setProject(next);
    setSelectedId(next.layers[0]?.id);
    setFilePath(path);
    setDirty(isDirty);
    return true;
  }, [dirty, project, stashRecovery]);

  const loadExample = useCallback(example => {
    const next = projectFromExample(example);
    if (!switchProject(next, null, true)) return;
    setSidebarTab('layers');
    notify(`已打开「${example.title}」示例`);
  }, [switchProject, notify]);

  const updateLayer = useCallback((id, changes) => {
    commit(previous => {
      const params = { ...previous.params };
      const ranges = { ...previous.ranges };
      const layers = previous.layers.map(layer => {
      if (layer.id !== id) return layer;
      const next = { ...layer, ...changes };
      if (Object.prototype.hasOwnProperty.call(changes, 'expression') && !readPlot(next).error) {
        const previousKind = parsePlot(layer.lastValidExpression || layer.expression).kind;
        const nextKind = parsePlot(changes.expression).kind;
        if (previousKind !== nextKind && !Object.prototype.hasOwnProperty.call(changes, 'domain')) {
          next.domain = normalizeDomain(null, nextKind);
        }
        next.lastValidExpression = changes.expression;
        for (const key of findParameters(changes.expression)) {
          if (!Number.isFinite(params[key])) params[key] = 1;
          if (!ranges[key]) ranges[key] = [-5, 5, 0.1];
        }
      }
      return next;
      });
      return { ...previous, exampleId: null, layers, params, ranges };
    });
  }, [commit]);

  const addLayer = useCallback(() => {
    const is3d = project.mode === '3d';
    const layer = makeLayer({ name: is3d ? '新曲面' : '新函数', expression: is3d ? 'z = sin(x)*cos(y)' : 'y = sin(x)', color: COLORS[project.layers.length % COLORS.length], domain: is3d ? { x: [-5, 5], y: [-5, 5] } : [-10, 10] }, project.layers.length);
    commit(previous => ({ ...previous, exampleId: null, layers: [...previous.layers, layer] }));
    setSelectedId(layer.id);
    setSidebarTab('layers');
  }, [commit, project.mode, project.layers.length]);

  const removeLayer = useCallback(id => {
    commit(previous => ({ ...previous, exampleId: null, layers: previous.layers.filter(layer => layer.id !== id) }));
  }, [commit]);

  const changeParameter = useCallback((key, value) => {
    commit(previous => ({ ...previous, params: { ...previous.params, [key]: value } }));
  }, [commit]);

  const saveProject = useCallback(async (saveAs = false) => {
    try {
      const snapshot = { ...project, savedAt: new Date().toISOString() };
      const snapshotRevision = revisionRef.current;
      if (window.desktop) {
        const result = await window.desktop.saveProject(snapshot, saveAs ? null : filePath);
        if (!result) return;
        if (revisionRef.current === snapshotRevision) setFilePath(result.path);
      } else {
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${project.name || '未命名工程'}.graphproj`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      if (revisionRef.current === snapshotRevision) {
        setDirty(false);
        notify('工程已保存到本地');
      } else notify('已保存上一版本；当前改动仍未保存');
    } catch (error) { notify(`保存失败：${error.message}`); }
  }, [project, filePath, notify]);

  const openProject = useCallback(async () => {
    try {
      if (window.desktop) {
        const result = await window.desktop.openProject();
        if (!result) return;
        const next = normalizeProject(result.project);
        if (switchProject(next, result.path, false)) notify('工程已打开');
      } else importRef.current?.click();
    } catch (error) { notify(`打开失败：${error.message}`); }
  }, [switchProject, notify]);

  const openBrowserFile = useCallback(async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = normalizeProject(JSON.parse(await file.text()));
      if (switchProject(data, null, false)) notify('工程已打开');
    } catch (error) { notify(`打开失败：${error.message}`); }
    event.target.value = '';
  }, [switchProject, notify]);

  const restoreRecovery = useCallback(item => {
    try {
      const next = normalizeProject(item.project);
      if (!switchProject(next, null, true)) return;
      setSidebarTab('layers');
      notify('已恢复本地草稿，请保存工程文件');
    } catch (error) { notify(`恢复失败：${error.message}`); }
  }, [switchProject, notify]);

  const exportPng = useCallback(async () => {
    if (hasStale) { notify('请先修正表达式，再导出当前图像'); return; }
    const canvas = project.mode === '3d' ? plot3dRef.current : plot2dRef.current;
    if (!canvas) { notify('当前视图尚未准备好'); return; }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (window.desktop) {
        const result = await window.desktop.savePng(dataUrl, project.name);
        if (!result) return;
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `${project.name || '图形'}.png`;
        link.click();
      }
      notify(project.mode === 'split' ? '已导出左侧 2D 画布' : 'PNG 已导出');
    } catch (error) { notify(`导出失败：${error.message}`); }
  }, [hasStale, project.mode, project.name, notify]);

  const zoom2d = useCallback(factor => {
    commit(previous => {
      const view = previous.view2d;
      const cx = (view.xmin + view.xmax) / 2, cy = (view.ymin + view.ymax) / 2;
      const width = (view.xmax - view.xmin) * factor / 2;
      const height = (view.ymax - view.ymin) * factor / 2;
      return { ...previous, view2d: { xmin: cx - width, xmax: cx + width, ymin: cy - height, ymax: cy + height } };
    });
  }, [commit]);

  const fitView = useCallback(() => {
    if (project.mode === '3d') setViewCommand(command => ({ id: command.id + 1, type: 'fit' }));
    else commit(previous => ({ ...previous, view2d: getFitView(previous.layers, previous.params, previous.view2d) }));
    notify('已适配当前绘制域；域外或超过安全范围的极值未包含');
  }, [project.mode, commit, notify]);

  const resetView = useCallback(() => {
    if (project.mode === '3d') setViewCommand(command => ({ id: command.id + 1, type: 'reset' }));
    else commit(previous => ({ ...previous, view2d: { ...START_VIEW } }));
  }, [project.mode, commit]);

  const zoomActive = useCallback(factor => {
    if (project.mode === '3d') setViewCommand(command => ({ id: command.id + 1, type: factor < 1 ? 'zoomIn' : 'zoomOut' }));
    else zoom2d(factor);
  }, [project.mode, zoom2d]);

  const send3dCommand = useCallback(type => {
    setViewCommand(command => ({ id: command.id + 1, type }));
    if (type === 'toggleProjection') setProjection(value => value === '透视' ? '正交' : '透视');
  }, []);

  const handleCameraChange = useCallback(next => {
    commit(previous => JSON.stringify(previous.camera3d) === JSON.stringify(next)
      ? previous : { ...previous, camera3d: next });
  }, [commit]);

  useEffect(() => {
    const handler = event => {
      const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openProject(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redo(); }
      else if (!editing && event.key.toLowerCase() === 'f') fitView();
      else if (!editing && (event.key === '+' || event.key === '=')) zoomActive(0.8);
      else if (!editing && event.key === '-') zoomActive(1.25);
      else if (!editing && event.key === '?') setShowHelp(value => !value);
      else if (event.key === 'Escape') setShowHelp(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveProject, openProject, undo, redo, fitView, zoomActive]);

  const statusText = status?.message || (status?.cursor ? Object.entries(status.cursor).map(([key, value]) => `${key} ${formatNumber(value)}`).join('  ·  ') : '准备就绪');

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">∿</span><div className="brand-copy"><strong>图形绘制实验室</strong><small>MATH ATLAS</small></div></div>
      <div className="project-identity"><span className="topbar-divider" /><input value={project.name} aria-label="工程名称" onChange={event => commit(previous => ({ ...previous, name: event.target.value }))} /><span className={`save-indicator ${dirty ? 'is-dirty' : ''}`}>{filePath ? (dirty ? '未保存' : '已保存') : '本地草稿'}</span></div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <IconButton icon="undo" label="撤销 Ctrl+Z" onClick={undo} disabled={!past.current.length} />
        <IconButton icon="redo" label="重做 Ctrl+Shift+Z" onClick={redo} disabled={!future.current.length} />
        <span className="action-separator" />
        <button className="text-button" onClick={openProject}><Icon name="folder" />打开</button>
        <button className="text-button" onClick={() => saveProject()}><Icon name="save" />保存</button>
        <button className="primary-button" onClick={exportPng}><Icon name="download" />导出 PNG</button>
      </div>
    </header>

    <div className="workspace">
      <aside className="left-sidebar">
        <div className="sidebar-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2>探索空间</h2></div><button className="sidebar-more" title="帮助" onClick={() => setShowHelp(true)}><Icon name="help" /></button></div>
        <div className="sidebar-tabs" role="tablist" aria-label="侧边栏"><button className={sidebarTab === 'layers' ? 'active' : ''} onClick={() => setSidebarTab('layers')} role="tab" aria-selected={sidebarTab === 'layers'}>图层 <span>{project.layers.length}</span></button><button className={sidebarTab === 'examples' ? 'active' : ''} onClick={() => setSidebarTab('examples')} role="tab" aria-selected={sidebarTab === 'examples'}>学习示例</button></div>
        {sidebarTab === 'layers' ? <div className="sidebar-body">
          <div className="section-line"><span>表达式与对象</span><IconButton icon="plus" label="新增图层" onClick={addLayer} /></div>
          <div className="layer-list">{project.layers.map((layer, index) => {
            const validity = readPlot(layer);
            return <div key={layer.id} className={`layer-row ${selectedId === layer.id ? 'selected' : ''} ${validity.error ? 'invalid' : ''}`} onClick={() => setSelectedId(layer.id)}>
              <span className="layer-index">{String(index + 1).padStart(2, '0')}</span><span className="layer-color" style={{ background: layer.color }} />
              <div className="layer-main"><strong>{layer.name}</strong><small>{layer.expression}</small></div>
              <button className="layer-visibility" title={layer.visible ? '隐藏图层' : '显示图层'} aria-label={layer.visible ? '隐藏图层' : '显示图层'} onClick={event => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={16} /></button>
            </div>;
          })}</div>
          <button className="add-layer" onClick={addLayer}><Icon name="plus" size={17} />添加表达式</button>
          <div className="sidebar-note"><span className="note-icon">✦</span><div><strong>从图形开始理解</strong><p>试着改变一个参数，再观察曲线如何移动。</p></div></div>
        </div> : <div className="sidebar-body examples-body"><p className="sidebar-intro">打开一个示例，拖动参数，看看数学如何变成图形。</p>{EXAMPLES.map(example => <button key={example.id} className={`example-card ${project.exampleId === example.id ? 'current' : ''}`} onClick={() => loadExample(example)}><span className="example-symbol">{example.symbol}</span><span><strong>{example.title}</strong><small>{example.group}</small></span><Icon name="chevron" size={15} /></button>)}{recoveryItems.length > 0 && <div className="recovery-list"><div className="section-line">未保存工程的恢复副本</div>{recoveryItems.map(item => <button key={item.savedAt} className="recovery-card" onClick={() => restoreRecovery(item)}><strong>{item.project?.name || '未命名工程'}</strong><small>{new Date(item.savedAt).toLocaleString('zh-CN')}</small></button>)}</div>}</div>}
        <div className="sidebar-footer"><span className="local-dot" />仅保存于本机<span className="footer-version">v0.1.1</span></div>
      </aside>

      <main className="main-area">
        <div className="canvas-toolbar"><div className="view-segment" role="tablist" aria-label="画布视图"><button className={project.mode === '2d' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: '2d' }))}><Icon name="chart" size={16} />2D</button><button className={project.mode === '3d' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: '3d' }))}><Icon name="cube" size={16} />3D</button><button className={project.mode === 'split' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: 'split' }))}>分屏</button></div>
          {project.mode !== '3d' && <div className="coord-segment"><span>坐标系</span><select value={project.coordinateSystem || 'cartesian'} onChange={event => commit(previous => ({ ...previous, coordinateSystem: event.target.value }))} aria-label="坐标系"><option value="cartesian">直角坐标</option><option value="polar">极坐标</option></select></div>}
          {project.mode !== '2d' && <div className="camera-controls"><button onClick={() => send3dCommand('toggleProjection')} title="切换透视／正交投影">{projection}</button><button onClick={() => send3dCommand('top')} title="从上方看">俯视</button><button onClick={() => send3dCommand('front')} title="从前方看">正视</button><button onClick={() => send3dCommand('side')} title="从侧面看">侧视</button></div>}
          <div className="toolbar-spacer" /><div className="toolbar-actions"><IconButton icon="zoomOut" label="缩小" onClick={() => zoomActive(1.25)} /><IconButton icon="zoomIn" label="放大" onClick={() => zoomActive(0.8)} /><span className="action-separator" /><IconButton icon="fit" label="适配内容 F" onClick={fitView} /><IconButton icon="reset" label="重置视图" onClick={resetView} /><IconButton icon="sliders" label="显示设置面板" onClick={() => setShowRight(value => !value)} className="mobile-settings" /></div></div>
        <div className={`canvas-stage mode-${project.mode}`}>
          {(project.mode === '2d' || project.mode === 'split') && <section className="plot-panel plot-panel-2d"><div className="plot-overlay-top"><span className="view-label"><span className="view-label-dot" />二维平面</span>{hasStale && <span className="stale-chip">上一有效结果 · 请修正表达式</span>}</div><Plot2D layers={renderLayers} params={project.params} selectedId={selectedId} onSelectLayer={setSelectedId} onStatus={setStatus} view={project.view2d || START_VIEW} onViewChange={next => commit(previous => ({ ...previous, view2d: next }))} canvasRef={plot2dRef} coordinateSystem={project.coordinateSystem || 'cartesian'} theme={theme} />{!has2dLayer && <div className="empty-plot"><span>∿</span><h3>从一个二维表达式开始</h3><p>添加函数，图像会在这里出现。</p><button onClick={addLayer}>添加表达式</button></div>}</section>}
          {(project.mode === '3d' || project.mode === 'split') && <section className="plot-panel plot-panel-3d"><div className="plot-overlay-top"><span className="view-label"><span className="view-label-dot dot-3d" />三维空间</span>{hasStale && <span className="stale-chip">上一有效结果</span>}</div><Plot3D layers={renderLayers} params={project.params} selectedId={selectedId} onSelectLayer={setSelectedId} onStatus={setStatus} canvasRef={plot3dRef} theme={theme} viewCommand={viewCommand} cameraState={project.camera3d} onCameraChange={handleCameraChange} />{!has3dLayer && <div className="empty-plot empty-plot-3d"><span>◈</span><h3>让函数进入三维空间</h3><p>打开曲面示例，旋转视角观察高度变化。</p><button onClick={() => loadExample(EXAMPLES[3])}>打开三维示例</button></div>}</section>}
        </div>
        <div className="statusbar"><div className="status-left"><span className="status-live-dot" />{statusText}</div><div className="status-right"><span>{project.mode === '3d' ? '拖动旋转 · 滚轮缩放' : '拖动平移 · 滚轮缩放'}</span><span className="status-divider" /><span>{project.mode === '3d' ? '3D' : project.coordinateSystem === 'polar' ? '极坐标' : '直角坐标'}</span><button onClick={() => setShowHelp(true)} title="查看快捷键">?</button></div></div>
      </main>

      <aside className={`right-sidebar ${showRight ? 'show' : ''}`}><div className="inspector-header"><span className="eyebrow">INSPECTOR</span><h2>{selectedLayer ? selectedLayer.name : '属性设置'}</h2><p>修改表达式和参数，观察画布中的变化。</p></div>
        {selectedLayer ? <div className="inspector-scroll"><div className="inspector-section"><div className="field-heading"><label htmlFor="expression-input">表达式</label><button type="button" className={`formula-help-toggle ${showFormulaHelp ? 'is-open' : ''}`} aria-expanded={showFormulaHelp} aria-controls="formula-guide" onClick={() => setShowFormulaHelp(value => !value)}><Icon name="help" size={14} />公式说明</button></div>
          <textarea id="expression-input" className={`expression-input ${selectedValidation?.error ? 'has-error' : ''}`} value={selectedLayer.expression} onChange={event => updateLayer(selectedLayer.id, { expression: event.target.value })} spellCheck={false} rows={selectedLayer.expression.length > 32 ? 3 : 2} />
          <div className="expression-hint">支持 sin、cos、^、π、参数与括号</div>
          {selectedValidation?.error && <div className="field-error" role="alert">{selectedValidation.error}</div>}
          {showFormulaHelp && <div className="formula-guide" id="formula-guide" role="region" aria-label="公式输入说明">
            <div className="formula-guide-title">{formulaGuide.title}<span>写法示例</span></div>
            <code className="formula-guide-example">{formulaKind === 'function2d' && /^\s*x\s*=/.test(selectedLayer.expression) ? 'x = y^2' : formulaGuide.example}</code>
            <p>{formulaGuide.variables}</p>
            <p><strong>常用函数</strong> sin、cos、tan、sqrt、abs、log、ln；乘法用 *，乘方用 ^，圆周率可写 pi 或 π。</p>
            <p><strong>输入报错时</strong> 检查等号左侧、括号是否成对，以及函数是否带参数，例如 sin(x)。</p>
          </div>}</div>
          <div className="inspector-section"><div className="field-heading"><span>参数调节</span><span className="field-kicker">VARIABLES</span></div>{selectedParams.length ? selectedParams.map(key => {
            const range = project.ranges?.[key] || [-5, 5, 0.1];
            const value = Number.isFinite(project.params[key]) ? project.params[key] : 1;
            return <div className="parameter" key={key}><div className="parameter-top"><span className="parameter-name">{key}</span><output>{formatNumber(value)}</output></div><input type="range" min={range[0]} max={range[1]} step={range[2]} value={value} aria-label={`参数 ${key}`} onChange={event => changeParameter(key, Number(event.target.value))} /><div className="parameter-range"><span>{range[0]}</span><span>{range[1]}</span></div></div>;
          }) : <p className="no-params">在表达式中加入 a、b 等字母，就能创建可拖动的参数。</p>}</div>
          <div className="inspector-section"><div className="field-heading"><span>绘制范围</span><span className="field-kicker">DOMAIN</span></div>
            {selectedPlotKind === 'surface3d' ? <>
              <DomainRangeEditor label="X 轴" id={`${selectedLayer.id}-x`} range={domainPair(selectedLayer.domain, 'x', [-5, 5])} limit={1000} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: withSurfaceAxis(selectedLayer.domain, 'x', pair) })} />
              <DomainRangeEditor label="Y 轴" id={`${selectedLayer.id}-y`} range={domainPair(selectedLayer.domain, 'y', [-5, 5])} limit={1000} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: withSurfaceAxis(selectedLayer.domain, 'y', pair) })} />
              <p className="domain-hint">X、Y 可分别设置；Z 的高度由公式决定。</p>
            </> : <>
              <DomainRangeEditor label={selectedPlotKind === 'curve3d' || selectedPlotKind === 'parametric2d' ? '参数 t' : selectedPlotKind === 'polar2d' ? '角度 θ（弧度）' : selectedPlot?.formulas?.x ? 'Y 轴' : 'X 轴'} id={`${selectedLayer.id}-domain`} range={normalizeDomain(selectedLayer.domain, selectedPlotKind)} limit={selectedPlotKind === 'curve3d' ? 1000 : undefined} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: pair })} />
              <p className="domain-hint">仅绘制此范围内的部分。</p>
            </>}
          </div>
          <div className="inspector-section"><div className="field-heading"><span>图层样式</span><span className="field-kicker">STYLE</span></div><div className="color-options">{COLORS.map(color => <button key={color} className={`color-swatch ${selectedLayer.color === color ? 'selected' : ''}`} style={{ '--swatch': color }} onClick={() => updateLayer(selectedLayer.id, { color })} title={`选择颜色 ${color}`} aria-label={`选择颜色 ${color}`} />)}</div><button className="delete-layer" onClick={() => removeLayer(selectedLayer.id)}><Icon name="trash" size={15} />删除此图层</button></div>
          <div className="inspector-section learning-section"><div className="learning-icon">✦</div><div><span className="field-kicker">数学小提示</span><p>{currentExample?.concept || '改变参数后，留意图像的位置、大小和形状。需要重新开始时，可从学习示例中打开一个模板。'}</p></div></div>
        </div> : <div className="inspector-empty">选择一个图层以编辑表达式和参数。</div>}
        <div className="inspector-bottom"><IconButton icon={theme === 'light' ? 'moon' : 'sun'} label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} /><span>外观设置</span></div>
      </aside>
    </div>

    <input ref={importRef} type="file" accept=".graphproj,.json" hidden onChange={openBrowserFile} />
    {toast && <div className="toast" role="status">{toast}</div>}
    {showHelp && <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}><div className="help-modal" role="dialog" aria-modal="true" aria-label="快捷键帮助" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">GUIDE</span><h2>让探索更顺手</h2></div><button onClick={() => setShowHelp(false)} aria-label="关闭帮助">×</button></div><p>拖动画布平移，滚轮放大缩小；在三维视图拖动可旋转曲面。</p><div className="shortcut-grid"><span>保存工程</span><kbd>Ctrl + S</kbd><span>打开工程</span><kbd>Ctrl + O</kbd><span>撤销 / 重做</span><kbd>Ctrl + Z / Ctrl + Shift + Z</kbd><span>适配当前内容</span><kbd>F</kbd><span>放大 / 缩小</span><kbd>+ / −</kbd></div><button className="primary-button modal-close" onClick={() => setShowHelp(false)}>开始探索</button></div></div>}
  </div>;
}
