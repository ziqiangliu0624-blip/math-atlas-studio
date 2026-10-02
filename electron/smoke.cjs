const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const outputDir = path.join(__dirname, '..', 'artifacts');
const profileDir = path.join(outputDir, 'smoke-profile');
fsSync.mkdirSync(profileDir, { recursive: true });
app.setPath('userData', profileDir);
const errors = [];

async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.webContents.on('console-message', details => {
    if (details.level === 'error') errors.push(details.message);
  });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(`Renderer gone: ${details.reason}`));
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await win.webContents.executeJavaScript("localStorage.removeItem('math-atlas-project-v1'); localStorage.removeItem('math-atlas-theme')");
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await wait(1500);
  await fs.mkdir(outputDir, { recursive: true });
  const summary = await win.webContents.executeJavaScript(`({
    title: document.title,
    heading: document.querySelector('.sidebar-heading h2')?.textContent,
    layers: document.querySelectorAll('.layer-row').length,
    plots: document.querySelectorAll('canvas').length,
    bodyText: document.body.innerText.slice(0, 300)
  })`);
  assert.equal(summary.heading, '探索空间');
  assert.equal(summary.layers, 1);
  assert.equal(summary.plots, 1);
  await fs.writeFile(path.join(outputDir, 'desktop-2d.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelectorAll('.sidebar-tabs button')[1].click()");
  await wait(100);
  await win.webContents.executeJavaScript("[...document.querySelectorAll('.example-card')].find(button => button.textContent.includes('波浪曲面')).click()");
  await wait(1200);
  const threeSummary = await win.webContents.executeJavaScript(`({plots: document.querySelectorAll('canvas').length, fallback: document.querySelector('.plot3d__fallback')?.textContent || null, layer: document.querySelector('.layer-main small')?.textContent || null})`);
  assert.equal(threeSummary.plots, 1);
  assert.equal(threeSummary.fallback, null);
  assert.match(threeSummary.layer, /^z\s*=/);
  await fs.writeFile(path.join(outputDir, 'desktop-3d.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.formula-help-toggle').click()");
  await wait(50);
  const controls = await win.webContents.executeJavaScript(`({
    guide: document.querySelector('#formula-guide')?.innerText,
    axes: [...document.querySelectorAll('.domain-axis-title')].map(node => node.textContent),
  })`);
  assert.match(controls.guide, /三维曲面/);
  assert.deepEqual(controls.axes, ['X 轴', 'Y 轴']);
  await fs.writeFile(path.join(outputDir, 'desktop-3d-controls.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.domain-axis input');
    input.focus();
    input.value = '-3';
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  })()`);
  await wait(750);
  const surfaceDomain = await win.webContents.executeJavaScript("JSON.parse(localStorage.getItem('math-atlas-project-v1'))?.layers?.[0]?.domain");
  assert.deepEqual(surfaceDomain, { x: [-3, 5], y: [-5, 5] });
  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  await wait(1000);
  const reloadedDomain = await win.webContents.executeJavaScript(`({
    stored: JSON.parse(localStorage.getItem('math-atlas-project-v1'))?.layers?.[0]?.domain,
    inputs: [...document.querySelectorAll('.domain-axis input')].map(input => input.value),
  })`);
  assert.deepEqual(reloadedDomain.stored, surfaceDomain);
  assert.deepEqual(reloadedDomain.inputs, ['-3', '5', '-5', '5']);
  await win.webContents.executeJavaScript("[...document.querySelectorAll('.camera-controls button')].find(button => button.textContent.includes('透视')).click()");
  await wait(1400);
  const cameraState = await win.webContents.executeJavaScript("JSON.parse(localStorage.getItem('math-atlas-project-v1'))?.camera3d");
  assert.equal(cameraState?.projection, 'orthographic');
  await win.webContents.executeJavaScript("document.querySelector('.inspector-bottom button').click()");
  await wait(300);
  assert.equal(await win.webContents.executeJavaScript("document.documentElement.dataset.theme"), 'dark');
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await win.webContents.capturePage();
  await fs.writeFile(path.join(outputDir, 'desktop-3d-dark.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ summary, threeSummary, controls, surfaceDomain, reloadedDomain, cameraState, errors, outputDir }) + '\n');
  await win.close();
  app.quit();
}).catch(error => { process.stderr.write(`${error.stack || error}\n`); app.exit(1); });
