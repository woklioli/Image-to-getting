/**
 * 素材兜底机制回归测试：24h URL 保鲜 + 上传中实时反馈
 * 用法：npx electron tools/test-import-staleness.js
 * 本机假接口（不联网）：/upload 延时 800ms 计数命中；/v3/* 立即返回 1 张 b64 图。
 * 覆盖：
 *   S1 ensureUploaded：新鲜素材不重传（零请求）；超 24h 重传换新 URL + urlAt
 *   S2 generate:run 兜底：带（过期）URL 的素材在生成前被重传
 *   S3 上传反馈：importFiles 期间出现 .thumb-pending 占位卡（spinner + 正在上传），完成后卡片更新/接管
 *   S4 导入失败路径：占位卡变成「重试上传」按钮，点击可补传
 *   S5 refreshStaleUrl：历史素材导入的后台刷新钩子（渲染层直调）
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const tmpDir = path.join(app.getPath('temp'), 'ai-stale-test-' + Date.now());
app.setPath('userData', tmpDir);

const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const guard = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

let uploadHits = 0;
let uploadShouldFail = false;

function startFakeServer() {
  const srv = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const reply = obj => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/upload')) {
        uploadHits++;
        setTimeout(() => {
          if (uploadShouldFail) { res.writeHead(500); res.end('图床挂了'); return; }
          reply({ url: `http://127.0.0.1:${srv.address().port}/fresh-${uploadHits}.png` });
        }, 800);
      } else if (req.url.startsWith('/v3/')) {
        reply({ data: [{ b64_json: PNG_B64 }] });
      } else { res.writeHead(404); res.end(); }
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  const { isUrlStale } = require('../src/main/api');
  store.init();
  registerIpc();

  const srv = await startFakeServer();
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const srcIcon = path.join(__dirname, '..', 'assets', 'icon.png');

  store.saveConfig({
    baseUrl: origin, apiKey: 'k', uploadUrl: `${origin}/upload`,
    models: [{ id: 'm-a', name: 'A', baseUrl: origin, modelPath: 'v3/edit', apiKey: 'k', apiType: 'custom', modelName: '' }],
    activeModelId: 'm-a', openaiPresetAdded: true
  });

  const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const mk = (over = {}) => store.addAsset({
    id: store.newId(), type: 'upload', fileName: 'seed.png', localPath: srcIcon,
    size: fs.statSync(srcIcon).size, mime: 'image/png',
    createdAt: hoursAgo(1), url: '', urlAt: '', ...over
  });
  const fresh = mk({ url: `${origin}/keep.png`, urlAt: hoursAgo(2) });
  const stale = mk({ url: `${origin}/expired.png`, createdAt: hoursAgo(25) });           // 无 urlAt → 按 createdAt 判定
  const staleWithUrlAt = mk({ url: `${origin}/expired2.png`, createdAt: hoursAgo(1), urlAt: hoursAgo(30) });

  /* ── 纯函数：TTL 判定 ── */
  check('T1 无 URL 视为需上传', isUrlStale({ url: '', createdAt: new Date().toISOString() }) === true);
  check('T2 2h 前上传的 URL 新鲜', isUrlStale({ url: 'x', urlAt: hoursAgo(2), createdAt: hoursAgo(100) }) === false);
  check('T3 25h 前（urlAt）过期', isUrlStale({ url: 'x', urlAt: hoursAgo(25) }) === true);
  check('T4 缺 urlAt 回退 createdAt（老数据兼容）', isUrlStale(stale) === true && isUrlStale(fresh) === false);

  // 单窗口贯穿：同机并发加载同一 index.html 的第二个窗口会 ERR_FAILED
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(400);
  const js = code => win.webContents.executeJavaScript(code, true);

  /* ── S1 ensureUploaded：新鲜零请求 / 超龄重传 ── */
  {
    uploadHits = 0;
    const ok = await js(`window.api.ensureUploaded('${fresh.id}').then(a => a.url)`);
    check('S1a 新鲜素材 ensureUploaded 不发上传请求', uploadHits === 0 && ok === `${origin}/keep.png`, 'hits=' + uploadHits);
    const before = stale.url;
    const got = await js(`window.api.ensureUploaded('${stale.id}').then(a => ({ url: a.url, urlAt: a.urlAt || '' }))`);
    check('S1b 超24h素材 ensureUploaded 重传换新 URL', uploadHits === 1 && got.url !== before && /^https?:/.test(got.url), 'hits=' + uploadHits + ' url=' + got.url);
    check('S1c 重传后落库 urlAt 时间戳', !!got.urlAt && Date.now() - Date.parse(got.urlAt) < 60000, got.urlAt);
    const got2 = await js(`window.api.ensureUploaded('${staleWithUrlAt.id}').then(a => a.url)`);
    check('S1d urlAt 也参与判定（createdAt 新但 urlAt 旧 → 重传）', uploadHits === 2 && got2 !== staleWithUrlAt.url, 'hits=' + uploadHits);
  }

  /* ── S2 generate:run 兜底：带过期 URL 的参考图在生成前重传 ── */
  {
    uploadHits = 0;
    const staleForGen = mk({ url: `${origin}/old-link.png`, createdAt: hoursAgo(48) });
    const res = await js(`window.api.generate({ jobId: 'g1', refAssetIds: ['${staleForGen.id}'], prompt: 'hi', params: { n: 1 } })`);
    check('S2 生成前自动重传过期 URL（接口不再收到死链）', uploadHits === 1 && !res.canceled && res.images.length === 1, 'hits=' + uploadHits);
    check('S2 素材 URL 已更新落库', store.getAsset(staleForGen.id).url.includes('/fresh-'), store.getAsset(staleForGen.id).url);
  }

  /* ── S3 上传中占位卡：渲染层 importFiles 期间可见「正在上传」，完成后原位更新 ── */
  {
    const tmp1 = path.join(tmpDir, 'p1.png'), tmp2 = path.join(tmpDir, 'p2.png');
    fs.writeFileSync(tmp1, PNG); fs.writeFileSync(tmp2, PNG);
    const flow = await js(`(async () => {
      const log = [];
      const seen = { pending: 0, badge: 0, progressText: '' };
      const p = window.importFiles(['${tmp1}', '${tmp2}'], a => { if (!refAssets.some(x => x.id === a.id)) refAssets.push(a); });
      // 上传进行中采样 DOM（服务端每张延时 800ms）
      await new Promise(r => setTimeout(r, 300));
      const mid = await new Promise(resolve => {
        const tick = () => {
          const cards = document.querySelectorAll('#refList .thumb-pending');
          if (cards.length) {
            seen.pending = cards.length;
            seen.badge = document.querySelectorAll('#refList .thumb-uploading').length;
            seen.progressText = cards[0].querySelector('.up-state')?.textContent || '';
            resolve(true);
          } else setTimeout(tick, 100);
        };
        tick();
        setTimeout(() => resolve(false), 1500);
      });
      await p;
      await new Promise(r => setTimeout(r, 100));
      const after = {
        pendingLeft: document.querySelectorAll('#refList .thumb-pending').length,
        local: refAssets.length
      };
      return { mid, seen, after };
    })()`);
    check('S3a 上传期间占位卡可见（本地缩略图+spinner 角标）', flow.mid === true && flow.seen.pending >= 1 && flow.seen.badge >= 1, JSON.stringify(flow.seen));
    check('S3b 占位卡带逐张进度文案', /上传中/.test(flow.seen.progressText) && /\d+\/\d+/.test(flow.seen.progressText), flow.seen.progressText);
    check('S3c 全部完成后占位卡被正式卡接管', flow.after.pendingLeft === 0 && flow.after.local === 2, JSON.stringify(flow.after));
    const formal = await js(`document.querySelectorAll('#refList .thumb').length`);
    check('S3d 完成后参考图正式卡 2 张（已上传图床）', formal === 2, 'cards=' + formal);
  }

  /* ── S4 图床失败 → 占位卡转「重试上传」，点击补传成功 ── */
  {
    uploadShouldFail = true;
    const tmp3 = path.join(tmpDir, 'p3.png');
    fs.writeFileSync(tmp3, PNG);
    const fail = await js(`(async () => {
      const p = window.importFiles(['${tmp3}'], a => { if (!refAssets.some(x => x.id === a.id)) refAssets.push(a); });
      await p;
      // 收尾 renderRefs 后应出现重试按钮（url 为空的正式卡）
      const retry = document.querySelector('#refList .thumb-retry');
      return { hasRetry: !!retry, toast: document.querySelector('#toast').textContent };
    })()`);
    check('S4a 上传失败保留本地记录并给出「重试上传」按钮', fail.hasRetry, JSON.stringify(fail));
    uploadShouldFail = false;
    const fixed = await js(`(async () => {
      const btn = document.querySelector('#refList .thumb-retry');
      btn.click();
      await new Promise(r => setTimeout(r, 1400));   // 服务端延时 800ms
      const cur = refAssets[refAssets.length - 1];
      return { url: (cur && cur.url) || '', retryLeft: !!document.querySelector('#refList .thumb-retry') };
    })()`);
    check('S4b 点击重试补传成功，卡片回到已上传态', /fresh-|\\.png/.test(fixed.url) && !fixed.retryLeft, JSON.stringify(fixed));
  }

  /* ── S5 历史素材导入钩子：refreshStaleUrl 后台刷新 ── */
  {
    uploadHits = 0;
    const old = mk({ url: `${origin}/dead-link.png`, createdAt: hoursAgo(26) });
    const fresh2 = mk({ url: `${origin}/live-link.png`, urlAt: hoursAgo(3) });
    const r = await js(`(async () => {
      await window.refreshStaleUrl(await window.api.getAsset('${old.id}'));
      await window.refreshStaleUrl(await window.api.getAsset('${fresh2.id}'));
      return { oldUrl: (await window.api.getAsset('${old.id}')).url, freshUrl: (await window.api.getAsset('${fresh2.id}')).url };
    })()`);
    check('S5 超龄素材后台刷新、新鲜素材零请求', uploadHits === 1 && r.oldUrl.includes('/fresh-') && r.freshUrl === `${origin}/live-link.png`, 'hits=' + uploadHits + ' ' + JSON.stringify(r));
  }

  srv.close();
  win.destroy();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length) { console.log('FAILURES:'); failed.forEach(([n, , d]) => console.log(' -', n, '|', d)); }
  else console.log('ALL PASSED');
  clearTimeout(guard);
  app.exit(failed.length ? 1 : 0);
}).catch(e => { console.error('FATAL', e); process.exit(1); });
