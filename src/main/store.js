const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  baseUrl: 'https://api.highwayapi.ai',
  apiKey: '',
  uploadUrl: 'https://tmpfile.link/api/upload',
  models: [
    { id: 'model-default', name: 'GPT Image 2 编辑', baseUrl: '', modelPath: 'v3/gpt-image-2-edit', apiKey: '' }
  ],
  activeModelId: 'model-default',
  theme: 'system'          // system | light | dark
};

let userDataDir = null;
let configPath = null;
let dbPath = null;
let uploadsDir = null;
let generatedDir = null;
let thumbsDir = null;

function init() {
  userDataDir = app.getPath('userData');
  configPath = path.join(userDataDir, 'config.json');
  dbPath = path.join(userDataDir, 'db.json');
  uploadsDir = path.join(userDataDir, 'images', 'uploads');
  generatedDir = path.join(userDataDir, 'images', 'generated');
  thumbsDir = path.join(userDataDir, 'images', 'thumbs');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
}

function paths() {
  return { userDataDir, uploadsDir, generatedDir, thumbsDir };
}

function thumbPathFor(id) {
  return path.join(thumbsDir, `${id}.jpg`);
}

function removeThumb(id) {
  try { fs.unlinkSync(thumbPathFor(id)); } catch { /* 无缩略图 */ }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

function getConfig() {
  const raw = readJson(configPath, {});
  const cfg = { ...DEFAULT_CONFIG, ...raw };
  // 迁移旧版单模型配置 -> 模型列表
  if (!Array.isArray(cfg.models) || cfg.models.length === 0) {
    cfg.models = [{
      id: 'model-default',
      name: 'GPT Image 2 编辑',
      baseUrl: '',
      modelPath: cfg.modelPath || 'v3/gpt-image-2-edit',
      apiKey: ''
    }];
    cfg.activeModelId = 'model-default';
  }
  cfg.models = cfg.models.map(m => ({
    id: m.id || newId(),
    name: m.name || m.modelPath || '未命名模型',
    baseUrl: m.baseUrl ?? '',
    modelPath: m.modelPath || '',
    apiKey: m.apiKey ?? ''
  }));
  if (!cfg.models.some(m => m.id === cfg.activeModelId)) cfg.activeModelId = cfg.models[0].id;
  if (!['system', 'light', 'dark'].includes(cfg.theme)) cfg.theme = 'system';
  return cfg;
}

function saveConfig(patch) {
  const next = { ...getConfig(), ...patch };
  writeJson(configPath, next);
  return next;
}

function getDb() {
  const db = readJson(dbPath, { assets: [] });
  if (!Array.isArray(db.assets)) db.assets = [];
  return db;
}

function saveDb(db) {
  writeJson(dbPath, db);
}

function newId() {
  return crypto.randomUUID();
}

function extOf(fileName, mime) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext && ext.length <= 6) return ext;
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

/** 把用户选择的本地文件复制进 uploads 目录，返回素材记录 */
function importUploadedFile(srcPath, originalName, mime) {
  const id = newId();
  const ext = extOf(originalName, mime);
  const storedName = `${id}${ext}`;
  const dest = path.join(uploadsDir, storedName);
  fs.copyFileSync(srcPath, dest);
  const stat = fs.statSync(dest);
  return {
    id,
    type: 'upload',
    fileName: originalName || storedName,
    localPath: dest,
    url: '',
    size: stat.size,
    mime: mime || '',
    createdAt: new Date().toISOString()
  };
}

/** 生成图落盘：buffer 或 下载后的临时文件 */
function saveGeneratedBuffer(buffer, ext) {
  const id = newId();
  const safeExt = ext && ext.startsWith('.') ? ext : `.${ext || 'png'}`;
  const fileName = `${id}${safeExt}`;
  const dest = path.join(generatedDir, fileName);
  fs.writeFileSync(dest, buffer);
  return { id, localPath: dest, fileName };
}

function listAssets(type) {
  const assets = getDb().assets;
  const filtered = type ? assets.filter(a => a.type === type) : assets;
  return filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function getAsset(id) {
  return getDb().assets.find(a => a.id === id) || null;
}

function addAsset(record) {
  const db = getDb();
  db.assets.push(record);
  saveDb(db);
  return record;
}

function updateAsset(id, patch) {
  const db = getDb();
  const idx = db.assets.findIndex(a => a.id === id);
  if (idx === -1) return null;
  db.assets[idx] = { ...db.assets[idx], ...patch };
  saveDb(db);
  return db.assets[idx];
}

function deleteAsset(id) {
  return deleteAssets([id]).length > 0;
}

/**
 * 批量删除素材（一次读一次写，替代逐个 deleteAsset 的 N 次全量写盘）。
 * alsoDeleteFiles=false 时仅删记录、保留本地图片文件。
 * 返回被删除记录的 localPath 列表。
 */
function deleteAssets(ids, { alsoDeleteFiles = true } = {}) {
  const db = getDb();
  const idSet = new Set(ids || []);
  const removed = [];
  db.assets = db.assets.filter(a => {
    if (idSet.has(a.id)) { removed.push(a); return false; }
    return true;
  });
  if (!removed.length) return [];
  saveDb(db);
  for (const record of removed) {
    removeThumb(record.id);
    // 仅删除生成图/上传图文件本身；仅当同时删文件时
    if (alsoDeleteFiles) {
      try {
        if (record.localPath && fs.existsSync(record.localPath)) fs.unlinkSync(record.localPath);
      } catch (e) {
        console.error('删除文件失败:', e.message);
      }
    }
  }
  return removed.map(a => a.localPath);
}

/**
 * 为素材生成/复用 480px 宽缩略图，返回缩略图文件路径；失败返回 null（调用方回退原图）。
 * 缓存键 = 文件 mtimeMs + size：原图更新即失效。
 */
function thumbnailFor(asset) {
  try {
    if (!asset || !asset.localPath || !fs.existsSync(asset.localPath)) return null;
    const stat = fs.statSync(asset.localPath);
    const thumb = thumbPathFor(asset.id);
    let fresh = false;
    try {
      const ts = fs.statSync(thumb);
      const stampPath = thumb + '.stamp';
      const stamp = `${Math.round(stat.mtimeMs)}:${stat.size}`;
      const old = fs.readFileSync(stampPath, 'utf-8');
      fresh = old === stamp && ts.mtimeMs >= stat.mtimeMs;
    } catch { /* 无缓存 */ }
    if (fresh) return thumb;
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(asset.localPath);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const out = width > 480
      ? img.resize({ width: 480, quality: 'good' })
      : img;
    const jpeg = out.toJPEG(80);
    if (!jpeg || !jpeg.length) return null;
    fs.writeFileSync(thumb, jpeg);
    fs.writeFileSync(thumb + '.stamp', `${Math.round(stat.mtimeMs)}:${stat.size}`);
    return thumb;
  } catch (e) {
    console.error('生成缩略图失败:', e.message);
    return null;
  }
}

module.exports = {
  init,
  paths,
  getConfig,
  saveConfig,
  listAssets,
  getAsset,
  addAsset,
  updateAsset,
  deleteAsset,
  deleteAssets,
  thumbnailFor,
  removeThumb,
  importUploadedFile,
  saveGeneratedBuffer,
  newId
};
