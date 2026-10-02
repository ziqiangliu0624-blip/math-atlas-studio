const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { registerTextTools } = require('./text-tools.cjs');

let mainWindow;
const allowedProjectPaths = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#f3f5f8',
    show: false,
    title: '图形绘制实验室',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  registerTextTools(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light';
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开本地工程',
    properties: ['openFile'],
    filters: [{ name: '图形绘制工程', extensions: ['graphproj', 'json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stats = await fs.stat(filePath);
  if (stats.size > 10 * 1024 * 1024) throw new Error('工程文件超过 10 MB');
  const content = await fs.readFile(filePath, 'utf8');
  const project = JSON.parse(content);
  allowedProjectPaths.add(filePath);
  return { path: filePath, project };
});

ipcMain.handle('project:save', async (_event, { project, path: existingPath }) => {
  if (!project || ![1, 2].includes(project.schemaVersion) || !Array.isArray(project.layers)) throw new Error('工程数据无效');
  let filePath = typeof existingPath === 'string' && allowedProjectPaths.has(existingPath) ? existingPath : null;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存本地工程',
      defaultPath: `${project?.name || '未命名工程'}.graphproj`,
      filters: [{ name: '图形绘制工程', extensions: ['graphproj'] }]
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(project, null, 2), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
  allowedProjectPaths.add(filePath);
  return { path: filePath };
});

ipcMain.handle('image:save', async (_event, { dataUrl, suggestedName }) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('仅支持 PNG 图像');
  }
  if (dataUrl.length > 70 * 1024 * 1024) throw new Error('图像过大，请缩小导出尺寸');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PNG',
    defaultPath: `${suggestedName || '图形'}.png`,
    filters: [{ name: 'PNG 图像', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePath) return null;
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  await fs.writeFile(result.filePath, bytes);
  return { path: result.filePath };
});

ipcMain.on('window:title', (_event, title) => {
  if (mainWindow && typeof title === 'string') mainWindow.setTitle(`${title} · 图形绘制实验室`);
});
