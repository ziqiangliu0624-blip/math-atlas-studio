const { clipboard, ipcMain, Menu } = require('electron');

let registered = false;

function registerTextTools(win) {
  if (!registered) {
    ipcMain.handle('clipboard:write-text', async (event, text) => {
      if (event.senderFrame !== event.sender.mainFrame || typeof text !== 'string' || text.length > 10000) {
        throw new Error('剪贴板内容无效');
      }
      await clipboard.writeText(text);
      return true;
    });
    registered = true;
  }
  win.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const flags = params.editFlags;
    Menu.buildFromTemplate([
      { role: 'undo', label: '撤销', enabled: flags.canUndo },
      { role: 'redo', label: '重做', enabled: flags.canRedo },
      { type: 'separator' },
      { role: 'cut', label: '剪切', enabled: flags.canCut },
      { role: 'copy', label: '复制', enabled: flags.canCopy },
      { role: 'paste', label: '粘贴', enabled: flags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: '全选', enabled: flags.canSelectAll },
    ]).popup({ window: win });
  });
}

module.exports = { registerTextTools };
