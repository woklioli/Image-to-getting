/**
 * OpenAI 官方 Images API 渠道回归测试
 * 用法：npx electron tools/test-openai-channel.js
 * 本机随机端口起假接口（不联网）：
 *   - generations：JSON，断言 body.model 存在、无参考图字段，返回 data[].b64_json + usage
 *   - edits：multipart/form-data，断言 image[] 文件段存在，返回 data[].b64_json
 * 验证：纯文生图放行、参考图本地直传（不碰图床）、custom 模式必填参考图不回归、
 *       设置页模型卡渲染/保存 apiType+modelName、激活渠道回退聚合站行为不变。
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
const tmpDir = path.join(app.getPath('temp'), 'ai-studio-openai-test-' + Date.now());
app.setPath('userData', tmpDir);

const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const guard = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);

const PNG_B64 = (() => {
  // 1x1 png
  const buf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  return buf.toString('base64');
})();
const PNG = Buffer.from(PNG_B64, 'base64');

/* 记录假接口命中情况 */
const hits = { generations: null, edits: null, editsRaw: '', upload: 0 };

function startFakeServer() {
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const reply = obj => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith('/v1/images/generations')) {
        hits.generations = { ct: req.headers['content-type'] || '', auth: req.headers.authorization || '', body: JSON.parse(raw) };
        // 用户示例的出参形状
        reply({
          created: 1789119590, background: 'opaque',
          data: [{ b64_json: PNG_B64 }],
          output_format: 'png', quality: 'low', size: '1024x1024',
          usage: { input_tokens: 11, output_tokens: 229, total_tokens: 240 }
        });
      } else if (req.url.startsWith('/v1/images/edits')) {
        hits.edits = { ct: req.headers['content-type'] || '' };
        hits.editsRaw = raw;
        reply({ created: 1, data: [{ b64_json: PNG_B64 }] });
      } else if (req.url.startsWith('/v3/')) {
        hits.generations = hits.generations || null;
        reply({ images: [] , data: [{ b64_json: PNG_B64 }] });
      } else if (req.url.startsWith('/upload')) {
        hits.upload++;
        reply({ url: `http://127.0.0.1:${srv.address().port}/x.png` });
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

  const srv = await startFakeServer();
  const origin = `http://127.0.0.1:${srv.address().port}`;

  store.saveConfig({
    baseUrl: origin, apiKey: 'global-key', uploadUrl: `${origin}/upload`,
    models: [
      { id: 'm-oai', name: 'OpenAI GPT Image 2', baseUrl: `${origin}/v1`, modelPath: '', apiKey: 'sk-oai', apiType: 'openai', modelName: 'gpt-image-2' },
      { id: 'm-hw', name: '聚合站', baseUrl: origin, modelPath: 'v3/gpt-image-2-edit', apiKey: '', apiType: 'custom', modelName: '' }
    ],
    activeModelId: 'm-oai',
    openaiPresetAdded: true
  });

  const srcIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  const seedUpload = store.addAsset({
    id: store.newId(), type: 'upload', fileName: 'seed.png', localPath: srcIcon,
    url: '', size: fs.statSync(srcIcon).size, mime: 'image/png', createdAt: new Date().toISOString()
  });

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

  /* ── O1 纯文生图：无参考图可生成，请求为 JSON 且带 model，出参 b64 落盘，usage 透传 ── */
  {
    const res = await js(`window.api.generate({
      jobId: 'o1', refAssetIds: [], maskAssetId: null,
      prompt: '生成一只小猫',
      params: { n: 1, size: '1024x1024', quality: 'low', background: 'auto', output_format: 'png' }
    })`);
    const g = hits.generations;
    check('O1 无参考图生成成功且落盘 1 张', !res.canceled && res.images.length === 1 && fs.existsSync(res.images[0].localPath), JSON.stringify({ n: res.images.length }));
    check('O1 请求走 generations(JSON)', !!g && /application\/json/.test(g.ct) && g.auth === 'Bearer sk-oai');
    check('O1 请求体带 model 字段、无 image 字段', !!g && g.body.model === 'gpt-image-2' && g.body.prompt === '生成一只小猫' && !('image' in g.body), g ? JSON.stringify(g.body).slice(0, 160) : '');
    check('O1 usage 透传给渲染层', res.usage && res.usage.total_tokens === 240, JSON.stringify(res.usage || null));
    check('O1 全程未调用图床', hits.upload === 0, 'upload hits=' + hits.upload);
    const dbAsset = store.getAsset(res.images[0].id);
    check('O1 素材记录含 model 与空 refImages', dbAsset.model === 'OpenAI GPT Image 2' && (dbAsset.refImages || []).length === 0);
  }

  /* ── O2 有参考图：走 edits(multipart)，本地文件直传不碰图床 ── */
  {
    const before = hits.upload;
    const res = await js(`window.api.generate({
      jobId: 'o2', refAssetIds: ['${seedUpload.id}'], maskAssetId: null,
      prompt: '给这张图加顶帽子',
      params: { n: 1, size: 'auto', quality: 'medium', background: 'auto', output_format: 'webp' }
    })`);
    check('O2 edits 生成成功', !res.canceled && res.images.length === 1, JSON.stringify({ n: (res.images || []).length }));
    check('O2 请求为 multipart 且含 image[] 文件段', !!hits.edits && /multipart\/form-data/.test(hits.edits.ct) && /name="image\[\]"/.test(hits.editsRaw), hits.edits ? hits.edits.ct : '未命中 edits');
    check('O2 multipart 携带 model/prompt/output_format', /name="model"[\s\S]*?gpt-image-2/.test(hits.editsRaw) && /name="output_format"[\s\S]*?webp/.test(hits.editsRaw));
    check('O2 参考图未上传图床', hits.upload === before, 'upload delta=' + (hits.upload - before));
    const dbAsset = store.getAsset(res.images[0].id);
    check('O2 记录仍引用参考图素材', (dbAsset.refImages || []).some(r => r.id === '${seedUpload.id}'.replace(/'/g, '')) || (dbAsset.refImages || []).length === 1, JSON.stringify(dbAsset.refImages));
  }

  /* ── O3 custom 模式回归：无参考图仍被拒（主进程+渲染层双保险） ── */
  {
    store.saveConfig({ activeModelId: 'm-hw' });
    let err = '';
    try {
      await js(`window.api.generate({ jobId: 'o3', refAssetIds: [], prompt: 'hi', params: {} })`);
    } catch (e) { err = e.message || String(e); }
    check('O3 聚合站模式无参考图报错', /至少添加一张参考图/.test(err), err);
  }

  /* ── O4 设置页 UI：模型卡渲染接口类型下拉 + 模型名输入；保存后字段持久化 ── */
  {
    await js(`window.dispatchEvent(new Event('focus'))`);
    const ui = await js(`(async () => {
      document.querySelector('.nav-item[data-page="settings"]').click();
      await new Promise(r => setTimeout(r, 250));
      const item = document.querySelector('#modelList .model-item[data-id="m-oai"]');
      const sel = item.querySelector('[data-f="apiType"]');
      const name = item.querySelector('[data-f="modelName"]');
      return {
        hasSel: !!sel && sel.value === 'openai',
        opts: sel ? sel.options.length : 0,
        nameVal: name ? name.value : null, nameEnabled: name ? !name.disabled : null,
        pathPlaceholder: item.querySelector('[data-f="modelPath"]').placeholder,
        items: document.querySelectorAll('#modelList .model-item').length
      };
    })()`);
    check('O4 OpenAI 模型卡显示 apiType=openai 下拉', ui.hasSel && ui.opts === 2, JSON.stringify(ui));
    check('O4 modelName 回填 gpt-image-2 且可用', ui.nameVal === 'gpt-image-2' && ui.nameEnabled === true);
    check('O4 openai 模式 modelPath 占位符提示自动路径', /generations/.test(ui.pathPlaceholder), ui.pathPlaceholder);
    check('O4 模型列表含两个模型', ui.items === 2, 'items=' + ui.items);

    // 切换 apiType → 卡片重建，模型名变必填可用、星号迁移
    const toggle = await js(`(async () => {
      const item = document.querySelector('#modelList .model-item[data-id="m-hw"]');
      const sel = item.querySelector('[data-f="apiType"]');
      sel.value = 'openai';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const again = document.querySelector('#modelList .model-item[data-id="m-hw"]');
      const name = again.querySelector('[data-f="modelName"]');
      const label = name.closest('.field').querySelector('span').innerHTML;
      // 补上模型名，满足 openai 模式逐模型必填校验
      name.value = 'gpt-image-2';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      return { modelNameEnabled: !name.disabled, labelHasReq: /class="req"/.test(label) };
    })()`);
    check('O4 切到 openai 后 模型名变必填可用', toggle.modelNameEnabled && toggle.labelHasReq, JSON.stringify(toggle));

    // 缺模型名时保存应被拦截（新逐模型校验）
    const blocked = await js(`(async () => {
      const before = document.querySelector('#cfgTip').textContent;
      const n = document.querySelector('#modelList .model-item[data-id="m-hw"] [data-f="modelName"]');
      const v = n.value; n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#btnSaveConfig').click();
      await new Promise(r => setTimeout(r, 200));
      n.value = v; n.dispatchEvent(new Event('input', { bubbles: true }));
      return { blocked: document.querySelector('#cfgTip').textContent === before };
    })()`);
    check('O4 缺模型名的 openai 模型保存被拦截', blocked.blocked === true, JSON.stringify(blocked));

    // 保存配置：collectConfigFromForm → saveConfig → 重读持久化
    const saved = await js(`(async () => {
      document.querySelector('#btnSaveConfig').click();
      await new Promise(r => setTimeout(r, 350));
      const cfg = await window.api.getConfig();
      const hw = cfg.models.find(m => m.id === 'm-hw');
      return { hwType: hw.apiType, hwName: hw.modelName, activeKeeps: cfg.models.find(m => m.id === 'm-oai').modelName };
    })()`);
    check('O4 保存后 apiType/modelName 持久化', saved.hwType === 'openai' && saved.hwName === 'gpt-image-2' && saved.activeKeeps === 'gpt-image-2', JSON.stringify(saved));
    // 复原 m-hw 为 custom（主进程直接写，避免渲染层异步链）
    {
      const cfg = store.getConfig();
      store.saveConfig({ models: cfg.models.map(m => m.id === 'm-hw' ? { ...m, apiType: 'custom', modelName: '' } : m) });
    }
  }

  /* ── O5 调用页校验：openai 模式无参考图不再前端拦截；custom 模式拦截 ── */
  {
    const res = await js(`(async () => {
      // 回到调用页、通过页内下拉切到 openai 模型（监听器会把最新配置写回渲染层 settingsCfg）
      document.querySelector('.nav-item[data-page="generate"]').click();
      await new Promise(r => setTimeout(r, 150));
      const sel = document.querySelector('#activeModel');
      sel.value = 'm-oai';
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 250));
      // 触发按钮点击路径的校验：清空提示词点击 → 应提示；openai+无参考图+有提示词 → 应放行
      window.__toastLog = [];
      const t0 = window.toast; window.toast = (m, k) => { window.__toastLog.push(m); return t0(m, k); };
      document.querySelector('#prompt').value = '';
      document.querySelector('#btnGenerate').click();
      await new Promise(r => setTimeout(r, 120));
      const noPrompt = window.__toastLog.join('|');
      window.__toastLog = [];
      document.querySelector('#prompt').value = 'x';
      document.querySelector('#btnGenerate').click();   // openai+无参考图 → 不被前端拦截；假接口秒回 → 等待完成
      await new Promise(r => setTimeout(r, 1500));
      // 放行判据：没有出现「请先添加至少一张参考图」拦截，且结果卡出现/有成功提示
      const passed = !window.__toastLog.some(m => /请先添加至少一张参考图/.test(m))
        && (window.__toastLog.some(m => /生成成功/.test(m)) || document.querySelector('#resultCard').style.display !== 'none');
      return { noPrompt, passed, log: window.__toastLog.join('|') };
    })()`);
    check('O5 openai 模式空提示词仍提示填写', /请填写提示词/.test(res.noPrompt), res.noPrompt);
    check('O5 openai 模式无参考图放行生成', res.passed === true, JSON.stringify(res));
  }

  /* ── O6 首启迁移：全新 userData 的 DEFAULT_CONFIG 自带 OpenAI 预设 ── */
  {
    const cfg = store.getConfig();
    check('O6 当前配置模型齐全（迁移不破坏既有）', cfg.models.length === 2);
  }

  await js(`window.api.cancelGenerate && window.api.cancelGenerate('o2')`).catch(() => {});
  srv.close();
  win.destroy();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} 通过 ====`);
  if (failed.length) { console.log('FAILURES:'); failed.forEach(([n, , d]) => console.log(' -', n, '|', d)); }
  else console.log('ALL PASSED');
  clearTimeout(guard);
  app.exit(failed.length ? 1 : 0);
}).catch(e => { console.error('FATAL', e); process.exit(1); });
