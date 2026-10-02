const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { registerTextTools } = require('./text-tools.cjs');

const outputDir = path.join(__dirname, '..', 'artifacts', 'geometry');
fsSync.mkdirSync(outputDir, { recursive: true });
app.setPath('userData', path.join(outputDir, 'profile'));
const errors = [];
const checks = [];
let win;
let savedProject;
let exportedImage;
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
  if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
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
const geometryLayer = (id, kind, points, extra = {}) => ({ id, name: id, type: 'geometry', geometry: { kind, points, ...extra }, color: '#16a6a0', visible: true });
const geometryFixture = (...layers) => ({ ...fixture('2d'), schemaVersion: 2, params: {}, ranges: {}, layers });
async function clickWorld(x, y, button = 'left') {
  const p = await worldScreen(x, y);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...p, button, clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...p, button, clickCount: 1 }); await wait(100);
}
async function worldScreen(x, y) {
  return js((x, y) => { const canvas = document.querySelector('.plot2d canvas'), v = JSON.parse(canvas.dataset.view), r = canvas.getBoundingClientRect(); return { x: Math.round(r.left + (x-v.xmin)/(v.xmax-v.xmin)*r.width), y: Math.round(r.top + (v.ymax-y)/(v.ymax-v.ymin)*r.height) }; }, x, y);
}
async function dragWorld(from, to, cancel = false) {
  const a = await worldScreen(...from), b = await worldScreen(...to);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...a });
  win.webContents.sendInputEvent({ type: 'mouseDown', ...a, button: 'left', clickCount: 1 });
  for (let i=1;i<=8;i++) { win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x+(b.x-a.x)*i/8), y: Math.round(a.y+(b.y-a.y)*i/8) }); await wait(35); }
  if (cancel) await key('Escape');
  win.webContents.sendInputEvent({ type: 'mouseUp', ...b, button: 'left', clickCount: 1 }); await wait(120);
}
const near = (actual, expected, tolerance = .12) => actual.forEach((p, i) => p.forEach((n, j) => assert.ok(Math.abs(n-expected[i][j]) < tolerance, `${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)));
const lastGeometry = async () => (await snapshot()).project.layers.at(-1).geometry;

app.whenReady().then(async () => {
  ipcMain.handle('project:save', async (_event, { project }) => {
    savedProject = JSON.parse(JSON.stringify(project));
    const filePath = path.join(outputDir, 'saved.graphproj'); await fs.writeFile(filePath, JSON.stringify(savedProject)); return { path: filePath };
  });
  ipcMain.handle('project:open', async () => ({ project: JSON.parse(await fs.readFile(path.join(outputDir, 'saved.graphproj'), 'utf8')), path: path.join(outputDir, 'saved.graphproj') }));
  ipcMain.handle('image:save', async (_event, { dataUrl }) => { exportedImage = dataUrl; const filePath=path.join(outputDir,'exported.png'); await fs.writeFile(filePath, Buffer.from(dataUrl.split(',')[1],'base64')); return { path:filePath }; });
  win = new BrowserWindow({ width:1440,height:900,show:false,webPreferences:{ preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false } });
  registerTextTools(win);
  win.webContents.on('console-message', details => { if(details.level==='error') errors.push(details.message); });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  await win.loadFile(path.join(__dirname,'..','dist','index.html')); await seed(fixture('2d')); win.webContents.focus();
  assert.equal((await snapshot()).project.schemaVersion,2);
  await mouseClick('[data-tool="point"]'); await clickWorld(-2,2);
  assert.equal((await lastGeometry()).kind,'point'); near((await lastGeometry()).points,[[-2,2]]);
  await edit('[aria-label="A X"]',-3); await edit('[aria-label="A Y"]',3); near((await lastGeometry()).points,[[-3,3]],1e-6);
  await mouseClick('[data-tool="segment"]'); await clickWorld(-3,-2); await clickWorld(3,1);
  assert.equal((await lastGeometry()).kind,'segment'); near((await lastGeometry()).points,[[-3,-2],[3,1]]);
  const before = (await snapshot()).project, original=before.layers.at(-1).geometry.points;
  await dragWorld([0,-.5],[1,.5]); const moved=(await lastGeometry()).points;
  near(moved,original.map(([x,y])=>[x+1,y+1])); assert.deepEqual((await snapshot()).project.view2d,before.view2d);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]'); assert.deepEqual((await lastGeometry()).points,original);
  await mouseClick('[aria-label="重做 Ctrl+Shift+Z"]'); assert.deepEqual((await lastGeometry()).points,moved);
  await dragWorld(moved[1],[5,3]); near((await lastGeometry()).points,[moved[0],[5,3]]);
  const endpoint=(await lastGeometry()).points; await dragWorld([5,3],[6,4],true); assert.deepEqual((await lastGeometry()).points,endpoint);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]'); assert.deepEqual((await lastGeometry()).points,moved);
  await mouseClick('[aria-label="重做 Ctrl+Shift+Z"]'); assert.deepEqual((await lastGeometry()).points,endpoint);
  for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur']) {
    const a=await worldScreen(...endpoint[1]), b=await worldScreen(6,4);
    win.webContents.sendInputEvent({type:'mouseMove',...a});win.webContents.sendInputEvent({type:'mouseDown',...a,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseMove',...b});await wait(80);
    await js(type=>{ if(type==='blur') window.dispatchEvent(new Event('blur')); else document.querySelector('.plot2d canvas').dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1})); },cancellation);
    win.webContents.sendInputEvent({type:'mouseUp',...b,button:'left',clickCount:1});await wait(100);
    assert.deepEqual((await lastGeometry()).points,endpoint);
  }
  checks.push('点与线段创建、精确坐标、整体拖动、端点拖动、一步撤销重做、Esc 取消');

  await mouseClick('[aria-label="用坐标创建"]'); await edit('[aria-label="起点 X"]',-4.25); await edit('[aria-label="起点 Y"]',2.75);
  await mouseClick('.geometry-creator [type="submit"]'); near((await lastGeometry()).points,[[-4.25,2.75]],1e-8);
  await mouseClick('[aria-label="用坐标创建"]'); await js(()=>{const select=document.querySelector('[aria-label="创建对象类型"]');select.value='line';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await edit('[aria-label="起点 X"]',0); await edit('[aria-label="起点 Y"]',0); await edit('[aria-label="终点 X"]',0); await edit('[aria-label="终点 Y"]',0);
  await mouseClick('.geometry-creator [type="submit"]'); assert.equal(await js(()=>!!document.querySelector('.geometry-creator [role="alert"]')),true);
  await edit('[aria-label="终点 Y"]',4); await js(()=>document.querySelector('.geometry-creator [type="submit"]').focus()); await key('Enter'); await until(()=>!document.querySelector('.geometry-creator'));
  near((await lastGeometry()).points,[[0,0],[0,4]],1e-8); assert.equal(await js(()=>!!document.querySelector('.geometry-creator')),false);
  await clickWorld(6,-3,'right'); await until(()=>!!document.querySelector('[role="menu"]')); await command('add-point'); near((await lastGeometry()).points,[[6,-3]]);
  const p=(await snapshot()).project.layers.at(-1); await clickWorld(...p.geometry.points[0],'right'); await until(()=>!!document.querySelector('[role="menu"]')); await command('pin-probe');
  assert.equal(await js(()=>document.querySelector('[data-probe="2d"]').dataset.valid),'true'); await edit('[aria-label="A X"]',5); assert.equal(await js(()=>document.querySelector('[data-probe="2d"]').dataset.valid),'false');
  await mouseClick('[aria-label="撤销 Ctrl+Z"]'); assert.equal(await js(()=>document.querySelector('[data-probe="2d"]').dataset.valid),'true');
  await capture('coordinate-creation-light.png');
  checks.push('坐标直接创建、非法直线拒绝、键盘提交、右键原位添加和几何探针失效恢复');

  await seed(geometryFixture(geometryLayer('segment','segment',[[1,1],[4,2]])));
  await js(() => [...document.querySelectorAll('.geometry-actions button')].find(b=>b.textContent==='旋转').click()); near((await lastGeometry()).points,[[-1,1],[-2,4]],1e-8);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  await js(() => [...document.querySelectorAll('.geometry-actions button')].find(b=>b.textContent==='缩放').click()); near((await lastGeometry()).points,[[2,2],[8,4]],1e-8);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  await edit('[aria-label="平移 X"]',2); await edit('[aria-label="平移 Y"]',-3);
  await js(() => [...document.querySelectorAll('.geometry-actions button')].find(b=>b.textContent==='平移').click()); near((await lastGeometry()).points,[[3,-2],[6,-1]],1e-8);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]');
  await open(row('segment')); await command('mirrorX'); near((await lastGeometry()).points,[[1,-1],[4,-2]],1e-8);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]'); await open(row('segment')); await command('rotate');
  await dragWorld([4,1.5],[2.5,3]); near((await lastGeometry()).points,[[3,0],[2,3]]);
  await mouseClick('[aria-label="撤销 Ctrl+Z"]'); await open(row('segment')); await command('scale');
  await dragWorld([4,1.5],[5.5,1.5]); near((await lastGeometry()).points,[[-.5,.5],[5.5,2.5]],.2);
  checks.push('数值平移旋转缩放、右键镜像、画布拖动旋转缩放');

  await open(row('segment')); await command('duplicate'); const copy=(await snapshot()).project.layers.at(-1);
  await open(row(copy.id)); await command('lock'); const locked=(await snapshot()).project;
  assert.equal(await js(()=>document.querySelector('[aria-label="A X"]').disabled),true);
  await dragWorld(copy.geometry.points[0],[0,0]); assert.deepEqual((await snapshot()).project.layers,locked.layers);
  await open(row(copy.id)); assert.equal(await js(()=>document.querySelector('[data-command="delete"]').disabled),true); await command('duplicate');
  assert.equal((await snapshot()).project.layers.at(-1).locked,false);
  await open(row(copy.id)); await command('visibility'); assert.equal((await snapshot()).project.layers.find(l=>l.id===copy.id).visible,false);
  await mouseClick('[aria-label="保存工程"]'); await until(()=>document.querySelector('.toast')?.textContent.includes('工程已保存'));
  assert.equal(savedProject.schemaVersion,2);
  await mouseClick('[aria-label="打开工程"]'); assert.deepEqual((await snapshot()).project.layers,savedProject.layers);
  checks.push('几何复制、锁定、显隐、删除禁用及版本 2 工程文件保存重开');

  await seed(geometryFixture(geometryLayer('point','point',[[-4,-3]])));
  await mouseClick('[data-tool="line"]'); await clickWorld(2,-2); await clickWorld(2,2);
  const infinite=(await snapshot()).project.layers.at(-1); assert.equal(infinite.geometry.kind,'line');
  await edit('[aria-label="A X"]',2); await edit('[aria-label="B X"]',2); await edit('[aria-label="A Y"]',-2); await edit('[aria-label="B Y"]',-2);
  assert.notEqual((await lastGeometry()).points[0][1],(await lastGeometry()).points[1][1]);
  await clickWorld(2,4,'right'); await until(()=>!!document.querySelector('[role="menu"]'));
  assert.equal(await js(()=>document.querySelector('[role="menu"]').getAttribute('aria-label')),infinite.name); await key('Escape');
  await mouseClick('[data-tool="vector"]'); await clickWorld(-2,1); await clickWorld(1,3); assert.equal((await lastGeometry()).kind,'vector');
  await mouseClick('[data-tool="text"]'); await clickWorld(-5,4); await edit('[aria-label="文字内容"]','向量 u\n第二行标注'); await edit('[aria-label="字号"]',24); await edit('[aria-label="文字角度（°）"]',30);
  const text=(await lastGeometry()); assert.equal(text.text,'向量 u\n第二行标注'); assert.equal(text.rotation,30); assert.equal(text.fontSize,24);
  await mouseClick('[data-tool="segment"]'); await clickWorld(4,2); const count=(await snapshot()).project.layers.length; await key('Escape'); await clickWorld(5,3); assert.equal((await snapshot()).project.layers.length,count);
  checks.push('无限直线命中、退化输入拒绝、向量箭头、中文多行旋转文字、两点创建取消');
  await capture('geometry-light.png');

  await mouseClick('[aria-label="PNG 导出设置"]'); await edit('[aria-label="图像宽度"]',800); await edit('[aria-label="图像高度"]',600);
  await js(()=>{ const select=document.querySelector('[aria-label="清晰度倍率"]'); select.value='2'; select.dispatchEvent(new Event('change',{bubbles:true})); });
  await mouseClick('.export-settings [type="checkbox"]'); await mouseClick('.export-settings [type="submit"]'); await until(()=>document.querySelector('.toast')?.textContent.includes('已导出'));
  const image=nativeImage.createFromDataURL(exportedImage); assert.deepEqual(image.getSize(),{width:1600,height:1200});
  const alpha=await js(data=>new Promise(resolve=>{ const image=new Image(); image.onload=()=>{ const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0); resolve([...ctx.getImageData(17,13,1,1).data]); };image.src=data; }),exportedImage); assert.equal(alpha[3],0);
  await fs.writeFile(path.join(outputDir,'2d-transparent.png'),image.toPNG());
  await edit('[aria-label="图像宽度"]',8192); await edit('[aria-label="图像高度"]',8192); const oldExport=exportedImage; await mouseClick('.export-settings [type="submit"]');
  assert.equal(await js(()=>!!document.querySelector('.export-settings [role="alert"]')),true); assert.equal(exportedImage,oldExport);
  await capture('geometry-export-light.png');
  checks.push('PNG 指定尺寸与倍率、真实透明像素、超大导出拒绝');

  await seed(fixture('3d')); await mouseClick('[aria-label="PNG 导出设置"]'); await edit('[aria-label="图像宽度"]',640); await edit('[aria-label="图像高度"]',480); await mouseClick('.export-settings [type="checkbox"]');
  const cameraBefore=(await snapshot()).project.camera3d; await mouseClick('.export-settings [type="submit"]'); await until(()=>document.querySelector('.toast')?.textContent.includes('已导出'));
  assert.deepEqual(nativeImage.createFromDataURL(exportedImage).getSize(),{width:640,height:480}); assert.deepEqual((await snapshot()).project.camera3d,cameraBefore);
  const alpha3d=await js(data=>new Promise(resolve=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);resolve([...ctx.getImageData(17,13,1,1).data]);};image.src=data;}),exportedImage); assert.equal(alpha3d[3],0);
  await fs.writeFile(path.join(outputDir,'3d-transparent.png'),Buffer.from(exportedImage.split(',')[1],'base64'));
  checks.push('3D 自定义透明 PNG 和导出后相机、画布恢复');

  await seed(fixture('2d'),'dark'); await js(()=>[...document.querySelectorAll('.sidebar-tabs button')].find(b=>b.textContent.includes('学习示例')).click());
  for(const title of ['两点与斜率','向量的首尾相接','旋转与镜像']) {
    await js(title=>[...document.querySelectorAll('.example-card')].find(b=>b.textContent.includes(title)).click(),title);
    assert.equal((await snapshot()).project.aspectLocked,true); assert.ok((await snapshot()).project.layers.every(l=>l.type==='geometry'));
    await js(()=>[...document.querySelectorAll('.sidebar-tabs button')].find(b=>b.textContent.includes('学习示例')).click());
  }
  await capture('geometry-dark.png'); win.setSize(1000,720); await wait(300); await mouseClick('[aria-label="显示设置面板"]'); await capture('geometry-small-dark.png');
  assert.equal(await js(()=>[...document.querySelectorAll('.geometry-toolbar button, .geometry-editor input')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),true);
  checks.push('三组学习示例、亮暗主题和小窗口可操作');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(outputDir,'summary.json'),JSON.stringify({checks,errors},null,2)); process.stdout.write(JSON.stringify({checks,errors,outputDir})+'\n'); win.close();app.quit();
}).catch(async error=>{
  process.stderr.write(`${error.stack || error}\n`);
  if(win&&!win.isDestroyed()) { await capture('failure.png').catch(()=>{}); const diagnostic=await js(()=>({ trace:window.__inputTrace, active:document.activeElement?.outerHTML, fields:[...document.querySelectorAll('.geometry-creator input')].map(i=>({label:i.getAttribute('aria-label'),value:i.value,valid:i.validity.valid})), text:document.body.innerText.slice(-4500), project:localStorage.getItem('math-atlas-project-v1') })).catch(()=>null); await fs.writeFile(path.join(outputDir,'failure.json'),JSON.stringify({error:error.message,diagnostic},null,2)); process.stderr.write(JSON.stringify(diagnostic)+'\n'); }
  app.exit(1);
});
