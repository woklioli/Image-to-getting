/**
 * 走「正式应用启动路径」（加载 src/main/main.js，含 store.init + IPC 注册），
 * 然后在渲染进程里真实调用 window.api.importFiles() 验证上传链路。
 * 用法：npx electron tools/test-main-upload.js
 */
const { app, BrowserWindow } = require('electron');

// 加载正式主进程入口（会创建窗口、初始化 store、注册 IPC）
require('../src/main/main');

app.whenReady().then(() => {
  setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) { console.log('FAIL: 未找到窗口'); app.exit(1); }
    try {
      const results = await win.webContents.executeJavaScript(`
        window.api.importFiles(['/tmp/avatar-test.jpg'])
      `);
      console.log('importFiles 返回:');
      for (const r of results) {
        if (r.ok) {
          console.log('  ✅ ok =', r.ok);
          console.log('     素材 ID:', r.asset.id);
          console.log('     本地路径:', r.asset.localPath);
          console.log('     图床 URL:', r.asset.url || '(无)');
          console.log('     warning:', r.warning || '无');
        } else {
          console.log('  ❌ 失败:', r.fileName, r.error);
        }
      }
      const list = await win.webContents.executeJavaScript(`window.api.listAssets('upload')`);
      console.log('上传素材总数:', list.length);
      app.exit(results.some(r => r.ok) ? 0 : 1);
    } catch (e) {
      console.log('❌ 渲染进程调用异常:', e.message);
      app.exit(1);
    }
  }, 3500);
});
