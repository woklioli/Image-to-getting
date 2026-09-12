/**
 * 模拟「上传图片」完整流程（与 ipc.js 中 asset:importFiles 处理器逻辑一致）：
 * 本地文件 -> 复制进应用目录 -> 上传图床换 URL -> 写入素材库 -> 校验
 * 用法：npx electron tools/test-upload.js
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('../src/main/store');
const { uploadFile } = require('../src/main/api');
const { pathToFileURL } = require('url');

const SRC = '/tmp/test-ref.png';

app.whenReady().then(async () => {
  // macOS 会定期清理 /tmp：缺 fixture 必须当场报错退出。否则 statSync 抛错后
  // 无人调 app.exit，进程会静默挂死（表现为「跑了十分钟，一行输出都没有」）。
  if (!fs.existsSync(SRC)) {
    console.error(`FAIL: 缺少测试图片 ${SRC}，先重建：cp assets/icon.png ${SRC}`);
    app.exit(1);
    return;
  }
  // 与正式应用（electron .）使用同一个用户数据目录
  app.setPath('userData', path.join(app.getPath('appData'), 'ai-image-studio'));
  store.init();
  const config = store.getConfig();
  console.log('1) 当前上传接口:', config.uploadUrl);
  console.log('   数据目录:', store.paths().userDataDir);

  console.log('2) 复制本地文件到 uploads 目录…');
  const stat = fs.statSync(SRC);
  let record = store.importUploadedFile(SRC, path.basename(SRC), 'image/png');
  record.size = stat.size;
  console.log('   素材 ID:', record.id);
  console.log('   本地路径:', record.localPath);
  console.log('   文件存在:', fs.existsSync(record.localPath));

  console.log('3) 上传到图床…');
  try {
    const url = await uploadFile(record.localPath, config.uploadUrl);
    record = store.addAsset({ ...record, url });
    console.log('   图床 URL:', url);
  } catch (e) {
    record = store.addAsset(record);
    console.log('   ⚠️ 图床上传失败（已保存本地记录）:', e.message);
  }

  console.log('4) 写入素材库后，上传图片列表:');
  const list = store.listAssets('upload');
  for (const a of list) {
    console.log(`   - [${a.type}] ${a.id.slice(0, 8)}  ${a.fileName}  url=${a.url ? '有' : '无'}`);
  }

  console.log('5) 页面渲染用的 file:// 地址:', pathToFileURL(record.localPath).href);
  console.log('   缩略图可访问(本地文件):', fs.existsSync(record.localPath));

  console.log('\n✅ 上传流程测试完成，该素材已出现在应用「历史素材-上传图片」中');
  app.exit(0);
}).catch(e => {   // 任何未捕获异常都要退出，绝不静默挂死（cron/CI 下会被误判为「还在跑」）
  console.error('FAIL:', e.stack || e.message);
  app.exit(1);
});
