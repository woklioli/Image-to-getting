# AI 出图桌面端 实施方案

## 技术选型
- **Electron + 原生 HTML/CSS/JS**（零前端构建步骤，最稳），用 `electron-builder` 打包成 Windows 软件。
- 在本机（macOS）交叉编译 Windows 安装包（NSIS `.exe` 安装版 + portable 免安装版各一个）；未签名，Windows 首次运行会有 SmartScreen 提示，点"仍要运行"即可。同时提供 `npm run dist:win` 脚本，用户在 Windows 机器上也可一键打包。
- 数据存于系统应用数据目录（Windows 下为 `%APPDATA%/ai-image-studio`）：`config.json`（配置）、`db.json`（素材元数据）、`images/uploads/`（上传图本地副本）、`images/generated/`（生成图）。

## 项目结构
```
接口AI出图平台/
├── package.json              # 依赖、electron-builder 打包配置、脚本
├── src/
│   ├── main/
│   │   ├── main.js           # 应用生命周期、创建窗口
│   │   ├── preload.js        # contextBridge 暴露安全 API 给页面
│   │   ├── store.js          # 配置读写、素材记录持久化、图片文件管理
│   │   ├── api.js            # tmpfile 上传、生图接口调用、图片下载/base64 解码
│   │   └── ipc.js            # 所有 IPC 处理器
│   └── renderer/
│       ├── index.html        # 三个页签：调用模型 / 历史素材 / 设置
│       ├── styles.css        # 简洁中文 UI 样式
│       └── app.js            # 页面逻辑
├── assets/icon.png           # 应用图标（用 Node 脚本生成 256x256 PNG）
└── README.md                 # 使用说明 + Windows 打包说明
```

## 主进程功能
**配置（设置页）**：渠道 Base URL（默认 `https://api.highwayapi.ai`）、图片模型/接口路径（默认 `v3/gpt-image-2-edit`，最终请求 URL = Base URL + 路径）、API Key（Bearer 令牌，密码框）、上传接口地址（默认 `https://tmpfile.link/api/upload`）。

**素材数据模型**：
- 上传素材：`{id, type:'upload', fileName, localPath, url, size, mime, createdAt}`
- 生成素材：`{id, type:'generated', batchId, localPath, url, prompt, params:{size,quality,n,background,output_format}, refImages:[{id, localPath, url}], maskImage:{id,localPath}|null, model, createdAt}` —— 即用户要求的：生成图 ID、本地保存路径、参考图 ID 及其路径、提示词，另附参数和时间便于追溯。

**核心流程**：
1. 上传图片：文件对话框选择 → 复制到 `images/uploads/` → 以 multipart/form-data POST 到 tmpfile（已实测返回 `downloadLink`）→ 保存素材记录。
2. 调用生图：参考图支持"本页新上传"和"从历史素材选择"（上传/生成两类素材都可选，支持多张，接口支持图片数组）；无 URL 的本地图自动先上传 tmpfile 取 URL → POST `{baseUrl}/{modelPath}`，头 `Authorization: Bearer {apiKey}`，体含 `image`(URL 数组)、`prompt`、`mask`(可选)、`size`、`quality`、`n`、`background`、`output_format` → 解析返回的 `images[]`：http 链接则下载保存，data:/纯 base64 则解码保存 → 每张图生成一条生成素材记录（含参考图 ID+路径、提示词）→ 返回结果展示。
3. 历史素材页：上传图片 / 生成图片 两个分类页签；卡片网格展示缩略图；生成图卡片显示 生成图ID、本地路径、提示词、参考图（ID+路径，可点击定位）、参数、时间；支持预览大图、打开所在文件夹、复制路径/URL、删除记录。

## 渲染端 UI（中文）
- 侧边栏三页：**调用模型**（参考图区+上传/选历史按钮、提示词、尺寸/质量/数量/背景/输出格式、可选遮罩图、生成按钮与进度、结果网格）、**历史素材**（两分类页签+素材卡片）、**设置**（首次启动引导配置）。
- 历史素材选择器为弹窗，含"上传图片/生成图片"两个页签，可多选。

## 验证与交付
1. `npm install` 安装 electron、electron-builder。
2. `npm start` 冒烟测试，确认窗口正常启动无报错。
3. 用 Node + zlib 脚本生成图标 PNG。
4. `npm run dist:win` 交叉编译，产出 `dist/` 下的 Windows NSIS 安装包和 portable 免安装 exe，并核对文件。
5. README 写明：配置方法、使用流程、在 Windows 上自行打包的命令。