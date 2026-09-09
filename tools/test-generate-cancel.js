/**
 * 阶段3 回归测试：取消生成（job 表 / 部分结果保留 / 真实错误不误判）+ 复用参数回填
 * 用法：npx electron tools/test-generate-cancel.js
 * 说明：测试在本机随机端口起一个慢速假接口（127.0.0.1），验证真实中止行为；不联网。
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const tmpDir = path.join(app.getPath('temp'), 'ai-studio-cancel-test-' + Date.now());
app.setPath('userData', tmpDir);

const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const guard = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);

/* 假接口时序：/upload 3s；模型 /v3/* 1.5s 返回 2 张图 URL；每张 /gen*.png 下载 2s；/bad → 502 */
function startFakeServer(png) {
  const srv = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const base = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          images: ['/gen1.png', '/gen2.png'].map(p => `http://127.0.0.1:${srv.address().port}${p}`)
        }));
      };
      if (req.url.startsWith('/upload')) {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ url: `http://127.0.0.1:${srv.address().port}/gen1.png` }));
        }, 3000);
      } else if (req.url.startsWith('/v3/')) {
        setTimeout(base, 1500);
      } else if (req.url.startsWith('/bad')) {
        setTimeout(() => { res.writeHead(502); res.end('bad gateway'); }, 200);
      } else if (req.url.startsWith('/gen')) {
        setTimeout(() => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); }, 2000);
      } else { res.writeHead(404); res.end(); }
    });
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  store.init();
  registerIpc();

  const srcIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  const srv = await startFakeServer(fs.readFileSync(srcIcon));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const dbPath = path.join(tmpDir, 'db.json');
  const readDb = () => JSON.parse(fs.readFileSync(dbPath, 'utf-8')).assets;

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await sleep(400);

  // 真实配置备份/还原（万一与正式环境共用 userData 目录也不留隐患）
  const realDir = path.join(app.getPath('appData'), 'ai-image-studio');
  const backup = {};
  for (const f of ['config.json', 'db.json']) {
    try { backup[f] = fs.readFileSync(path.join(realDir, f)); } catch { backup[f] = null; }
  }

  // 种子生成记录（复用场景）：直接入库，url 指向假图
  const seed = store.addAsset({
    id: store.newId(), type: 'generated', batchId: 'seed-batch',
    localPath: srcIcon, url: `${origin}/gen1.png`, fileName: 'seed.png',
    prompt: '把背景换成海边日落，保持人物不变',
    params: { n: 2, size: '1024x1536', quality: 'medium', background: 'opaque', output_format: 'jpeg' },
    refImages: [], maskImage: null, model: 'Seed Model', modelPath: 'v3/gpt-image-2-edit',
    createdAt: new Date().toISOString()
  });

  // 注意：getConfig 会给缺 id 的模型现生成 uuid，saveConfig 的 patch 必须带完整 models（含 id）
  store.saveConfig({
    baseUrl: origin, apiKey: 'test-key', uploadUrl: `${origin}/upload`,
    models: [
      { id: 'm-a', name: 'A', baseUrl: origin, modelPath: 'v3/gpt-image-2-edit', apiKey: 'test-key' },
      { id: 'm-bad', name: '坏模型', baseUrl: origin, modelPath: 'bad/endpoint', apiKey: 'test' }
    ],
    activeModelId: 'm-a'
  });
  // 窗口在 config 就绪后再加载，避免 renderActiveModelSelect 用启动瞬间的默认配置

  /* ── C1 UI：生成中按钮互换 + 耗时显示；点停止 → 灰色「已取消」（参考图上传阶段，无落盘） ── */
  // 造一张无 url 的上传素材，令 generate 停在 uploadFile
  const upA = store.addAsset(store.importUploadedFile(srcIcon, 'a.png', 'image/png'));
  const ui1 = await win.webContents.executeJavaScript(`(async () => {
    refAssets = [await window.api.getAsset(${JSON.stringify(upA.id)})];
    const P = document.getElementById('prompt'); P.value = '测试取消'; P.dispatchEvent(new Event('input'));
    document.getElementById('btnGenerate').click();
    await new Promise(r => setTimeout(r, 250));
    const mid = {
      stopHidden: document.getElementById('genStop').hidden,
      genDisabled: document.getElementById('btnGenerate').disabled,
      working: document.getElementById('genProgress').className.includes('working'),
      elapsed: document.getElementById('genElapsed').textContent
    };
    document.getElementById('genStop').click();
    await new Promise(r => setTimeout(r, 600));
    const el = document.getElementById('genProgress');
    return { mid, after: { cls: el.className, stage: document.getElementById('genStage').textContent,
      stopHidden: document.getElementById('genStop').hidden,
      genDisabled: document.getElementById('btnGenerate').disabled } };
  })()`);
  check('C1 生成中：停止按钮出现、开始按钮禁用、耗时显示',
    ui1.mid.stopHidden === false && ui1.mid.genDisabled === true && ui1.mid.working && /\d/.test(ui1.mid.elapsed),
    JSON.stringify(ui1.mid));
  check('C1 取消后：灰色「已取消」文案（非 error）、按钮恢复',
    ui1.after.cls.includes('canceled') && !ui1.after.cls.includes('error') &&
    /已取消/.test(ui1.after.stage) && ui1.after.stopHidden === true && ui1.after.genDisabled === false,
    JSON.stringify(ui1.after));

  /* ── C2 复用参数回填（prompt/params/modelPath 匹配/无参考图提示） ── */
  const ui2 = await win.webContents.executeJavaScript(`(async () => {
    await reuseParams(await window.api.getAsset(${JSON.stringify(seed.id)}));
    await new Promise(r => setTimeout(r, 120));
    return {
      prompt: document.getElementById('prompt').value,
      count: document.getElementById('promptCount').textContent,
      size: document.getElementById('paramSize').value,
      quality: document.getElementById('paramQuality').value,
      n: document.getElementById('paramN').value,
      background: document.getElementById('paramBackground').value,
      format: document.getElementById('paramFormat').value,
      refs: refAssets.length,
      activeModel: document.getElementById('activeModel').value,
      toast: document.getElementById('toast').textContent
    };
  })()`);
  check('C2 复用回填 prompt + 全部生成参数',
    ui2.prompt.includes('海边日落') && ui2.size === '1024x1536' && ui2.quality === 'medium' &&
    ui2.n === '2' && ui2.background === 'opaque' && ui2.format === 'jpeg', JSON.stringify(ui2));
  check('C2 复用按 modelPath 匹配并激活 m-a', ui2.activeModel === 'm-a', ui2.activeModel);
  check('C2 无参考图时提示手动添加', ui2.refs === 0 && ui2.toast.includes('没有参考图'), JSON.stringify({ refs: ui2.refs, toast: ui2.toast }));

  // 复用后 activeModel 仍是 m-a，继续
  /* ── C3 部分结果保留：模型 1.5s 出图，图1 下载 1.5→3.5s，图2 3.5→5.5s，在 4.2s 取消 → 保 1 张 ── */
  const before3 = readDb().filter(a => a.type === 'generated').length;
  const c3 = await win.webContents.executeJavaScript(`(async () => {
    window.api.generate({ jobId: 'job-c3', refAssetIds: [${JSON.stringify(seed.id)}], maskAssetId: null, prompt: '部分保留测试XYZ', params: { n: 2 } });
    await new Promise(r => setTimeout(r, 4200));
    const hit = await window.api.cancelGenerate('job-c3');
    await new Promise(r => setTimeout(r, 1500));
    return { hit };
  })()`);
  const genAfter3 = readDb().filter(a => a.type === 'generated' && (a.prompt || '').includes('部分保留测试XYZ'));
  check('C3 取消命中作业', c3.hit === true);
  check('C3 已落盘的部分结果保留（≥1 张，接口已出图不丢弃）',
    genAfter3.length >= 1 && genAfter3.length <= 2, `新增 ${genAfter3.length} 张`);

  /* ── C4 早期取消（上传阶段）：canceled 而非 reject，且不落任何生成记录 ── */
  const upB = store.addAsset(store.importUploadedFile(srcIcon, 'b.png', 'image/png'));
  const before4 = readDb().length;
  const c4 = await win.webContents.executeJavaScript(`(async () => {
    const p = window.api.generate({ jobId: 'job-c4', refAssetIds: [${JSON.stringify(upB.id)}], prompt: 'x', params: {} });
    await new Promise(r => setTimeout(r, 60));
    await window.api.cancelGenerate('job-c4');
    try { return { res: await p }; } catch (e) { return { rejected: String(e && e.message) }; }
  })()`);
  check('C4 上传阶段取消走 canceled 而非 reject', c4.res && c4.res.canceled === true && !c4.rejected, JSON.stringify(c4));
  check('C4 早期取消不新增生成记录', readDb().length === before4);

  /* ── C5 未知 jobId cancel 返回 false ── */
  const c5 = await win.webContents.executeJavaScript(`window.api.cancelGenerate('job-nope')`);
  check('C5 取消不存在的作业返回 false', c5 === false);

  /* ── C6 真实接口错误（502）正常 reject，不被误判为取消 ── */
  await store.saveConfig({ activeModelId: 'm-bad' });
  const c6 = await win.webContents.executeJavaScript(`(async () => {
    try {
      await window.api.generate({ jobId: 'job-c6', refAssetIds: [${JSON.stringify(seed.id)}], prompt: 'x', params: {} });
      return { resolved: true };
    } catch (e) { return { resolved: false, canceled: !!(e && e.canceled), msg: String(e && e.message) }; }
  })()`);
  check('C6 502 错误 reject 且文案非「取消」',
    c6.resolved === false && c6.canceled === false && /生图接口调用失败/.test(c6.msg), JSON.stringify(c6));

  clearTimeout(guard);
  srv.close();
  for (const [f, buf] of Object.entries(backup)) {
    const p = path.join(realDir, f);
    try { if (buf) fs.writeFileSync(p, buf); else fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `\n${failed.length} 项失败` : '\nALL PASSED');
  app.exit(failed.length ? 1 : 0);
});
