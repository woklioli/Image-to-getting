# AI 出图平台（桌面端）

基于 Electron 的桌面应用：配置渠道 Base URL / 图片模型接口 / API Key，上传或选择历史素材作为参考图，调用生图接口生成图片。支持两类渠道：**聚合站编辑接口**（默认，如 `/v3/gpt-image-2-edit`，参考图经图床换 URL）与 **OpenAI 官方 Images API**（`gpt-image-2`，本地文件直传、支持纯文生图）。所有素材（上传图、生成图）均保存在本机并记入历史素材。

- ✅ 可在 macOS 上直接运行（开发调试）
- ✅ 可打包为 **Windows** 软件（NSIS 安装包 `.exe`、免安装 portable `.exe`、zip 绿色版）
- ✅ 可打包为 macOS 应用（`.dmg` / `.zip`）

---

## 功能一览

### 1. 设置页
**全局渠道配置**（各模型留空专属配置时使用）：
| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| 全局渠道 Base URL | 接口域名 | `https://api.highwayapi.ai` |
| 全局 API Key | Bearer 令牌，请求头 `Authorization: Bearer <key>` | 空 |
| 图片上传接口地址 | 图床地址，参考图先上传换取 URL | `https://tmpfile.link/api/upload` |

**模型列表（支持多个模型）**：
- 点「➕ 添加模型」可新增任意数量的模型，每个模型包含：**接口类型**（聚合站编辑接口 / OpenAI 官方 Images API）、模型名称、模型名 `model`（OpenAI 模式必填，如 `gpt-image-2`）、接口路径（聚合站模式必填，如 `v3/gpt-image-2-edit`；OpenAI 模式可留空）、专属 Base URL（留空用全局）、专属 API Key（留空用全局）。
- 不同模型可以指向不同渠道、使用不同密钥；单选框选中的为「当前使用模型」。
- 在「调用模型」页顶部可通过下拉框快速切换当前模型。
- 旧版单模型配置会在首次启动时自动迁移为模型列表；老配置首次启动还会自动追加一条 **OpenAI GPT Image 2** 预设（Base `https://api.openai.com/v1`，需自行填入 API Key，不用可删）。
- 最终请求地址 = 模型专属 Base URL（或全局）+ 接口路径；接口路径写完整 `http(s)://` 地址时直接作为请求端点（方便反代）。

**OpenAI 官方渠道说明**（接口类型 = OpenAI，走官方 Images API 契约）：
- 无参考图 → `POST {Base}/images/generations`，JSON 请求体带 `model`（官方不接受纯 JSON+图片 URL，因此**不需要图床**）。
- 有参考图 → `POST {Base}/images/edits`，`multipart/form-data` 直传本地文件（字段 `image[]`，遮罩为 `mask`）；此模式不发送 `background` 参数（官方 edits 不支持）。
- 出参 `{ created, data: [{ b64_json }], usage }`：GPT image 系列**只返回 base64**；`usage`（输入/输出 tokens）会显示在完成提示里，成本由你自己的 OpenAI 账户按量计费。
- 参考图可选：OpenAI 模型下允许纯文生图（提示词仍必填）。

### 2. 调用模型页
- **参考图**（聚合站渠道必填、支持多张；OpenAI 官方渠道可选，支持纯文生图）：本页直接上传、点击「从历史素材选择」复用上传图/生成图，或**直接把图片拖进窗口**、**Ctrl/Cmd+V 粘贴截图**。聚合站渠道上传时自动 POST 到图床并取回 URL；OpenAI 渠道本地文件直传，不经图床。
- **上传中实时反馈**：选完文件立即在参考图区出现带缩略图的「正在上传」占位卡（逐张回推进度），上传完成原位更新；图床失败的卡片转为「重试上传」按钮，本地记录始终保留。
- **遮罩图**（可选）：带 alpha 通道的 PNG，透明区域为编辑位置；拖图到「遮罩图」卡片内即可设为遮罩。
- **提示词**（必填，最长 32000 字符）。
- **生成参数**：尺寸 `size`、质量 `quality`（low/medium/high）、数量 `n`（1-10）、背景 `background`（auto/opaque）、输出格式 `output_format`（png/jpeg）。
- 点击「开始生成」→ 自动确保所有参考图有**新鲜** URL（图床外链 24 小时过期，超龄素材自动重传换新链接；历史素材导入与复用参数时同样后台兜底）→ 调用生图接口 → 返回的图片（HTTP 链接 / data URI / 裸 base64 均兼容）自动下载解码、保存到本地并写入历史素材。OpenAI 渠道完成提示里附带本次 `usage` tokens 用量。
- 生成中可随时点「⏹ 停止」取消：**已在下载中的图片会保留落盘**（接口已出图不浪费），取消状态显示为灰色提示而非报错。

### 3. 历史素材页
分「上传图片」「生成图片」两个分类，卡片网格 + 大图详情。每张**生成图片**记录：

- 生成图 ID
- 本地保存路径
- 提示词
- 参考图 ID 及其本地路径（可多张）、遮罩图信息
- 生成参数、模型接口、批次 ID、创建时间

支持：预览大图/详情、打开所在文件夹、复制本地路径/在线 URL、删除记录（同时删除本地图片文件）。

### 数据存放位置
- Windows：`%APPDATA%\ai-image-studio\`
- macOS：`~/Library/Application Support/ai-image-studio/`

```
config.json          # 渠道配置
db.json              # 素材元数据（上传/生成记录）
images/uploads/      # 上传参考图本地副本
images/generated/    # 生成图片
```
设置页有「📁 打开数据目录」按钮可直接打开。

---

## 开发运行（macOS）

要求：Node.js 18+（已在 Node 24 上验证）。

```bash
npm install
npm start
```

首次使用：打开「设置」填写 API Key（Base URL / 模型路径 / 图床地址已有默认值，通常不用改），保存后即可在「调用模型」页使用。

> macOS 上如出现无法上传或无法访问网络，请确认系统对本应用放行了网络权限。

## 打包 Windows 软件

**方式 A：在 Windows 机器上打包（推荐，产物最标准）**

1. 安装 Node.js 18+（https://nodejs.org ）
2. 把本项目文件夹拷到 Windows，在该目录打开 PowerShell：
   ```powershell
   npm install
   npm run dist:win
   ```
3. 产物在 `dist\` 目录：
   - `AI出图平台-Setup-1.1.0.exe` —— NSIS 安装包（可选安装目录、创建桌面快捷方式）
   - `AI出图平台 1.1.0.exe` —— portable 免安装版，双击即用
   - `AI出图平台-1.1.0-win.zip` —— 绿色免安装压缩包
   - `win-unpacked\` —— 解包后的完整程序目录

> **覆盖安装（无需先卸载）**：直接双击新版 Setup 即可升级。`build/installer.nsh` 覆写了 electron-builder 的卸载检查
> （`customUnInstallCheck` 清掉「卸载失败」并强制继续），`customInit` 会先 `taskkill` 结束仍在运行的旧进程减少文件占用；
> 用户数据（`%APPDATA%\ai-image-studio`）在升级与卸载时都保留。发布新版务必同步递增 `package.json` 的 `version`，
> 否则 NSIS 注册表版本不变，「应用和功能」里不会显示为新版本。

**方式 B：在 macOS 上交叉打包 Windows 版**

```bash
npm install
npm run dist:win
```
Apple Silicon 机器首次交叉打包需安装 Rosetta 2（electron-builder 依赖 wine 设置 exe 图标/版本信息）：
```bash
softwareupdate --install-rosetta --agree-to-license
```

> 说明：应用未做代码签名，Windows 首次运行可能弹出 SmartScreen 提示，点击「更多信息 → 仍要运行」即可。

## 打包 macOS 应用

```bash
npm run dist:mac
```
产物：`dist/AI出图平台-1.1.0-arm64.dmg` 与 `.zip`（未签名，首次打开如被拦截，右键 → 打开，或在「系统设置 → 隐私与安全性」中允许）。

## 其它脚本

| 命令 | 作用 |
| --- | --- |
| `npm start` | 开发模式启动应用 |
| `npm run icon` | 重新生成应用图标 `assets/icon.png` |
| `npm run dist:win` | 打包 Windows x64 安装包/portable/zip |
| `npm run dist:mac` | 打包 macOS arm64 dmg/zip |
| `npx electron tools/smoke-test.js` | 无头冒烟测试（页面加载、IPC、默认配置） |

---

## 接口约定

**图片上传**（multipart/form-data，字段名 `file`）：
```
POST https://tmpfile.link/api/upload
→ { "downloadLink": "https://d.tmpfile.link/.../xxx.png", ... }
```

**生图**（JSON）：
```
POST {baseUrl}/{modelPath}
Headers: Authorization: Bearer <API Key>, Content-Type: application/json
Body: {
  "image": ["参考图URL", ...],   // 单张时为字符串
  "mask":  "遮罩图URL（可选）",
  "prompt": "提示词",
  "n": 1, "size": "1024x1024", "quality": "low",
  "background": "auto", "output_format": "png"
}
→ { "images": ["<http URL 或 base64 或 data URI>", ...] }
```

## 技术栈

Electron 33 + 原生 HTML/CSS/JS（无前端构建步骤），electron-builder 打包；渲染进程通过 `contextBridge` 暴露的安全 IPC 与主进程通信，配置与素材数据全部存储在本机应用数据目录。
