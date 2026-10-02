const { app, BrowserWindow, ipcMain, clipboard, ClipboardItem } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { registerTextTools } = require('./text-tools.cjs');

const outputDir = path.join(__dirname, '..', 'artifacts', 'phase2');
fsSync.mkdirSync(outputDir, { recursive: true });
app.setPath('userData', path.join(outputDir, 'profile'));
const errors = [];
const checks = [];
let win;
let savedProject;
let exportedImage;
let previousClipboard;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const fixture = mode => ({
  schemaVersion: 1, name: '右键交互验证', createdAt: '2026-10-02T00:00:00.000Z', mode,
  view2d: { xmin: -10, xmax: 10, ymin: -6, ymax: 6 }, coordinateSystem: 'cartesian',
  params: { a: 1 }, ranges: { a: [-3, 3, 0.1] },
  layers: [
    { id: 'sine', name: '正弦曲线', expression: 'y = a*sin(x)', lastValidExpression: 'y = a*sin(x)', color: '#5368d9', visible: true, domain: [-10, 10] },
    { id: 'line', name: '直线', expression: 'y = x+2', lastValidExpression: 'y = x+2', color: '#ef785b', visible: true, domain: [-10, 10] },
    ...(mode === '2d' ? [] : [{ id: 'plane', name: '三维平面', expression: 'z = 0', lastValidExpression: 'z = 0', color: '#16a6a0', visible: true, domain: { x: [-5, 5], y: [-5, 5] } }]),
  ],
});

async function js(fn, ...args) {
  return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
}
async function until(fn, ...args) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await js(fn, ...args);
    if (result) return result;
    await wait(40);
  }
  throw new Error(`等待界面状态超时：${fn.toString()}`);
}
async function seed(project, theme = 'light') {
  await js((project, theme) => {
    localStorage.setItem('math-atlas-project-v1', JSON.stringify(project));
    localStorage.setItem('math-atlas-theme', theme);
    localStorage.removeItem('math-atlas-recoveries-v1');
  }, project, theme);
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await until(() => document.querySelector('.layer-row'));
  await wait(500);
  await js(() => {
    window.__inputTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu', 'wheel']) document.addEventListener(type, event => {
      window.__inputTrace.push({ type, button: event.button, buttons: event.buttons, x: event.clientX, y: event.clientY, target: event.target.className });
      window.__inputTrace = window.__inputTrace.slice(-30);
    }, true);
  });
}
async function point(selector, fx = 0.5, fy = 0.5) {
  return js((selector, fx, fy) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`找不到元素：${selector}`);
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width * fx), y: Math.round(rect.top + rect.height * fy) };
  }, selector, fx, fy);
}
async function mouseClick(selector, button = 'left', fx = 0.5, fy = 0.5) {
  const location = await point(selector, fx, fy);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...location });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...location, button, clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...location, button, clickCount: 1 });
  await wait(80);
}
async function key(keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(60);
}
async function open(selector, fx = 0.5, fy = 0.5) {
  await mouseClick(selector, 'right', fx, fy);
  await until(() => document.querySelector('[role="menu"]'));
}
async function command(id) {
  await mouseClick(`[data-command="${id}"]`);
  await until(() => !document.querySelector('[role="menu"]'));
}
async function snapshot() {
  await wait(580);
  return js(() => ({
    project: JSON.parse(localStorage.getItem('math-atlas-project-v1')),
    selected: document.querySelector('.layer-row.selected')?.dataset.layerId || null,
  }));
}
async function capture(name) {
  // Flush hidden-window paint before waiting for the renderer's next frames.
  await win.webContents.capturePage();
  await wait(100);
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(outputDir, name), (await win.webContents.capturePage()).toPNG());
}
const row = id => `[data-layer-id="${id}"]`;


async function edit(selector, value) {
  await mouseClick(selector);
  await key('a', ['control']);
  await win.webContents.insertText(String(value));
  await key('Tab');
}
async function drag(selector, from, to, modifiers = [], pauseMs = 0) {
  const a = await point(selector, ...from), b = await point(selector, ...to);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...a });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...a, button: 'left', clickCount: 1, modifiers });
  for (let i = 1; i <= 8; i++) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + (b.x - a.x) * i / 8), y: Math.round(a.y + (b.y - a.y) * i / 8), modifiers });
    await wait(35);
    if (i === 4 && pauseMs) await wait(pauseMs);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', ...b, button: 'left', clickCount: 1, modifiers });
  await wait(120);
}
async function wheel(selector) {
  const location = await point(selector);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...location });
  await wait(100);
  for (let i = 0; i < 5; i++) {
    const count = await js(() => window.__inputTrace.filter(event => event.type === 'wheel').length);
    win.webContents.sendInputEvent({ type: 'mouseWheel', ...location, deltaY: -70, deltaX: 0, canScroll: true });
    await until(count => window.__inputTrace.filter(event => event.type === 'wheel').length > count, count);
    await win.webContents.capturePage();
    await wait(60);
  }
  await wait(300);
}
async function settings() {
  await js(() => [...document.querySelectorAll('.canvas-toolbar button')].find(button => button.textContent === '视图设置').click());
  await until(() => !!document.querySelector('.view-settings'));
}
async function apply() { await mouseClick('.view-settings [type="submit"]'); await wait(150); }

app.whenReady().then(async () => {
  previousClipboard = await Promise.all((await clipboard.read()).map(async item => {
    const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
    return new ClipboardItem(Object.fromEntries(entries));
  }));
  ipcMain.handle('project:save', async (_event, { project }) => {
    savedProject = JSON.parse(JSON.stringify(project));
    const filePath = path.join(outputDir, 'saved.graphproj');
    await fs.writeFile(filePath, JSON.stringify(savedProject));
    return { path: filePath };
  });
  ipcMain.handle('project:open', async () => ({ project: savedProject, path: path.join(outputDir, 'saved.graphproj') }));
  ipcMain.handle('image:save', async (_event, { dataUrl }) => {
    exportedImage = dataUrl;
    const filePath = path.join(outputDir, 'exported.png');
    await fs.writeFile(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return { path: filePath };
  });
  win = new BrowserWindow({ width: 1440, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  registerTextTools(win);
  win.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await js(() => console.error('interaction-smoke: error-capture-probe'));
  await wait(80);
  assert.equal(errors.pop(), 'interaction-smoke: error-capture-probe');
  await seed(fixture('2d')); win.webContents.focus();
  await settings();
  await edit('[aria-label="2D X 最小值"]', -4);
  await edit('[aria-label="2D X 最大值"]', 4);
  await edit('[aria-label="2D Y 最小值"]', -3);
  await edit('[aria-label="2D Y 最大值"]', 3);
  await apply();
  const precision = (await snapshot()).project;
  assert.deepEqual(precision.view2d, { xmin: -4, xmax: 4, ymin: -3, ymax: 3 });
  await edit('[aria-label="2D X 最大值"]', -5); await apply();
  assert.equal(await js(() => !!document.querySelector('.view-settings [role="alert"]')), true);
  assert.deepEqual((await snapshot()).project.view2d, precision.view2d);
  await edit('[aria-label="2D X 最大值"]', 4);
  await mouseClick('.check-field input');
  const displayed = await js(() => ({ view: JSON.parse(document.querySelector('.plot2d canvas').dataset.view), size: document.querySelector('.plot2d canvas').getBoundingClientRect().toJSON() }));
  assert.ok(Math.abs((displayed.view.xmax-displayed.view.xmin)/displayed.size.width - (displayed.view.ymax-displayed.view.ymin)/displayed.size.height) < 1e-7);
  assert.equal((await snapshot()).project.aspectLocked, true);
  await capture('precision-light.png');
  checks.push('精确 X/Y 范围、非法范围不改变工程、等比例坐标');

  await seed(fixture('2d'));
  const beforePan = (await snapshot()).project.view2d;
  await drag('.plot2d canvas', [.3,.4], [.65,.62], [], 1200);
  assert.notDeepEqual((await snapshot()).project.view2d, beforePan);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.deepEqual((await snapshot()).project.view2d, beforePan);
  assert.equal(await js(() => document.querySelector('[aria-label="撤销 Ctrl+Z"]').disabled), true);
  await wheel('.plot2d canvas');
  assert.notDeepEqual((await snapshot()).project.view2d, beforePan);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.deepEqual((await snapshot()).project.view2d, beforePan);
  assert.equal(await js(() => document.querySelector('[aria-label="撤销 Ctrl+Z"]').disabled), true);
  checks.push('真实长拖动与连续滚轮分别只产生一步撤销');

  await drag('.plot2d canvas', [.2,.25], [.8,.8], ['shift']);
  const boxed = (await snapshot()).project.view2d;
  assert.ok(boxed.xmax - boxed.xmin < beforePan.xmax - beforePan.xmin);
  assert.ok(boxed.ymax - boxed.ymin < beforePan.ymax - beforePan.ymin);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.deepEqual((await snapshot()).project.view2d, beforePan);
  await open('.plot2d canvas', .1,.1); await command('box-zoom');
  assert.equal(await js(() => document.querySelector('.plot2d canvas').classList.contains('box-zoom')), true);
  await key('Escape');
  assert.equal(await js(() => !!document.querySelector('.box-mode-hint')), false);
  checks.push('Shift 框选放大、右键框选模式与 Esc 取消');

  await seed(fixture('2d'));
  await mouseClick('#expression-input'); await key('a', ['control']);
  for (const text of ['y = ', 'a*', 'cos(x)']) { await win.webContents.insertText(text); await wait(100); }
  await key('Tab');
  assert.equal((await snapshot()).project.layers[0].expression, 'y = a*cos(x)');
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.equal((await snapshot()).project.layers[0].expression, 'y = a*sin(x)');
  assert.equal(await js(() => document.querySelector('[aria-label="撤销 Ctrl+Z"]').disabled), true);
  await mouseClick('[aria-label="重做 Ctrl+Shift+Z"]');
  await mouseClick('#expression-input'); await key('End'); await win.webContents.insertText(' + 1');
  await key('z', ['control']);
  assert.equal((await snapshot()).project.layers[0].expression, 'y = a*cos(x)');
  await mouseClick('.plot2d canvas', 'left', .1,.1);
  await drag('[aria-label="参数 a"]', [.25,.5], [.75,.5]);
  const draggedParameter = (await snapshot()).project.params.a;
  assert.notEqual(draggedParameter, 1);
  assert.equal(await js(() => document.activeElement.getAttribute('aria-label')), '参数 a');
  await key('z', ['control']);
  assert.equal((await snapshot()).project.params.a, 1);
  await key('z', ['control', 'shift']);
  assert.equal((await snapshot()).project.params.a, draggedParameter);
  await key('z', ['control']);
  assert.equal((await snapshot()).project.params.a, 1);
  checks.push('连续公式输入和滑块合并；文本框 Ctrl+Z 撤销文字，滑块焦点下 Ctrl+Z／Ctrl+Shift+Z 撤销／重做工程');

  await seed(fixture('2d'));
  await edit('[aria-label="图层线宽"]', 5);
  await js(() => document.querySelector('[aria-label="图层线型"]').focus()); await key('Home'); await key('Down'); await key('Enter'); await key('Tab');
  await drag('[aria-label="图层透明度"]', [.9,.5], [.5,.5]);
  const styled = (await snapshot()).project.layers[0];
  assert.equal(styled.lineWidth, 5); assert.equal(styled.lineStyle, 'dashed'); assert.ok(styled.opacity > .3 && styled.opacity < .7);
  await capture('layer-style-light.png');
  await mouseClick('[aria-label="锁定当前图层"]');
  assert.equal((await snapshot()).project.layers[0].locked, true);
  assert.equal(await js(() => document.querySelector('#expression-input').disabled), true);
  await open(row('sine'));
  for (const id of ['edit','rename','move-up','move-down','delete']) assert.equal(await js(id => document.querySelector(`[data-command="${id}"]`).disabled, id), true);
  await command('duplicate');
  assert.equal((await snapshot()).project.layers[1].locked, false);
  await open(row('line')); await command('move-up'); await open(row('line')); assert.equal(await js(() => document.querySelector('[data-command="move-up"]').disabled), true); await key('Escape');
  await mouseClick(row('sine'));
  await drag('[aria-label="参数 a"]', [.3,.5], [.7,.5]);
  assert.notEqual((await snapshot()).project.params.a, 1);
  await open(row('sine')); await command('visibility');
  assert.equal((await snapshot()).project.layers[0].visible, false);
  await open(row('sine')); await command('lock');
  assert.equal((await snapshot()).project.layers[0].locked, false);
  await mouseClick('[aria-label="锁定当前图层"]');
  const beforeSave = (await snapshot()).project.layers;
  await mouseClick('[aria-label="保存工程"]'); await until(() => document.querySelector('.toast')?.textContent.includes('工程已保存'));
  await mouseClick('[aria-label="打开工程"]');
  assert.deepEqual((await snapshot()).project.layers, beforeSave);
  checks.push('线宽、虚线和透明度；锁定阻止编辑/排序/删除，复制解锁，参数仍共享，保存重开保持样式与锁定');

  await seed(fixture('2d'));
  await open('.plot2d canvas'); await command('pin-probe');
  assert.equal(await js(() => document.querySelector('[data-probe="2d"]').dataset.valid), 'true');
  await edit('[aria-label="图层线宽"]', 4);
  assert.equal(await js(() => document.querySelector('[data-probe="2d"]').dataset.valid), 'true');
  await drag('[aria-label="参数 a"]', [.3,.5], [.7,.5]);
  assert.equal(await js(() => document.querySelector('[data-probe="2d"]').dataset.valid), 'false');
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.equal(await js(() => document.querySelector('[data-probe="2d"]').dataset.valid), 'true');
  await edit('#expression-input', 'y = sin(');
  assert.equal(await js(() => document.querySelector('[data-probe="2d"] button').disabled), true);
  await open('.plot2d canvas'); assert.equal(await js(() => document.querySelector('[data-command="pin-probe"]').disabled), true); await key('Escape');
  checks.push('固定探针保留位置，参数/表达式改变或过期时失效，撤销后恢复');

  await seed(fixture('2d'));
  const startNav = (await snapshot()).project.view2d;
  await wheel('.plot2d canvas'); const navOne = (await snapshot()).project.view2d;
  await wait(1000); await wheel('.plot2d canvas');
  await edit('[aria-label="图层线宽"]', 6);
  await mouseClick('[aria-label="返回上一视图 Alt+←"]');
  assert.deepEqual((await snapshot()).project.view2d, navOne);
  assert.equal((await snapshot()).project.layers[0].lineWidth, 6);
  await mouseClick('.plot2d canvas', 'left', .1,.1); await key('Left', ['alt']);
  assert.deepEqual((await snapshot()).project.view2d, startNav);
  await key('Right', ['alt']); assert.deepEqual((await snapshot()).project.view2d, navOne);
  checks.push('视图前进后退独立于属性编辑，Alt+方向键作用于当前画布');

  await seed(fixture('3d'));
  win.webContents.sendInputEvent({ type: 'mouseMove', ...await point('.plot3d canvas') });
  await until(() => document.querySelector('.status-left')?.textContent.includes('≈'));
  await settings();
  await edit('[aria-label="3D X 最小值"]', -3); await edit('[aria-label="3D X 最大值"]', 8);
  await edit('[aria-label="3D Z 最大值"]', 4); await apply();
  const boxed3d = (await snapshot()).project;
  assert.deepEqual(boxed3d.box3d, { x: [-3,8], y: [-6,6], z: [-6,4] });
  assert.deepEqual(boxed3d.layers.at(-1).domain, { x: [-5,5], y: [-5,5] });
  await mouseClick('[aria-label="关闭视图设置"]');
  const firstCamera = (await snapshot()).project.camera3d;
  await mouseClick('[title="从上方看"]'); await wait(300);
  const topCamera = (await snapshot()).project.camera3d;
  await mouseClick('[title="从前方看"]'); await wait(300);
  await mouseClick('[aria-label="返回上一视图 Alt+←"]');
  assert.deepEqual((await snapshot()).project.camera3d, topCamera);
  await mouseClick('[aria-label="返回上一视图 Alt+←"]');
  assert.deepEqual((await snapshot()).project.camera3d, firstCamera);
  await open('.plot3d canvas'); await command('pin-probe');
  assert.equal(await js(() => document.querySelector('[data-probe="3d"]').dataset.valid), 'true');
  await capture('3d-probe-box.png');
  const pixel = await js(() => { const canvas = document.querySelector('.plot3d canvas'), gl = canvas.getContext('webgl2'), pixel = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1,1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel]; });
  assert.notDeepEqual(pixel.slice(0,3), [251,252,254]);
  assert.ok(pixel[1] > pixel[0], '中心应绘制绿色平面，不能只有背景');
  await mouseClick('[aria-label="保存工程"]');
  await until(() => document.querySelector('.toast')?.textContent.includes('工程已保存'));
  await mouseClick('[aria-label="打开工程"]');
  const reopened = (await snapshot()).project;
  assert.deepEqual(reopened.box3d, boxed3d.box3d);
  assert.ok(reopened.probes['3d']);
  await open('.plot3d canvas', .98,.98); await command('export');
  assert.match(exportedImage, /^data:image\/png;base64,/);
  checks.push('3D 坐标盒与绘制域分离、相机导航、近似探针、保存重开与导出');
  await js(() => document.querySelector('.plot3d canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await until(() => !!document.querySelector('.plot3d__fallback'));
  assert.equal(await js(() => document.querySelector('[data-probe="3d"]').dataset.valid), 'false');
  assert.equal(await js(() => document.querySelector('[data-probe="3d"] button').disabled), true);
  checks.push('显卡连接中断使固定三维探针失效，禁止继续复制过期坐标');

  const curve = fixture('3d'); curve.layers = [{ id: 'helix', name: '宽线螺旋', expression: 'x(t)=2*cos(t); y(t)=2*sin(t); z(t)=t/5', lastValidExpression: 'x(t)=2*cos(t); y(t)=2*sin(t); z(t)=t/5', color: '#16a6a0', visible: true, domain: [0,16], lineWidth: 7, lineStyle: 'dotted', opacity: .7 }];
  await seed(curve, 'dark');
  assert.equal(await js(() => !!document.querySelector('.plot3d__fallback')), false);
  await capture('3d-wide-dotted-dark.png');
  await wheel('.plot3d canvas'); const zoomCamera = (await snapshot()).project.camera3d;
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.notDeepEqual((await snapshot()).project.camera3d, zoomCamera);
  assert.equal(await js(() => document.querySelector('[aria-label="撤销 Ctrl+Z"]').disabled), true);
  win.setSize(1000,720); await wait(300);
  await settings();
  await capture('small-dark-settings.png');
  assert.equal(await js(() => { const rect = document.querySelector('.plot3d canvas').getBoundingClientRect(); return rect.right <= innerWidth && rect.bottom <= innerHeight; }), true);
  assert.equal(await js(() => [...document.querySelectorAll('.canvas-toolbar button, .view-settings input')].every(element => { const r=element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })), true);
  checks.push('3D 宽点线与透明度、滚轮一步撤销、小窗口深色设置可用');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ checks, errors }, null, 2));
  process.stdout.write(JSON.stringify({ checks, errors, outputDir }) + '\n');
  if (previousClipboard.length) await clipboard.write(previousClipboard);
  else clipboard.clear();
  win.close(); app.quit();
}).catch(async error => {
  process.stderr.write(`${error.stack || error}\n`);
  if (win && !win.isDestroyed()) {
    const diagnostic = await js(() => ({
      trace: window.__inputTrace, size: [innerWidth, innerHeight],
      canvases: [...document.querySelectorAll('canvas')].map(canvas => {
        const rect = canvas.getBoundingClientRect();
        const x = rect.left + rect.width * 0.98, y = rect.top + rect.height * 0.97;
        return { rect: rect.toJSON(), pointTarget: document.elementFromPoint(x, y)?.className };
      }), theme: document.documentElement.dataset.theme,
    })).catch(() => null);
    await capture('failure.png').catch(() => {});
    process.stderr.write(JSON.stringify(diagnostic) + '\n');
    await fs.writeFile(path.join(outputDir, 'failure.json'), JSON.stringify({ error: error.message, diagnostic }, null, 2));
  }
  if (previousClipboard?.length) await clipboard.write(previousClipboard).catch(() => {});
  else if (previousClipboard) clipboard.clear();
  app.exit(1);
});
