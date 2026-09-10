const { app, BrowserWindow, shell, nativeTheme } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc');
const store = require('./store');

let mainWindow = null;

// 固定应用名，保证各平台/开发/打包后用户数据目录一致（ai-image-studio）
app.setName('ai-image-studio');

/* 窗口底色必须与页面 --bg-page 同色，否则深色模式启动时先白后黑闪一下。
   值由 styles.css 的 oklch token 换算而来（改 token 要同步改这里）。 */
const BG_LIGHT = '#f1f3f9';   // light:  --bg-page = oklch(96.5% 0.008 265)
const BG_DARK = '#15181f';    // dark:   --bg-page = oklch(21% 0.015 265)

function themeIsDark() {
  const t = store.getConfig().theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return nativeTheme.shouldUseDarkColors;        // system
}

/* 主题落地：nativeTheme 决定 prefers-color-scheme（渲染层的「跟随系统」分支靠它），
   底色决定新建/已存窗口的第一印象。 */
function applyThemeToApp() {
  const t = store.getConfig().theme;
  nativeTheme.themeSource = t === 'system' ? 'system' : t;
  const bg = themeIsDark() ? BG_DARK : BG_LIGHT;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(bg);
  return bg;
}

function createWindow(bg) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'AI 出图平台',
    icon: path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 外链交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 系统深浅色切换时，若处于「跟随系统」则同步底色
  nativeTheme.on('update', () => {
    if (store.getConfig().theme === 'system' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(themeIsDark() ? BG_DARK : BG_LIGHT);
    }
  });
}

app.whenReady().then(() => {
  store.init();
  const bg = applyThemeToApp();   // 先定主题与底色，再建窗口
  registerIpc({ applyTheme: applyThemeToApp });
  createWindow(bg);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(applyThemeToApp());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
