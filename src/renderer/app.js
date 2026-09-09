/* ===== 工具 ===== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function shortId(id) { return id ? id.slice(0, 8) : '—'; }
function imgSrc(a) {
  if (!a) return '';
  if (a.localPath) { try { return window.api.toFileUrl(a.localPath); } catch { /* fall through */ } }
  return a.url || '';
}
let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* ===== 导航 ===== */
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
    const page = btn.dataset.page;
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    if (page === 'history') loadHistory();
  });
});

/* ===== 设置 ===== */
let settingsCfg = null;

async function loadConfig() {
  settingsCfg = await window.api.getConfig();
  $('#cfgBaseUrl').value = settingsCfg.baseUrl || '';
  $('#cfgApiKey').value = settingsCfg.apiKey || '';
  $('#cfgUploadUrl').value = settingsCfg.uploadUrl || '';
  $('#dataDir').textContent = await window.api.getDataDir();
  renderModelList();
  renderActiveModelSelect(settingsCfg);
}

function renderModelList() {
  const wrap = $('#modelList');
  wrap.innerHTML = '';
  (settingsCfg.models || []).forEach(m => {
    const item = document.createElement('div');
    item.className = 'model-item' + (m.id === settingsCfg.activeModelId ? ' active' : '');
    item.dataset.id = m.id;
    item.innerHTML = `
      <div class="model-head">
        <input type="radio" name="activeModel" title="设为当前使用模型" ${m.id === settingsCfg.activeModelId ? 'checked' : ''} />
        <input type="text" class="model-name-input" data-f="name" value="${esc(m.name)}" placeholder="模型名称，如：GPT Image 2 编辑" />
        <button class="btn ghost small model-del" title="删除该模型">🗑️ 删除</button>
      </div>
      <div class="model-fields">
        <label class="field full">
          <span>接口路径 modelPath <span class="req">*</span></span>
          <input type="text" data-f="modelPath" value="${esc(m.modelPath)}" placeholder="v3/gpt-image-2-edit" />
        </label>
        <label class="field">
          <span>专属 Base URL（留空用全局）</span>
          <input type="text" data-f="baseUrl" value="${esc(m.baseUrl || '')}" placeholder="留空使用全局 Base URL" />
        </label>
        <label class="field">
          <span>专属 API Key（留空用全局）</span>
          <input type="password" data-f="apiKey" value="${esc(m.apiKey || '')}" placeholder="留空使用全局 API Key" />
        </label>
      </div>`;
    // 输入实时回写内存：任何列表重建都不会吞掉未保存的编辑
    item.querySelectorAll('[data-f]').forEach(inp => {
      inp.addEventListener('input', () => {
        const cur = (settingsCfg.models || []).find(x => x.id === m.id);
        if (cur) cur[inp.dataset.f] = inp.value;
      });
    });
    item.querySelector('.model-del').addEventListener('click', () => {
      if (settingsCfg.models.length <= 1) return toast('至少保留一个模型', 'err');
      if (!confirm(`确定删除模型「${m.name || m.modelPath}」吗？`)) return;
      settingsCfg.models = settingsCfg.models.filter(x => x.id !== m.id);
      if (settingsCfg.activeModelId === m.id) settingsCfg.activeModelId = settingsCfg.models[0].id;
      renderModelList();
      renderActiveModelSelect(settingsCfg);
    });
    item.querySelector('input[type=radio]').addEventListener('change', () => {
      settingsCfg.activeModelId = m.id;
      syncModelActiveState();   // 只更新选中态，不重建 input（旧版在这里丢过用户的输入）
      renderActiveModelSelect(settingsCfg);
    });
    wrap.appendChild(item);
  });
}

/* 仅同步各卡片的高亮与 radio 选中态，不触碰输入框的值 */
function syncModelActiveState() {
  $$('#modelList .model-item').forEach(it => {
    const on = it.dataset.id === settingsCfg.activeModelId;
    it.classList.toggle('active', on);
    const r = it.querySelector('input[type=radio]');
    if (r) r.checked = on;
  });
}

function collectConfigFromForm() {
  const models = $$('#modelList .model-item').map(item => {
    const get = f => item.querySelector(`[data-f="${f}"]`).value.trim();
    const old = settingsCfg.models.find(x => x.id === item.dataset.id) || {};
    return { id: item.dataset.id || old.id, name: get('name') || get('modelPath') || '未命名模型',
      modelPath: get('modelPath'), baseUrl: get('baseUrl'), apiKey: get('apiKey') };
  });
  // 单选选中的为 active（radio 状态可能已同步到 settingsCfg，这里再兜底读 DOM）
  const checked = $('#modelList .model-item input[type=radio]:checked');
  if (checked) {
    const id = checked.closest('.model-item').dataset.id;
    if (id) settingsCfg.activeModelId = id;
  }
  return {
    baseUrl: $('#cfgBaseUrl').value.trim(),
    apiKey: $('#cfgApiKey').value.trim(),
    uploadUrl: $('#cfgUploadUrl').value.trim(),
    models,
    activeModelId: settingsCfg.activeModelId
  };
}

$('#btnAddModel').addEventListener('click', () => {
  const id = 'model-' + Date.now();
  settingsCfg.models.push({ id, name: '', baseUrl: '', modelPath: '', apiKey: '' });
  settingsCfg.activeModelId = id;
  renderModelList();
});

$('#btnSaveConfig').addEventListener('click', async () => {
  const patch = collectConfigFromForm();
  if (!patch.models.length || !patch.models[0].modelPath) {
    return toast('请至少填写一个模型的接口路径', 'err');
  }
  settingsCfg = await window.api.saveConfig(patch);
  renderModelList();
  renderActiveModelSelect(settingsCfg);
  $('#cfgTip').textContent = '✅ 已保存 ' + fmtTime(new Date().toISOString());
  toast('配置已保存', 'ok');
});

$('#btnOpenDataDir').addEventListener('click', async () => {
  const dir = await window.api.getDataDir();
  await window.api.openPath(dir);
});

/* 调用模型页：当前模型下拉 */
function renderActiveModelSelect(cfg) {
  const sel = $('#activeModel');
  if (!sel) return;
  sel.innerHTML = '';
  (cfg.models || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name || m.modelPath}（${(m.baseUrl || cfg.baseUrl || '').replace(/^https?:\/\//, '')}/${m.modelPath}）`;
    sel.appendChild(opt);
  });
  sel.value = cfg.activeModelId;
}
$('#activeModel')?.addEventListener('change', async e => {
  settingsCfg = await window.api.saveConfig({ activeModelId: e.target.value });
  syncModelActiveState();   // 设置页 radio 同步跟随，避免保存时用过期选中态把模型改回去
  toast('已切换当前模型', 'ok');
});
$('#btnGoSettings')?.addEventListener('click', () => {
  document.querySelector('.nav-item[data-page="settings"]').click();
});

/* ===== 调用模型页：参考图 / 遮罩 ===== */
let refAssets = [];      // 参考图素材数组
let maskAsset = null;    // 遮罩素材

function renderRefs() {
  const list = $('#refList');
  list.innerHTML = '';
  if (refAssets.length === 0) {
    list.innerHTML = '<div class="empty-tip">尚未添加参考图，点击上方按钮上传或从历史选择</div>';
    return;
  }
  refAssets.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `
      <img class="thumb-img" data-asset-id="${esc(a.id)}" data-fallback="${esc(imgSrc(a))}" alt="" decoding="async" />
      <span class="thumb-badge">参考图 ${i + 1}</span>
      <button class="thumb-remove" title="移除">✕</button>
      <div class="thumb-body">
        <div class="thumb-name" title="${esc(a.fileName || a.id)}">${esc(a.fileName || shortId(a.id))}</div>
        <div>${a.type === 'generated' ? '历史生成图' : '上传图'} · ${a.url
          ? '已上传图床'
          : '<button class="thumb-retry" data-act="retry" title="该图尚未上传到图床，点击重试上传">☁️ 重试上传</button>'}</div>
      </div>`;
    const img = card.querySelector('.thumb-img');
    img.addEventListener('error', e => {
      if (e.target.dataset.failed) return;
      e.target.dataset.failed = '1';
      if (e.target.dataset.fallback) e.target.src = e.target.dataset.fallback;
    });
    observeThumb(img);
    card.querySelector('.thumb-remove').addEventListener('click', e => {
      e.stopPropagation();
      refAssets = refAssets.filter(x => x.id !== a.id);
      renderRefs();
    });
    const retry = card.querySelector('.thumb-retry');
    if (retry) retry.addEventListener('click', async e => {
      e.stopPropagation();
      retry.disabled = true;
      retry.textContent = '上传中…';
      try {
        const updated = await window.api.ensureUploaded(a.id);   // 此前是死代码，现在接入
        const cur = refAssets.find(x => x.id === a.id);
        if (cur) Object.assign(cur, updated);
        toast('已补传图床', 'ok');
      } catch (err) {
        toast('重试上传失败：' + (err.message || err), 'err');
        retry.disabled = false;
        retry.textContent = '☁️ 重试上传';
      }
      renderRefs();
    });
    card.addEventListener('click', e => {
      if (e.target.closest('[data-act]')) return;
      openPreview(a);
    });
    list.appendChild(card);
  });
}

function renderMask() {
  const list = $('#maskList');
  list.innerHTML = '';
  if (!maskAsset) {
    list.innerHTML = '<div class="empty-tip">未选择遮罩图（可选）</div>';
    return;
  }
  const card = document.createElement('div');
  card.className = 'thumb';
  card.innerHTML = `
    <img class="thumb-img" src="${esc(imgSrc(maskAsset))}" alt="" />
    <button class="thumb-remove" title="移除">✕</button>
    <div class="thumb-body"><div class="thumb-name">遮罩图</div><div>透明区域为编辑位置</div></div>`;
  card.querySelector('.thumb-remove').addEventListener('click', e => {
    e.stopPropagation();
    maskAsset = null;
    renderMask();
  });
  card.addEventListener('click', () => openPreview(maskAsset));
  list.appendChild(card);
}

$('#btnUploadRef').addEventListener('click', async () => {
  const paths = await window.api.pickImages();
  if (!paths.length) return;
  await importFiles(paths, asset => {
    if (!refAssets.some(x => x.id === asset.id)) refAssets.push(asset);
  });
  renderRefs();
});

$('#btnClearRefs').addEventListener('click', () => { refAssets = []; renderRefs(); });

$('#btnPickMask').addEventListener('click', async () => {
  const p = await window.api.pickMask();
  if (!p) return;
  const results = await window.api.importFiles([p]);
  const ok = results.find(r => r.ok);
  if (!ok) { toast('遮罩图导入失败：' + (results[0]?.error || '未知错误'), 'err'); return; }
  maskAsset = ok.asset;
  renderMask();
  if (ok.warning) toast('遮罩图已保存但上传图床失败：' + ok.warning, 'err');
});
$('#btnClearMask').addEventListener('click', () => { maskAsset = null; renderMask(); });

async function importFiles(paths, onAsset) {
  toast('正在上传图片…');
  const results = await window.api.importFiles(paths);
  let okCount = 0;
  const warnings = [];
  for (const r of results) {
    if (r.ok) { okCount++; if (onAsset) onAsset(r.asset); if (r.warning) warnings.push(r.warning); }
    else toast(`「${r.fileName}」上传失败：${r.error}`, 'err');
  }
  if (okCount) toast(`成功导入 ${okCount} 张图片`, 'ok');
  if (warnings.length) toast('部分图片上传图床失败，可稍后重试：' + warnings[0], 'err');
  return results;
}

/* ===== 历史素材选择弹窗 ===== */
let pickerTab = 'upload';
let pickerSelected = new Set();
let pickerOnConfirm = null;

async function openPicker(onConfirm) {
  pickerSelected = new Set();
  pickerOnConfirm = onConfirm;
  $('#pickerModal').hidden = false;
  $$('#pickerModal [data-ptab]').forEach(b => b.classList.toggle('active', b.dataset.ptab === pickerTab));
  await loadPickerGrid();
}
async function loadPickerGrid() {
  const grid = $('#pickerGrid');
  grid.innerHTML = '<div class="empty-tip">加载中…</div>';
  const assets = await window.api.listAssets(pickerTab);
  grid.innerHTML = '';
  if (!assets.length) {
    grid.innerHTML = `<div class="empty-tip">暂无${pickerTab === 'upload' ? '上传' : '生成'}素材，可先在「调用模型」页上传图片</div>`;
    return;
  }
  assets.forEach(a => grid.appendChild(buildPickerCard(a)));
  updatePickerCount();
}
function buildPickerCard(a) {
  const card = document.createElement('div');
  card.className = 'thumb' + (pickerSelected.has(a.id) ? ' selected' : '');
  const sub = a.type === 'generated'
    ? `生成图 · ${esc((a.prompt || '').slice(0, 24) || '无提示词')}`
    : `上传图 · ${fmtSize(a.size)}`;
  card.innerHTML = `
    <img class="thumb-img" data-asset-id="${esc(a.id)}" data-fallback="${esc(imgSrc(a))}" alt="" decoding="async" />
    <span class="thumb-badge ${a.type === 'generated' ? 'gen' : ''}">${a.type === 'generated' ? '生成' : '上传'}</span>
    <span class="thumb-check">✓</span>
    <div class="thumb-body">
      <div class="thumb-name" title="${esc(a.fileName || a.id)}">${esc(a.fileName || shortId(a.id))}</div>
      <div title="${esc(a.id)}">ID: ${esc(shortId(a.id))} · ${fmtTime(a.createdAt)}</div>
      <div>${sub}</div>
    </div>`;
  const img = card.querySelector('.thumb-img');
  img.addEventListener('error', e => {
    if (e.target.dataset.failed) return;
    e.target.dataset.failed = '1';
    if (e.target.dataset.fallback) e.target.src = e.target.dataset.fallback;
  });
  observeThumb(img);
  card.addEventListener('click', () => {
    if (pickerSelected.has(a.id)) pickerSelected.delete(a.id);
    else pickerSelected.add(a.id);
    card.classList.toggle('selected', pickerSelected.has(a.id));
    updatePickerCount();
  });
  return card;
}
function updatePickerCount() {
  $('#pickerCount').textContent = `已选 ${pickerSelected.size} 张`;
}
$$('#pickerModal [data-ptab]').forEach(btn => {
  btn.addEventListener('click', () => {
    pickerTab = btn.dataset.ptab;
    $$('#pickerModal [data-ptab]').forEach(b => b.classList.toggle('active', b === btn));
    loadPickerGrid();
  });
});
$('#btnPickerConfirm').addEventListener('click', async () => {
  if (pickerSelected.size === 0) { toast('请至少选择一张图片'); return; }
  const added = [];
  for (const id of pickerSelected) {
    const a = await window.api.getAsset(id);
    if (a && !refAssets.some(x => x.id === id)) { refAssets.push(a); added.push(a); }
  }
  $('#pickerModal').hidden = true;
  renderRefs();
  toast(`已添加 ${added.length} 张参考图`, 'ok');
  if (pickerOnConfirm) { pickerOnConfirm(added); pickerOnConfirm = null; }
});
$('#btnPickHistory').addEventListener('click', () => openPicker());

/* ===== 生成 ===== */
$('#prompt').addEventListener('input', e => {
  $('#promptCount').textContent = e.target.value.length;
});

const offProgress = window.api.onProgress(msg => {
  const el = $('#genProgress');
  el.className = 'progress working';
  el.textContent = '⏳ ' + msg;
});
window.addEventListener('beforeunload', offProgress);

$('#btnGenerate').addEventListener('click', async () => {
  const prompt = $('#prompt').value.trim();
  if (refAssets.length === 0) return toast('请先添加至少一张参考图', 'err');
  if (!prompt) return toast('请填写提示词', 'err');

  const params = {
    size: $('#paramSize').value,
    quality: $('#paramQuality').value,
    n: Math.min(10, Math.max(1, Number($('#paramN').value) || 1)),
    background: $('#paramBackground').value,
    output_format: $('#paramFormat').value
  };

  const btn = $('#btnGenerate');
  btn.disabled = true;
  const el = $('#genProgress');
  el.className = 'progress working';
  el.textContent = '⏳ 开始…';
  try {
    const res = await window.api.generate({
      refAssetIds: refAssets.map(a => a.id),
      maskAssetId: maskAsset ? maskAsset.id : null,
      prompt,
      params
    });
    el.className = 'progress';
    el.textContent = `✅ 完成，本次生成 ${res.images.length} 张图片，已保存到历史素材`;
    toast(`生成成功，共 ${res.images.length} 张`, 'ok');
    renderResults(res.images);
  } catch (e) {
    el.className = 'progress error';
    el.textContent = '❌ ' + (e.message || e);
    toast('生成失败', 'err');
  } finally {
    btn.disabled = false;
  }
});

function renderResults(images) {
  $('#resultCard').style.display = '';
  $('#resultMeta').textContent = `共 ${images.length} 张 · 批次 ${shortId(images[0]?.batchId)}`;
  const grid = $('#resultList');
  grid.innerHTML = '';
  images.forEach(a => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `
      <img class="thumb-img" src="${esc(imgSrc(a))}" alt="" />
      <span class="thumb-badge gen">生成图</span>
      <div class="thumb-body">
        <div class="thumb-name" title="${esc(a.id)}">ID: ${esc(shortId(a.id))}</div>
        <div>${fmtTime(a.createdAt)}</div>
      </div>
      <div class="thumb-actions">
        <button data-act="preview">预览</button>
        <button data-act="folder">文件夹</button>
        <button data-act="copy" class="danger">复制路径</button>
      </div>`;
    card.addEventListener('click', e => {
      const act = e.target.dataset?.act;
      if (act === 'folder') return window.api.showItem(a.localPath);
      if (act === 'copy') { window.api.copyText(a.localPath); return toast('本地路径已复制', 'ok'); }
      openPreview(a);
    });
    grid.appendChild(card);
  });
}

/* ===== 自绘确认弹窗（替代原生 confirm） ===== */
function askConfirm({ title = '确认', msg, detail = '', fileOptions = false }) {
  return new Promise(resolve => {
    const modal = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = msg;
    const dEl = $('#confirmDetail');
    dEl.textContent = detail;
    dEl.hidden = !detail;
    $('#confirmOpts').hidden = !fileOptions;
    if (fileOptions) $('#confirmModal input[name=delOpt][value=record]').checked = true;
    modal.hidden = false;
    const done = val => {
      modal.hidden = true;
      $('#btnConfirmOk').onclick = null; $('#btnConfirmCancel').onclick = null; $('#btnConfirmX').onclick = null;
      resolve(val);
    };
    $('#btnConfirmOk').onclick = () => {
      const opt = fileOptions ? $('#confirmModal input[name=delOpt]:checked')?.value : 'files';
      done({ ok: true, alsoDeleteFiles: opt === 'files' });
    };
    $('#btnConfirmCancel').onclick = () => done({ ok: false });
    $('#btnConfirmX').onclick = () => done({ ok: false });
  });
}

/* ===== 缩略图懒加载：可见时才请求 480px 缩略图，失败/无缓存回退原图 ===== */
const thumbObserver = new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    thumbObserver.unobserve(en.target);
    hydrateThumb(en.target);
  }
}, { rootMargin: '200px' });

async function hydrateThumb(img) {
  const id = img.dataset.assetId;
  if (!id) return;
  const fallback = img.dataset.fallback || '';
  try {
    const p = await window.api.thumbnail(id);
    img.src = p ? window.api.toFileUrl(p) : fallback;
  } catch {
    if (fallback) img.src = fallback;
  }
  img.decode?.().catch(() => {});
}
function observeThumb(img) { thumbObserver.observe(img); }

/* ===== 历史素材页 ===== */
let historyTab = 'upload';
let historyAll = [];          // 当前分类的全部素材（已按搜索/排序过滤）
let historyRendered = 0;      // 已渲染数量
const PAGE_SIZE = 60;
let batchMode = false;
let batchSelected = new Set();
let historySearchTimer = null;

$$('#page-history [data-htab]').forEach(btn => {
  btn.addEventListener('click', () => {
    historyTab = btn.dataset.htab;
    $$('#page-history [data-htab]').forEach(b => b.classList.toggle('active', b === btn));
    loadHistory();
  });
});
$('#btnRefreshHistory').addEventListener('click', loadHistory);

$('#historySearch').addEventListener('input', () => {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => renderHistoryPage(true), 250);
});
$('#historySort').addEventListener('change', () => renderHistoryPage(true));

$('#btnBatchMode').addEventListener('click', () => {
  batchMode = !batchMode;
  batchSelected.clear();
  $('#batchBar').hidden = !batchMode;
  $('#btnBatchMode').classList.toggle('primary', batchMode);
  updateBatchCount();
  renderHistoryPage(true);
});
$('#btnBatchExit').addEventListener('click', () => $('#btnBatchMode').click());
$('#btnBatchSelectAll').addEventListener('click', () => {
  historyAll.slice(0, historyRendered).forEach(a => batchSelected.add(a.id));
  $$('#historyGrid .thumb').forEach(c => c.classList.add('selected'));
  updateBatchCount();
});
$('#btnBatchDelete').addEventListener('click', async () => {
  if (!batchSelected.size) return toast('请先勾选要删除的素材', 'err');
  const r = await askConfirm({
    title: '批量删除素材',
    msg: `确定删除选中的 ${batchSelected.size} 项素材吗？`,
    detail: '删除后不可恢复。',
    fileOptions: true
  });
  if (!r.ok) return;
  await window.api.deleteMany([...batchSelected], { alsoDeleteFiles: r.alsoDeleteFiles });
  toast(`已删除 ${batchSelected.size} 项${r.alsoDeleteFiles ? '（含本地文件）' : ''}`, 'ok');
  batchSelected.clear();
  loadHistory();
});

function updateBatchCount() {
  $('#batchCount').textContent = `已选 ${batchSelected.size} 项`;
}

async function loadHistory() {
  const grid = $('#historyGrid');
  grid.innerHTML = '<div class="empty-tip">加载中…</div>';
  historyAll = await window.api.listAssets(historyTab);
  renderHistoryPage(true);
}

function filteredHistoryAssets() {
  const q = $('#historySearch').value.trim().toLowerCase();
  let list = historyAll;
  if (q) {
    list = list.filter(a =>
      (a.prompt || '').toLowerCase().includes(q) ||
      (a.fileName || '').toLowerCase().includes(q) ||
      (a.id || '').toLowerCase().includes(q));
  }
  const sort = $('#historySort').value;
  list = [...list];
  if (sort === 'time-asc') list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  else if (sort === 'name-asc') list.sort((a, b) => ((a.fileName || a.prompt || a.id) + '').localeCompare((b.fileName || b.prompt || b.id) + ''));
  else list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

function renderHistoryPage(reset) {
  const grid = $('#historyGrid');
  if (reset) { grid.innerHTML = ''; historyRendered = 0; }
  const list = filteredHistoryAssets();
  if (!list.length) {
    const q = $('#historySearch').value.trim();
    grid.innerHTML = `<div class="empty-tip">${q ? '没有匹配「' + esc(q) + '」的素材' : '暂无' + (historyTab === 'upload' ? '上传' : '生成') + '素材'}</div>`;
    $('#loadSentinel').hidden = true;
    return;
  }
  const next = list.slice(historyRendered, historyRendered + PAGE_SIZE);
  next.forEach(a => grid.appendChild(buildHistoryCard(a)));
  historyRendered += next.length;
  $('#loadSentinel').hidden = historyRendered >= list.length;
}

/* 滚动到底自动加载下一页 */
const pageEl = $('#page-history');
$('#loadSentinel') && new IntersectionObserver(entries => {
  if (entries.some(e => e.isIntersecting)) renderHistoryPage(false);
}, { root: document.querySelector('.main'), rootMargin: '300px' }).observe($('#loadSentinel'));

function buildHistoryCard(a) {
  const card = document.createElement('div');
  card.className = 'thumb' + (batchMode && batchSelected.has(a.id) ? ' selected' : '');
  const isGen = a.type === 'generated';
  const promptShort = esc((a.prompt || '').slice(0, 40)) || '—';
  const sub = isGen
    ? `<div class="t-sub" title="${esc(a.prompt || '')}">提示词：${promptShort}</div>
       <div class="t-meta">参考图 ${(a.refImages || []).length} 张 · ${esc(a.params?.size || '')} · ${esc(a.params?.quality || '')}</div>`
    : `<div class="t-sub">${esc(a.fileName || '')}</div><div class="t-meta">${fmtSize(a.size)} · ${a.url ? '已上传图床' : '仅本地'}</div>`;
  card.innerHTML = `
    <img class="thumb-img" data-asset-id="${esc(a.id)}" data-fallback="${esc(imgSrc(a))}" alt="" decoding="async" />
    <span class="thumb-badge ${isGen ? 'gen' : ''}">${isGen ? '生成' : '上传'}</span>
    ${batchMode ? '<span class="thumb-check">✓</span>' : ''}
    <div class="thumb-body">
      <div class="thumb-name" title="${esc(a.id)}">ID: ${esc(shortId(a.id))}</div>
      <div class="t-meta">${fmtTime(a.createdAt)}</div>
      ${sub}
    </div>
    <div class="thumb-actions">
      <button data-act="preview">详情</button>
      <button data-act="folder">文件夹</button>
      <button data-act="del" class="danger">删除</button>
    </div>`;
  card.querySelector('.thumb-img').addEventListener('error', e => {
    const img = e.target;
    if (!img.src || img.dataset.failed) return;
    img.dataset.failed = '1';
    if (img.dataset.fallback) img.src = img.dataset.fallback;
  });
  observeThumb(card.querySelector('.thumb-img'));
  card.addEventListener('click', async e => {
    if (batchMode) {
      // 批量模式：点卡片勾选；点操作按钮走按钮语义
      const btn = e.target.closest('[data-act]');
      if (btn) {
        e.stopPropagation();
        if (btn.dataset.act === 'del') return deleteSingleAsset(a);
        if (btn.dataset.act === 'folder') return window.api.showItem(a.localPath);
        return openPreview(a);
      }
      if (batchSelected.has(a.id)) batchSelected.delete(a.id); else batchSelected.add(a.id);
      card.classList.toggle('selected', batchSelected.has(a.id));
      updateBatchCount();
      return;
    }
    const btn = e.target.closest('[data-act]');
    const act = btn ? btn.dataset.act : null;
    if (act === 'folder') return window.api.showItem(a.localPath);
    if (act === 'del') return deleteSingleAsset(a);
    openPreview(a);
  });
  return card;
}

async function deleteSingleAsset(a) {
  const r = await askConfirm({
    title: '删除素材',
    msg: '确定删除该素材吗？',
    detail: a.localPath ? `文件：${a.localPath}` : '',
    fileOptions: true
  });
  if (!r.ok) return;
  await window.api.deleteMany([a.id], { alsoDeleteFiles: r.alsoDeleteFiles });
  toast('已删除', 'ok');
  loadHistory();
}

/* ===== 大图预览 / 详情 ===== */
function openPreview(a) {
  $('#previewImg').src = imgSrc(a);
  $('#previewTitle').textContent = a.type === 'generated' ? `生成图 ${shortId(a.id)}` : `上传图 ${shortId(a.id)}`;
  const meta = $('#previewMeta');
  const rows = [];
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`;
  rows.push(row('素材 ID', esc(a.id)));
  rows.push(row('类型', a.type === 'generated' ? '生成图片' : '上传图片'));
  rows.push(row('本地路径', `<a href="#" data-act="folder" style="color:var(--primary)">${esc(a.localPath)}</a>`));
  if (a.url) rows.push(row('在线 URL', `<a href="#" data-act="url" style="color:var(--primary)">${esc(a.url)}</a>`));
  rows.push(row('创建时间', esc(fmtTime(a.createdAt))));
  if (a.type === 'upload') {
    rows.push(row('文件名', esc(a.fileName || '—')));
    rows.push(row('大小', fmtSize(a.size)));
  }
  if (a.type === 'generated') {
    rows.push(row('提示词', esc(a.prompt || '—')));
    rows.push(row('生成参数', esc(`尺寸 ${a.params?.size || ''}｜质量 ${a.params?.quality || ''}｜数量 ${a.params?.n || ''}｜背景 ${a.params?.background || ''}｜格式 ${a.params?.output_format || ''}`)));
    rows.push(row('模型接口', esc(a.model || '—')));
    rows.push(row('批次 ID', esc(a.batchId || '—')));
    const refs = (a.refImages || []).map((r, i) =>
      `参考图${i + 1}：ID ${esc(r.id)}<br/>&nbsp;&nbsp;&nbsp;&nbsp;路径 ${esc(r.localPath)}`
    ).join('<br/>');
    rows.push(row('参考图', refs || '—'));
    if (a.maskImage) rows.push(row('遮罩图', `ID ${esc(a.maskImage.id)}<br/>&nbsp;&nbsp;&nbsp;&nbsp;路径 ${esc(a.maskImage.localPath)}`));
  }
  meta.innerHTML = rows.join('') + `
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small" data-act="folder2">📁 打开所在文件夹</button>
      <button class="btn small" data-act="copypath">📋 复制本地路径</button>
      ${a.url ? '<button class="btn small" data-act="copyurl">🔗 复制在线 URL</button>' : ''}
    </div>`;
  meta.onclick = e => {
    const act = e.target.dataset?.act || e.target.closest('[data-act]')?.dataset?.act;
    if (!act) return;
    if (act === 'folder' || act === 'folder2') window.api.showItem(a.localPath);
    if (act === 'url') window.api.openExternal(a.url);
    if (act === 'copypath') { window.api.copyText(a.localPath); toast('本地路径已复制', 'ok'); }
    if (act === 'copyurl') { window.api.copyText(a.url); toast('在线 URL 已复制', 'ok'); }
  };
  $('#previewModal').hidden = false;
}

$$('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => { $('#' + btn.dataset.close).hidden = true; });
});
$$('.modal-mask').forEach(mask => {
  mask.addEventListener('click', e => { if (e.target === mask) mask.hidden = true; });
});

/* ===== 初始化 ===== */
loadConfig();
renderRefs();
renderMask();
