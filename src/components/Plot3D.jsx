import { exportDimensions, isGeometry } from '../math/geometry.js';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { DEFAULT_BOX } from '../math/view.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compile, parsePlot } from '../math/engine.js';
import { bindContextGesture } from '../interaction/contextGesture.js';
import './Plot3D.css';

const DOMAIN = 6;
const HEIGHT_LIMIT = 30;
const SURFACE_STEPS = 76;
const CURVE_STEPS = 1400;
const ORTHO_HEIGHT = 16;

function validCameraState(value) {
  if (!value || !['perspective', 'orthographic'].includes(value.projection)) return null;
  if (!Array.isArray(value.position) || value.position.length !== 3 ||
      !Array.isArray(value.target) || value.target.length !== 3) return null;
  const position = value.position.map(Number);
  const target = value.target.map(Number);
  const zoom = Number(value.zoom);
  if (![...position, ...target, zoom].every(Number.isFinite) || zoom <= 0 || zoom > 80 ||
      position.some(number => Math.abs(number) > 100000) ||
      target.some(number => Math.abs(number) > 100000) ||
      Math.hypot(...position.map((number, index) => number - target[index])) < 0.1) return null;
  return { projection: value.projection, position, target, zoom };
}

function cameraSnapshot(camera, target) {
  return {
    projection: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
    position: camera.position.toArray(),
    target: target.toArray(),
    zoom: camera.zoom,
  };
}

function sameCameraState(a, b) {
  return Boolean(a && b && a.projection === b.projection && Math.abs(a.zoom - b.zoom) < 1e-8 &&
    a.position.every((value, index) => Math.abs(value - b.position[index]) < 1e-8) &&
    a.target.every((value, index) => Math.abs(value - b.target[index]) < 1e-8));
}

function domainFor(layer, axis) {
  const range = Array.isArray(layer?.domain) ? layer.domain : layer?.domain?.[axis];
  const pair = Array.isArray(range) ? range : range && [range.min, range.max];
  const start = Number(pair?.[0]);
  const end = Number(pair?.[1]);
  return Number.isFinite(start) && Number.isFinite(end) && end > start &&
    Math.abs(start) <= 1000 && Math.abs(end) <= 1000 ? [start, end] : [-DOMAIN, DOMAIN];
}

function disposeTree(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  root.clear();
}

function numberFrom(fn, scope) {
  try {
    const value = fn(scope);
    return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  } catch {
    return NaN;
  }
}

function surfaceGeometry(formula, params, xDomain, yDomain) {
  const evaluate = compile(formula);
  const stride = SURFACE_STEPS + 1;
  const samples = new Float32Array(stride * stride);
  let clipped = 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let row = 0; row < stride; row += 1) {
    const y = yDomain[0] + (yDomain[1] - yDomain[0]) * row / SURFACE_STEPS;
    for (let col = 0; col < stride; col += 1) {
      const x = xDomain[0] + (xDomain[1] - xDomain[0]) * col / SURFACE_STEPS;
      const raw = numberFrom(evaluate, { ...params, x, y });
      const value = Number.isFinite(raw) && Math.abs(raw) <= HEIGHT_LIMIT ? raw : NaN;
      if (!Number.isFinite(value)) clipped += 1;
      else {
        minZ = Math.min(minZ, value);
        maxZ = Math.max(maxZ, value);
      }
      samples[row * stride + col] = value;
    }
  }

  const positions = [];
  const tones = [];
  const span = Math.max(0.001, maxZ - minZ);
  const push = (row, col) => {
    const z = samples[row * stride + col];
    positions.push(xDomain[0] + (xDomain[1] - xDomain[0]) * col / SURFACE_STEPS,
      yDomain[0] + (yDomain[1] - yDomain[0]) * row / SURFACE_STEPS, z);
    // Height shading keeps the layer's hue while making folds easier to read.
    tones.push(0.62 + 0.38 * (z - minZ) / span);
  };
  const acceptable = (a, b, c) =>
    Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) &&
    Math.max(a, b, c) - Math.min(a, b, c) < Math.min(6, Math.max(2.5, span * 0.2));

  for (let row = 0; row < SURFACE_STEPS; row += 1) {
    for (let col = 0; col < SURFACE_STEPS; col += 1) {
      const a = samples[row * stride + col];
      const b = samples[row * stride + col + 1];
      const c = samples[(row + 1) * stride + col];
      const d = samples[(row + 1) * stride + col + 1];
      if (acceptable(a, b, c)) { push(row, col); push(row, col + 1); push(row + 1, col); }
      if (acceptable(b, d, c)) { push(row, col + 1); push(row + 1, col + 1); push(row + 1, col); }
    }
  }

  if (!positions.length) return { geometry: null, clipped };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Each triangle has a flat tone. Lighting adds the local surface shape.
  const colors = [];
  for (const tone of tones) colors.push(tone, tone, tone);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, clipped };
}

function curveObjects(formulas, params, color, layerId, tDomain, stale, style, size) {
  const fx = compile(formulas.x);
  const fy = compile(formulas.y);
  const fz = compile(formulas.z);
  const group = new THREE.Group();
  const material = new LineMaterial({ color, linewidth: style.lineWidth || 2.3, transparent: true, opacity: style.opacity ?? 1, dashed: style.lineStyle !== 'solid', dashSize: style.lineStyle === 'dotted' ? 0.025 : 0.3, gapSize: style.lineStyle === 'dotted' ? 0.12 : 0.18 });
  material.resolution.set(size.width, size.height);
  let points = [];
  let clipped = 0;
  const flush = () => {
    if (points.length < 2) { points = []; return; }
    const geometry = new LineGeometry().setPositions(points.flatMap(point => point.toArray()));
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.userData.layerId = layerId;
    line.userData.stale = stale;
    group.add(line);
    points = [];
  };

  for (let index = 0; index <= CURVE_STEPS; index += 1) {
    const t = tDomain[0] + (tDomain[1] - tDomain[0]) * index / CURVE_STEPS;
    const scope = { ...params, t };
    const x = numberFrom(fx, scope);
    const y = numberFrom(fy, scope);
    const z = numberFrom(fz, scope);
    if (![x, y, z].every((value) => Number.isFinite(value) && Math.abs(value) <= HEIGHT_LIMIT)) {
      clipped += 1;
      flush();
      continue;
    }
    const next = new THREE.Vector3(x, y, z);
    if (points.length && points[points.length - 1].distanceTo(next) > 4) flush();
    points.push(next);
  }
  flush();
  if (!group.children.length) material.dispose();
  return { group, clipped };
}

function createGuides(theme, box = DEFAULT_BOX) {
  const dark = theme === 'dark';
  const group = new THREE.Group();
  const [xmin, xmax] = box.x, [ymin, ymax] = box.y, [zmin, zmax] = box.z;
  const neutral = dark ? 0x607489 : 0xa7b7c8;
  const gridPoints = [];
  const planeZ = Math.max(zmin, Math.min(zmax, 0));
  for (let i = 0; i <= 12; i++) {
    const x = xmin + (xmax - xmin) * i / 12, y = ymin + (ymax - ymin) * i / 12;
    gridPoints.push(new THREE.Vector3(x, ymin, planeZ), new THREE.Vector3(x, ymax, planeZ),
      new THREE.Vector3(xmin, y, planeZ), new THREE.Vector3(xmax, y, planeZ));
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), new THREE.LineBasicMaterial({ color: dark ? 0x344354 : 0xdce4ec })));
  const shape = new THREE.BoxGeometry(xmax - xmin, ymax - ymin, zmax - zmin);
  const edges = new THREE.EdgesGeometry(shape); shape.dispose();
  const boundary = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: neutral, transparent: true, opacity: 0.4 }));
  boundary.position.set((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2);
  group.add(boundary);
  const clamp = (pair) => Math.max(pair[0], Math.min(pair[1], 0));
  const zero = [clamp(box.x), clamp(box.y), clamp(box.z)];
  const colors = [0xea6572, 0x28a98c, 0x5f8df0];
  ['x', 'y', 'z'].forEach((axis, index) => {
    const a = [...zero], b = [...zero]; a[index] = box[axis][0]; b[index] = box[axis][1];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), new THREE.LineBasicMaterial({ color: colors[index] })));
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = `#${colors[index].toString(16).padStart(6, '0')}`;
    context.font = '600 32px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(`${axis.toUpperCase()} ${Number(box[axis][1].toPrecision(4))}`, 128, 32);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    const position = [...b]; position[index] += (box[axis][1] - box[axis][0]) * 0.055;
    sprite.position.set(...position); sprite.scale.set(2, 0.5, 1); group.add(sprite);
  });
  return group;
}

function disposeGuides(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (object.material?.map) object.material.map.dispose();
    object.material?.dispose();
  });
  root.clear();
}

/** Cartesian z-up canvas. The parent owns expressions, parameters and PNG export. */
export default function Plot3D({ layers = [], params = {}, selectedId, onSelectLayer,
  onStatus, canvasRef, theme = 'light', viewCommand, cameraState, onCameraChange, onContextMenu, onInteractionStart, box = DEFAULT_BOX, probe, onAvailabilityChange }) {
  const hostRef = useRef(null);
  const markerRef = useRef(null);
  const probeRef = useRef(probe); probeRef.current = probe;
  const runtimeRef = useRef(null);
  const callbackRef = useRef({ onSelectLayer, onStatus, onCameraChange, onContextMenu, onInteractionStart });
  const lastCommandRef = useRef(null);
  const lastInputCameraRef = useRef(null);
  const [error, setError] = useState('');
  const errorRef = useRef(error);
  errorRef.current = error;
  useEffect(() => { onAvailabilityChange?.(!error); }, [error, onAvailabilityChange]);
  callbackRef.current = { onSelectLayer, onStatus, onCameraChange, onContextMenu, onInteractionStart };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      setError('当前设备无法启动 3D 显卡绘制。请检查显卡驱动；2D 绘图和本地工程仍可继续使用。');
      callbackRef.current.onStatus?.({ message: '3D 显卡绘制不可用' });
      return undefined;
    }

    host.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '三维画布。左键拖动旋转，右键拖动平移，右键单击打开菜单。');
    if (typeof canvasRef === 'function') canvasRef(renderer.domElement);
    else if (canvasRef) canvasRef.current = renderer.domElement;
    const scene = new THREE.Scene();
    const content = new THREE.Group();
    scene.add(content);
    const guideHolder = new THREE.Group();
    scene.add(guideHolder);
    scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(8, -10, 15);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
    fillLight.position.set(-7, 8, -4);
    scene.add(fillLight);

    const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    perspective.up.set(0, 0, 1);
    perspective.position.set(13, -16, 11);
    const orthographic = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 2000);
    orthographic.up.set(0, 0, 1);
    orthographic.position.copy(perspective.position);
    let camera = perspective;
    let projection = 'perspective';
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.11;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.35;
    controls.maxDistance = 1000;
    controls.minZoom = 0.025;
    controls.maxZoom = 80;
    controls.rotateSpeed = 0.8;
    controls.zoomToCursor = true;
    controls.target.set(0, 0, 0);

    let lastReported = cameraSnapshot(camera, controls.target);
    let reportTimer = 0;
    let reportPending = false;
    let cameraGroup = '3d-wheel';
    let gestureId = 0;
    const emitCamera = (group = cameraGroup) => {
      const state = cameraSnapshot(camera, controls.target);
      if (sameCameraState(state, lastReported)) return;
      lastReported = state;
      callbackRef.current.onCameraChange?.(state, false, group ? { group } : {});
    };
    const scheduleCameraReport = () => {
      reportPending = true;
      if (reportTimer) window.clearTimeout(reportTimer);
      reportTimer = window.setTimeout(() => {
        reportTimer = 0;
        reportPending = false;
        // Finish residual damping before recording one stable gesture result.
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
        emitCamera();
      }, 180);
    };
    const cancelCameraReport = () => {
      if (reportTimer) window.clearTimeout(reportTimer);
      reportTimer = 0;
      reportPending = false;
    };

    let frame = 0;
    let disposed = false;
    const invalidate = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        controls.update();
        try {
          renderer.render(scene, camera);
          const pinned = probeRef.current, marker = markerRef.current;
          if (marker) {
            const point = pinned?.valid ? new THREE.Vector3(pinned.point.x, pinned.point.y, pinned.point.z).project(camera) : null;
            marker.hidden = !point || point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
            if (point) { marker.style.left = `${(point.x + 1) * host.clientWidth / 2}px`; marker.style.top = `${(1 - point.y) * host.clientHeight / 2}px`; }
          }
        }
        catch {
          setError('3D 绘制已中断。请检查显卡驱动后重新打开应用。');
          callbackRef.current.onStatus?.({ message: '3D 绘制已中断' });
          return;
        }
      });
    };
    const controlsChanged = () => {
      invalidate();
      if (reportPending) scheduleCameraReport();
    };
    controls.addEventListener('change', controlsChanged);
    controls.addEventListener('end', scheduleCameraReport);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      perspective.aspect = width / height;
      perspective.updateProjectionMatrix();
      const halfHeight = ORTHO_HEIGHT / 2;
      orthographic.left = -halfHeight * width / height;
      orthographic.right = halfHeight * width / height;
      orthographic.top = halfHeight;
      orthographic.bottom = -halfHeight;
      orthographic.updateProjectionMatrix();
      invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener('resize', resize);
    resize();

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line.threshold = 0.2;
    raycaster.params.Line2 = { threshold: 7 };
    const pointer = new THREE.Vector2();
    const hit = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      const intersection = raycaster.intersectObjects([...content.children].reverse(), true)[0];
      if (intersection?.pointOnLine) intersection.point = intersection.pointOnLine;
      return intersection;
    };
    let down = null;
    let hoverFrame = 0;
    let lastHover = 0;
    const pointerDown = (event) => { cameraGroup = `3d-drag:${++gestureId}`; down = event.button === 0 ? { x: event.clientX, y: event.clientY, moved: false } : null; };
    const pointerUp = (event) => {
      if (!down || down.moved || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const intersection = hit(event);
      const layerId = intersection?.object?.userData?.layerId;
      if (layerId != null) callbackRef.current.onSelectLayer?.(layerId);
    };
    const pointerMove = (event) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down.moved = true;
      const now = performance.now();
      if (hoverFrame || now - lastHover < 75) return;
      const location = { clientX: event.clientX, clientY: event.clientY };
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        lastHover = performance.now();
        const intersection = hit(location);
        callbackRef.current.onStatus?.({ cursor: intersection && !intersection.object.userData.stale ? {
          x: intersection.point.x, y: intersection.point.y, z: intersection.point.z,
        } : null });
      });
    };
    const wheelGroup = () => { cameraGroup = '3d-wheel'; };
    const pointerLeave = () => callbackRef.current.onStatus?.({ cursor: null });
    const doubleClick = (event) => {
      const intersection = hit(event);
      if (intersection && !intersection.object.userData.stale) {
        const delta = intersection.point.clone().sub(controls.target);
        controls.target.copy(intersection.point);
        camera.position.add(delta);
        controls.update();
        invalidate();
        scheduleCameraReport();
      }
    };
    const unbindContext = bindContextGesture(renderer.domElement, {
      capturePointer: false,
      onStart: () => callbackRef.current.onInteractionStart?.(),
      onOpen: location => {
        runtimeRef.current?.flushCameraReport();
        const intersection = errorRef.current ? null : hit(location);
        const point = intersection ? { x: intersection.point.x, y: intersection.point.y, z: intersection.point.z } : null;
        callbackRef.current.onContextMenu?.({ ...location, source: '3d',
          layerId: intersection?.object.userData.layerId, point,
          available: !errorRef.current, stale: intersection?.object.userData.stale, anchorElement: renderer.domElement });
      },
    });
    const contextLost = (event) => {
      event.preventDefault();
      callbackRef.current.onInteractionStart?.();
      setError('3D 显卡连接已中断。请检查显卡驱动，或重新打开应用。');
      callbackRef.current.onStatus?.({ message: '3D 显卡连接已中断' });
    };
    const contextRestored = () => {
      callbackRef.current.onInteractionStart?.();
      setError('');
      callbackRef.current.onStatus?.({ message: '3D 显卡连接已恢复' });
      invalidate();
    };
    renderer.domElement.addEventListener('wheel', wheelGroup, { capture: true, passive: true });
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('dblclick', doubleClick);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);

    const runtime = {
      renderer, scene, content, guideHolder, perspective, orthographic, controls,
      get camera() { return camera; },
      get projection() { return projection; },
      setCamera(next) {
        camera = next;
        projection = next === orthographic ? 'orthographic' : 'perspective';
        controls.object = next;
        controls.update();
        invalidate();
      },
      applyCameraState(saved) {
        cancelCameraReport();
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
        const next = saved.projection === 'orthographic' ? orthographic : perspective;
        camera = next;
        projection = saved.projection;
        controls.object = next;
        controls.target.fromArray(saved.target);
        next.position.fromArray(saved.position);
        next.zoom = saved.zoom;
        const direction = next.position.clone().sub(controls.target).normalize();
        next.up.set(0, Math.abs(direction.z) > 0.98 ? 1 : 0,
          Math.abs(direction.z) > 0.98 ? 0 : 1);
        next.updateProjectionMatrix();
        controls.update();
        lastReported = cameraSnapshot(camera, controls.target);
        invalidate();
      },
      snapshotCamera() { return cameraSnapshot(camera, controls.target); },
      flushCameraReport() {
        const damping = controls.enableDamping;
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = damping;
        cancelCameraReport();
        emitCamera();
      },
      reportCamera() { cancelCameraReport(); emitCamera(null); },
      scheduleCameraReport,
      invalidate,
    };
    runtimeRef.current = runtime;
    renderer.domElement.flushView = () => runtime.flushCameraReport();
    renderer.domElement.exportPng = options => {
      if (errorRef.current) throw new Error('3D 绘制暂不可用');
      const dims = exportDimensions(options, { width: host.clientWidth, height: host.clientHeight });
      runtime.flushCameraReport();
      const savedSize = renderer.getSize(new THREE.Vector2()), ratio = renderer.getPixelRatio(), background = scene.background;
      const savedProjection = { aspect: camera.aspect, fov: camera.fov, left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
      const oldAspect = savedSize.x / savedSize.y, newAspect = dims.width / dims.height;
      try {
        if (camera.isPerspectiveCamera) {
          camera.aspect = newAspect;
          if (newAspect < oldAspect) camera.fov = 2 * Math.atan(Math.tan(savedProjection.fov * Math.PI / 360) * oldAspect / newAspect) * 180 / Math.PI;
        } else {
          const centerX = (camera.left + camera.right) / 2, centerY = (camera.top + camera.bottom) / 2;
          const halfHeight = Math.max((camera.top - camera.bottom) / 2, (camera.right - camera.left) / 2 / newAspect);
          camera.left = centerX - halfHeight * newAspect; camera.right = centerX + halfHeight * newAspect;
          camera.bottom = centerY - halfHeight; camera.top = centerY + halfHeight;
        }
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(dims.scale); renderer.setSize(dims.width, dims.height, false);
        if (dims.transparent) { scene.background = null; renderer.setClearAlpha(0); }
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      } finally {
        scene.background = background;
        for (const [key, value] of Object.entries(savedProjection)) if (value !== undefined) camera[key] = value;
        camera.updateProjectionMatrix(); renderer.setPixelRatio(ratio); renderer.setSize(savedSize.x, savedSize.y, false);
        renderer.render(scene, camera);
      }
    };
    const initialCamera = validCameraState(cameraState);
    if (initialCamera) runtime.applyCameraState(initialCamera);
    else callbackRef.current.onCameraChange?.(runtime.snapshotCamera(), true);
    lastInputCameraRef.current = initialCamera;
    // A queued command from a previously hidden 3D view must not override the saved view.
    lastCommandRef.current = viewCommand?.id ?? null;

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
      cancelCameraReport();
      unbindContext();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      controls.removeEventListener('change', controlsChanged);
      controls.removeEventListener('end', scheduleCameraReport);
      controls.dispose();
      renderer.domElement.removeEventListener('wheel', wheelGroup, true);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('dblclick', doubleClick);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      disposeTree(content);
      disposeGuides(guideHolder);
      renderer.dispose();
      renderer.domElement.remove();
      if (typeof canvasRef === 'function') canvasRef(null);
      else if (canvasRef?.current === renderer.domElement) canvasRef.current = null;
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const saved = validCameraState(cameraState);
    if (!runtime || !saved || sameCameraState(saved, lastInputCameraRef.current)) return;
    lastInputCameraRef.current = saved;
    if (!sameCameraState(saved, runtime.snapshotCamera())) {
      runtime.applyCameraState(saved);
    }
  }, [cameraState]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeGuides(runtime.guideHolder);
    runtime.guideHolder.add(createGuides(theme, box));
    runtime.scene.background = new THREE.Color(theme === 'dark' ? 0x111820 : 0xfbfcfe);
    runtime.invalidate();
  }, [theme, box]);

  useEffect(() => { runtimeRef.current?.invalidate(); }, [probe]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeTree(runtime.content);
    const notices = [];
    for (const layer of layers) {
      if (layer.visible === false || layer.opacity === 0 || isGeometry(layer)) continue;
      let plot;
      try { plot = parsePlot(layer.expression || ''); }
      catch { continue; }
      try {
        const color = new THREE.Color(layer.color || '#5276e8');
        if (plot.kind === 'surface3d') {
          const { geometry, clipped } = surfaceGeometry(plot.formulas.z, params,
            domainFor(layer, 'x'), domainFor(layer, 'y'));
          if (clipped) notices.push(`${layer.name || '曲面'}：${clipped} 个无效或超出高度范围的采样点已跳过`);
          if (!geometry) { notices.push(`${layer.name || '曲面'}：当前绘制域内没有有效图形`); continue; }
          const material = new THREE.MeshPhongMaterial({
            color, vertexColors: true, side: THREE.DoubleSide, shininess: 45,
            transparent: true, opacity: layer.opacity ?? 1,
            depthWrite: (layer.opacity ?? 1) >= 0.95,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.layerId = layer.id;
          mesh.userData.stale = layer.stale;
          runtime.content.add(mesh);
        } else if (plot.kind === 'curve3d') {
          const { group, clipped } = curveObjects(plot.formulas, params, color, layer.id,
            domainFor(layer, 't'), layer.stale, layer, { width: hostRef.current.clientWidth, height: hostRef.current.clientHeight });
          if (clipped) notices.push(`${layer.name || '空间曲线'}：${clipped} 个无效或超出范围的采样点已跳过`);
          if (!group.children.length) notices.push(`${layer.name || '空间曲线'}：当前绘制域内没有有效图形`);
          runtime.content.add(group);
        }
      } catch (cause) {
        notices.push(`${layer.name || '图层'}：${cause?.message || '表达式无法绘制'}`);
      }
    }
    callbackRef.current.onStatus?.({ message: notices.length ? notices.slice(0, 2).join('；') : '3D 绘制完成' });
    runtime.invalidate();
  }, [layers, params, selectedId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !viewCommand || lastCommandRef.current === viewCommand.id) return;
    lastCommandRef.current = viewCommand.id;
    runtime.flushCameraReport();
    const { controls, perspective, orthographic } = runtime;
    const camera = runtime.camera;
    const direction = camera.position.clone().sub(controls.target);
    const distance = Math.max(1, direction.length());
    const radius = new THREE.Box3().setFromObject(runtime.content).getBoundingSphere(new THREE.Sphere()).radius;
    if (viewCommand.type === 'focus' && viewCommand.point) {
      const point = new THREE.Vector3(viewCommand.point.x, viewCommand.point.y, viewCommand.point.z);
      const delta = point.clone().sub(controls.target);
      controls.target.copy(point);
      camera.position.add(delta);
    } else if (viewCommand.type === 'reset') {
      controls.target.set(0, 0, 0);
      camera.up.set(0, 0, 1);
      camera.position.set(13, -16, 11);
      if (camera === orthographic) camera.zoom = 1;
    } else if (viewCommand.type === 'fit') {
      const box = new THREE.Box3().setFromObject(runtime.content);
      if (!box.isEmpty()) box.getCenter(controls.target);
      else controls.target.set(0, 0, 0);
      const fitRadius = Number.isFinite(radius) && radius > 0 ? radius : 7;
      if (camera === orthographic) {
        camera.zoom = Math.min(80, Math.max(0.025, ORTHO_HEIGHT / (fitRadius * 2.6)));
        camera.position.copy(controls.target).add(direction);
      }
      else camera.position.copy(controls.target).add(direction.normalize().multiplyScalar(
        fitRadius / Math.sin(THREE.MathUtils.degToRad(perspective.fov / 2)) * 1.25));
      callbackRef.current.onStatus?.({ message: '已适配当前有限绘制域，域外内容未包含' });
    } else if (['top', 'front', 'side'].includes(viewCommand.type)) {
      const vectors = { top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0] };
      const [x, y, z] = vectors[viewCommand.type];
      camera.up.set(0, viewCommand.type === 'top' ? 1 : 0, viewCommand.type === 'top' ? 0 : 1);
      camera.position.copy(controls.target).add(new THREE.Vector3(x, y, z).multiplyScalar(distance));
    } else if (viewCommand.type === 'zoomIn' || viewCommand.type === 'zoomOut') {
      const factor = viewCommand.type === 'zoomIn' ? 1.25 : 0.8;
      if (camera === orthographic) camera.zoom = Math.min(80, Math.max(0.025, camera.zoom * factor));
      else camera.position.copy(controls.target).add(direction.multiplyScalar(1 / factor).clampLength(0.35, 1000));
    } else if (viewCommand.type === 'toggleProjection') {
      const next = camera === perspective ? orthographic : perspective;
      next.position.copy(camera.position);
      next.quaternion.copy(camera.quaternion);
      next.up.copy(camera.up);
      const visibleHeight = camera === perspective
        ? 2 * distance * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2))
        : ORTHO_HEIGHT / orthographic.zoom;
      if (next === orthographic) next.zoom = Math.min(80, Math.max(0.025, ORTHO_HEIGHT / Math.max(0.1, visibleHeight)));
      else next.position.copy(controls.target).add(direction.normalize().multiplyScalar(
        visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)))));
      next.updateProjectionMatrix();
      runtime.setCamera(next);
      callbackRef.current.onStatus?.({ message: next === orthographic ? '正交投影' : '透视投影' });
    }
    camera.updateProjectionMatrix();
    controls.update();
    runtime.invalidate();
    runtime.reportCamera();
  }, [viewCommand]);

  return (
    <div className="plot3d" aria-label="三维绘图画布" tabIndex={error ? 0 : undefined}
      onContextMenu={event => {
        if (!error) return;
        event.preventDefault();
        onContextMenu?.({ source: '3d', available: false, clientX: event.clientX, clientY: event.clientY, anchorElement: event.currentTarget });
      }} onKeyDown={event => {
        if (!error || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextMenu?.({ source: '3d', available: false, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, anchorElement: event.currentTarget });
      }}>
      <div className="plot3d__canvas" ref={hostRef} /><span ref={markerRef} className="probe-marker" hidden aria-hidden="true" />
      {error && <div className="plot3d__fallback" role="alert">
        <div className="plot3d__fallback-icon" aria-hidden="true">◇</div>
        <strong>三维画布暂不可用</strong>
        <p>{error}</p>
      </div>}
      {!error && <div className="plot3d__hint">左键旋转 · 右键拖动平移 · 右键单击菜单</div>}
    </div>
  );
}
