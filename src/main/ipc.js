const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { uploadFile, ensureAssetUrl, generateImages } = require('./api');

/* ---------- 生成作业表：jobId -> AbortController，支持「停止生成」 ---------- */
const genJobs = new Map();
const startedAt = new Map();
let lastJobId = null;

function sendProgress(event, jobId, stage) {
  if (event.sender.isDestroyed()) return;
  event.sender.send('generate:progress', {
    stage,
    elapsed: Math.round((Date.now() - (startedAt.get(jobId) || Date.now())) / 100) / 10
  });
}

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
  ipcMain.handle('asset:deleteMany', (_e, ids, opts) => store.deleteAssets(ids, opts || {}));

  // 480px 缩略图（主进程缓存于 images/thumbs/，返回 file 路径；null=调用方回退原图）
  ipcMain.handle('asset:thumbnail', (_e, id) => {
    const asset = store.getAsset(id);
    const p = asset ? store.thumbnailFor(asset) : null;
    return p && fs.existsSync(p) ? p : null;
  });

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

  // ---------- 调用生图（payload.jobId 用于 generate:cancel 定向取消） ----------
  ipcMain.handle('generate:run', async (event, payload) => {
    const jobId = payload.jobId || store.newId();
    const ctrl = new AbortController();
    genJobs.set(jobId, ctrl);
    startedAt.set(jobId, Date.now());
    lastJobId = jobId;
    // 窗口销毁时自动取消该窗口发起的作业，避免悬挂请求
    event.sender.once('destroyed', () => ctrl.abort());
    const signal = ctrl.signal;
    const canceled = () => {
      const err = new Error('已取消生成');
      err.canceled = true;
      return err;
    };
    const progress = (stage) => sendProgress(event, jobId, stage);
    const guard = (p) => p.catch(e => {
      // 外部取消引起的中止统一措辞；其余原样上抛
      if (signal.aborted) throw new Error('用户已取消');
      throw e;
    });

    const refIds = payload.refAssetIds || [];
    const saved = [];   // 已落盘结果：取消/失败时也要带回渲染层展示

    /** 落盘一批（可能部分）生成图并生成素材记录，返回 { batchId, images } */
    const persist = (ctx, imgs) => {
      const batchId = store.newId();
      for (let i = 0; i < imgs.length; i++) {
        progress(`正在保存生成图 ${i + 1}/${imgs.length}…`);
        const img = imgs[i];
        const { id, localPath } = store.saveGeneratedBuffer(img.buffer, img.ext);
        saved.push(store.addAsset({
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
          refImages: ctx.refAssets.map(a => ({ id: a.id, localPath: a.localPath, url: a.url, fileName: a.fileName })),
          maskImage: ctx.maskAsset ? { id: ctx.maskAsset.id, localPath: ctx.maskAsset.localPath, url: ctx.maskAsset.url } : null,
          model: ctx.model.name,
          modelPath: ctx.modelPath,
          endpoint: ctx.endpoint,
          createdAt: new Date().toISOString()
        }));
      }
      return { batchId, images: saved };
    };

    try {
      if (signal.aborted) throw canceled();
      const config = store.getConfig();
      // 解析当前选中的模型（模型可独立配置 baseUrl/apiKey，留空则回退到全局）
      const model = config.models.find(m => m.id === config.activeModelId) || config.models[0];
      const baseUrl = (model.baseUrl || config.baseUrl || '').trim();
      const modelPath = (model.modelPath || '').trim();
      const apiKey = (model.apiKey || config.apiKey || '').trim();
      if (!apiKey) throw new Error('请先在「设置」中填写 API Key（全局或当前模型）');
      if (!baseUrl || !modelPath) throw new Error('当前模型缺少渠道 Base URL 或接口路径，请在「设置」中检查');

      if (refIds.length === 0) throw new Error('请至少添加一张参考图');
      const ctx = { model, modelPath, endpoint: `${baseUrl.replace(/\/+$/, '')}/${modelPath.replace(/^\/+/, '')}`, refAssets: [], maskAsset: null };

      // 1. 确保参考图都有 URL
      for (const id of refIds) {
        if (signal.aborted) throw canceled();
        const asset = store.getAsset(id);
        if (!asset) throw new Error(`参考图素材不存在：${id}`);
        progress(`正在准备参考图 ${ctx.refAssets.length + 1}/${refIds.length}…`);
        if (!asset.url) {
          const url = await guard(uploadFile(asset.localPath, config.uploadUrl, { signal }));
          store.updateAsset(asset.id, { url });
          asset.url = url;
        }
        ctx.refAssets.push(asset);
      }

      // 2. 遮罩图（可选）
      if (payload.maskAssetId) {
        if (signal.aborted) throw canceled();
        ctx.maskAsset = store.getAsset(payload.maskAssetId);
        if (ctx.maskAsset && !ctx.maskAsset.url) {
          progress('正在上传遮罩图…');
          const url = await guard(uploadFile(ctx.maskAsset.localPath, config.uploadUrl, { signal }));
          store.updateAsset(ctx.maskAsset.id, { url });
          ctx.maskAsset.url = url;
        }
      }

      // 3. 调用接口（进度：阶段文字 + 耗时秒数，渲染层另有本地计时刷新）
      progress(`正在调用模型「${model.name}」…`);
      let res;
      try {
        res = await generateImages({
          imageUrls: ctx.refAssets.map(a => a.url),
          maskUrl: ctx.maskAsset ? ctx.maskAsset.url : null,
          prompt: payload.prompt || '',
          params: payload.params || {},
          config: { baseUrl, modelPath, apiKey },
          signal
        });
      } catch (e) {
        if (signal.aborted) throw canceled();
        throw e;
      }

      // 4. 落盘（接口出图后不再中断：即使已取消，也把拿到的部分图保存下来）
      if (res.canceled) {
        if (res.images.length) persist(ctx, res.images);
        throw canceled();
      }
      return persist(ctx, res.images);
    } catch (e) {
      // 取消不走 reject：Error 的自定义属性无法可靠穿过 IPC 结构化克隆，
      // 用返回值 {canceled:true} 表达，渲染层据此显示灰色「已取消」并展示已落盘的部分结果。
      // 判定以本作业自己的 signal 为准，避免网络错误文案里的 aborted 被误判成取消。
      if (signal.aborted || (e && e.canceled === true)) {
        return { canceled: true, batchId: saved[0]?.batchId || null, images: saved };
      }
      throw e;
    } finally {
      genJobs.delete(jobId);
      startedAt.delete(jobId);
    }
  });

  // 取消生成：jobId 缺省取消最近一个作业。返回是否命中正在进行的作业。
  ipcMain.handle('generate:cancel', (_e, jobId) => {
    const ctrl = genJobs.get(jobId || lastJobId);
    if (!ctrl) return false;
    ctrl.abort();
    return true;
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
