const { app, BrowserWindow, ipcMain, clipboard, ClipboardItem } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { registerTextTools } = require('./text-tools.cjs');

const outputDir = path.join(__dirname, '..', 'artifacts', 'interactions');
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
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'contextmenu']) document.addEventListener(type, event => {
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
  // Paint a hidden window before capturing; Chromium may otherwise return an older frame.
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(outputDir, name), (await win.webContents.capturePage()).toPNG());
}
const row = id => `[data-layer-id="${id}"]`;

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
  await seed(fixture('2d'));
  win.webContents.focus();

  await open('.plot2d canvas', 0.1, 0.1);
  assert.equal(await js(() => !!document.querySelector('[data-command="add"]')), true);
  await command('copy-coordinates');
  await until(() => document.querySelector('.toast')?.textContent.includes('已复制坐标'));
  assert.match(await clipboard.readText(), /^x = [-\d.]+, y = [-\d.]+$/);
  assert.equal(await js(() => document.querySelector('[aria-label="撤销 Ctrl+Z"]').disabled), true);
  await mouseClick(row('line'));
  await open('.plot2d canvas');
  assert.equal(await js(() => document.querySelector('.layer-row.selected').dataset.layerId), 'sine');
  await capture('2d-curve-menu.png');
  await command('edit');
  assert.equal(await js(() => document.activeElement.id), 'expression-input');
  checks.push('真实鼠标右键：2D 空白／曲线命中、坐标剪贴板和编辑焦点');

  const history = [await snapshot()];
  await open(row('sine')); await command('duplicate');
  history.push(await snapshot());
  const copyId = history[1].selected;
  assert.notEqual(copyId, 'sine');
  assert.deepEqual(history[1].project.layers.map(layer => layer.id), ['sine', copyId, 'line']);
  assert.equal(history[1].project.layers[1].expression, history[1].project.layers[0].expression);
  await open(row(copyId)); await command('rename');
  await until(() => document.activeElement?.classList.contains('layer-name-input'));
  await win.webContents.insertText('比较用曲线');
  await wait(70); await key('Enter');
  history.push(await snapshot());
  assert.equal(history.at(-1).project.layers[1].name, '比较用曲线');
  await open(row(copyId)); await command('move-up'); history.push(await snapshot());
  assert.equal(history.at(-1).project.layers[0].id, copyId);
  await open(row(copyId)); await command('visibility'); history.push(await snapshot());
  assert.equal(history.at(-1).project.layers[0].visible, false);
  await open(row(copyId)); await command('delete'); history.push(await snapshot());
  assert.equal(history.at(-1).selected, 'sine');
  for (let index = history.length - 2; index >= 0; index--) {
    await mouseClick('[aria-label="撤销 Ctrl+Z"]');
    const actual = await snapshot();
    assert.deepEqual(actual.project.layers, history[index].project.layers);
    assert.equal(actual.selected, history[index].selected);
  }
  for (let index = 1; index < history.length; index++) {
    await mouseClick('[aria-label="重做 Ctrl+Shift+Z"]');
    const actual = await snapshot();
    assert.deepEqual(actual.project.layers, history[index].project.layers);
    assert.equal(actual.selected, history[index].selected);
  }
  checks.push('复制、重命名、排序、隐藏、删除的逐步撤销／重做及选中恢复');
  process.stdout.write('图层操作与历史记录验证完成\n');

  await js(() => document.querySelector('.layer-row').focus());
  await key('F10', ['shift']);
  await until(() => document.querySelector('[role="menu"]'));
  assert.equal(await js(() => document.activeElement.dataset.command), 'edit');
  await key('Down');
  assert.equal(await js(() => document.activeElement.dataset.command), 'rename');
  await key('Escape');
  assert.equal(await js(() => document.activeElement.classList.contains('layer-row')), true);
  await js(() => document.querySelector('.plot2d canvas').focus());
  await key('F10', ['shift']);
  await until(() => document.querySelector('[role="menu"]'));
  await key('Escape');
  await open(row('sine')); await command('rename');
  await win.webContents.insertText('取消的名称'); await wait(50); await key('Escape');
  assert.equal((await snapshot()).project.layers[0].name, '正弦曲线');
  await open(row('sine'));
  await mouseClick('.project-identity input');
  assert.equal(await js(() => !!document.querySelector('[role="menu"]')), false);
  checks.push('键盘菜单、方向键、Esc、重命名取消和点击外部关闭');

  const staleProject = fixture('2d');
  staleProject.layers[0].expression = 'y = sin(';
  await seed(staleProject);
  await open('.plot2d canvas');
  assert.equal(await js(() => document.querySelector('[data-command="copy-coordinates"]').disabled), true);
  assert.equal(await js(() => document.querySelector('[data-command="export"]').disabled), true);
  await command('edit');
  checks.push('过期曲线可编辑、禁止探针复制和导出');

  await seed(fixture('split'));
  const before3d = await snapshot();
  await open('.plot3d canvas');
  assert.equal(await js(() => document.querySelector('.layer-row.selected').dataset.layerId), 'plane');
  await command('copy-coordinates');
  await until(() => document.querySelector('.toast')?.textContent.includes('已复制坐标'));
  assert.ok(Math.abs(Number((await clipboard.readText()).split('z = ')[1])) < 1e-10);
  await mouseClick(row('sine'));
  const start = await point('.plot3d canvas', 0.7, 0.5);
  const end = await point('.plot3d canvas', 0.45, 0.3);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'right', clickCount: 1 });
  for (let step = 1; step <= 8; step++) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + (end.x - start.x) * step / 8),
      y: Math.round(start.y + (end.y - start.y) * step / 8), modifiers: ['rightButtonDown'] });
    await wait(20);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'right', clickCount: 1 });
  await until(() => JSON.parse(localStorage.getItem('math-atlas-project-v1'))?.camera3d?.target.some(value => Math.abs(value) > 1e-8));
  const afterPan = await snapshot();
  assert.equal(await js(() => !!document.querySelector('[role="menu"]')), false);
  assert.equal(afterPan.selected, 'sine');
  assert.notDeepEqual(afterPan.project.camera3d.target, before3d.project.camera3d.target);
  await open('.plot3d canvas', 0.02, 0.1);
  await command('reset');
  const reset = await snapshot();
  assert.deepEqual(reset.project.view2d, before3d.project.view2d);
  assert.ok(reset.project.camera3d.target.every(value => Math.abs(value) < 1e-8));
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.deepEqual((await snapshot()).project.camera3d, afterPan.project.camera3d);
  await open('.plot3d canvas', 0.02, 0.1); await command('projection');
  assert.equal((await snapshot()).project.camera3d.projection, 'orthographic');
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  assert.equal((await snapshot()).project.camera3d.projection, 'perspective');
  checks.push('3D 命中、右键拖动平移不弹菜单、不误选、视图与投影撤销');
  process.stdout.write('三维手势与分屏视图验证完成\n');

  await open('.plot3d canvas', 0.02, 0.1); await command('add');
  assert.match((await snapshot()).project.layers.at(-1).expression, /^z\s*=/);
  await open('.plot3d canvas', 0.02, 0.1);
  const expectedPng = await js(() => document.querySelector('.plot3d canvas').toDataURL('image/png'));
  await command('export');
  await until(() => document.querySelector('.toast')?.textContent.includes('已导出 3D'));
  assert.equal(exportedImage, expectedPng);
  await mouseClick('[aria-label="保存工程"]');
  await until(() => document.querySelector('.save-indicator')?.textContent === '已保存');
  assert.equal(savedProject.layers.at(-1).expression, 'z = sin(x)*cos(y)');
  await mouseClick('.layer-visibility');
  await mouseClick('[aria-label="打开工程"]');
  await wait(650);
  assert.deepEqual((await snapshot()).project.layers, savedProject.layers);
  checks.push('分屏右侧新增／导出目标与工程保存重开');

  const hidden = fixture('2d'); hidden.layers[0].visible = false;
  await seed(hidden);
  await open('.plot2d canvas');
  assert.equal(await js(() => !!document.querySelector('[data-command="add"]')), true);
  await key('Escape');
  await open(row('sine')); await command('delete');
  await open(row('line')); await command('delete');
  assert.equal((await snapshot()).project.layers.length, 0);
  await open('.plot2d canvas'); await command('add');
  assert.equal((await snapshot()).project.layers.length, 1);
  checks.push('隐藏对象不命中、删除最后图层后空画布仍可新增');

  await seed(fixture('split'));
  win.setSize(1000, 720);
  await wait(250);
  await js(() => document.querySelector('[aria-label="切换深色主题"]').click());
  await until(() => document.documentElement.dataset.theme === 'dark');
  await win.webContents.capturePage();
  await open('.plot3d canvas', 0.98, 0.97);
  const menuBounds = await js(() => {
    const menu = document.querySelector('[role="menu"]');
    const rect = menu.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight,
      background: getComputedStyle(menu).backgroundColor, theme: document.documentElement.dataset.theme };
  });
  assert.ok(menuBounds.left >= 0 && menuBounds.top >= 0 && menuBounds.right <= menuBounds.width && menuBounds.bottom <= menuBounds.height);
  assert.equal(menuBounds.background, 'rgb(27, 37, 48)');
  assert.equal(menuBounds.theme, 'dark');
  await capture('3d-dark-menu-small-window.png');
  await key('Escape');
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await until(() => document.documentElement.dataset.theme === 'dark');
  checks.push('小窗口、边缘避让、深色菜单与主题重新加载恢复');

  await seed(fixture('2d'));
  const lost = await point('.plot2d canvas', 0.2, 0.2);
  await js(() => document.querySelector('.plot2d canvas').addEventListener('pointerdown', event => { window.__mousePointer = event.pointerId; }, { once: true }));
  win.webContents.sendInputEvent({ type: 'mouseDown', ...lost, button: 'right', clickCount: 1 });
  await wait(60);
  await js(() => document.querySelector('.plot2d canvas').releasePointerCapture(window.__mousePointer));
  await wait(60);
  win.webContents.sendInputEvent({ type: 'mouseUp', ...lost, button: 'right', clickCount: 1 });
  await wait(60);
  assert.equal(await js(() => !!document.querySelector('[role="menu"]')), false);
  await open('.plot2d canvas', 0.2, 0.2); await key('Escape');
  // Returning to the start after a drag must still count as a drag.
  win.webContents.sendInputEvent({ type: 'mouseDown', ...lost, button: 'right', clickCount: 1 });
  await wait(30);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: lost.x + 30, y: lost.y, modifiers: ['rightButtonDown'] });
  await wait(30);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...lost, modifiers: ['rightButtonDown'] });
  await wait(30);
  win.webContents.sendInputEvent({ type: 'mouseUp', ...lost, button: 'right', clickCount: 1 });
  await wait(80);
  assert.equal(await js(() => !!document.querySelector('[role="menu"]')), false);
  await open('.plot2d canvas', 0.2, 0.2); await key('Escape');
  checks.push('丢失指针捕获、拖动回原点和后续右键恢复');

  const spatialCurve = fixture('3d');
  spatialCurve.layers = [{ ...spatialCurve.layers[2], id: 'curve', name: '空间直线',
    expression: 'x(t)=t; y(t)=0; z(t)=0', lastValidExpression: 'x(t)=t; y(t)=0; z(t)=0', domain: [-5, 5] }];
  await seed(spatialCurve);
  await open('.plot3d canvas');
  assert.equal(await js(() => document.querySelector('[role="menu"]').getAttribute('aria-label')), '空间直线');
  await command('focus');
  await open('.plot3d canvas', 0.05, 0.1);
  assert.equal(await js(() => !!document.querySelector('[data-command="copy-coordinates"]')), false);
  await key('Escape');
  checks.push('空间曲线命中／聚焦与三维空白处无虚构坐标');

  await seed(fixture('2d'));
  win.webContents.debugger.attach('1.3');
  const viewport = await js(() => ({ width: innerWidth, height: innerHeight }));
  for (const deviceScaleFactor of [1, 1.5, 2]) {
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor, mobile: false });
    await wait(200);
    await win.webContents.capturePage();
    assert.equal(await js(() => devicePixelRatio), deviceScaleFactor);
    for (const [fx, fy] of [[0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]]) {
      await open('.plot2d canvas', fx, fy);
      assert.equal(await js(() => {
        const rect = document.querySelector('[role="menu"]').getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
      }), true);
      await key('Escape');
    }
    await js(() => document.querySelector('.plot2d canvas').focus());
    await key('F10', ['shift']);
    await until(() => document.querySelector('[role="menu"]'));
    await key('End');
    assert.equal(await js(() => document.activeElement.dataset.command), 'export');
    await key('Home');
    assert.equal(await js(() => document.activeElement.dataset.command), 'edit');
    await key('Enter');
    await until(() => document.activeElement.id === 'expression-input');
    await mouseClick('[aria-label="显示设置面板"]');
    await wait(250);
  }
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
  win.webContents.debugger.detach();
  checks.push('100%／150%／200% 像素比例模拟、四角菜单与键盘执行');

  await seed(fixture('3d'));
  assert.equal(await js(() => {
    const gl = document.querySelector('.plot3d canvas').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  }), true);
  await until(() => document.querySelector('.plot3d__fallback'));
  await open('.plot3d__fallback');
  assert.equal(await js(() => document.querySelector('[data-command="export"]').disabled), true);
  assert.equal(await js(() => document.querySelector('[data-command="reset"]').disabled), true);
  await command('add');
  assert.match((await snapshot()).project.layers.at(-1).expression, /^z\s*=/);
  await seed(fixture('2d'));
  assert.equal(await js(() => !!document.querySelector('.plot2d canvas')), true);
  checks.push('WebGL 连接中断时禁用视图／导出，仍可新增和使用 2D');

  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ checks, errors, menuBounds }, null, 2));
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
    process.stderr.write(JSON.stringify(diagnostic) + '\n');
    await fs.writeFile(path.join(outputDir, 'failure.json'), JSON.stringify({ error: error.message, diagnostic }, null, 2));
  }
  if (previousClipboard?.length) await clipboard.write(previousClipboard).catch(() => {});
  else if (previousClipboard) clipboard.clear();
  app.exit(1);
});
