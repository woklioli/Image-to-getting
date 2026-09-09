/**
 * 生成应用图标 assets/icon.png（256x256，纯 Node + zlib，无第三方依赖）
 * 简单绘制：蓝紫渐变圆角底 + 白色画笔/星形图案
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- 绘制 ----
const px = Buffer.alloc(SIZE * SIZE * 4);
function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // alpha 混合
  const aa = a / 255;
  px[i]     = Math.round(r * aa + px[i]     * (1 - aa));
  px[i + 1] = Math.round(g * aa + px[i + 1] * (1 - aa));
  px[i + 2] = Math.round(b * aa + px[i + 2] * (1 - aa));
  px[i + 3] = Math.max(px[i + 3], a);
}

function roundedRectMask(x, y, w, h, rad) {
  // 距离圆角矩形的 SDF
  const cx = Math.max(Math.min(x, w - rad), rad);
  const cy = Math.max(Math.min(y, h - rad), rad);
  const dx = x - cx, dy = y - cy;
  return Math.sqrt(dx * dx + dy * dy) - rad;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = roundedRectMask(x, y, SIZE, SIZE, 112);
    if (d <= 0) {
      const t = y / SIZE;
      const r = Math.round(79 + (30 - 79) * t);   // #4f6ef7 -> 蓝紫
      const g = Math.round(110 + (58 - 110) * t);
      const b = Math.round(247 + (160 - 247) * t);
      const alpha = d < -1.5 ? 255 : Math.round((-d + 1.5) / 3 * 255);
      setPx(x, y, r, g, b, Math.min(255, alpha));
    }
  }
}

// 白色四角星（sparkle）
function star(cx, cy, rOut, rIn, points) {
  const verts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const ang = -Math.PI / 2 + i * Math.PI / points;
    verts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let inside = false;
      for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const [xi, yi] = verts[i], [xj, yj] = verts[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) setPx(x, y, 255, 255, 255, 255);
    }
  }
}
star(256, 240, 148, 40, 4);
star(392, 140, 44, 14, 4);
star(124, 376, 36, 12, 4);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.png');
fs.writeFileSync(out, encodePNG(SIZE, SIZE, px));
console.log('图标已生成:', out, fs.statSync(out).size, 'bytes');
