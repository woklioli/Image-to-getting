/**
 * 阶段2 回归测试：缩略图 IPC、批量删除语义、历史页搜索/排序/分页/批量 UI
 * 用法：npx electron tools/test-history-features.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const tmpDir = path.join(app.getPath('temp'), 'ai-studio-hist-test-' + Date.now());
app.setPath('userData', tmpDir);

const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const guard = setTimeout(() => { console.log('TIMEOUT'); fs.rmSync(tmpDir, { recursive: true, force: true }); app.exit(1); }, 45000);

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  store.init();
  registerIpc();

  // 真实素材源：项目内 icon.png（256x256）
  const srcIcon = path.join(__dirname, '..', 'assets', 'icon.png');

  // ── 主进程侧：导入 + 缩略图 ──
  const rec = store.addAsset(store.importUploadedFile(srcIcon, 'icon.png', 'image/png'));
  const t1 = store.thumbnailFor(rec);
  check('T1 缩略图生成成功', !!(t1 && fs.existsSync(t1)), t1 || 'null');
  const t1stat = t1 && fs.statSync(t1);
  check('T1 缩略图为 JPEG 且体积有效', !!(t1stat && t1stat.size > 500 && t1stat.size < 200000), t1stat ? `size=${t1stat.size}` : '');

  const t2 = store.thumbnailFor(store.getAsset(rec.id));
  check('T2 二次调用命中缓存（同一路径）', t2 === t1);

  const stampPath = t1 + '.stamp';
  const oldStamp = fs.readFileSync(stampPath, 'utf-8');
  fs.writeFileSync(rec.localPath, fs.readFileSync(srcIcon)); // 触碰 mtime
  const t3 = store.thumbnailFor(store.getAsset(rec.id));
  const newStamp = fs.readFileSync(stampPath, 'utf-8');
  check('T3 原图变更后缓存失效重生成', !!t3 && newStamp !== oldStamp, `${oldStamp} -> ${newStamp}`);

  const ghost = store.thumbnailFor({ id: 'no-such', localPath: path.join(tmpDir, 'missing.png') });
  check('T4 缺失文件返回 null（前端回退原图）', ghost === null);

  // ── 批量删除语义 ──
  const recA = store.addAsset(store.importUploadedFile(srcIcon, 'a.png', 'image/png'));
  const recB = store.addAsset(store.importUploadedFile(srcIcon, 'b.png', 'image/png'));
  store.deleteAssets([recA.id], { alsoDeleteFiles: false });
  check('T5 仅删记录：记录消失、文件保留',
    !store.getAsset(recA.id) && fs.existsSync(recA.localPath));
  store.deleteAssets([recB.id], { alsoDeleteFiles: true });
  check('T6 删记录+文件', !store.getAsset(recB.id) && !fs.existsSync(recB.localPath));
  check('T7 删除时缩略图缓存同步清理', !fs.existsSync(store.paths().thumbsDir + '/' + recA.id + '.jpg'));

  // ── 渲染层：搜索 / 分页 / 批量 UI ──
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 400));
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-page="history"]').click()`);
  await new Promise(r => setTimeout(r, 500));

  // 造 150 条上传素材记录（复制 icon 会慢，直接引用同一 localPath，仅 id/fileName 不同）
  await win.webContents.executeJavaScript(`(async () => {
    const base = await window.api.importFiles([${JSON.stringify(srcIcon)}]);
    return base.length;
  })()`);
  const dbPath = path.join(tmpDir, 'db.json');
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const seed = db.assets[0];
  for (let i = 0; i < 149; i++) {
    db.assets.push({ ...seed, id: `seed-${i}`, fileName: (i % 2 ? 'cat' : 'dog') + i + '.png', createdAt: new Date(Date.now() - i * 60000).toISOString() });
  }
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

  const ui1 = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('btnRefreshHistory').click();
    await new Promise(r => setTimeout(r, 400));
    return { rendered: document.querySelectorAll('#historyGrid .thumb').length,
             sentinelShown: !document.getElementById('loadSentinel').hidden };
  })()`);
  check('U1 首页只渲染 60 张（分页生效）', ui1.rendered === 60 && ui1.sentinelShown, JSON.stringify(ui1));

  const ui2 = await win.webContents.executeJavaScript(`(async () => {
    const inp = document.getElementById('historySearch');
    inp.value = 'cat1'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    return { rendered: document.querySelectorAll('#historyGrid .thumb').length };
  })()`);
  // cat1: cat1.png cat10-19 cat100-109... 精确值由数据决定，只断言 <150 且 >0
  check('U2 搜索过滤生效', ui2.rendered > 0 && ui2.rendered < 60, JSON.stringify(ui2));

  const ui3 = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('historySearch').value = '';
    document.getElementById('historySearch').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('btnBatchMode').click();
    await new Promise(r => setTimeout(r, 200));
    const cards = document.querySelectorAll('#historyGrid .thumb');
    cards[0].click(); cards[1].click();
    document.getElementById('btnBatchSelectAll').click();
    return { barShown: !document.getElementById('batchBar').hidden,
             count: document.getElementById('batchCount').textContent,
             checks: document.querySelectorAll('#historyGrid .thumb .thumb-check').length,
             selected: document.querySelectorAll('#historyGrid .thumb.selected').length };
  })()`);
  check('U3 批量模式：勾选/全选/计数', ui3.barShown && ui3.checks === 60 && ui3.selected === 60 && ui3.count.includes('60'), JSON.stringify(ui3));

  const ui4 = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('btnBatchDelete').click();
    await new Promise(r => setTimeout(r, 200));
    const modalShown = !document.getElementById('confirmModal').hidden;
    const optsShown = !document.getElementById('confirmOpts').hidden;
    document.querySelector('#confirmModal input[name=delOpt][value=record]').checked = true;
    document.getElementById('btnConfirmOk').click();
    await new Promise(r => setTimeout(r, 500));
    return { modalShown, optsShown,
             stillSelected: document.querySelectorAll('#historyGrid .thumb.selected').length };
  })()`);
  check('U4 自绘确认弹窗 + 仅删记录批量执行', ui4.modalShown && ui4.optsShown, JSON.stringify(ui4));
  const dbAfter = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const seedLeft = dbAfter.assets.filter(a => String(a.id).startsWith('seed-')).length;
  check('U4 删除数量正确（151-60=91）且文件保留', seedLeft === 91 && fs.existsSync(seed.localPath), `left=${seedLeft}`);

  clearTimeout(guard);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `\n${failed.length} 项失败` : '\nALL PASSED');
  app.exit(failed.length ? 1 : 0);
});
