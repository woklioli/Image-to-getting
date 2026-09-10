# AI 出图平台（桌面端）

基于 Electron 的桌面应用：配置渠道 Base URL / 图片模型接口 / API Key，上传或选择历史素材作为参考图，调用 GPT Image 图片编辑接口（`/v3/gpt-image-2-edit`）生成图片。所有素材（上传图、生成图）均保存在本机并记入历史素材。

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
- 点「➕ 添加模型」可新增任意数量的模型，每个模型包含：模型名称、接口路径（如 `v3/gpt-image-2-edit`，必填）、专属 Base URL（留空用全局）、专属 API Key（留空用全局）。
- 不同模型可以指向不同渠道、使用不同密钥；单选框选中的为「当前使用模型」。
- 在「调用模型」页顶部可通过下拉框快速切换当前模型。
- 旧版单模型配置会在首次启动时自动迁移为模型列表。
- 最终请求地址 = 模型专属 Base URL（或全局）+ 接口路径。

### 2. 调用模型页
- **参考图**（必填，支持多张）：本页直接上传、点击「从历史素材选择」复用上传图/生成图，或**直接把图片拖进窗口**、**Ctrl/Cmd+V 粘贴截图**。上传时自动 POST 到图床并取回 URL。
- **遮罩图**（可选）：带 alpha 通道的 PNG，透明区域为编辑位置；拖图到「遮罩图」卡片内即可设为遮罩。
- **提示词**（必填，最长 32000 字符）。
- **生成参数**：尺寸 `size`、质量 `quality`（low/medium/high）、数量 `n`（1-10）、背景 `background`（auto/opaque）、输出格式 `output_format`（png/jpeg）。
- 点击「开始生成」→ 自动确保所有参考图有 URL → 调用生图接口 → 返回的图片（HTTP 链接 / data URI / 裸 base64 均兼容）自动下载解码、保存到本地并写入历史素材。
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
   - `AI出图平台 Setup 1.0.0.exe` —— NSIS 安装包（可选安装目录、创建桌面快捷方式）
   - `AI出图平台 1.0.0.exe` —— portable 免安装版，双击即用
   - `AI出图平台-1.0.0-win.zip` —— 绿色免安装压缩包
   - `win-unpacked\` —— 解包后的完整程序目录

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
产物：`dist/AI出图平台-1.0.0-arm64.dmg` 与 `.zip`（未签名，首次打开如被拦截，右键 → 打开，或在「系统设置 → 隐私与安全性」中允许）。

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
