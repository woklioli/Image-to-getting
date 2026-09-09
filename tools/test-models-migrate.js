/**
 * 验证旧版单模型配置自动迁移 + 多模型增删保存
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const store = require('../src/main/store');
  const dir = path.join(app.getPath('temp'), 'ai-studio-migrate-test');
  fs.rmSync(dir, { recursive: true, force: true });
  app.setPath('userData', dir);
  store.init();

  // 1) 写入旧版配置
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    baseUrl: 'https://api.highwayapi.ai',
    modelPath: 'v3/gpt-image-2-edit',
    apiKey: 'sk-old-123',
    uploadUrl: 'https://tmpfile.link/api/upload'
  }));

  let cfg = store.getConfig();
  console.log('迁移后模型数:', cfg.models.length);
  console.log('模型[0]:', JSON.stringify(cfg.models[0]));
  console.log('activeModelId:', cfg.activeModelId);
  const m = cfg.models[0];
  const okMigrate = cfg.models.length === 1 && m.modelPath === 'v3/gpt-image-2-edit';
  console.log(okMigrate ? 'PASS 旧配置迁移' : 'FAIL 旧配置迁移');

  // 2) 保存多模型
  cfg = store.saveConfig({
    baseUrl: 'https://global.example.com',
    apiKey: 'sk-global',
    uploadUrl: 'https://tmpfile.link/api/upload',
    models: [
      { id: 'a', name: '模型A', modelPath: 'v3/model-a', baseUrl: '', apiKey: '' },
      { id: 'b', name: '模型B', modelPath: 'v3/model-b', baseUrl: 'https://b.example.com', apiKey: 'sk-b' }
    ],
    activeModelId: 'b'
  });
  console.log('保存后 active:', cfg.activeModelId, '| 模型数:', cfg.models.length);
  const active = cfg.models.find(x => x.id === cfg.activeModelId);
  console.log('当前模型:', active.name, '→', active.baseUrl || cfg.baseUrl, '/', active.modelPath,
    '| key:', active.apiKey || cfg.apiKey);

  // 3) 重新读取，验证持久化
  const reread = store.getConfig();
  const okPersist = reread.models.length === 2 && reread.activeModelId === 'b';
  console.log(okPersist ? 'PASS 多模型持久化' : 'FAIL 多模型持久化');

  fs.rmSync(dir, { recursive: true, force: true });
  app.exit(okMigrate && okPersist ? 0 : 1);
});
