/**
 * 阶段4 回归测试：全局拖拽上传 / Ctrl+V 粘贴图片 / 预览 ←/→ 翻页
 * 用法：npx electron tools/test-drag-preview.js
 * 说明：监听器层用合成 DragEvent/DataTransfer 驱动（合成 File 无磁盘路径 → 走忽略分支，
 *       正好验证浏览器拖拽场景）；导入落地用真实路径直接调 importDroppedPaths（同一函数体）。
 *       粘贴走主进程真实剪贴板。图床指向死端口，验证「导入成功但上传失败可重试」链路。
 */
const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const tmpDir = path.join(app.getPath('temp'), 'ai-studio-drag-test-' + Date.now());
app.setPath('userData', tmpDir);

const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  store.init();
  registerIpc();

  const srcIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.mkdirSync(tmpDir, { recursive: true });
  const dropA = path.join(tmpDir, 'drop-a.png');
  fs.copyFileSync(srcIcon, dropA);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(300);

  // 图床指向死端口：导入仍应成功（本地记录保留），上传走失败告警
  await store.saveConfig({ uploadUrl: 'http://127.0.0.1:9/upload' });

  /* ── D1 拖拽监听器：高亮层出现/熄灭、非图片忽略提示；真实路径经 importDroppedPaths 落地 ── */
  const d1 = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('.nav-item[data-page="history"]').click();
    await new Promise(r => setTimeout(r, 250));

    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(8)], 'drop-a.png', { type: 'image/png' }));
    dt.items.add(new File([new Uint8Array(8)], '说明.txt', { type: 'text/plain' }));
    const fire = (type, x, y) => document.dispatchEvent(
      new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true }));

    fire('dragenter', 400, 300);
    const overlayOn = !document.getElementById('dropOverlay').hidden;
    fire('dragleave', 400, 300);
    const overlayOff = document.getElementById('dropOverlay').hidden;
    fire('dragenter', 400, 300);
    await new Promise(r => setTimeout(r, 50));
    fire('drop', 400, 300);                       // 合成 File 无磁盘路径 → 应被忽略，页面不切换
    await new Promise(r => setTimeout(r, 60));
    const listenerToast = document.getElementById('toast').textContent;
    const overlayGone = document.getElementById('dropOverlay').hidden;
    const pageAfterFake = document.querySelector('.page.active').id;

    // 同一落地函数用真实路径驱动（浏览器拖拽拿不到路径，本地文件可以）
    await importDroppedPaths([${JSON.stringify(dropA)}], 400, 300);
    await new Promise(r => setTimeout(r, 6500));  // 图床死端口重试耗时
    return { overlayOn, overlayOff, overlayGone, listenerToast, pageAfterFake,
      page: document.querySelector('.page.active').id, refs: refAssets.length };
  })()`);
  check('D1 拖入高亮层出现、拖离熄灭、drop 后归零',
    d1.overlayOn === true && d1.overlayOff === true && d1.overlayGone === true,
    JSON.stringify({ on: d1.overlayOn, off: d1.overlayOff, gone: d1.overlayGone }));
  check('D1 忽略无路径/非图片文件并提示支持格式（页面不切换）',
    d1.listenerToast.includes('仅支持 PNG/JPEG/WebP/GIF') && d1.pageAfterFake === 'page-history',
    JSON.stringify({ toast: d1.listenerToast, page: d1.pageAfterFake }));
  check('D1 本地图片拖入 → 自动切调用页并加为参考图',
    d1.page === 'page-generate' && d1.refs === 1, JSON.stringify({ page: d1.page, refs: d1.refs }));

  /* ── D1b 落点在遮罩卡片 → 设为遮罩 ── */
  const d1b = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('maskCard').scrollIntoView({ block: 'center' });   // 小窗口里遮罩卡片在折叠线下
    await new Promise(r => setTimeout(r, 120));
    const rect = document.getElementById('maskCard').getBoundingClientRect();
    await importDroppedPaths([${JSON.stringify(dropA)}], rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => setTimeout(r, 6500));
    return { maskSet: !!maskAsset, refs: refAssets.length };
  })()`);
  check('D1b 拖到遮罩卡片内设为遮罩（不增参考图）', d1b.maskSet === true && d1b.refs === 1, JSON.stringify(d1b));

  /* ── D1c 弹窗打开时 drop 忽略 ── */
  const d1c = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('pickerModal').hidden = false;
    const before = refAssets.length;
    document.getElementById('prompt').scrollIntoView({ block: 'center' });
    await new Promise(r => setTimeout(r, 100));
    await importDroppedPaths([${JSON.stringify(dropA)}], 400, 300);
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('pickerModal').hidden = true;
    return { same: refAssets.length === before, before };
  })()`);
  check('D1c 弹窗打开时拖入被忽略', d1c.same === true);

  /* ── D2 剪贴板粘贴 ── */
  clipboard.writeImage(nativeImage.createFromPath(srcIcon));
  const p2 = await win.webContents.executeJavaScript(`window.api.pasteImage()`);
  check('D2 剪贴板图片读取并落盘为 PNG', !!p2 && fs.existsSync(p2) && p2.includes('粘贴图片'), String(p2));
  const d2b = await win.webContents.executeJavaScript(`(async () => {
    const before = (await window.api.listAssets('upload')).length;
    const r = await window.api.importFiles([${JSON.stringify(p2 || '')}]);
    const after = (await window.api.listAssets('upload')).length;
    return { ok: r.some(x => x.ok), warned: !!r[0]?.warning, delta: after - before, name: r[0]?.asset?.fileName };
  })()`);
  check('D2 粘贴图片可导入（图床失败带 warning 仍可重试）',
    d2b.ok === true && d2b.warned === true && d2b.delta === 1 && String(d2b.name).includes('粘贴图片'), JSON.stringify(d2b));
  clipboard.writeText('纯文本');
  const p2c = await win.webContents.executeJavaScript(`window.api.pasteImage()`);
  check('D2 剪贴板无图返回 null（文本粘贴不受影响）', p2c === null);

  /* ── D3 文本粘贴不被拦截：paste 监听器在有文字时不 preventDefault ── */
  const d3 = await win.webContents.executeJavaScript(`(async () => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '提示词文本');
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const before = refAssets.length;
    document.getElementById('prompt').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 400));
    return { defaultPrevented: ev.defaultPrevented, unchanged: refAssets.length === before };
  })()`);
  check('D3 粘贴文本时不拦截、不误导入', d3.defaultPrevented === false && d3.unchanged === true, JSON.stringify(d3));

  /* ── P1 预览翻页 ── */
  const p1 = await win.webContents.executeJavaScript(`(async () => {
    const list = [
      { id: 'p-1', type: 'upload', localPath: ${JSON.stringify(srcIcon)}, fileName: '一.png' },
      { id: 'p-2', type: 'upload', localPath: ${JSON.stringify(srcIcon)}, fileName: '二.png' }
    ];
    openPreview(list[0], list);
    const shown = !document.getElementById('previewModal').hidden;
    const navShown = !document.getElementById('btnPrev').hidden && !document.getElementById('btnNext').hidden;
    const t0 = document.getElementById('previewTitle').textContent;
    previewStep(1);
    const t1 = document.getElementById('previewTitle').textContent;
    previewStep(1);                                   // 循环回 1/2
    const t2 = document.getElementById('previewTitle').textContent;
    document.getElementById('btnPrev').click();       // 反向到 2/2
    const t3 = document.getElementById('previewTitle').textContent;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const t4 = document.getElementById('previewTitle').textContent;
    const imgLoaded = document.getElementById('previewImg').src.startsWith('file:');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const closed = document.getElementById('previewModal').hidden;
    openPreview(list[1], [list[1]]);
    const singleHidden = document.getElementById('btnPrev').hidden && document.getElementById('btnNext').hidden;
    document.getElementById('previewModal').hidden = true;
    return { shown, navShown, t0, t1, t2, t3, t4, imgLoaded, closed, singleHidden };
  })()`);
  check('P1 预览打开且多张时显示导航', p1.shown && p1.navShown && p1.imgLoaded);
  check('P1 →/循环/←/键盘 翻页索引正确',
    p1.t0.includes('1/2') && p1.t1.includes('2/2') && p1.t2.includes('1/2') && p1.t3.includes('2/2') && p1.t4.includes('1/2'),
    JSON.stringify([p1.t0, p1.t1, p1.t2, p1.t3, p1.t4]));
  check('P1 Esc 关闭、单张隐藏导航', p1.closed === true && p1.singleHidden === true);

  /* ── P2 历史卡片进预览携带列表上下文 ── */
  const pcx = await win.webContents.executeJavaScript(`(async () => {
    await window.api.importFiles([${JSON.stringify(srcIcon)}]);
    document.querySelector('.nav-item[data-page="history"]').click();
    await new Promise(r => setTimeout(r, 7000));
    const cards = document.querySelectorAll('#historyGrid .thumb');
    cards[0].click();
    await new Promise(r => setTimeout(r, 150));
    return { cards: cards.length, list: previewList.length, title: document.getElementById('previewTitle').textContent };
  })()`);
  check('P2 从历史卡片进预览携带完整列表',
    pcx.cards >= 2 && pcx.list === pcx.cards && pcx.title.includes('/' + pcx.cards), JSON.stringify(pcx));

  const failed = results.filter(([, ok]) => !ok);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(failed.length ? `\n${failed.length} 项失败` : '\nALL PASSED');
  app.exit(failed.length ? 1 : 0);
});
