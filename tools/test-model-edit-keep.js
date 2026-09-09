/**
 * P0 回归测试：设置页模型编辑不被吞掉、activeModelId 不回退
 * 覆盖旧版四个必现 bug 场景：
 *   1) 手打模型名称 -> 点另一个模型的 radio -> 值必须还在（旧版丢）
 *   2) 手打值 -> 点「添加模型」 -> 值必须还在（旧版丢）
 *   3) 手打值 -> 删除另一个模型 -> 值必须还在（旧版丢）
 *   4) 调用页下拉切模型 -> 设置页 radio 跟随 -> 点保存不回退（旧版回退）
 * 用法：npx electron tools/test-model-edit-keep.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const tmpDir = path.join(app.getPath('temp'), 'ai-studio-model-edit-test-' + Date.now());
app.setPath('userData', tmpDir);

const R = path.join(__dirname, '..', 'src', 'renderer');
const results = [];
function check(name, ok, detail = '') {
  results.push([name, !!ok, detail]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' | ' + detail : ''}`);
}

const guard = setTimeout(() => {
  console.log('TIMEOUT 测试超时未完成');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.exit(1);
}, 40000);

async function freshWin() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  win.on('dialog', e => e.preventDefault());  // 保险：headless 下 confirm 直接放行
  await win.loadFile(path.join(R, 'index.html'));
  await new Promise(r => setTimeout(r, 400)); // 等 loadConfig 完成
  return win;
}

app.whenReady().then(async () => {
  const store = require('../src/main/store');
  const { registerIpc } = require('../src/main/ipc');
  store.init();
  registerIpc();

  // 预置两个模型到磁盘，再加载页面让渲染层内存与之一致
  store.saveConfig({
    models: [
      { id: 'm-a', name: 'A', modelPath: 'v3/a', baseUrl: '', apiKey: '' },
      { id: 'm-b', name: 'B', modelPath: 'v3/b', baseUrl: '', apiKey: '' }
    ],
    activeModelId: 'm-a'
  });
  let win = await freshWin();
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-page="settings"]').click()`);

  // ── 场景 1：填值 -> 点另一个模型 radio ──
  let s1 = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('#modelList .model-item')];
    const ni = items[0].querySelector('[data-f="name"]');
    ni.value = '我的新模型XYZ'; ni.dispatchEvent(new Event('input', { bubbles: true }));
    const pi = items[0].querySelector('[data-f="modelPath"]');
    pi.value = 'v3/mine-typed'; pi.dispatchEvent(new Event('input', { bubbles: true }));
    items[1].querySelector('input[type=radio]').click();
    const a0 = [...document.querySelectorAll('#modelList .model-item')][0];
    return {
      name: a0.querySelector('[data-f="name"]').value,
      mp: a0.querySelector('[data-f="modelPath"]').value,
      radio0: a0.querySelector('input[type=radio]').checked
    };
  })()`);
  check('S1 切 radio 后未保存输入保留', s1.name === '我的新模型XYZ' && s1.mp === 'v3/mine-typed', JSON.stringify(s1));
  check('S1 radio 选中态正确切换', s1.radio0 === false, JSON.stringify(s1));

  // ── 场景 2：填值 -> 点添加模型 ──
  let s2 = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('#modelList .model-item')];
    const ni = items[0].querySelector('[data-f="name"]');
    ni.value = '保留我'; ni.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('btnAddModel').click();
    const a0 = [...document.querySelectorAll('#modelList .model-item')][0];
    return { name: a0.querySelector('[data-f="name"]').value,
             count: document.querySelectorAll('#modelList .model-item').length };
  })()`);
  check('S2 添加模型后输入保留', s2.name === '保留我' && s2.count === 3, JSON.stringify(s2));

  // ── 场景 3：填值 -> 删除最后一个模型 ──
  let s3 = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('#modelList .model-item')];
    const ni = items[0].querySelector('[data-f="name"]');
    ni.value = '删除也别丢'; ni.dispatchEvent(new Event('input', { bubbles: true }));
    window.confirm = () => true;
    items[items.length - 1].querySelector('.model-del').click();
    const a0 = [...document.querySelectorAll('#modelList .model-item')][0];
    return { name: a0.querySelector('[data-f="name"]').value,
             count: document.querySelectorAll('#modelList .model-item').length };
  })()`);
  check('S3 删除模型后输入保留', s3.name === '删除也别丢' && s3.count === 2, JSON.stringify(s3));

  // ── 场景 4：下拉切 m-a -> radio 跟随 -> 保存 -> 不篡改名称、不回退 active ──
  let s4 = await win.webContents.executeJavaScript(`(async () => {
    const sel = document.getElementById('activeModel');
    sel.value = 'm-a'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const itemA = [...document.querySelectorAll('#modelList .model-item')].find(i => i.dataset.id === 'm-a');
    const followed = itemA.querySelector('input[type=radio]').checked === true;
    document.getElementById('btnSaveConfig').click();
    await new Promise(r => setTimeout(r, 300));
    const cfg = await window.api.getConfig();
    const a = cfg.models.find(m => m.id === 'm-a');
    return { followed, savedActive: cfg.activeModelId, savedName: a && a.name, savedPath: a && a.modelPath };
  })()`);
  check('S4 下拉切换后设置页 radio 跟随', s4.followed, JSON.stringify(s4));
  check('S4 保存后 activeModelId 不回退', s4.savedActive === 'm-a', JSON.stringify(s4));
  check('S4 未保存输入经保存落盘（实时同步生效）', s4.savedName === '删除也别丢' && s4.savedPath === 'v3/mine-typed', JSON.stringify(s4));

  // ── 场景 5：重开窗口（模拟重启应用），验证已保存数据完整回显 ──
  win.close();
  win = await freshWin();
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-page="settings"]').click()`);
  const s5 = await win.webContents.executeJavaScript(`(() => {
    const items = [...document.querySelectorAll('#modelList .model-item')];
    const a = items.find(i => i.dataset.id === 'm-a');
    return { count: items.length, name: a.querySelector('[data-f="name"]').value,
             mp: a.querySelector('[data-f="modelPath"]').value, active: a.classList.contains('active') };
  })()`);
  check('S5 重启后数据完整回显', s5.count === 2 && s5.name === '删除也别丢' && s5.mp === 'v3/mine-typed' && s5.active, JSON.stringify(s5));

  clearTimeout(guard);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `\n${failed.length} 项失败` : '\nALL PASSED');
  app.exit(failed.length ? 1 : 0);
});
