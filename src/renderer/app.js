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
  el.className = 'toast' + (type ? ' ' + type : '');   // #toast 的 id 不可改（此处整体覆写 className）
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/* 内联 SVG 精灵引用（CSP 禁 url()，SVG 只能进 DOM） */
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
/* 统一空状态：图标 + 说明 + 可选引导 */
function emptyTip(iconName, text, sub = '') {
  return `<div class="empty-tip">${icon(iconName)}<div>${text}</div>${sub ? `<span class="hint">${sub}</span>` : ''}</div>`;
}
/* 骨架屏占位（加载期消除布局跳动） */
function skeletons(n) {
  return Array.from({ length: n }, () =>
    '<div class="skeleton" aria-hidden="true"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line w60"></div><div class="sk-line w40"></div></div>').join('');
}

/* ===== 导航 ===== */
function goToPage(page) {
  $$('.nav-item').forEach(b => {
    const on = b.dataset.page === page;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'history') loadHistory();
}
$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => goToPage(btn.dataset.page));
});

/* ===== 主题（system|light|dark） =====
   深色 token 在 styles.css 两处成对定义（跟随系统 + 手动开关）；这里只负责
   data-theme 属性、分段按钮状态、持久化，以及让主进程同步窗口底色（消灭深色启动闪白）。 */
function applyTheme(t) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $$('#themeSegment button').forEach(b => {
    const on = b.dataset.themeVal === t;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
async function initTheme() {
  try { applyTheme(await window.api.getTheme()); } catch { /* 旧版主进程无此接口：保持 system */ }
  if (window.api.onThemeChanged) window.api.onThemeChanged(applyTheme);
}
$$('#themeSegment button').forEach(b => {
  b.addEventListener('click', async () => {
    applyTheme(b.dataset.themeVal);                  // 先立即应用，再落盘
    try { await window.api.setTheme(b.dataset.themeVal); } catch { /* 同上 */ }
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
        <button class="btn ghost small model-del" aria-label="删除模型 ${esc(m.name || m.modelPath)}">${icon('trash')} 删除</button>
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
      askConfirm({ title: '删除模型', msg: `确定删除模型「${m.name || m.modelPath}」吗？`, detail: '仅删除配置项，不影响已生成的素材。' })
        .then(r => {
          if (!r.ok) return;
          settingsCfg.models = settingsCfg.models.filter(x => x.id !== m.id);
          if (settingsCfg.activeModelId === m.id) settingsCfg.activeModelId = settingsCfg.models[0].id;
          renderModelList();
          renderActiveModelSelect(settingsCfg);
        });
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
  $('#cfgTip').innerHTML = icon('check') + ' 已保存 ' + fmtTime(new Date().toISOString());
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
    list.innerHTML = emptyTip('image', '尚未添加参考图', '点击上方按钮上传，或直接拖入图片 / Ctrl·Cmd+V 粘贴');
    return;
  }
  refAssets.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'thumb';
    card.innerHTML = `
      <img class="thumb-img" data-asset-id="${esc(a.id)}" data-fallback="${esc(imgSrc(a))}" alt="" decoding="async" />
      <span class="thumb-badge">参考图 ${i + 1}</span>
      <button class="thumb-remove" aria-label="移除参考图">${icon('x')}</button>
      <div class="thumb-body">
        <div class="thumb-name" title="${esc(a.fileName || a.id)}">${esc(a.fileName || shortId(a.id))}</div>
        <div>${a.type === 'generated' ? '历史生成图' : '上传图'} · ${a.url
          ? '已上传图床'
          : `<button class="thumb-retry" data-act="retry" title="该图尚未上传到图床，点击重试上传">${icon('cloud-up')} 重试上传</button>`}</div>
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
        retry.innerHTML = icon('cloud-up') + ' 重试上传';
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
    list.innerHTML = emptyTip('image', '未选择遮罩图（可选）', '带 alpha 的 PNG，透明区域将被重绘');
    return;
  }
  const card = document.createElement('div');
  card.className = 'thumb';
  card.innerHTML = `
    <img class="thumb-img" src="${esc(imgSrc(maskAsset))}" alt="" />
    <button class="thumb-remove" aria-label="移除遮罩图">${icon('x')}</button>
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

/* ===== 全局拖拽上传 + 剪贴板粘贴 ===== */
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
let dragDepth = 0;

function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}
function showDropOverlay(on) {
  const ov = $('#dropOverlay');
  if (ov) ov.hidden = !on;
  $('#refCard')?.classList.toggle('drop-hint', !!on);
  $('#maskCard')?.classList.toggle('drop-hint', !!on);
}
/* 落点在哪张卡片内：遮罩卡片 → 设为遮罩；其余 → 参考图。
   覆盖层 pointer-events:none，elementFromPoint 命中的是真实元素。 */
function cardAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest?.('#maskCard') ? 'mask' : 'ref';
}

/* 拖入路径集合的落地逻辑（与事件解耦，便于测试）：弹窗中忽略；ref 目标自动切调用页 */
async function importDroppedPaths(paths, x, y) {
  if (!paths.length) return;
  const modalOpen = ['#pickerModal', '#confirmModal', '#previewModal'].some(sel => {
    const m = $(sel);
    return m && !m.hidden;
  });
  if (modalOpen) return;
  const target = cardAt(x, y);
  if (target === 'ref' && document.querySelector('.page.active')?.id !== 'page-generate') {
    goToPage('generate');             // 任意页拖入 → 自动切到调用页
  }
  await addImagePaths(paths, target);
}

document.addEventListener('dragenter', e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  showDropOverlay(true);
});
document.addEventListener('dragover', e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();                 // 必须阻止默认，否则 drop 会变成页面导航
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', e => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) showDropOverlay(false);
});
document.addEventListener('drop', async e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();                 // 兜底：拖到空白处也不离开页面
  showDropOverlay(false);
  dragDepth = 0;
  const { paths, rejected } = pathsFromFiles(Array.from(e.dataTransfer?.files || []));
  rejectToast(rejected);
  await importDroppedPaths(paths, e.clientX, e.clientY);   // 弹窗中/无可导入文件时在内部忽略
});

/* 把一组本地图片路径加入参考图或遮罩（拖拽与粘贴共用） */
async function addImagePaths(paths, target) {
  if (target === 'mask') {
    const results = await window.api.importFiles([paths[0]]);
    const ok = results.find(r => r.ok);
    if (!ok) { toast('图片导入失败：' + (results[0]?.error || '未知错误'), 'err'); return false; }
    maskAsset = ok.asset;
    renderMask();
    toast(paths.length > 1 ? `遮罩仅取第 1 张（忽略 ${paths.length - 1} 张）` : '已设为遮罩图', 'ok');
    if (ok.warning) toast('遮罩图已保存但上传图床失败：' + ok.warning, 'err');
    return true;
  }
  await importFiles(paths, a => { if (!refAssets.some(x => x.id === a.id)) refAssets.push(a); });
  renderRefs();
  return true;
}

/* File[] → 合法本地图片路径（Electron 33 走 webUtils）。rejected 由调用方决定是否提示：
   拖拽要报「格式不支持」，粘贴截图时 clipboardData.files 本就是空的，不该打扰用户。 */
function pathsFromFiles(files) {
  const paths = [];
  const rejected = [];
  for (const f of files) {
    // 从浏览器/其他应用拖入的「虚拟文件」没有本地路径，getPathForFile 会抛错
    let p = '';
    try { p = window.api.getPathForFile(f) || ''; } catch { p = ''; }
    if (p && IMG_EXT_RE.test(p)) paths.push(p);
    else rejected.push(f.name || p || '未知文件');
  }
  return { paths, rejected };
}
function rejectToast(rejected) {
  if (!rejected.length) return;
  toast(`仅支持 PNG/JPEG/WebP/GIF，已忽略：${rejected.slice(0, 3).join('、')}${rejected.length > 3 ? ` 等 ${rejected.length} 项` : ''}`, 'err');
}

document.addEventListener('paste', async e => {
  const t = e.target;
  const genActive = document.querySelector('.page.active')?.id === 'page-generate';
  if (!genActive && !t?.closest?.('#page-generate')) return;
  if (e.clipboardData?.getData('text')) return;   // 有文字 ⇒ 粘贴文本，不拦截默认行为
  e.preventDefault();
  const target = t?.closest?.('#maskCard') ? 'mask' : 'ref';
  // 优先用 paste 事件自带的文件（从访达/资源管理器复制的文件），
  // 没有再读系统剪贴板位图（截图），避免误取文件图标缩略图
  let { paths } = pathsFromFiles(Array.from(e.clipboardData?.files || []));
  if (!paths.length) {
    const p = await window.api.pasteImage();
    if (p) paths = [p];
  }
  if (!paths.length) { toast('剪贴板里没有图片 — 可先截图再粘贴，或拖拽文件'); return; }
  await addImagePaths(paths, target);
});

/* ===== 历史素材选择弹窗 ===== */
let pickerTab = 'upload';
let pickerSelected = new Set();
let pickerOnConfirm = null;

async function openPicker(onConfirm) {
  pickerSelected = new Set();
  pickerOnConfirm = onConfirm;
  openModal('#pickerModal');
  $$('#pickerModal [data-ptab]').forEach(b => b.classList.toggle('active', b.dataset.ptab === pickerTab));
  await loadPickerGrid();
}
async function loadPickerGrid() {
  const grid = $('#pickerGrid');
  grid.innerHTML = skeletons(8);
  const assets = await window.api.listAssets(pickerTab);
  grid.innerHTML = '';
  if (!assets.length) {
    grid.innerHTML = emptyTip('archive', `暂无${pickerTab === 'upload' ? '上传' : '生成'}素材`, '可先在「调用模型」页上传图片');
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
    <span class="thumb-check"></span>
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
  closeModal('#pickerModal');
  renderRefs();
  toast(`已添加 ${added.length} 张参考图`, 'ok');
  if (pickerOnConfirm) { pickerOnConfirm(added); pickerOnConfirm = null; }
});
$('#btnPickHistory').addEventListener('click', () => openPicker());

/* ===== 生成 ===== */
$('#prompt').addEventListener('input', e => {
  $('#promptCount').textContent = e.target.value.length;
});

/* 进度：主进程推 {stage, elapsed}，渲染层再按秒自刷耗时，两路互补 */
let genRunning = false;
let genJobId = null;
let genStart = 0;
let genElapsedTimer = null;
let lastStage = '';

function setProgress(cls, stage, elapsed) {
  const el = $('#genProgress');
  el.className = 'progress' + (cls ? ' ' + cls : '');
  $('#genStage').textContent = stage || '';
  $('#genElapsed').textContent = elapsed != null && stage ? `（${elapsed.toFixed(1)}s）` : '';
}

const offProgress = window.api.onProgress(p => {
  // 兼容：万一收到旧式字符串
  const msg = typeof p === 'string' ? { stage: p, elapsed: null } : (p || {});
  if (msg.stage) lastStage = msg.stage;
  setProgress('working', lastStage, msg.elapsed ?? undefined);
});
window.addEventListener('beforeunload', offProgress);

function startElapsedTicker() {
  stopElapsedTicker();
  genElapsedTimer = setInterval(() => {
    if (lastStage) setProgress('working', lastStage, (Date.now() - genStart) / 1000);
  }, 1000);
}
function stopElapsedTicker() {
  if (genElapsedTimer) { clearInterval(genElapsedTimer); genElapsedTimer = null; }
}

function setGenUI(running) {
  genRunning = running;
  $('#btnGenerate').disabled = running;
  $('#genStop').hidden = !running;
}

$('#genStop').addEventListener('click', async () => {
  if (!genJobId) return;
  $('#genStop').disabled = true;
  setProgress('working', '正在停止…');
  try { await window.api.cancelGenerate(genJobId); } catch { /* 主进程异常时靠 generate 的 settle 收尾 */ }
});

$('#btnGenerate').addEventListener('click', async () => {
  if (genRunning) return;   // 防重复点击
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

  genJobId = 'job-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  genStart = Date.now();
  lastStage = '开始…';
  setGenUI(true);
  setProgress('working', '开始…', 0);
  startElapsedTicker();
  try {
    const res = await window.api.generate({
      jobId: genJobId,
      refAssetIds: refAssets.map(a => a.id),
      maskAssetId: maskAsset ? maskAsset.id : null,
      prompt,
      params
    });
    const secs = ((Date.now() - genStart) / 1000).toFixed(1);
    if (res && res.canceled) {
      // 取消不是错误：灰色文案；已落盘的部分照常展示
      if (res.images && res.images.length) {
        setProgress('canceled', `已取消，本次生成 ${res.images.length} 张已保存`);
        toast(`已停止，保留 ${res.images.length} 张已生成图片`, 'ok');
        renderResults(res.images);
      } else {
        setProgress('canceled', '已取消生成');
        toast('已取消生成');
      }
    } else {
      setProgress('', `完成（${secs}s），本次生成 ${res.images.length} 张图片，已保存到历史素材`);
      toast(`生成成功，共 ${res.images.length} 张`, 'ok');
      renderResults(res.images);
    }
  } catch (e) {
    setProgress('error', e.message || e);
    toast('生成失败', 'err');
  } finally {
    stopElapsedTicker();
    setGenUI(false);
    $('#genStop').disabled = false;
    genJobId = null;
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
        <button data-act="reuse">${icon('reuse')} 复用</button>
        <button data-act="folder">文件夹</button>
        <button data-act="copy" class="danger">复制路径</button>
      </div>`;
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      const act = btn ? btn.dataset.act : null;
      if (act === 'folder') return window.api.showItem(a.localPath);
      if (act === 'copy') { window.api.copyText(a.localPath); return toast('本地路径已复制', 'ok'); }
      if (act === 'reuse') return reuseParams(a);
      openPreview(a, images);
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
    openModal('#confirmModal');
    const done = val => {
      closeModal('#confirmModal');
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
    $$('#page-history [data-htab]').forEach(b => {
      b.classList.toggle('active', b === btn);
      if (b === btn) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
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
  grid.innerHTML = skeletons(8);
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
    grid.innerHTML = q
      ? emptyTip('search', `没有匹配「${esc(q)}」的素材`, '换个关键词，或清空搜索框')
      : emptyTip('archive', `暂无${historyTab === 'upload' ? '上传' : '生成'}素材`,
          historyTab === 'upload' ? '在「调用模型」页上传的参考图会出现在这里' : '生成记录会自动出现在这里');
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
    ${batchMode ? '<span class="thumb-check"></span>' : ''}
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
        return openPreview(a, filteredHistoryAssets().slice(0, historyRendered));
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
    openPreview(a, filteredHistoryAssets().slice(0, historyRendered));
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

/* ===== 复用参数：把生成图记录的 prompt/params/refs/mask/model 回填调用页 ===== */
async function reuseParams(a) {
  if (!a || a.type !== 'generated') return toast('仅生成图可复用参数', 'err');
  // 始终读最新配置：模型列表可能在设置页被改过而未刷新
  settingsCfg = await window.api.getConfig();
  const cfg = settingsCfg;

  // 1. 模型：优先按 modelPath 匹配（模型 id 可能已变），失配则提示重选并停留当前
  const byPath = (cfg.models || []).find(m => m.modelPath === a.modelPath);
  const modelOk = !!byPath;
  if (modelOk && cfg.activeModelId !== byPath.id) {
    settingsCfg = await window.api.saveConfig({ activeModelId: byPath.id });
  }
  if (modelOk) {
    renderActiveModelSelect(settingsCfg);   // 即使 active 未变也刷新下拉（可能还是页面加载时的旧列表）
    syncModelActiveState();
  }

  // 2. 参考图：逐个校验素材记录与本地文件是否还在
  const refs = [];
  let missingRefs = 0;
  for (const r of (a.refImages || [])) {
    const asset = await window.api.getAsset(r.id);
    if (asset) refs.push(asset);
    else missingRefs++;
  }
  refAssets = refs;
  renderRefs();

  // 3. 遮罩
  maskAsset = null;
  if (a.maskImage) {
    const m = await window.api.getAsset(a.maskImage.id);
    if (m) maskAsset = m;
  }
  renderMask();

  // 4. prompt 与参数回填
  $('#prompt').value = a.prompt || '';
  $('#promptCount').textContent = (a.prompt || '').length;
  const setSel = (sel, v) => {
    if (!v) return;
    const el = $(sel);
    if ([...el.options].some(o => o.value === v)) el.value = v;
  };
  setSel('#paramSize', a.params?.size);
  setSel('#paramQuality', a.params?.quality);
  setSel('#paramBackground', a.params?.background);
  setSel('#paramFormat', a.params?.output_format);
  if (a.params?.n) $('#paramN').value = Math.min(10, Math.max(1, Number(a.params.n) || 1));

  // 5. 切到调用页并定位
  document.querySelector('.nav-item[data-page="generate"]').click();
  document.querySelector('.page.active').scrollTop = 0;
  $('#prompt').focus({ preventScroll: true });

  const notes = [];
  if (!modelOk) notes.push(`原模型「${a.model || a.modelPath || '未知'}」已被删除，请重新选择模型`);
  if (missingRefs) notes.push(`${missingRefs} 张参考图素材已不存在，未回填`);
  if (!a.refImages?.length) notes.push('该记录没有参考图，请手动添加');
  if (notes.length) toast('参数已复用：' + notes.join('；'), 'err');
  else toast('参数已复用，可直接生成', 'ok');
}

/* ===== 大图预览 / 详情（支持 ←/→ 翻页、Esc 关闭） ===== */
let previewList = [];     // 当前预览上下文（结果列表 / 历史列表）
let previewIndex = 0;

function openPreview(a, list) {
  previewList = Array.isArray(list) && list.length ? list : [a];
  previewIndex = Math.max(0, previewList.findIndex(x => x && x.id === a.id));
  if (previewList[previewIndex]?.id !== a.id) { previewList[0] = a; previewIndex = 0; }
  renderPreview();
  openModal('#previewModal');
}

function renderPreview() {
  const a = previewList[previewIndex];
  if (!a) return;
  const multi = previewList.length > 1;
  $('#previewImg').src = imgSrc(a);
  $('#previewTitle').textContent =
    (a.type === 'generated' ? `生成图 ${shortId(a.id)}` : `上传图 ${shortId(a.id)}`) +
    (multi ? `（${previewIndex + 1}/${previewList.length}）` : '');
  $('#btnPrev').hidden = !multi;
  $('#btnNext').hidden = !multi;
  $('#previewHint').hidden = !multi;
  const meta = $('#previewMeta');
  const rows = [];
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span>${v}</span></div>`;
  rows.push(row('素材 ID', esc(a.id)));
  rows.push(row('类型', a.type === 'generated' ? '生成图片' : '上传图片'));
  rows.push(row('本地路径', `<a href="#" data-act="folder">${esc(a.localPath)}</a>`));
  if (a.url) rows.push(row('在线 URL', `<a href="#" data-act="url">${esc(a.url)}</a>`));
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
    <div class="preview-actions">
      ${a.type === 'generated' ? `<button class="btn small primary" data-act="reuse">${icon('reuse')} 复用参数再来一张</button>` : ''}
      ${a.type === 'generated' && a.prompt ? `<button class="btn small" data-act="copyprompt">${icon('copy')} 复制提示词</button>` : ''}
      <button class="btn small" data-act="folder2">${icon('folder')} 打开所在文件夹</button>
      <button class="btn small" data-act="copypath">${icon('copy')} 复制本地路径</button>
      ${a.url ? `<button class="btn small" data-act="copyurl">${icon('link')} 复制在线 URL</button>` : ''}
    </div>`;
  meta.onclick = e => {
    const btn = e.target.closest('[data-act]');
    const act = btn ? btn.dataset.act : null;
    if (!act) return;
    if (act === 'folder' || act === 'folder2') window.api.showItem(a.localPath);
    if (act === 'url') window.api.openExternal(a.url);
    if (act === 'copypath') { window.api.copyText(a.localPath); toast('本地路径已复制', 'ok'); }
    if (act === 'copyurl') { window.api.copyText(a.url); toast('在线 URL 已复制', 'ok'); }
    if (act === 'copyprompt') { window.api.copyText(a.prompt); toast('提示词已复制', 'ok'); }
    if (act === 'reuse') { closeModal('#previewModal'); reuseParams(a); }
  };
}

function previewStep(d) {
  if (previewList.length < 2) return;
  previewIndex = (previewIndex + d + previewList.length) % previewList.length;   // 循环翻页
  renderPreview();
}
$('#btnPrev')?.addEventListener('click', () => previewStep(-1));
$('#btnNext')?.addEventListener('click', () => previewStep(1));

/* 键盘：预览打开时 ←/→ 翻页，Esc 关闭 */
document.addEventListener('keydown', e => {
  if ($('#previewModal').hidden) return;
  if (e.key === 'ArrowLeft') { previewStep(-1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { previewStep(1); e.preventDefault(); }
});

/* ===== 尺寸 / 宽高比选择器 =====
   数据源仍是 #paramSize 里的 <option>（唯一真值，复用参数回填零改动）；
   卡片只是它的可视化投影：点卡片 → 写 select → 派发 change 让两边同步。 */
const SIZES = [
  { v: 'auto', label: '自动', dir: 'square' },
  { v: '1024x1024', label: '1024²', dir: 'square' },
  { v: '2048x2048', label: '2048²', dir: 'square' },
  { v: '1024x1536', label: '2:3', dir: 'vertical' },
  { v: '1536x1024', label: '3:2', dir: 'horizontal' },
  { v: '1024x2048', label: '1:2', dir: 'vertical' },
  { v: '2048x1024', label: '2:1', dir: 'horizontal' },
  { v: '688x2048', label: '1:3', dir: 'vertical' },
  { v: '2048x688', label: '3:1', dir: 'horizontal' },
  { v: '880x2048', label: '880×2048', dir: 'vertical' },
  { v: '2048x880', label: '2048×880', dir: 'horizontal' },
  { v: '1152x2048', label: '9:16', dir: 'vertical' },
  { v: '2048x1152', label: '16:9', dir: 'horizontal' },
  { v: '1360x2048', label: '1360×2048', dir: 'vertical' },
  { v: '2048x1360', label: '2048×1360', dir: 'horizontal' },
  { v: '1536x2048', label: '3:4', dir: 'vertical' },
  { v: '2048x1536', label: '4:3', dir: 'horizontal' },
  { v: '2160x3840', label: '9:16 4K', dir: 'vertical' },
  { v: '3840x2160', label: '16:9 4K', dir: 'horizontal' }
];
const SIZE_GROUPS = [
  ['square', '正方形'], ['vertical', '竖向'], ['horizontal', '横向']
];
/* 按真实宽高比画小矩形：长边 30px，短边按比例（最小 8px 保证可见可点） */
function ratioShape(v) {
  if (v === 'auto') {
    return '<svg width="34" height="30" viewBox="0 0 34 30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4.5" y="4.5" width="25" height="21" rx="3" stroke-dasharray="3 3"/><path d="M12 15h10M17 12l3 3-3 3"/></svg>';
  }
  const [w, h] = v.split('x').map(Number);
  const long = 30, scale = long / Math.max(w, h);
  const rw = Math.max(8, Math.round(w * scale)), rh = Math.max(8, Math.round(h * scale));
  return `<svg width="34" height="30" viewBox="0 0 34 30" fill="none"><rect x="${(34 - rw) / 2}" y="${(30 - rh) / 2}" width="${rw}" height="${rh}" rx="2.5" stroke="currentColor" stroke-width="1.5"/></svg>`;
}
function buildRatioGrid() {
  const sel = $('#paramSize'), grid = $('#ratioGrid');
  if (!sel || !grid) return;
  if (!sel.options.length) { grid.classList.add('is-empty'); return; }   // 降级：只留下拉
  const known = new Set(SIZES.map(s => s.v));
  const uncovered = [...sel.options].some(o => !known.has(o.value));   // 将来加尺寸时下拉兜底可见
  grid.innerHTML = SIZE_GROUPS.map(([dir, title]) => {
    const items = SIZES.filter(s => s.dir === dir);
    if (!items.length) return '';
    return `<div class="ratio-group"><div class="ratio-group-title is-${dir}">${title}</div><div class="ratio-grid">` +
      items.map(s => {
        const opt = [...sel.options].find(o => o.value === s.v);
        if (!opt) return '';
        return `<label class="ratio-item ${opt.selected ? 'checked' : ''}" data-v="${esc(s.v)}" title="${esc(opt.textContent.trim())}">
          <input type="radio" name="ratioPick" value="${esc(s.v)}" ${opt.selected ? 'checked' : ''} tabindex="0" />
          <span class="ratio-tag is-${dir}" aria-hidden="true">${s.label}</span>
          <span class="ratio-shape">${ratioShape(s.v)}</span>
          <span class="ratio-name">${esc(s.v.replace('x', ' × '))}</span>
          <span class="ratio-check" aria-hidden="true"></span>
        </label>`;
      }).join('') + '</div></div>';
  }).join('');
  const sync = () => {
    grid.querySelectorAll('.ratio-item').forEach(it => {
      const on = it.dataset.v === sel.value;
      it.classList.toggle('checked', on);
      it.querySelector('input').checked = on;
    });
  };
  grid.addEventListener('change', e => {
    const it = e.target.closest('.ratio-item');
    if (!it) return;
    sel.value = it.dataset.v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  });
  sel.addEventListener('change', sync);   // 复用参数回填走这条路
  if (uncovered) {
    sel.classList.add('is-active');
    grid.insertAdjacentHTML('beforeend', '<span class="hint">部分尺寸不在快捷选择中，请用下方下拉</span>');
  }
  sync();
}

/* ===== 弹窗通用可访问性：Esc 关闭、焦点进入/归还、背景 inert ===== */
/* 顺序即 Esc 关闭优先级（从低到高，pop() 取最上层）：预览 > 选择器 > 确认。
   与 CSS z-index 一致（preview 110 > picker/confirm 100），改顺序必须同步改 z-index。 */
const MODALS = ['#pickerModal', '#confirmModal', '#previewModal'];
const modalVisible = sel => { const m = $(sel); return !!m && !m.hidden; };
function topModal() { return MODALS.filter(modalVisible).pop() || null; }   // preview 层级最高

function modalFocusables(modal) {
  return $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
    .filter(el => !el.disabled && !el.hidden && el.offsetParent !== null);
}
$$('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal('#' + btn.dataset.close));
});
$$('.modal-mask').forEach(mask => {
  mask.addEventListener('click', e => { if (e.target === mask) closeModal('#' + mask.id); });
  mask.addEventListener('keydown', e => {           // 焦点陷阱
    if (e.key !== 'Tab') return;
    const list = modalFocusables(mask);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
});
let lastFocused = null;
function openModal(sel) {
  const m = $(sel);
  if (!m || !m.hidden) return;
  lastFocused = document.activeElement;
  m.hidden = false;
  setBackgroundInert();
  const f = modalFocusables(m);
  (f.find(el => el.classList.contains('modal-close')) || f[0])?.focus();
}
function closeModal(sel) {
  const m = $(sel);
  if (!m || m.hidden) return;
  m.hidden = true;
  setBackgroundInert();
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
}
/* 弹窗打开时把背景设为 inert：Tab/点击/读屏都进不去（陷阱⑧） */
function setBackgroundInert() {
  const blocked = MODALS.some(modalVisible);
  $$('.app').forEach(el => {
    if (blocked) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
    else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  });
}
/* Esc：最上层弹窗关闭（预览优先），Ctrl/Cmd+K 之类不抢 */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const top = topModal();
  if (top) { e.preventDefault(); closeModal(top); }
}, true);

/* ===== 初始化 ===== */
initTheme();
buildRatioGrid();
loadConfig();
renderRefs();
renderMask();
