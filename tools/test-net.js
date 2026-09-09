const { app } = require('electron');
app.whenReady().then(async () => {
  const targets = ['https://www.baidu.com', 'https://tmpfile.link/api/upload', 'https://api.highwayapi.ai'];
  for (const u of targets) {
    try {
      const r = await fetch(u, { method: 'GET' });
      console.log('OK  ', u, '->', r.status);
    } catch (e) {
      console.log('FAIL', u, '->', e.message, '| cause:', e.cause && (e.cause.code || e.cause.message || e.cause));
    }
  }
  app.exit(0);
});
