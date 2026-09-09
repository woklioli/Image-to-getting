/**
 * 无头冒烟测试：加载渲染页面，收集控制台错误与加载失败，5 秒后退出。
 * 用法：npx electron tools/smoke-test.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpc } = require('../src/main/ipc');
const store = require('../src/main/store');

app.disableHardwareAcceleration();

const errors = [];

app.whenReady().then(async () => {
  store.init();
  registerIpc();
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`console[${level}]: ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    errors.push(`did-fail-load: ${code} ${desc}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('render-process-gone: ' + JSON.stringify(d)));

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  // 执行基本 DOM/接口可用性检查
  const checks = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    out.push(['window.api 存在', !!window.api]);
    out.push(['三个导航页签', document.querySelectorAll('.nav-item').length === 3]);
    out.push(['三个页面容器', document.querySelectorAll('.page').length === 3]);
    out.push(['设置页输入框', !!document.getElementById('cfgBaseUrl')]);
    out.push(['提示词输入框', !!document.getElementById('prompt')]);
    out.push(['尺寸选项数量', document.querySelectorAll('#paramSize option').length]);
    return out;
  })()`);

  // 测试配置读取
  const cfg = await win.webContents.executeJavaScript('window.api.getConfig()');

  setTimeout(() => {
    console.log('--- DOM 检查 ---');
    for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${ok}`);
    console.log('--- 配置默认值 ---');
    console.log('baseUrl =', cfg.baseUrl);
    console.log('modelPath =', cfg.modelPath);
    console.log('uploadUrl =', cfg.uploadUrl);
    console.log('--- 错误 ---');
    if (errors.length) {
      errors.forEach(e => console.log('ERROR:', e));
      app.exit(1);
    } else {
      console.log('无控制台错误');
      console.log('SMOKE TEST PASSED');
      app.exit(0);
    }
  }, 2500);
});
