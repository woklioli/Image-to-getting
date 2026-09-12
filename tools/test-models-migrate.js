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
  const oai = cfg.models.find(x => x.id === 'model-openai-gpt-image-2');
  // 契约：旧单模型配置保留原模型为 [0]，并一次性补种 OpenAI 渠道预设；
  // activeModelId 必须仍是原模型——补种不得劫持用户当前渠道
  const okMigrate = cfg.models.length === 2 && m.modelPath === 'v3/gpt-image-2-edit'
    && m.apiType === 'custom'
    && !!oai && oai.apiType === 'openai' && oai.modelName === 'gpt-image-2' && !oai.modelPath
    && cfg.activeModelId === 'model-default' && cfg.openaiPresetAdded === true;
  console.log(okMigrate ? 'PASS 旧配置迁移（保留原模型 + 补种 OpenAI 预设 + 不劫持当前渠道）' : 'FAIL 旧配置迁移');

  // 1b) 幂等：openaiPresetAdded 已落盘，重复读取不得叠加第二个预设
  const again = store.getConfig();
  const okIdempotent = again.models.filter(x => x.id === 'model-openai-gpt-image-2').length === 1
    && again.models.length === 2;
  console.log(okIdempotent ? 'PASS 补种幂等（重复读取不叠加预设）' : 'FAIL 补种幂等（重复读取不叠加预设）');

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
  app.exit(okMigrate && okIdempotent && okPersist ? 0 : 1);
});
