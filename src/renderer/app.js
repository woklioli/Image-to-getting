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
      <img class="thumb-img" src="${esc(imgSrc(a))}" alt="" />
      <span class="thumb-badge">参考图 ${i + 1}</span>
      <button class="thumb-remove" title="移除">✕</button>
      <div class="thumb-body">
        <div class="thumb-name" title="${esc(a.fileName || a.id)}">${esc(a.fileName || shortId(a.id))}</div>
        <div>${a.type === 'generated' ? '历史生成图' : '上传图'} · ${a.url ? '已上传图床' : '未上传'}</div>
      </div>`;
    card.querySelector('.thumb-remove').addEventListener('click', e => {
      e.stopPropagation();
      refAssets = refAssets.filter(x => x.id !== a.id);
      renderRefs();
    });
    card.addEventListener('click', () => openPreview(a));
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
    <img class="thumb-img" src="${esc(imgSrc(a))}" alt="" />
    <span class="thumb-badge ${a.type === 'generated' ? 'gen' : ''}">${a.type === 'generated' ? '生成' : '上传'}</span>
    <span class="thumb-check">✓</span>
    <div class="thumb-body">
      <div class="thumb-name" title="${esc(a.fileName || a.id)}">${esc(a.fileName || shortId(a.id))}</div>
      <div title="${esc(a.id)}">ID: ${esc(shortId(a.id))} · ${fmtTime(a.createdAt)}</div>
      <div>${sub}</div>
    </div>`;
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

/* ===== 历史素材页 ===== */
let historyTab = 'upload';
$$('#page-history [data-htab]').forEach(btn => {
  btn.addEventListener('click', () => {
    historyTab = btn.dataset.htab;
    $$('#page-history [data-htab]').forEach(b => b.classList.toggle('active', b === btn));
    loadHistory();
  });
});
$('#btnRefreshHistory').addEventListener('click', loadHistory);

async function loadHistory() {
  const grid = $('#historyGrid');
  grid.innerHTML = '<div class="empty-tip">加载中…</div>';
  const assets = await window.api.listAssets(historyTab);
  grid.innerHTML = '';
  if (!assets.length) {
    grid.innerHTML = `<div class="empty-tip">暂无${historyTab === 'upload' ? '上传' : '生成'}素材</div>`;
    return;
  }
  assets.forEach(a => grid.appendChild(buildHistoryCard(a)));
}

function buildHistoryCard(a) {
  const card = document.createElement('div');
  card.className = 'thumb';
  const isGen = a.type === 'generated';
  const sub = isGen
    ? `<div title="${esc(a.prompt || '')}">提示词：${esc((a.prompt || '').slice(0, 40)) || '—'}</div>
       <div>参考图 ${(a.refImages || []).length} 张 · ${esc(a.params?.size || '')} · ${esc(a.params?.quality || '')}</div>`
    : `<div>${esc(a.fileName || '')}</div><div>${fmtSize(a.size)} · ${a.url ? '已上传图床' : '仅本地'}</div>`;
  card.innerHTML = `
    <img class="thumb-img" src="${esc(imgSrc(a))}" alt="" />
    <span class="thumb-badge ${isGen ? 'gen' : ''}">${isGen ? '生成' : '上传'}</span>
    <div class="thumb-body">
      <div class="thumb-name" title="${esc(a.id)}">ID: ${esc(shortId(a.id))}</div>
      <div>${fmtTime(a.createdAt)}</div>
      ${sub}
    </div>
    <div class="thumb-actions">
      <button data-act="preview">详情</button>
      <button data-act="folder">文件夹</button>
      <button data-act="del" class="danger">删除</button>
    </div>`;
  card.addEventListener('click', async e => {
    const act = e.target.dataset?.act;
    if (act === 'folder') return window.api.showItem(a.localPath);
    if (act === 'del') {
      if (!confirm(`确定删除该素材记录吗？\n（会同时删除本地图片文件：${a.localPath}）`)) return;
      await window.api.deleteAsset(a.id);
      toast('已删除', 'ok');
      loadHistory();
      return;
    }
    openPreview(a);
  });
  return card;
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
