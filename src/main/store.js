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
  activeModelId: 'model-default'
};

let userDataDir = null;
let configPath = null;
let dbPath = null;
let uploadsDir = null;
let generatedDir = null;

function init() {
  userDataDir = app.getPath('userData');
  configPath = path.join(userDataDir, 'config.json');
  dbPath = path.join(userDataDir, 'db.json');
  uploadsDir = path.join(userDataDir, 'images', 'uploads');
  generatedDir = path.join(userDataDir, 'images', 'generated');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });
}

function paths() {
  return { userDataDir, uploadsDir, generatedDir };
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
  const db = getDb();
  const idx = db.assets.findIndex(a => a.id === id);
  if (idx === -1) return false;
  const [record] = db.assets.splice(idx, 1);
  saveDb(db);
  // 仅删除生成图/上传图文件本身；参考图不删（可能被其它记录引用）
  try {
    if (record.localPath && fs.existsSync(record.localPath)) fs.unlinkSync(record.localPath);
  } catch (e) {
    console.error('删除文件失败:', e.message);
  }
  return true;
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
  importUploadedFile,
  saveGeneratedBuffer,
  newId
};
