const fs = require('fs');
const path = require('path');

/** 绝对 URL（modelPath 允许直接写完整地址，如反代/自建域名，此时忽略 baseUrl 拼接） */
function isAbsoluteUrl(p) {
  return /^https?:\/\//i.test((p || '').trim());
}

/** 拼接 baseUrl 与模型路径 */
function buildEndpoint(baseUrl, modelPath) {
  if (isAbsoluteUrl(modelPath)) return modelPath.trim();
  const base = (baseUrl || '').replace(/\/+$/, '');
  const p = (modelPath || '').replace(/^\/+/, '');
  return `${base}/${p}`;
}

/** 本地图片文件 → FormData 可用的 Blob（按扩展名猜 mime，OpenAI 接受 png/jpeg/webp） */
function imageBlob(localPath) {
  const buffer = fs.readFileSync(localPath);
  const ext = path.extname(localPath || '').toLowerCase().replace(/^\./, '');
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
        : 'application/octet-stream';
  return new Blob([buffer], { type: mime });
}

/** 把外部取消 signal（可空）与内部超时合并：任一触发即 abort */
function composeSignal(outerSignal, timeoutMs) {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) return { signal: ctrl.signal, cleanup() {} };
    outerSignal.addEventListener('abort', onOuterAbort);
  }
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  return {
    signal: ctrl.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    }
  };
}

/** 可被取消打断的等待；signal 触发时立即 reject */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new Error('用户已取消'));
    }
    if (signal) {
      if (signal.aborted) { clearTimeout(t); onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * multipart/form-data 上传文件到图床，返回图片可访问 URL（失败自动重试 3 次）。
 * opts.signal：外部取消信号；取消时中止请求并抛「用户已取消」，不再重试。
 */
async function uploadFile(localPath, uploadUrl, opts = {}) {
  const outerSignal = opts.signal || null;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (outerSignal && outerSignal.aborted) throw new Error('用户已取消');
    try {
      const buffer = fs.readFileSync(localPath);
      const fileName = path.basename(localPath);
      const form = new FormData();
      form.append('file', new Blob([buffer]), fileName);

      const { signal, cleanup } = composeSignal(outerSignal, 60000);
      let res;
      try {
        res = await fetch(uploadUrl, { method: 'POST', body: form, signal });
      } finally {
        cleanup();
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`上传失败 (HTTP ${res.status})：${text.slice(0, 500)}`);
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`上传返回无法解析：${text.slice(0, 300)}`);
      }
      const url = data.downloadLink || data.url || data.data?.url || data.data?.downloadLink;
      if (!url) throw new Error(`上传返回中未找到图片链接：${text.slice(0, 300)}`);
      return url;
    } catch (e) {
      // 外部取消优先：不重试，直接以「用户已取消」上抛
      if (outerSignal && outerSignal.aborted) throw new Error('用户已取消');
      lastErr = e;
      const msg = e?.message || String(e);
      // 内部超时（AbortError 且未被外部取消）也归为可重试的网络类错误
      const retriable = /fetch failed|aborted|timeout|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|EOF|socket/i.test(msg);
      if (attempt < 3 && retriable) {
        await sleep(1000 * attempt, outerSignal);   // 重试间隔也能被取消打断
        continue;
      }
      break;
    }
  }
  throw new Error(`图片上传到图床失败（已重试 3 次）：${lastErr?.message || lastErr}。请检查网络/代理后重试。`);
}

/**
 * 图床链接保鲜期：24 小时。
 * tmpfile.link 等免登录图床的外链会过期，超龄素材调接口前必须重传换新 URL。
 * 基准时间优先取 urlAt（该 URL 何时上传），缺省回退 createdAt（导入即上传的老数据）。
 */
const URL_TTL_MS = 24 * 60 * 60 * 1000;
function isUrlStale(asset, nowMs = Date.now()) {
  if (!asset || !asset.url) return true;   // 无 URL 视为需要上传
  const t = Date.parse(asset.urlAt || asset.createdAt || '');
  if (!Number.isFinite(t)) return true;    // 时间戳缺失/非法 → 保守重刷
  return nowMs - t > URL_TTL_MS;
}

/**
 * 确保素材有可用的图床 URL。
 * @param {boolean} [opts.force] 强制重传（URL 超龄时的兜底刷新）
 */
async function ensureAssetUrl(asset, uploadUrl, onUploaded, opts = {}) {
  if (asset.url && !opts.force) return asset.url;
  if (!asset.localPath) throw new Error('素材缺少本地文件，无法上传');
  const url = await uploadFile(asset.localPath, uploadUrl, opts);
  if (onUploaded) onUploaded(asset.id, url);
  return url;
}

function extFromMime(mime) {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function extFromUrl(u) {
  try {
    const ext = path.extname(new URL(u).pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch { /* ignore */ }
  return null;
}

/** 解析接口返回的单张图片（http 链接 / data URI / 裸 base64）为 buffer + 扩展名 */
async function resolveImage(item, signal) {
  if (signal && signal.aborted) throw new Error('用户已取消');
  if (typeof item !== 'string') {
    // 兼容 { b64_json: '...' } / { url: '...' } 形式
    if (item && typeof item === 'object') {
      if (item.url) return resolveImage(item.url, signal);
      if (item.b64_json) return resolveImage(item.b64_json, signal);
    }
    throw new Error('无法识别的图片返回格式');
  }

  if (/^https?:\/\//i.test(item)) {
    const res = await fetch(item, { signal });
    if (!res.ok) throw new Error(`下载生成图失败 (HTTP ${res.status})：${item}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = extFromUrl(item) || extFromMime(res.headers.get('content-type') || '');
    return { buffer: buf, ext, url: item };
  }

  if (/^data:/i.test(item)) {
    const m = item.match(/^data:([^;]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error('data URI 解析失败');
    const mime = m[1] || 'image/png';
    const isB64 = !!m[2];
    const data = m[3];
    const buf = isB64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf-8');
    return { buffer: buf, ext: extFromMime(mime), url: '' };
  }

  // 裸 base64
  return { buffer: Buffer.from(item.replace(/\s/g, ''), 'base64'), ext: '.png', url: '' };
}

/** 出参统一处理：解析 { images } / { data }，逐张转 buffer；取消时带回部分结果 */
async function parseImages(data, text, signal, requestBody, endpoint) {
  const images = data.images || data.data || [];
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(`生图接口未返回图片：${text.slice(0, 500)}`);
  }
  const resolved = [];
  for (const item of images) {
    if (signal && signal.aborted) {
      // 取消发生在结果图下载阶段：已解析出的部分照常返回，由调用方决定落盘
      return { images: resolved, canceled: true, partial: true, requestBody, endpoint };
    }
    try {
      resolved.push(await resolveImage(item, signal));
    } catch (e) {
      if (signal && signal.aborted) {
        return { images: resolved, canceled: true, partial: true, requestBody, endpoint };
      }
      console.error('解析返回图片失败:', e.message);
    }
  }
  if (resolved.length === 0) throw new Error('返回的图片全部解析失败');
  return { images: resolved, requestBody, endpoint };
}

async function postJson(endpoint, body, apiKey, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey || ''}`
    },
    body: JSON.stringify(body),
    signal
  });
  return res;
}

/**
 * 调用生图接口。两种渠道模式：
 *
 * A. 聚合站编辑接口（默认，config.apiType !== 'openai'）：
 *    JSON POST {baseUrl}/{modelPath}，body 带 image=图床URL 数组，至少 1 张参考图。
 *
 * B. OpenAI 官方接口（config.apiType === 'openai'）：
 *    - 无参考图 → JSON POST …/images/generations，body { model, prompt, n, size, quality, background, output_format }
 *    - 有参考图 → multipart POST …/images/edits，image[]/mask 直接传本地文件（无需图床）
 *    出参 { data: [{ b64_json }] }，GPT image 系列永远只返回 base64。
 *
 * @param {object} opts
 * @param {string[]} [opts.imageUrls]   参考图 URL 数组（默认模式）
 * @param {string}  [opts.maskUrl]      遮罩图 URL（默认模式）
 * @param {string[]} [opts.imageFiles]  参考图本地文件路径数组（OpenAI 模式）
 * @param {string}  [opts.maskFile]     遮罩图本地文件路径（OpenAI 模式）
 * @param {string}  opts.prompt
 * @param {object}  opts.params         { n, size, quality, background, output_format }
 * @param {object}  opts.config         { baseUrl, modelPath, apiKey, apiType?, modelName? }
 * @param {AbortSignal} [opts.signal]   取消信号：中止模型调用与结果图下载
 */
async function generateImages(opts) {
  const { imageUrls = [], maskUrl, imageFiles = [], maskFile, prompt, params, config, signal } = opts;

  if (config.apiType === 'openai') {
    return generateImagesOpenAI({ imageFiles, maskFile, prompt, params, config, signal });
  }

  const endpoint = buildEndpoint(config.baseUrl, config.modelPath);

  const body = {
    image: imageUrls.length === 1 ? imageUrls[0] : imageUrls,
    prompt: prompt || '',
    n: Math.min(10, Math.max(1, Number(params.n) || 1)),
    size: params.size || '1024x1024',
    quality: params.quality || 'low',
    background: params.background || 'auto',
    output_format: params.output_format || 'png'
  };
  if (maskUrl) body.mask = maskUrl;

  const res = await postJson(endpoint, body, config.apiKey, signal);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`生图接口调用失败 (HTTP ${res.status})：${text.slice(0, 800)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`生图接口返回无法解析：${text.slice(0, 300)}`);
  }
  const out = await parseImages(data, text, signal, body, endpoint);
  if (data.usage) out.usage = data.usage;
  return out;
}

/** OpenAI Images API：有参考图走 edits(multipart)，纯文生图走 generations(JSON) */
async function generateImagesOpenAI({ imageFiles, maskFile, prompt, params, config, signal }) {
  const hasRefs = imageFiles.length > 0;
  // modelPath 留空 → 官方标准路径；写了（相对或绝对 URL）→ 以它为准，方便反代/聚合站兼容层
  const endpoint = config.modelPath
    ? buildEndpoint(config.baseUrl, config.modelPath)
    : buildEndpoint(config.baseUrl, hasRefs ? 'images/edits' : 'images/generations');

  const common = {
    model: config.modelName || 'gpt-image-2',
    prompt: prompt || '',
    n: Math.min(10, Math.max(1, Number(params.n) || 1)),
    size: params.size || '1024x1024',
    quality: params.quality || 'low',
    output_format: params.output_format || 'png'
  };

  let res, requestBody;
  if (hasRefs) {
    // edits：multipart/form-data，本地文件直传（官方不接受 URL，也不支持 background 参数）
    const form = new FormData();
    form.append('model', common.model);
    form.append('prompt', common.prompt);
    form.append('n', String(common.n));
    form.append('size', common.size);
    form.append('quality', common.quality);
    form.append('output_format', common.output_format);
    for (const p of imageFiles) {
      form.append('image[]', imageBlob(p), path.basename(p) || 'image.png');
    }
    if (maskFile) form.append('mask', imageBlob(maskFile), path.basename(maskFile) || 'mask.png');
    requestBody = { ...common, image: `[${imageFiles.length} 个本地文件]` };
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey || ''}` },   // multipart 边界由 fetch 自动生成
      body: form,
      signal
    });
  } else {
    requestBody = { ...common, background: params.background || 'auto' };
    res = await postJson(endpoint, requestBody, config.apiKey, signal);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`生图接口调用失败 (HTTP ${res.status})：${text.slice(0, 800)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`生图接口返回无法解析：${text.slice(0, 300)}`);
  }
  const out = await parseImages(data, text, signal, requestBody, endpoint);
  if (data.usage) out.usage = data.usage;   // { input_tokens, output_tokens, total_tokens, ... }
  return out;
}

module.exports = { uploadFile, ensureAssetUrl, generateImages, buildEndpoint, resolveImage, isUrlStale, URL_TTL_MS };
