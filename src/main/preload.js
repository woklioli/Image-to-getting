const { contextBridge, ipcRenderer, clipboard } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  getDataDir: () => ipcRenderer.invoke('app:dataDir'),

  // 文件选择
  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  pickMask: () => ipcRenderer.invoke('dialog:pickMask'),

  // 素材
  listAssets: (type) => ipcRenderer.invoke('asset:list', type),
  getAsset: (id) => ipcRenderer.invoke('asset:get', id),
  deleteAsset: (id) => ipcRenderer.invoke('asset:delete', id),
  deleteMany: (ids, opts) => ipcRenderer.invoke('asset:deleteMany', ids, opts),
  thumbnail: (id) => ipcRenderer.invoke('asset:thumbnail', id),
  importFiles: (paths) => ipcRenderer.invoke('asset:importFiles', paths),
  ensureUploaded: (id) => ipcRenderer.invoke('asset:ensureUploaded', id),

  // 生图（payload 含 jobId，配合 cancel(jobId) 定向停止）
  generate: (payload) => ipcRenderer.invoke('generate:run', payload),
  cancelGenerate: (jobId) => ipcRenderer.invoke('generate:cancel', jobId),
  // 进度 payload：{ stage, elapsed }（elapsed 秒，保留 1 位小数）
  onProgress: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('generate:progress', listener);
    return () => ipcRenderer.removeListener('generate:progress', listener);
  },

  // 系统
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  copyText: (text) => clipboard.writeText(String(text ?? '')),

  // 本地文件转为可显示的 file:// 地址
  toFileUrl: (p) => pathToFileURL(p).href
});
