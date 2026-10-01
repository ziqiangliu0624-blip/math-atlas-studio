import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compile, parsePlot } from '../math/engine.js';
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

function curveObjects(formulas, params, color, layerId, tDomain) {
  const fx = compile(formulas.x);
  const fy = compile(formulas.y);
  const fz = compile(formulas.z);
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color });
  let points = [];
  let clipped = 0;
  const flush = () => {
    if (points.length < 2) { points = []; return; }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    line.userData.layerId = layerId;
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

function createGuides(theme) {
  const dark = theme === 'dark';
  const group = new THREE.Group();
  const grid = new THREE.GridHelper(12, 12,
    dark ? 0x607489 : 0xa7b7c8, dark ? 0x344354 : 0xdce4ec);
  grid.rotation.x = Math.PI / 2;
  group.add(grid);
  const x = new THREE.Vector3(1, 0, 0);
  const y = new THREE.Vector3(0, 1, 0);
  const z = new THREE.Vector3(0, 0, 1);
  for (const [direction, color] of [[x, 0xea6572], [y, 0x28a98c], [z, 0x5f8df0]]) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      direction.clone().multiplyScalar(-6.3), direction.clone().multiplyScalar(6.3),
    ]);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
  }
  const labels = [
    ['X', new THREE.Vector3(6.65, 0, 0), 0xea6572],
    ['Y', new THREE.Vector3(0, 6.65, 0), 0x28a98c],
    ['Z', new THREE.Vector3(0, 0, 6.65), 0x5f8df0],
  ];
  for (const [label, position, color] of labels) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.font = '700 42px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.position.copy(position);
    sprite.scale.set(0.75, 0.75, 1);
    group.add(sprite);
  }
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
  onStatus, canvasRef, theme = 'light', viewCommand, cameraState, onCameraChange }) {
  const hostRef = useRef(null);
  const runtimeRef = useRef(null);
  const callbackRef = useRef({ onSelectLayer, onStatus, onCameraChange });
  const lastCommandRef = useRef(null);
  const lastInputCameraRef = useRef(null);
  const [error, setError] = useState('');
  callbackRef.current = { onSelectLayer, onStatus, onCameraChange };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      setError('当前设备无法启动 3D 显卡绘制。请检查显卡驱动；2D 绘图和本地工程仍可继续使用。');
      callbackRef.current.onStatus?.({ message: '3D 显卡绘制不可用' });
      return undefined;
    }

    host.appendChild(renderer.domElement);
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
    const emitCamera = () => {
      const state = cameraSnapshot(camera, controls.target);
      if (sameCameraState(state, lastReported)) return;
      lastReported = state;
      callbackRef.current.onCameraChange?.(state);
    };
    const scheduleCameraReport = () => {
      reportPending = true;
      if (reportTimer) window.clearTimeout(reportTimer);
      reportTimer = window.setTimeout(() => {
        reportTimer = 0;
        reportPending = false;
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
        try { renderer.render(scene, camera); }
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
    const pointer = new THREE.Vector2();
    const hit = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(content.children, true)[0];
    };
    let down = null;
    let hoverFrame = 0;
    let lastHover = 0;
    const pointerDown = (event) => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const intersection = hit(event);
      const layerId = intersection?.object?.userData?.layerId;
      if (layerId != null) callbackRef.current.onSelectLayer?.(layerId);
    };
    const pointerMove = (event) => {
      const now = performance.now();
      if (hoverFrame || now - lastHover < 75) return;
      const location = { clientX: event.clientX, clientY: event.clientY };
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = 0;
        lastHover = performance.now();
        const intersection = hit(location);
        callbackRef.current.onStatus?.({ cursor: intersection ? {
          x: intersection.point.x, y: intersection.point.y, z: intersection.point.z,
        } : null });
      });
    };
    const pointerLeave = () => callbackRef.current.onStatus?.({ cursor: null });
    const doubleClick = (event) => {
      const intersection = hit(event);
      if (intersection) {
        const delta = intersection.point.clone().sub(controls.target);
        controls.target.copy(intersection.point);
        camera.position.add(delta);
        controls.update();
        invalidate();
        scheduleCameraReport();
      }
    };
    const contextLost = (event) => {
      event.preventDefault();
      setError('3D 显卡连接已中断。请检查显卡驱动，或重新打开应用。');
      callbackRef.current.onStatus?.({ message: '3D 显卡连接已中断' });
    };
    const contextRestored = () => {
      setError('');
      callbackRef.current.onStatus?.({ message: '3D 显卡连接已恢复' });
      invalidate();
    };
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
      scheduleCameraReport,
      invalidate,
    };
    runtimeRef.current = runtime;
    const initialCamera = validCameraState(cameraState);
    if (initialCamera) runtime.applyCameraState(initialCamera);
    lastInputCameraRef.current = initialCamera;
    // A queued command from a previously hidden 3D view must not override the saved view.
    lastCommandRef.current = viewCommand?.id ?? null;

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (hoverFrame) window.cancelAnimationFrame(hoverFrame);
      cancelCameraReport();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      controls.removeEventListener('change', controlsChanged);
      controls.removeEventListener('end', scheduleCameraReport);
      controls.dispose();
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
    runtime.guideHolder.add(createGuides(theme));
    runtime.scene.background = new THREE.Color(theme === 'dark' ? 0x111820 : 0xfbfcfe);
    runtime.invalidate();
  }, [theme]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeTree(runtime.content);
    const notices = [];
    for (const layer of layers) {
      if (layer.visible === false) continue;
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
            transparent: true, opacity: layer.id === selectedId ? 0.96 : 0.84,
            depthWrite: true,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.layerId = layer.id;
          runtime.content.add(mesh);
        } else if (plot.kind === 'curve3d') {
          const { group, clipped } = curveObjects(plot.formulas, params, color, layer.id,
            domainFor(layer, 't'));
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
    const { controls, perspective, orthographic } = runtime;
    const camera = runtime.camera;
    const direction = camera.position.clone().sub(controls.target);
    const distance = Math.max(1, direction.length());
    const radius = new THREE.Box3().setFromObject(runtime.content).getBoundingSphere(new THREE.Sphere()).radius;
    if (viewCommand.type === 'reset') {
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
    runtime.scheduleCameraReport();
  }, [viewCommand]);

  return (
    <div className="plot3d" aria-label="三维绘图画布">
      <div className="plot3d__canvas" ref={hostRef} />
      {error && <div className="plot3d__fallback" role="alert">
        <div className="plot3d__fallback-icon" aria-hidden="true">◇</div>
        <strong>三维画布暂不可用</strong>
        <p>{error}</p>
      </div>}
      {!error && <div className="plot3d__hint">拖动旋转 · 右键平移 · 滚轮缩放 · 双击聚焦</div>}
    </div>
  );
}
