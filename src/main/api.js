const fs = require('fs');
const path = require('path');

/** 拼接 baseUrl 与模型路径 */
function buildEndpoint(baseUrl, modelPath) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  const p = (modelPath || '').replace(/^\/+/, '');
  return `${base}/${p}`;
}

/** multipart/form-data 上传文件到图床，返回图片可访问 URL（失败自动重试 3 次） */
async function uploadFile(localPath, uploadUrl) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const buffer = fs.readFileSync(localPath);
      const fileName = path.basename(localPath);
      const form = new FormData();
      form.append('file', new Blob([buffer]), fileName);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      let res;
      try {
        res = await fetch(uploadUrl, { method: 'POST', body: form, signal: controller.signal });
      } finally {
        clearTimeout(timer);
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
      lastErr = e;
      const msg = e?.message || String(e);
      // 网络中断/超时类错误才重试；接口返回的业务错误不重试
      const retriable = /fetch failed|aborted|timeout|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|EOF|socket/i.test(msg);
      if (attempt < 3 && retriable) {
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }
      break;
    }
  }
  throw new Error(`图片上传到图床失败（已重试 3 次）：${lastErr?.message || lastErr}。请检查网络/代理后重试。`);
}

/** 素材没有 URL 时自动上传，返回可用于接口的图片链接 */
async function ensureAssetUrl(asset, uploadUrl, onUploaded) {
  if (asset.url) return asset.url;
  if (!asset.localPath) throw new Error('素材缺少本地文件，无法上传');
  const url = await uploadFile(asset.localPath, uploadUrl);
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
async function resolveImage(item) {
  if (typeof item !== 'string') {
    // 兼容 { b64_json: '...' } / { url: '...' } 形式
    if (item && typeof item === 'object') {
      if (item.url) return resolveImage(item.url);
      if (item.b64_json) return resolveImage(item.b64_json);
    }
    throw new Error('无法识别的图片返回格式');
  }

  if (/^https?:\/\//i.test(item)) {
    const res = await fetch(item);
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

/**
 * 调用生图接口
 * @param {object} opts
 * @param {string[]} opts.imageUrls  参考图 URL 数组（必填至少 1 张）
 * @param {string}  [opts.maskUrl]   遮罩图 URL
 * @param {string}  opts.prompt
 * @param {object}  opts.params      { n, size, quality, background, output_format }
 * @param {object}  opts.config      { baseUrl, modelPath, apiKey }
 */
async function generateImages(opts) {
  const { imageUrls, maskUrl, prompt, params, config } = opts;
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

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey || ''}`
    },
    body: JSON.stringify(body)
  });

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

  const images = data.images || data.data || [];
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(`生图接口未返回图片：${text.slice(0, 500)}`);
  }

  const resolved = [];
  for (const item of images) {
    try {
      resolved.push(await resolveImage(item));
    } catch (e) {
      console.error('解析返回图片失败:', e.message);
    }
  }
  if (resolved.length === 0) throw new Error('返回的图片全部解析失败');
  return { images: resolved, requestBody: body, endpoint };
}

module.exports = { uploadFile, ensureAssetUrl, generateImages, buildEndpoint, resolveImage };
