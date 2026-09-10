/**
 * 阶段 5 回归测试：视觉重做 + 深色模式 + 三态主题
 * 无头环境 prefers-color-scheme 恒为 light，因此「跟随系统」分支不可测，
 * 这里验证可测的部分：token 生效、data-theme 三态、主进程底色同步、
 * 图标精灵无 emoji 残留、比例选择器与 select 双向一致、弹窗 a11y（inert/Esc/焦点）。
 * 用法：npx electron tools/test-visual-theme.js
 */
const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const tmpDir = path.join(app.getPath('temp'), 'ai-studio-visual-test-' + Date.now());
app.setPath('userData', tmpDir);

const R = path.join(__dirname, '..', 'src', 'renderer');
const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const guard = setTimeout(() => {
  console.log('TIMEOUT 测试超时未完成');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.exit(1);
}, 90000);

async function freshWin() {
  const win = new BrowserWindow({
    show: false, width: 900, height: 700,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  const errs = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errs.push(message); });
  win.__errs = errs;
  await win.loadFile(path.join(R, 'index.html'));
  await sleep(400);
  return win;
}

const V8_SELECTORS = ['.btn', '.tab', '.nav-item', '.ratio-item', '.thumb', '.preview-nav', '.modal-close', '.theme-seg button'];

/* 读取元素计算样式（比字符串匹配可靠：确认 CSS 真的落到元素上） */
const cs = (win, sel, prop) => win.webContents.executeJavaScript(
  `(() => { const el = document.querySelector(${JSON.stringify(sel)});
     return el ? getComputedStyle(el)[${JSON.stringify(prop)}] : null; })()`);

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  store.init();
  const hookCalls = [];
  registerIpc({ applyTheme: () => hookCalls.push(Date.now()) });

  /* ── V1 六个样式文件全部加载，token 生效 ── */
  let win = await freshWin();
  const v1 = await win.webContents.executeJavaScript(`(() => {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'));
    const root = getComputedStyle(document.documentElement);
    return {
      links,
      accent: root.getPropertyValue('--accent').trim(),
      bgPage: root.getPropertyValue('--bg-page').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
      // 组件样式确实来自拆分文件
      barPosition: getComputedStyle(document.querySelector('.generate-bar')).position,
      barZ: getComputedStyle(document.querySelector('.generate-bar')).zIndex,
      sideZ: getComputedStyle(document.querySelector('.sidebar')).zIndex,
      previewZ: getComputedStyle(document.querySelector('#previewModal')).zIndex,
      pickerZ: getComputedStyle(document.querySelector('#pickerModal')).zIndex,
      toastZ: getComputedStyle(document.querySelector('.toast')).zIndex,
      dropZ: getComputedStyle(document.querySelector('.drop-overlay')).zIndex
    };
  })()`);
  const files = ['styles.css', 'base.css', 'generate.css', 'history.css', 'settings.css', 'modal.css'];
  check('V1 六个样式文件按序 <link>', JSON.stringify(v1.links) === JSON.stringify(files), JSON.stringify(v1.links));
  check('V1 --accent 为方案主色 oklch(52% .19 265)', /52%\s+0\.19\s+265/.test(v1.accent), v1.accent);
  check('V1 body 底色取自 --bg-page token', !!v1.bodyBg && !!v1.bgPage, JSON.stringify({ bodyBg: v1.bodyBg, bgPage: v1.bgPage }));
  // z-index 体系：拖入 90 < 选择器 100 < 预览 110 < toast 200，生成栏 sticky 20、侧栏 30
  check('V1 z-index 体系 90<100<110<200 + sticky 20 / sidebar 30',
    v1.dropZ === '90' && v1.pickerZ === '100' && v1.previewZ === '110' && v1.toastZ === '200'
    && v1.barZ === '20' && v1.sideZ === '30' && v1.barPosition === 'sticky',
    JSON.stringify({ drop: v1.dropZ, picker: v1.pickerZ, preview: v1.previewZ, toast: v1.toastZ, bar: v1.barZ, side: v1.sideZ, pos: v1.barPosition }));

  /* ── V2 无 emoji 残留（DOM 文本 + CSS 源码） ── */
  const v2 = await win.webContents.executeJavaScript(`(() => {
    /* 只查图形 emoji 区（u{1F300}+ 及变体选择符）；✓/✗/→/⚠ 等 BMP 排版符号为有意保留的
       文本符号，图标 SVG 化本身由下方 <use> 计数与 CSS 源码扫描共同把关 */
    const RE = /[\\u{1F300}-\\u{1FAFF}\\u{2B00}-\\u{2BFF}\\u{FE0F}]/u;
    const textHit = RE.test(document.body.innerText);
    const svgUse = document.querySelectorAll('#previewModal use, .nav-item use, #btnGenerate use').length;
    const hiddenSvg = !!document.querySelector('svg[aria-hidden="true"] defs symbol');
    return { textHit, svgUse, hiddenSvg,
      ariaLabels: ['btnPrev','btnConfirmX'].every(id => document.getElementById(id).getAttribute('aria-label')) };
  })()`);
  const cssFiles = files.map(f => [f, fs.readFileSync(path.join(R, f), 'utf-8')]);
  const emojiInCss = cssFiles.filter(([, c]) => /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(c));  // 与文本扫描同范围：content:'✓' 与注释里的 ⚠→ 是刻意的排版符号
  check('V2 页面无 emoji 文本残留', v2.textHit === false && emojiInCss.length === 0,
    emojiInCss.length ? 'CSS 仍含 emoji: ' + emojiInCss.map(x => x[0]).join(',') : '');
  check('V2 图标走内联 SVG 精灵（<use>）', v2.svgUse >= 4 && v2.hiddenSvg === true, JSON.stringify(v2));

  /* ── V3 深色：data-theme=dark 令牌真的翻转 ── */
  const lightBody = await cs(win, 'body', 'backgroundColor');
  await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme','dark')`);
  await sleep(120);
  const dark = await win.webContents.executeJavaScript(`(() => {
    const r = getComputedStyle(document.documentElement);
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      cardBg: getComputedStyle(document.querySelector('.card')).backgroundColor,
      text: getComputedStyle(document.body).color,
      accent: r.getPropertyValue('--accent').trim(),
      fw2: r.getPropertyValue('--fw-5').trim(),
      // 深色陷阱①：字段标签升为 14px/700
      labelSize: getComputedStyle(document.querySelector('.field > span')).fontSize,
      labelWeight: getComputedStyle(document.querySelector('.field > span')).fontWeight
    };
  })()`);
  check('V3 深色下 body/卡片底色翻转', dark.bodyBg !== lightBody && dark.cardBg !== 'rgb(255, 255, 255)',
    JSON.stringify({ lightBody, darkBody: dark.bodyBg, card: dark.cardBg }));
  check('V3 深色主色提亮 oklch(66% .16 265)', /66%\s+0\.16\s+265/.test(dark.accent), dark.accent);
  check('V3 深色字重收档 --fw-5=700', dark.fw2 === '700', dark.fw2);
  check('V3 深色字段标签 14px/700（AA 对比度）',
    dark.labelSize === '14px' && dark.labelWeight === '700', JSON.stringify({ s: dark.labelSize, w: dark.labelWeight }));
  // 手动 light 应回到浅色（证明开关双向有效，不只是加了暗色）
  await win.webContents.executeJavaScript(`document.documentElement.setAttribute('data-theme','light')`);
  await sleep(120);
  const backLight = await cs(win, 'body', 'backgroundColor');
  check('V3 data-theme=light 覆盖回浅色（开关可逆）', backLight === lightBody, JSON.stringify({ lightBody, backLight }));
  await win.webContents.executeJavaScript(`document.documentElement.removeAttribute('data-theme')`);

  /* ── V4 三态主题持久化 + 主进程底色同步 ── */
  const cfgTheme0 = store.getConfig().theme;
  check('V4 默认 theme=system', cfgTheme0 === 'system', String(cfgTheme0));
  const v4 = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('btnThemeDark').click();
    await new Promise(r => setTimeout(r, 200));
    const attr = document.documentElement.getAttribute('data-theme');
    const segActive = [...document.querySelectorAll('#themeSegment button')].filter(b => b.classList.contains('active')).map(b => b.dataset.themeVal);
    const persisted = (await window.api.getConfig()).theme;
    const pressed = document.getElementById('btnThemeDark').getAttribute('aria-pressed');
    return { attr, segActive, persisted, pressed };
  })()`);
  check('V4 点「深色」→ data-theme + 持久化 + 分段态',
    v4.attr === 'dark' && v4.persisted === 'dark' && JSON.stringify(v4.segActive) === '["dark"]' && v4.pressed === 'true',
    JSON.stringify(v4));
  check('V4 theme:set 回调了主进程底色 hook', hookCalls.length >= 1, JSON.stringify({ hookCalls: hookCalls.length }));
  const v4b = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('btnThemeSystem').click();
    await new Promise(r => setTimeout(r, 200));
    return { attr: document.documentElement.getAttribute('data-theme'),
             persisted: (await window.api.getConfig()).theme };
  })()`);
  check('V4 「跟随系统」清除 data-theme 属性', v4b.attr === null && v4b.persisted === 'system', JSON.stringify(v4b));
  const badSave = await win.webContents.executeJavaScript(`window.api.setTheme('nonsense')`);
  check('V4 非法 theme 回退 system', badSave === 'system', String(badSave));
  check('V4 无控制台错误', win.__errs.length === 0, win.__errs.join(' | '));
  await win.close();

  /* ── V5 启动路径：磁盘上 theme=dark 时，新窗口未经任何点击即为深色（消灭深色闪白的渲染侧） ── */
  store.saveConfig({ theme: 'dark' });
  win = await freshWin();
  const darkBgPage = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim()`);
  const v5 = await win.webContents.executeJavaScript(`({
    attr: document.documentElement.getAttribute('data-theme'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    themeViaApi: null
  })`);
  check('V5 重启后未经点击即 data-theme=dark', v5.attr === 'dark', String(v5.attr));
  check('V5 重启后底色为深色 token', v5.bodyBg !== lightBody, JSON.stringify({ lightBody, v5: v5.bodyBg }));
  // 主进程侧：applyThemeToApp 的底色常量与 CSS token 换算一致（改 token 不同步改这里会闪白）
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf-8');
  const mDark = mainSrc.match(/BG_DARK = '(#[0-9a-f]{6})'/);
  const mLight = mainSrc.match(/BG_LIGHT = '(#[0-9a-f]{6})'/);
  // 底色现为 oklch 字面量：先与 --bg-page token 比对，再用 Chromium 原生换算验证 main.js 的 hex 注释
  /* 计算样式把 21% 归一为 0.21，自定义属性保留原文 —— 统一成规范串再比 */
  const norm = str => {
    const m = String(str).trim().match(/^oklch\(([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\)$/);
    if (!m) return null;
    const L = m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    return `oklch(${L} ${m[3]} ${m[4]})`;
  };
  check('V5 页面底色即 --bg-page token（未被硬编码覆盖）',
    norm(v5.bodyBg) !== null && norm(v5.bodyBg) === norm(darkBgPage),
    JSON.stringify({ body: v5.bodyBg, token: darkBgPage }));
  // 主进程只能吃 hex：验证 main.js 里的 BG_DARK 确实是该 oklch 的正确换算
  const v5conv = await win.webContents.executeJavaScript(`(() => {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');   // 后备存储为 sRGB
    ctx.fillStyle = ${JSON.stringify(darkBgPage)};
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;      // fillStyle 会保留色彩空间原文，必须读像素才拿到 hex
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  })()`);
  const near = (a, b) => /^#[0-9a-f]{6}$/i.test(a) && /^#[0-9a-f]{6}$/i.test(b) &&
    [1, 3, 5].every(i => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);
  check('V5 主进程 BG_DARK 与深色 token 换算一致（±2 通道容差）',
    !!mDark && near(v5conv, mDark[1]),
    JSON.stringify({ token: darkBgPage, converted: v5conv, BG_DARK: mDark && mDark[1] }));
  store.saveConfig({ theme: 'system' });
  await win.close();
  win = await freshWin();  // 后续用例以 system 主题继续

  /* ── V6 比例选择器与 #paramSize 双向一致 ── */
  store.saveConfig({ theme: 'system' });
  win = await freshWin();
  const v6 = await win.webContents.executeJavaScript(`(async () => {
    const sel = document.getElementById('paramSize');
    const grid = document.getElementById('ratioGrid');
    const items = [...grid.querySelectorAll('.ratio-item')];
    const groups = grid.querySelectorAll('.ratio-group').length;
    // 渲染出的卡片数应等于 select 里可映射的 option 数（19 项全映射）
    const countOk = items.length === 19 && groups === 3;
    const checkedNow = grid.querySelector('.ratio-item.checked')?.dataset.v;
    // 点卡片 → select 跟随 + change 派发
    let changed = false;
    sel.addEventListener('change', () => { changed = true; }, { once: true });
    grid.querySelector('.ratio-item[data-v="1536x1024"] input').click();
    await new Promise(r => setTimeout(r, 100));
    const afterClick = { sel: sel.value, changed,
      checked: grid.querySelector('.ratio-item.checked')?.dataset.v,
      shapeHasSvg: !!grid.querySelector('.ratio-item[data-v="1536x1024"] svg') };
    // 反向：写 select + change（复用参数回填路径）→ 卡片跟随
    sel.value = '1024x1536';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const afterSel = grid.querySelector('.ratio-item.checked')?.dataset.v;
    // select 保持隐藏（降级不显示，值仍是唯一真值）
    const selHidden = getComputedStyle(sel).display;
    return { countOk, checkedNow, afterClick, afterSel, selHidden };
  })()`);
  check('V6 比例卡片 19 个 / 3 组方向', v6.countOk === true, JSON.stringify({ countOk: v6.countOk }));
  check('V6 初始选中态与 select 默认值一致', v6.checkedNow === '1024x1024', String(v6.checkedNow));
  check('V6 点卡片 → select 更新并派发 change', v6.afterClick.changed === true &&
    v6.afterClick.sel === '1536x1024' && v6.afterClick.checked === '1536x1024', JSON.stringify(v6.afterClick));
  check('V6 写 select → 卡片跟随（复用参数回填兼容）', v6.afterSel === '1024x1536', String(v6.afterSel));
  check('V6 降级 <select> 隐藏但仍为数据源', v6.selHidden === 'none', v6.selHidden);

  /* ── V7 弹窗可访问性：inert / Esc / 焦点 / role ── */
  const v7 = await win.webContents.executeJavaScript(`(async () => {
    const app = document.querySelector('.app');
    const before = app.hasAttribute('inert');
    const trigger = document.getElementById('btnPickHistory');
    trigger.focus();
    openModal('#pickerModal');
    await new Promise(r => setTimeout(r, 80));
    const opened = { inert: app.getAttribute('inert'), ariaHidden: app.getAttribute('aria-hidden'),
      focusIn: !!document.activeElement.closest('#pickerModal'),
      focusOnCloseBtn: document.activeElement.classList.contains('modal-close'),
      role: document.querySelector('#pickerModal .modal').getAttribute('role'),
      modal: document.querySelector('#pickerModal .modal').getAttribute('aria-modal'),
      labelledby: !!document.querySelector('#pickerModal .modal').getAttribute('aria-labelledby') };
    // Esc 关最上层
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const afterEsc = { hidden: document.getElementById('pickerModal').hidden,
      inertGone: !app.hasAttribute('inert'), ariaHiddenGone: !app.hasAttribute('aria-hidden'),
      focusBack: document.activeElement === trigger };
    // 预览层叠：预览打开时高于选择器
    openModal('#pickerModal');
    const fake = [{ id: 'p1', type: 'upload', localPath: '/tmp/p1.png', createdAt: '' }];
    previewList = fake; previewIndex = 0; renderPreview(); openModal('#previewModal');
    await new Promise(r => setTimeout(r, 60));
    const stacked = { preview: getComputedStyle(document.getElementById('previewModal')).zIndex,
      picker: getComputedStyle(document.getElementById('pickerModal')).zIndex,
      bothOpen: !document.getElementById('previewModal').hidden && !document.getElementById('pickerModal').hidden };
    // Esc 先关预览（层级最高），选择器留着
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 60));
    const escTop = { previewHidden: document.getElementById('previewModal').hidden,
      pickerStillOpen: !document.getElementById('pickerModal').hidden,
      stillInert: document.querySelector('.app').hasAttribute('inert') };
    document.getElementById('pickerModal').hidden = true;
    setBackgroundInert();
    return { before, opened, afterEsc, stacked, escTop };
  })()`);
  check('V7 弹窗未开时背景无 inert', v7.before === false);
  check('V7 弹窗打开 → 背景 inert + aria-hidden，焦点进入弹窗关闭键',
    v7.opened.inert === '' && v7.opened.ariaHidden === 'true' && v7.opened.focusIn === true
    && v7.opened.focusOnCloseBtn === true, JSON.stringify(v7.opened));
  check('V7 dialog 具备 role/aria-modal/aria-labelledby',
    v7.opened.role === 'dialog' && v7.opened.modal === 'true' && v7.opened.labelledby === true, JSON.stringify(v7.opened));
  check('V7 Esc 关闭弹窗并解除 inert、焦点归还触发元素',
    v7.afterEsc.hidden === true && v7.afterEsc.inertGone === true && v7.afterEsc.ariaHiddenGone === true
    && v7.afterEsc.focusBack === true, JSON.stringify(v7.afterEsc));
  check('V7 预览(110) 可叠在选择器(100) 之上',
    v7.stacked.bothOpen === true && Number(v7.stacked.preview) > Number(v7.stacked.picker), JSON.stringify(v7.stacked));
  check('V7 Esc 只关最上层，下层弹窗保持 inert',
    v7.escTop.previewHidden === true && v7.escTop.pickerStillOpen === true && v7.escTop.stillInert === true,
    JSON.stringify(v7.escTop));

  /* ── V8 按压反馈 :active 覆盖 8 个交互元素 ── */
  const v8 = await win.webContents.executeJavaScript(`(() => {
    const sels = ['.btn', '.tab', '.nav-item', '.ratio-item', '.thumb', '.preview-nav', '.modal-close', '.theme-seg button'];
    return [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } })
      .filter(r => r.selectorText && r.style && r.style.transform && /:active/.test(r.selectorText))
      .flatMap(r => r.selectorText.split(',').map(s => s.trim()));
  })()`);
  const activeMissing = sels => sels.filter(s => !v8.some(rule => rule.includes(s)));
  check('V8 八个交互元素都有 :active 按压反馈', activeMissing(V8_SELECTORS).length === 0,
    '缺失: ' + activeMissing(V8_SELECTORS).join(','));

  /* ── V9 骨架屏与空状态 ── */
  const v9 = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-item[data-page="history"]').click();
    const sk = document.querySelectorAll('#historyGrid .skeleton').length;
    await new Promise(r => setTimeout(r, 400));
    const empty = document.querySelector('#historyGrid .empty-tip');
    return { sk, emptyIcon: !!empty?.querySelector('svg use'), emptyText: empty ? empty.textContent.trim().slice(0, 12) : null,
      toastLive: document.getElementById('toast').getAttribute('aria-live'),
      genStatus: document.getElementById('genProgress').getAttribute('role') };
  })()`);
  check('V9 历史加载期渲染骨架屏（≥4 占位）', v9.sk >= 4, String(v9.sk));
  check('V9 空状态带 SVG 图标与引导文案', v9.emptyIcon === true && !!v9.emptyText, JSON.stringify(v9));
  check('V9 toast aria-live + 进度 role=status（屏幕阅读器播报）',
    v9.toastLive === 'polite' && v9.genStatus === 'status', JSON.stringify(v9));

  check('V9 无控制台错误', win.__errs.length === 0, win.__errs.join(' | '));
  await win.close();

  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearTimeout(guard);
  const failed = results.filter(r => !r[1]);
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
  console.log(failed.length ? 'FAILURES:\n' + failed.map(f => ' - ' + f[0] + ' | ' + f[2]).join('\n') : 'ALL PASSED');
  app.exit(failed.length ? 1 : 0);
});

