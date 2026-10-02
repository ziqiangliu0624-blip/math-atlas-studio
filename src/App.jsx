import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plot2D from './components/Plot2D.jsx';
import Plot3D from './components/Plot3D.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LayerNameEditor from './components/LayerNameEditor.jsx';
import ViewSettings from './components/ViewSettings.jsx';
import { START_VIEW, DEFAULT_BOX, validView, equalAspect, normalizeStyle, normalizeBox, normalizeProbes, probeSignature } from './math/view.js';
import { createHistory, recordHistory, finishGroup } from './interaction/history.js';
import { compile, findParameters, parsePlot } from './math/engine.js';
import { domainPair, normalizeDomain, withSurfaceAxis } from './math/domain.js';

const COLORS = ['#5368d9', '#ef785b', '#16a6a0', '#a56ad9', '#e6a72e', '#467fb6'];
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
    color: partial.color || COLORS[index % COLORS.length], visible: true, ...normalizeStyle(partial),
    domain: partial.domain || [-10, 10]
  };
}

function projectFromExample(example) {
  return {
    schemaVersion: 1, name: example.title, exampleId: example.id,
    layers: example.layers.map((layer, index) => makeLayer(layer, index)),
    params: { ...example.params }, ranges: { ...example.ranges },
    view2d: { ...example.view }, aspectLocked: false, box3d: normalizeBox(), probes: {}, mode: example.mode,
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
      visible: layer.visible !== false, ...normalizeStyle(layer),
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
  const view2d = validView(data.view2d) ? data.view2d : { ...START_VIEW };
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
    layers, params, ranges, view2d, aspectLocked: data.aspectLocked === true,
    box3d: normalizeBox(data.box3d), probes: normalizeProbes(data.probes, layers),
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
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    back: <><path d="m14 6-6 6 6 6" /></>,
    forward: <><path d="m10 6 6 6-6 6" /></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5m-9 5L3 7m9 5v10" /></>
  };
  return <svg {...common}>{paths[name] || paths.chart}</svg>;
}

function IconButton({ icon, label, onClick, disabled = false, active = false, className = '' }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} onClick={onClick} disabled={disabled} title={label} aria-label={label}><Icon name={icon} /></button>;
}

function DomainRangeEditor({ label, id, range, onCommit, onInvalid, limit, disabled = false }) {
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
    <label>起点<input key={`${id}-min-${range[0]}`} type="number" disabled={disabled} defaultValue={range[0]} onBlur={event => commitEdge(0, event)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
    <label>终点<input key={`${id}-max-${range[1]}`} type="number" disabled={disabled} defaultValue={range[1]} onBlur={event => commitEdge(1, event)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
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
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [activeView, setActiveView] = useState('2d');
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [boxZoom, setBoxZoom] = useState(false);
  const [threeAvailable, setThreeAvailable] = useState(true);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 0 });
  const history = useRef(createHistory());
  const navigation = useRef({ '2d': { past: [], future: [] }, '3d': { past: [], future: [] } });
  const projectRef = useRef(project);
  const selectedRef = useRef(selectedId);
  const contextRef = useRef(null);
  const plot2dRef = useRef(null);
  const plot3dRef = useRef(null);
  const importRef = useRef(null);
  const revisionRef = useRef(0);
  const sliderHeld = useRef(false);
  const activeCanvas = project.mode === 'split' ? activeView : project.mode;
  const displayedView = useMemo(() => equalAspect(project.view2d, plotSize, project.aspectLocked), [project.view2d, plotSize, project.aspectLocked]);
  const endHistoryGroup = useCallback(() => finishGroup(history.current), []);
  const flushView = useCallback(() => plot3dRef.current?.flushView?.(), []);
  const resolveView = useCallback(target => target === '2d' || target === '3d' ? target : activeCanvas, [activeCanvas]);

  const selectLayer = useCallback(id => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  const closeContextMenu = useCallback((restoreFocus = false) => {
    const anchor = contextRef.current?.anchorElement;
    contextRef.current = null;
    setContextMenu(null);
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }, []);

  const openContextMenu = useCallback(context => {
    if (context.layerId && !projectRef.current.layers.some(layer => layer.id === context.layerId)) return;
    if (context.layerId) selectLayer(context.layerId);
    if (context.source !== 'layers') setActiveView(context.source);
    contextRef.current = context;
    setContextMenu(context);
  }, [selectLayer]);

  useEffect(() => { closeContextMenu(); setRenamingId(null); }, [project.mode, closeContextMenu]);
  useEffect(() => { setStatus({ message: `${activeCanvas.toUpperCase()} 画布已就绪` }); }, [activeCanvas]);

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
  const staleInView = useCallback(view => renderLayers.some(layer => layer.visible && layer.stale &&
    (parsePlot(layer.expression).kind?.endsWith('3d') ? '3d' : '2d') === view), [renderLayers]);

  const notify = useCallback(message => {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(''), 3600);
  }, []);

  const recordNavigation = useCallback((before, after, grouped = false) => {
    for (const [target, key] of [['2d', 'view2d'], ['3d', 'camera3d']]) {
      if (!before[key] || !after[key] || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      const nav = navigation.current[target];
      if (!grouped) nav.past = [...nav.past.slice(-39), before[key]];
      nav.future = [];
    }
  }, []);

  const commit = useCallback((updater, nextSelection = selectedRef.current, options = {}) => {
    if (!options.fromCamera) flushView();
    const previous = projectRef.current;
    const next = typeof updater === 'function' ? updater(previous) : updater;
    if (next === previous) return;
    const newStep = recordHistory(history.current, { project: previous, selectedId: selectedRef.current }, options);
    if (!options.skipNavigation) recordNavigation(previous, next, !newStep);
    revisionRef.current += 1;
    projectRef.current = next;
    setProject(next);
    selectLayer(nextSelection);
    setDirty(true);
  }, [selectLayer, flushView, recordNavigation]);

  const undo = useCallback(() => {
    flushView(); endHistoryGroup();
    if (!history.current.past.length) return;
    closeContextMenu(); setRenamingId(null);
    history.current.future.push({ project: projectRef.current, selectedId: selectedRef.current });
    const next = history.current.past.pop();
    recordNavigation(projectRef.current, next.project);
    projectRef.current = next.project;
    setProject(next.project);
    selectLayer(next.selectedId);
    revisionRef.current += 1;
    setDirty(true); notify('已撤销上一步操作');
  }, [selectLayer, closeContextMenu, endHistoryGroup, flushView, recordNavigation, notify]);

  const redo = useCallback(() => {
    flushView(); endHistoryGroup();
    if (!history.current.future.length) return;
    closeContextMenu(); setRenamingId(null);
    history.current.past.push({ project: projectRef.current, selectedId: selectedRef.current });
    const next = history.current.future.pop();
    recordNavigation(projectRef.current, next.project);
    projectRef.current = next.project;
    setProject(next.project);
    selectLayer(next.selectedId);
    revisionRef.current += 1;
    setDirty(true); notify('已重做上一步操作');
  }, [selectLayer, closeContextMenu, endHistoryGroup, flushView, recordNavigation, notify]);

  const change2dView = useCallback((next, options = {}) => {
    const adjusted = equalAspect(next, plotSize, projectRef.current.aspectLocked);
    if (!validView(adjusted)) { notify('视图已到可用范围边界'); return; }
    commit(previous => JSON.stringify(previous.view2d) === JSON.stringify(adjusted) ? previous : { ...previous, view2d: adjusted }, selectedRef.current, options);
  }, [commit, plotSize, notify]);

  const travelView = useCallback((direction, target) => {
    flushView(); endHistoryGroup(); closeContextMenu();
    const source = resolveView(target), key = source === '2d' ? 'view2d' : 'camera3d';
    const nav = navigation.current[source];
    const from = direction === 'back' ? nav.past : nav.future;
    const to = direction === 'back' ? nav.future : nav.past;
    if (!from.length) return;
    const next = from.pop();
    to.push(projectRef.current[key]);
    commit(previous => ({ ...previous, [key]: next }), selectedRef.current, { skipNavigation: true });
    notify(`已${direction === 'back' ? '返回上一' : '前进到下一'}${source.toUpperCase()}视图`);
  }, [commit, resolveView, notify, flushView, endHistoryGroup, closeContextMenu]);

  useEffect(() => {
    const stop = () => endHistoryGroup();
    window.addEventListener('blur', stop);
    return () => window.removeEventListener('blur', stop);
  }, [endHistoryGroup]);

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
      selectLayer(project.layers[0]?.id);
    }
  }, [project.layers, selectedId, selectLayer]);

  const stashRecovery = useCallback(snapshot => {
    try {
      const next = [{ savedAt: new Date().toISOString(), project: snapshot }, ...loadRecoveries()].slice(0, 5);
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(next));
      setRecoveryItems(next);
      return true;
    } catch { notify('本地恢复副本未能保存，请先手动保存工程'); return false; }
  }, [notify]);

  const switchProject = useCallback((next, path = null, isDirty = false) => {
    flushView(); endHistoryGroup();
    if (dirty && !stashRecovery(projectRef.current)) return false;
    closeContextMenu(); setRenamingId(null);
    history.current = createHistory();
    navigation.current = { '2d': { past: [], future: [] }, '3d': { past: [], future: [] } };
    setBoxZoom(false); setShowViewSettings(false);
    revisionRef.current += 1;
    projectRef.current = next;
    setProject(next);
    selectLayer(next.layers[0]?.id);
    setFilePath(path);
    setDirty(isDirty);
    return true;
  }, [dirty, stashRecovery, closeContextMenu, selectLayer, flushView, endHistoryGroup]);

  const loadExample = useCallback(example => {
    const next = projectFromExample(example);
    if (!switchProject(next, null, true)) return;
    setSidebarTab('layers');
    notify(`已打开「${example.title}」示例`);
  }, [switchProject, notify]);

  const updateLayer = useCallback((id, changes, options = {}) => {
    commit(previous => {
      const original = previous.layers.find(layer => layer.id === id);
      if (original?.locked && Object.keys(changes).some(key => !['locked', 'visible'].includes(key))) return previous;
      if (!original || Object.entries(changes).every(([key, value]) => original[key] === value)) return previous;
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
    }, selectedRef.current, options);
  }, [commit]);

  const addLayer = useCallback(target => {
    if (projectRef.current.layers.length >= 200) { notify('一个工程最多支持 200 个图层'); return; }
    const is3d = resolveView(target) === '3d';
    const layer = makeLayer({ name: is3d ? '新曲面' : '新函数', expression: is3d ? 'z = sin(x)*cos(y)' : 'y = sin(x)', color: COLORS[project.layers.length % COLORS.length], domain: is3d ? { x: [-5, 5], y: [-5, 5] } : [-10, 10] }, project.layers.length);
    commit(previous => ({ ...previous, exampleId: null, layers: [...previous.layers, layer] }), layer.id);
    setSidebarTab('layers');
  }, [commit, resolveView, project.layers.length, notify]);

  const removeLayer = useCallback(id => {
    const layers = projectRef.current.layers;
    const index = layers.findIndex(layer => layer.id === id);
    if (index < 0 || layers[index].locked) return;
    const nextSelection = selectedRef.current === id ? (layers[index + 1] || layers[index - 1])?.id : selectedRef.current;
    commit(previous => ({ ...previous, exampleId: null, layers: previous.layers.filter(layer => layer.id !== id) }), nextSelection);
  }, [commit]);

  const duplicateLayer = useCallback(id => {
    const layers = projectRef.current.layers;
    const index = layers.findIndex(layer => layer.id === id);
    if (index < 0) return;
    if (layers.length >= 200) { notify('一个工程最多支持 200 个图层'); return; }
    const copy = { ...structuredClone(layers[index]), id: crypto.randomUUID(), locked: false, name: `${layers[index].name.slice(0, 96)} 副本` };
    commit(previous => ({ ...previous, exampleId: null, layers: [...previous.layers.slice(0, index + 1), copy, ...previous.layers.slice(index + 1)] }), copy.id);
    notify('图层已复制；同名参数仍联动');
  }, [commit, notify]);

  const moveLayer = useCallback((id, direction) => {
    commit(previous => {
      const index = previous.layers.findIndex(layer => layer.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= previous.layers.length || previous.layers[index].locked || previous.layers[destination].locked) return previous;
      const layers = [...previous.layers];
      [layers[index], layers[destination]] = [layers[destination], layers[index]];
      return { ...previous, exampleId: null, layers };
    });
  }, [commit]);

  const editLayer = useCallback(id => {
    if (projectRef.current.layers.find(layer => layer.id === id)?.locked) { notify('请先解锁图层，再修改属性'); return; }
    selectLayer(id); setShowRight(true);
    window.requestAnimationFrame(() => { const input = document.getElementById('expression-input'); input?.focus(); input?.select(); });
  }, [selectLayer, notify]);

  const changeParameter = useCallback((key, value) => {
    commit(previous => previous.params[key] === value ? previous : ({ ...previous, params: { ...previous.params, [key]: value } }), selectedRef.current, { group: `parameter:${key}`, hold: sliderHeld.current });
  }, [commit]);

  const saveProject = useCallback(async (saveAs = false) => {
    try {
      flushView(); endHistoryGroup();
      const snapshot = { ...projectRef.current, savedAt: new Date().toISOString() };
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
  }, [project, filePath, notify, flushView, endHistoryGroup]);

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

  const exportPng = useCallback(async target => {
    const view = resolveView(target);
    if (staleInView(view)) { notify('请先修正当前画布的表达式，再导出图像'); return; }
    const canvas = view === '3d' ? plot3dRef.current : plot2dRef.current;
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
      notify(`已导出 ${view.toUpperCase()} 画布 PNG`);
    } catch (error) { notify(`导出失败：${error.message}`); }
  }, [staleInView, resolveView, project.name, notify]);

  const zoom2d = useCallback(factor => {
    const view = equalAspect(projectRef.current.view2d, plotSize, projectRef.current.aspectLocked);
    const cx = (view.xmin + view.xmax) / 2, cy = (view.ymin + view.ymax) / 2;
    const width = (view.xmax - view.xmin) * factor / 2, height = (view.ymax - view.ymin) * factor / 2;
    change2dView({ xmin: cx - width, xmax: cx + width, ymin: cy - height, ymax: cy + height });
  }, [change2dView, plotSize]);

  const fitView = useCallback(target => {
    if (resolveView(target) === '3d') setViewCommand(command => ({ id: command.id + 1, type: 'fit' }));
    else change2dView(getFitView(projectRef.current.layers, projectRef.current.params, projectRef.current.view2d));
    notify('已适配当前绘制域；域外或超过安全范围的极值未包含');
  }, [resolveView, change2dView, notify]);

  const resetView = useCallback(target => {
    if (resolveView(target) === '3d') setViewCommand(command => ({ id: command.id + 1, type: 'reset' }));
    else change2dView({ ...START_VIEW });
  }, [resolveView, change2dView]);

  const zoomActive = useCallback((factor, target) => {
    if (resolveView(target) === '3d') setViewCommand(command => ({ id: command.id + 1, type: factor < 1 ? 'zoomIn' : 'zoomOut' }));
    else zoom2d(factor);
  }, [resolveView, zoom2d]);

  const send3dCommand = useCallback((type, point) => {
    setViewCommand(command => ({ id: command.id + 1, type, point }));
    if (type === 'toggleProjection') setProjection(value => value === '透视' ? '正交' : '透视');
  }, []);

  const handleCameraChange = useCallback((next, initial = false, options = {}) => {
    if (initial) {
      if (projectRef.current.camera3d) return;
      const baseline = { ...projectRef.current, camera3d: next };
      projectRef.current = baseline;
      setProject(baseline);
      return;
    }
    commit(previous => JSON.stringify(previous.camera3d) === JSON.stringify(next)
      ? previous : { ...previous, camera3d: next }, selectedRef.current, { ...options, fromCamera: true });
  }, [commit]);

  const copyCoordinates = useCallback(async point => {
    if (!point || !Object.values(point).every(Number.isFinite)) return;
    const text = Object.entries(point).map(([axis, value]) => `${axis} = ${Number(value.toPrecision(8))}`).join(', ');
    try {
      if (window.desktop?.writeClipboardText) await window.desktop.writeClipboardText(text);
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('当前环境无法使用剪贴板');
      notify(`已复制坐标：${text}`);
    } catch (error) { notify(`复制失败：${error.message}`); }
  }, [notify]);

  const getProbe = source => {
    const probe = project.probes?.[source];
    if (!probe) return null;
    const layer = probe.layerId ? project.layers.find(item => item.id === probe.layerId) : null;
    const valid = (source !== '3d' || threeAvailable) && !staleInView(source) && (!probe.layerId || (layer?.visible && layer.opacity > 0 && !readPlot(layer).error && probe.signature === probeSignature(layer, project.params)));
    return { ...probe, valid, name: layer?.name || '画布坐标' };
  };
  const probes = { '2d': getProbe('2d'), '3d': getProbe('3d') };
  const pinProbe = (source, point, layerId) => {
    const layer = projectRef.current.layers.find(item => item.id === layerId);
    const probe = { point, layerId: layerId || null, signature: layer ? probeSignature(layer, projectRef.current.params) : '' };
    commit(previous => ({ ...previous, probes: { ...previous.probes, [source]: probe } }));
    notify(source === '3d' ? '已固定近似采样命中点；图形改变后需重新固定' : '已固定画布坐标；图形改变后需重新固定');
  };
  const clearProbe = source => commit(previous => ({ ...previous, probes: { ...previous.probes, [source]: null } }));
  const renderProbe = source => probes[source] && <div className="probe-readout" data-probe={source} data-valid={probes[source].valid}>
    <div><strong>{source.toUpperCase()} 固定探针 · {probes[source].name}</strong><span>{probes[source].valid ? Object.entries(probes[source].point).map(([axis, value]) => `${axis} ${source === '3d' ? '≈ ' : ''}${formatNumber(value)}`).join(' · ') : '坐标已失效，请重新固定'}</span></div>
    <button onClick={() => copyCoordinates(probes[source].point)} disabled={!probes[source].valid}>复制</button><button onClick={() => clearProbe(source)} aria-label={`清除 ${source.toUpperCase()} 固定探针`}>×</button>
  </div>;
  const sliderStart = () => { endHistoryGroup(); sliderHeld.current = true; };
  const sliderEnd = () => { sliderHeld.current = false; endHistoryGroup(); };

  const menuLayer = contextMenu?.layerId ? project.layers.find(layer => layer.id === contextMenu.layerId) : null;
  const menuItems = [];
  if (contextMenu) {
    const view = contextMenu.source;
    const unavailable = view === '3d' && contextMenu.available === false;
    const stale = view !== 'layers' && staleInView(view);
    const index = menuLayer ? project.layers.indexOf(menuLayer) : -1;
    const item = (id, label, action, disabled = false, reason = '', danger = false) => ({ id, label, action, disabled, reason: disabled ? reason : '', danger });
    const separator = () => menuItems.push({ separator: true });
    if (menuLayer) {
      menuItems.push(
        item('edit', '编辑表达式', () => editLayer(menuLayer.id), menuLayer.locked, '请先解锁'),
        item('rename', '重命名', () => { setSidebarTab('layers'); setRenamingId(menuLayer.id); }, menuLayer.locked, '请先解锁'),
        item('duplicate', '复制图层', () => duplicateLayer(menuLayer.id), project.layers.length >= 200, '已达 200 层'),
        item('lock', menuLayer.locked ? '解锁图层' : '锁定图层', () => { updateLayer(menuLayer.id, { locked: !menuLayer.locked }); notify(menuLayer.locked ? '图层已解锁' : '图层已锁定；共享参数仍联动'); }),
        item('visibility', menuLayer.visible ? '隐藏图层' : '显示图层', () => updateLayer(menuLayer.id, { visible: !menuLayer.visible })),
      );
      separator();
      menuItems.push(
        item('move-up', '上移一层', () => moveLayer(menuLayer.id, -1), index === 0 || menuLayer.locked || project.layers[index - 1]?.locked, menuLayer.locked || project.layers[index - 1]?.locked ? '图层已锁定' : '已在最上方'),
        item('move-down', '下移一层', () => moveLayer(menuLayer.id, 1), index === project.layers.length - 1 || menuLayer.locked || project.layers[index + 1]?.locked, menuLayer.locked || project.layers[index + 1]?.locked ? '图层已锁定' : '已在最下方'),
        item('delete', '删除图层', () => removeLayer(menuLayer.id), menuLayer.locked, '请先解锁', true),
      );
    } else {
      menuItems.push(item('add', view === '3d' ? '添加三维表达式' : '添加二维表达式', () => addLayer(view), project.layers.length >= 200, '已达 200 层'));
      separator();
      menuItems.push(
        item('fit', '适配内容', () => fitView(view), unavailable, '3D 不可用'),
        item('reset', '重置视图', () => resetView(view), unavailable, '3D 不可用'),
      );
      if (view === '3d') menuItems.push(
        item('top', '俯视', () => send3dCommand('top'), unavailable, '3D 不可用'),
        item('front', '正视', () => send3dCommand('front'), unavailable, '3D 不可用'),
        item('side', '侧视', () => send3dCommand('side'), unavailable, '3D 不可用'),
        item('projection', projection === '透视' ? '切换为正交投影' : '切换为透视投影', () => send3dCommand('toggleProjection'), unavailable, '3D 不可用'),
      );
      else menuItems.push(item('zoom-in', '放大', () => zoomActive(0.8, view)), item('zoom-out', '缩小', () => zoomActive(1.25, view)));
    }
    if (view !== 'layers') {
      separator();
      if (view === '3d' && contextMenu.point) menuItems.push(item('focus', '聚焦此处', () => send3dCommand('focus', contextMenu.point), stale, '请先修正表达式'));
      menuItems.push(item('view-settings', '精确视图设置', () => setShowViewSettings(true), unavailable, '3D 不可用'));
      menuItems.push(item('view-back', '返回上一视图', () => travelView('back', view), !navigation.current[view].past.length || unavailable, unavailable ? '3D 不可用' : '没有上一视图'));
      if (view === '2d') menuItems.push(item('box-zoom', '框选放大', () => { setBoxZoom(true); notify('拖出矩形放大；按 Esc 退出'); }));
      if (contextMenu.point) menuItems.push(item('pin-probe', '固定此处坐标探针', () => pinProbe(view, contextMenu.point, contextMenu.layerId), stale || unavailable, '请先修正表达式'));
      if (contextMenu.point) menuItems.push(item('copy-coordinates', view === '3d' ? '复制近似命中点坐标' : '复制画布坐标', () => copyCoordinates(contextMenu.point), stale, '请先修正表达式'));
      menuItems.push(item('export', '导出当前画布 PNG', () => exportPng(view), stale || unavailable, unavailable ? '3D 不可用' : '请先修正表达式'));
    }
  }

  const rowContext = (event, layer) => {
    if (event.target.closest('input')) return;
    event.preventDefault(); event.stopPropagation();
    const row = event.currentTarget;
    const keyboard = event.type === 'keydown';
    const rect = row.getBoundingClientRect();
    openContextMenu({ source: 'layers', layerId: layer.id, anchorElement: row,
      clientX: keyboard ? rect.left + 20 : event.clientX, clientY: keyboard ? rect.bottom : event.clientY });
  };

  useEffect(() => {
    const handler = event => {
      if (event.defaultPrevented || contextRef.current) return;
      const active = document.activeElement;
      const editing = active?.isContentEditable || active?.tagName === 'TEXTAREA' || (active?.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'file', 'button'].includes(active.type));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); openProject(); }
      else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
      else if (!editing && (event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); redo(); }
      else if (!editing && event.key.toLowerCase() === 'f') fitView();
      else if (!editing && (event.key === '+' || event.key === '=')) zoomActive(0.8);
      else if (!editing && event.key === '-') zoomActive(1.25);
      else if (!editing && event.key === '?') setShowHelp(value => !value);
      else if (!editing && event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); travelView('back'); }
      else if (!editing && event.altKey && event.key === 'ArrowRight') { event.preventDefault(); travelView('forward'); }
      else if (event.key === 'Escape') { setShowHelp(false); setBoxZoom(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [saveProject, openProject, undo, redo, fitView, zoomActive, travelView]);

  const statusText = status?.message || (status?.cursor ? Object.entries(status.cursor).map(([key, value]) => `${key} ${status.approximate ? '≈ ' : ''}${formatNumber(value)}`).join('  ·  ') : '准备就绪');

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark" aria-hidden="true">∿</span><div className="brand-copy"><strong>图形绘制实验室</strong><small>MATH ATLAS</small></div></div>
      <div className="project-identity"><span className="topbar-divider" /><input value={project.name} aria-label="工程名称" onBlur={endHistoryGroup} onChange={event => commit(previous => ({ ...previous, name: event.target.value }), selectedRef.current, { group: 'project-name' })} /><span className={`save-indicator ${dirty ? 'is-dirty' : ''}`}>{filePath ? (dirty ? '未保存' : '已保存') : '本地草稿'}</span></div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <IconButton icon="undo" label="撤销 Ctrl+Z" onClick={undo} disabled={!history.current.past.length} />
        <IconButton icon="redo" label="重做 Ctrl+Shift+Z" onClick={redo} disabled={!history.current.future.length} />
        <span className="action-separator" />
        <button className="text-button" aria-label="打开工程" onClick={openProject}><Icon name="folder" />打开</button>
        <button className="text-button" aria-label="保存工程" onClick={() => saveProject()}><Icon name="save" />保存</button>
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
            return <div key={layer.id} data-layer-id={layer.id} tabIndex={0} role="group" aria-label={`${layer.name}，${layer.visible ? '可见' : '隐藏'}${layer.locked ? '，已锁定' : ''}`} aria-haspopup="menu"
              className={`layer-row ${selectedId === layer.id ? 'selected' : ''} ${validity.error ? 'invalid' : ''}`}
              onClick={() => selectLayer(layer.id)} onFocus={event => { if (event.target === event.currentTarget) selectLayer(layer.id); }}
              onContextMenu={event => rowContext(event, layer)} onKeyDown={event => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) rowContext(event, layer);
                else if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); editLayer(layer.id); }
              }}>
              <span className="layer-index">{String(index + 1).padStart(2, '0')}</span><span className="layer-color" style={{ background: layer.color }} />
              <div className="layer-main">{renamingId === layer.id ? <LayerNameEditor name={layer.name} onFinish={name => {
                setRenamingId(null); updateLayer(layer.id, { name });
                window.requestAnimationFrame(() => [...document.querySelectorAll('[data-layer-id]')].find(row => row.dataset.layerId === layer.id)?.focus());
              }} /> : <strong>{layer.name}{layer.locked && <span className="layer-lock" title="已锁定"><Icon name="lock" size={12} /></span>}</strong>}<small>{layer.expression}</small></div>
              <button className="layer-visibility" title={layer.visible ? '隐藏图层' : '显示图层'} aria-label={layer.visible ? '隐藏图层' : '显示图层'} onClick={event => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}><Icon name={layer.visible ? 'eye' : 'eyeOff'} size={16} /></button>
            </div>;
          })}</div>
          <button className="add-layer" onClick={addLayer}><Icon name="plus" size={17} />添加表达式</button>
          <div className="sidebar-note"><span className="note-icon">✦</span><div><strong>从图形开始理解</strong><p>试着改变一个参数，再观察曲线如何移动。</p></div></div>
        </div> : <div className="sidebar-body examples-body"><p className="sidebar-intro">打开一个示例，拖动参数，看看数学如何变成图形。</p>{EXAMPLES.map(example => <button key={example.id} className={`example-card ${project.exampleId === example.id ? 'current' : ''}`} onClick={() => loadExample(example)}><span className="example-symbol">{example.symbol}</span><span><strong>{example.title}</strong><small>{example.group}</small></span><Icon name="chevron" size={15} /></button>)}{recoveryItems.length > 0 && <div className="recovery-list"><div className="section-line">未保存工程的恢复副本</div>{recoveryItems.map(item => <button key={item.savedAt} className="recovery-card" onClick={() => restoreRecovery(item)}><strong>{item.project?.name || '未命名工程'}</strong><small>{new Date(item.savedAt).toLocaleString('zh-CN')}</small></button>)}</div>}</div>}
        <div className="sidebar-footer"><span className="local-dot" />仅保存于本机<span className="footer-version">v0.1.3</span></div>
      </aside>

      <main className="main-area">
        <div className="canvas-toolbar"><div className="view-segment" role="tablist" aria-label="画布视图"><button className={project.mode === '2d' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: '2d' }))}><Icon name="chart" size={16} />2D</button><button className={project.mode === '3d' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: '3d' }))}><Icon name="cube" size={16} />3D</button><button className={project.mode === 'split' ? 'active' : ''} onClick={() => commit(previous => ({ ...previous, mode: 'split' }))}>分屏</button></div>
          {activeCanvas === '2d' && <div className="coord-segment"><span>坐标系</span><select value={project.coordinateSystem || 'cartesian'} onChange={event => commit(previous => ({ ...previous, coordinateSystem: event.target.value }))} aria-label="坐标系"><option value="cartesian">直角坐标</option><option value="polar">极坐标</option></select></div>}
          {activeCanvas === '3d' && <div className="camera-controls"><button onClick={() => send3dCommand('toggleProjection')} title="切换透视／正交投影">{projection}</button><button onClick={() => send3dCommand('top')} title="从上方看">俯视</button><button onClick={() => send3dCommand('front')} title="从前方看">正视</button><button onClick={() => send3dCommand('side')} title="从侧面看">侧视</button></div>}
          <div className="toolbar-spacer" /><div className="toolbar-actions"><IconButton icon="back" label="返回上一视图 Alt+←" onClick={() => travelView('back')} disabled={!navigation.current[activeCanvas].past.length} /><IconButton icon="forward" label="前进下一视图 Alt+→" onClick={() => travelView('forward')} disabled={!navigation.current[activeCanvas].future.length} /><button className={`text-button ${showViewSettings ? 'is-active' : ''}`} aria-expanded={showViewSettings} onClick={() => setShowViewSettings(value => !value)}>视图设置</button><IconButton icon="zoomOut" label="缩小" onClick={() => zoomActive(1.25)} /><IconButton icon="zoomIn" label="放大" onClick={() => zoomActive(0.8)} /><span className="action-separator" /><IconButton icon="fit" label="适配内容 F" onClick={fitView} /><IconButton icon="reset" label="重置视图" onClick={resetView} /><IconButton icon="sliders" label="显示设置面板" onClick={() => setShowRight(value => !value)} className="mobile-settings" /></div></div>
        {showViewSettings && <ViewSettings key={activeCanvas} target={activeCanvas} view={displayedView} box={project.box3d || DEFAULT_BOX} aspectLocked={project.aspectLocked} onApply={next => { change2dView(next); notify('二维视图范围已应用'); }} onAspect={locked => commit(previous => ({ ...previous, aspectLocked: locked }))} onBox={box => { commit(previous => ({ ...previous, box3d: box })); notify('三维参考坐标盒已更新'); }} onClose={() => setShowViewSettings(false)} />}
        <div className={`canvas-stage mode-${project.mode}`}>
          {(project.mode === '2d' || project.mode === 'split') && <section className={`plot-panel plot-panel-2d ${activeCanvas === '2d' ? 'is-active' : ''}`} onPointerDownCapture={() => setActiveView('2d')} onFocusCapture={() => setActiveView('2d')}><div className="plot-overlay-top"><span className="view-label"><span className="view-label-dot" />二维平面{project.mode === 'split' && activeCanvas === '2d' ? ' · 当前' : ''}</span>{staleInView('2d') && <span className="stale-chip">上一有效结果 · 请修正表达式</span>}</div>{boxZoom && <div className="box-mode-hint">拖出矩形放大 · Esc 退出<button onClick={() => setBoxZoom(false)}>退出</button></div>}<Plot2D layers={renderLayers} params={project.params} selectedId={selectedId} onSelectLayer={selectLayer} onContextMenu={openContextMenu} onInteractionStart={closeContextMenu} onStatus={next => { if (activeCanvas === '2d') setStatus(next); }} view={project.view2d || START_VIEW} onViewChange={change2dView} onHistoryEnd={endHistoryGroup} onSize={setPlotSize} aspectLocked={project.aspectLocked} boxZoom={boxZoom} onBoxComplete={() => setBoxZoom(false)} probe={probes['2d']} canvasRef={plot2dRef} coordinateSystem={project.coordinateSystem || 'cartesian'} theme={theme} />{!has2dLayer && <div className="empty-plot"><span>∿</span><h3>从一个二维表达式开始</h3><p>添加函数，图像会在这里出现。</p><button onClick={() => addLayer('2d')}>添加表达式</button></div>}</section>}
          {(project.mode === '3d' || project.mode === 'split') && <section className={`plot-panel plot-panel-3d ${activeCanvas === '3d' ? 'is-active' : ''}`} onPointerDownCapture={() => setActiveView('3d')} onFocusCapture={() => setActiveView('3d')}><div className="plot-overlay-top"><span className="view-label"><span className="view-label-dot dot-3d" />三维空间{project.mode === 'split' && activeCanvas === '3d' ? ' · 当前' : ''}</span>{staleInView('3d') && <span className="stale-chip">上一有效结果</span>}</div><Plot3D layers={renderLayers} params={project.params} selectedId={selectedId} onSelectLayer={selectLayer} onContextMenu={openContextMenu} onInteractionStart={closeContextMenu} onStatus={next => { if (activeCanvas === '3d') setStatus({ ...next, approximate: !!next.cursor }); }} onAvailabilityChange={setThreeAvailable} box={project.box3d || DEFAULT_BOX} probe={probes['3d']} canvasRef={plot3dRef} theme={theme} viewCommand={viewCommand} cameraState={project.camera3d} onCameraChange={handleCameraChange} />{!has3dLayer && <div className="empty-plot empty-plot-3d"><span>◈</span><h3>让函数进入三维空间</h3><p>打开曲面示例，旋转视角观察高度变化。</p><button onClick={() => addLayer('3d')}>添加三维表达式</button></div>}</section>}
        </div>
        <div className="probe-tray">{renderProbe('2d')}{renderProbe('3d')}</div>
        <div className="statusbar"><div className="status-left"><span className="status-live-dot" />{statusText}</div><div className="status-right"><span>{activeCanvas === '3d' ? '拖动旋转 · 滚轮缩放' : '拖动平移 · 滚轮缩放'}</span><span className="status-divider" /><span>{activeCanvas === '3d' ? '3D' : project.coordinateSystem === 'polar' ? '极坐标' : '直角坐标'}</span><button onClick={() => setShowHelp(true)} title="查看快捷键">?</button></div></div>
      </main>

      <aside className={`right-sidebar ${showRight ? 'show' : ''}`}><div className="inspector-header"><span className="eyebrow">INSPECTOR</span><h2>{selectedLayer ? selectedLayer.name : '属性设置'}</h2><p>修改表达式和参数，观察画布中的变化。</p></div>
        {selectedLayer ? <div className="inspector-scroll"><div className="layer-lock-controls"><button aria-label={selectedLayer.locked ? '解锁当前图层' : '锁定当前图层'} onClick={() => { updateLayer(selectedLayer.id, { locked: !selectedLayer.locked }); notify(selectedLayer.locked ? '图层已解锁' : '图层已锁定；共享参数仍联动'); }}><Icon name="lock" size={14} />{selectedLayer.locked ? '已锁定 · 点击解锁' : '锁定图层'}</button>{selectedLayer.locked && <p>属性、排序和删除已锁定；仍可选择、显隐和复制。共享参数继续联动。</p>}</div><div className="inspector-section"><div className="field-heading"><label htmlFor="expression-input">表达式</label><button type="button" className={`formula-help-toggle ${showFormulaHelp ? 'is-open' : ''}`} aria-expanded={showFormulaHelp} aria-controls="formula-guide" onClick={() => setShowFormulaHelp(value => !value)}><Icon name="help" size={14} />公式说明</button></div>
          <textarea id="expression-input" className={`expression-input ${selectedValidation?.error ? 'has-error' : ''}`} value={selectedLayer.expression} disabled={selectedLayer.locked} onBlur={endHistoryGroup} onChange={event => updateLayer(selectedLayer.id, { expression: event.target.value }, { group: `expression:${selectedLayer.id}` })} spellCheck={false} rows={selectedLayer.expression.length > 32 ? 3 : 2} />
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
            return <div className="parameter" key={key}><div className="parameter-top"><span className="parameter-name">{key}</span><output>{formatNumber(value)}</output></div><input type="range" min={range[0]} max={range[1]} step={range[2]} value={value} aria-label={`参数 ${key}`} onPointerDown={sliderStart} onPointerUp={sliderEnd} onPointerCancel={sliderEnd} onLostPointerCapture={sliderEnd} onBlur={sliderEnd} onChange={event => changeParameter(key, Number(event.target.value))} /><div className="parameter-range"><span>{range[0]}</span><span>{range[1]}</span></div></div>;
          }) : <p className="no-params">在表达式中加入 a、b 等字母，就能创建可拖动的参数。</p>}</div>
          <div className="inspector-section"><div className="field-heading"><span>绘制范围</span><span className="field-kicker">DOMAIN</span></div>
            {selectedPlotKind === 'surface3d' ? <>
              <DomainRangeEditor disabled={selectedLayer.locked} label="X 轴" id={`${selectedLayer.id}-x`} range={domainPair(selectedLayer.domain, 'x', [-5, 5])} limit={1000} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: withSurfaceAxis(selectedLayer.domain, 'x', pair) })} />
              <DomainRangeEditor disabled={selectedLayer.locked} label="Y 轴" id={`${selectedLayer.id}-y`} range={domainPair(selectedLayer.domain, 'y', [-5, 5])} limit={1000} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: withSurfaceAxis(selectedLayer.domain, 'y', pair) })} />
              <p className="domain-hint">X、Y 可分别设置；Z 的高度由公式决定。</p>
            </> : <>
              <DomainRangeEditor disabled={selectedLayer.locked} label={selectedPlotKind === 'curve3d' || selectedPlotKind === 'parametric2d' ? '参数 t' : selectedPlotKind === 'polar2d' ? '角度 θ（弧度）' : selectedPlot?.formulas?.x ? 'Y 轴' : 'X 轴'} id={`${selectedLayer.id}-domain`} range={normalizeDomain(selectedLayer.domain, selectedPlotKind)} limit={selectedPlotKind === 'curve3d' ? 1000 : undefined} onInvalid={notify} onCommit={pair => updateLayer(selectedLayer.id, { domain: pair })} />
              <p className="domain-hint">仅绘制此范围内的部分。</p>
            </>}
          </div>
          <div className="inspector-section"><div className="field-heading"><span>图层样式</span><span className="field-kicker">STYLE</span></div><div className="color-options">{COLORS.map(color => <button key={color} disabled={selectedLayer.locked} className={`color-swatch ${selectedLayer.color === color ? 'selected' : ''}`} style={{ '--swatch': color }} onClick={() => updateLayer(selectedLayer.id, { color })} title={`选择颜色 ${color}`} aria-label={`选择颜色 ${color}`} />)}</div>
            <div className="style-fields"><label>线宽<input aria-label="图层线宽" type="number" min="1" max="12" step="0.1" value={selectedLayer.lineWidth} disabled={selectedLayer.locked || selectedPlotKind === 'surface3d'} onChange={event => { const n = Number(event.target.value); if (Number.isFinite(n) && n >= 1 && n <= 12) updateLayer(selectedLayer.id, { lineWidth: n }, { group: `width:${selectedLayer.id}` }); }} onBlur={endHistoryGroup} /></label><label>线型<select aria-label="图层线型" value={selectedLayer.lineStyle} disabled={selectedLayer.locked || selectedPlotKind === 'surface3d'} onChange={event => updateLayer(selectedLayer.id, { lineStyle: event.target.value })}><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label></div>
            <label className="opacity-field">透明度 <output>{Math.round(selectedLayer.opacity * 100)}%</output><input type="range" aria-label="图层透明度" min="0" max="1" step="0.01" value={selectedLayer.opacity} disabled={selectedLayer.locked} onPointerDown={sliderStart} onPointerUp={sliderEnd} onPointerCancel={sliderEnd} onLostPointerCapture={sliderEnd} onBlur={sliderEnd} onChange={event => updateLayer(selectedLayer.id, { opacity: Number(event.target.value) }, { group: `opacity:${selectedLayer.id}`, hold: sliderHeld.current })} /></label>
            <p className="domain-hint">{selectedPlotKind === 'surface3d' ? '曲面支持颜色与透明度；线宽和线型用于曲线。' : '线宽以屏幕像素计；0% 透明度的图层不会被画布命中。'}</p>
            <button className="delete-layer" disabled={selectedLayer.locked} onClick={() => removeLayer(selectedLayer.id)}><Icon name="trash" size={15} />删除此图层</button></div>
          <div className="inspector-section learning-section"><div className="learning-icon">✦</div><div><span className="field-kicker">数学小提示</span><p>{currentExample?.concept || '改变参数后，留意图像的位置、大小和形状。需要重新开始时，可从学习示例中打开一个模板。'}</p></div></div>
        </div> : <div className="inspector-empty">选择一个图层以编辑表达式和参数。</div>}
        <div className="inspector-bottom"><IconButton icon={theme === 'light' ? 'moon' : 'sun'} label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} /><span>外观设置</span></div>
      </aside>
    </div>

    <input ref={importRef} type="file" accept=".graphproj,.json" hidden onChange={openBrowserFile} />
    {contextMenu && <ContextMenu context={contextMenu} onClose={closeContextMenu} items={menuItems}
      title={menuLayer?.name || (contextMenu.source === '3d' ? '三维画布' : '二维画布')}
      caption={contextMenu.source === 'layers' ? '图层操作' : contextMenu.available === false ? '3D 绘制暂不可用' :
        staleInView(contextMenu.source) ? '上一有效结果 · 请先修正表达式' :
        `${contextMenu.keyboard ? '键盘入口 · 画布中心' : contextMenu.source === '3d' ? (contextMenu.point ? '采样命中点' : '视图操作') : '画布位置'}${contextMenu.point ? ' · ' + Object.entries(contextMenu.point).map(([axis, value]) => `${axis} ${contextMenu.source === '3d' ? '≈ ' : ''}${formatNumber(value)}`).join('，') : ''}`} />}
    {toast && <div className="toast" role="status">{toast}</div>}
    {showHelp && <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}><div className="help-modal" role="dialog" aria-modal="true" aria-label="快捷键帮助" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">GUIDE</span><h2>让探索更顺手</h2></div><button onClick={() => setShowHelp(false)} aria-label="关闭帮助">×</button></div><p>右键单击画布或图层打开菜单。在三维画布中，左键拖动旋转、右键拖动平移、滚轮缩放。分屏时，工具栏操作作用于当前画布。视图设置可输入范围、锁定等比例；Shift 拖动可框选放大。右键可固定坐标探针，图形改变后探针会失效。连续输入以停顿或离开输入框为一次撤销，输入框内 Ctrl+Z 保留文本撤销。</p><div className="shortcut-grid"><span>打开操作菜单</span><kbd>Shift + F10</kbd><span>选择 / 执行菜单项</span><kbd>↑ ↓ / Enter</kbd><span>关闭菜单</span><kbd>Esc</kbd><span>视图后退 / 前进</span><kbd>Alt + ← / →</kbd><span>保存工程</span><kbd>Ctrl + S</kbd><span>打开工程</span><kbd>Ctrl + O</kbd><span>撤销 / 重做</span><kbd>Ctrl + Z / Ctrl + Shift + Z</kbd><span>适配当前内容</span><kbd>F</kbd><span>放大 / 缩小</span><kbd>+ / −</kbd></div><button className="primary-button modal-close" onClick={() => setShowHelp(false)}>开始探索</button></div></div>}
  </div>;
}
