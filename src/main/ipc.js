const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { uploadFile, ensureAssetUrl, generateImages } = require('./api');

function registerIpc() {
  // ---------- 配置 ----------
  ipcMain.handle('config:get', () => store.getConfig());
  ipcMain.handle('config:save', (_e, patch) => store.saveConfig(patch || {}));
  ipcMain.handle('app:dataDir', () => store.paths().userDataDir);

  // ---------- 文件选择 ----------
  ipcMain.handle('dialog:pickImages', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('dialog:pickMask', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择遮罩图（带 alpha 通道的 PNG）',
      properties: ['openFile'],
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // ---------- 素材管理 ----------
  ipcMain.handle('asset:list', (_e, type) => store.listAssets(type));
  ipcMain.handle('asset:get', (_e, id) => store.getAsset(id));
  ipcMain.handle('asset:delete', (_e, id) => store.deleteAsset(id));

  // 导入本地文件为上传素材（复制进应用目录，自动上传图床取 URL）
  ipcMain.handle('asset:importFiles', async (_e, filePaths) => {
    const config = store.getConfig();
    const results = [];
    for (const fp of filePaths || []) {
      let record;
      try {
        const stat = fs.statSync(fp);
        record = store.importUploadedFile(fp, path.basename(fp), mimeFromExt(fp));
        record.size = stat.size;
      } catch (e) {
        results.push({ ok: false, fileName: path.basename(fp), error: e.message });
        continue;
      }
      try {
        const url = await uploadFile(record.localPath, config.uploadUrl);
        record = store.addAsset({ ...record, url });
        results.push({ ok: true, asset: record });
      } catch (e) {
        // 图床失败也保留本地记录，之后可重试上传
        record = store.addAsset(record);
        results.push({ ok: true, asset: record, warning: e.message });
      }
    }
    return results;
  });

  // 为缺少 URL 的素材补传图床
  ipcMain.handle('asset:ensureUploaded', async (_e, id) => {
    const config = store.getConfig();
    const asset = store.getAsset(id);
    if (!asset) throw new Error('素材不存在');
    const url = await ensureAssetUrl(asset, config.uploadUrl, (aid, u) =>
      store.updateAsset(aid, { url: u })
    );
    return store.getAsset(id);
  });

  // ---------- 调用生图 ----------
  ipcMain.handle('generate:run', async (event, payload) => {
    const config = store.getConfig();
    // 解析当前选中的模型（模型可独立配置 baseUrl/apiKey，留空则回退到全局）
    const model = config.models.find(m => m.id === config.activeModelId) || config.models[0];
    const baseUrl = (model.baseUrl || config.baseUrl || '').trim();
    const modelPath = (model.modelPath || '').trim();
    const apiKey = (model.apiKey || config.apiKey || '').trim();
    if (!apiKey) throw new Error('请先在「设置」中填写 API Key（全局或当前模型）');
    if (!baseUrl || !modelPath) throw new Error('当前模型缺少渠道 Base URL 或接口路径，请在「设置」中检查');

    const refIds = payload.refAssetIds || [];
    if (refIds.length === 0) throw new Error('请至少添加一张参考图');

    // 1. 确保参考图都有 URL
    const refAssets = [];
    for (const id of refIds) {
      const asset = store.getAsset(id);
      if (!asset) throw new Error(`参考图素材不存在：${id}`);
      event.sender.send('generate:progress', `正在准备参考图 ${refAssets.length + 1}/${refIds.length}…`);
      if (!asset.url) {
        const url = await uploadFile(asset.localPath, config.uploadUrl);
        store.updateAsset(asset.id, { url });
        asset.url = url;
      }
      refAssets.push(asset);
    }

    // 2. 遮罩图（可选）
    let maskAsset = null;
    if (payload.maskAssetId) {
      maskAsset = store.getAsset(payload.maskAssetId);
      if (maskAsset && !maskAsset.url) {
        event.sender.send('generate:progress', '正在上传遮罩图…');
        const url = await uploadFile(maskAsset.localPath, config.uploadUrl);
        store.updateAsset(maskAsset.id, { url });
        maskAsset.url = url;
      }
    }

    // 3. 调用接口
    event.sender.send('generate:progress', `正在调用模型「${model.name}」，请稍候…`);
    const { images } = await generateImages({
      imageUrls: refAssets.map(a => a.url),
      maskUrl: maskAsset ? maskAsset.url : null,
      prompt: payload.prompt || '',
      params: payload.params || {},
      config: { baseUrl, modelPath, apiKey }
    });

    // 4. 落盘并生成素材记录
    const batchId = store.newId();
    const saved = [];
    for (let i = 0; i < images.length; i++) {
      event.sender.send('generate:progress', `正在保存生成图 ${i + 1}/${images.length}…`);
      const img = images[i];
      const { id, localPath } = store.saveGeneratedBuffer(img.buffer, img.ext);
      const record = store.addAsset({
        id,
        type: 'generated',
        batchId,
        localPath,
        url: img.url || '',
        prompt: payload.prompt || '',
        params: {
          n: payload.params?.n || 1,
          size: payload.params?.size || '1024x1024',
          quality: payload.params?.quality || 'low',
          background: payload.params?.background || 'auto',
          output_format: payload.params?.output_format || 'png'
        },
        refImages: refAssets.map(a => ({ id: a.id, localPath: a.localPath, url: a.url, fileName: a.fileName })),
        maskImage: maskAsset ? { id: maskAsset.id, localPath: maskAsset.localPath, url: maskAsset.url } : null,
        model: model.name,
        modelPath,
        endpoint: `${baseUrl.replace(/\/+$/, '')}/${modelPath.replace(/^\/+/, '')}`,
        createdAt: new Date().toISOString()
      });
      saved.push(record);
    }
    return { batchId, images: saved };
  });

  // ---------- 系统操作 ----------
  ipcMain.handle('shell:showItem', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  });
  ipcMain.handle('shell:openPath', async (_e, p) => {
    if (p && fs.existsSync(p)) return shell.openPath(p);
    return '路径不存在';
  });
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
}

function mimeFromExt(fp) {
  const ext = path.extname(fp).toLowerCase();
  return ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'
  })[ext] || 'application/octet-stream';
}

module.exports = { registerIpc };
