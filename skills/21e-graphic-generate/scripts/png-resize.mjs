// Step 21e のサイズ自動調整 — 依存ゼロの PNG decode / 中心 crop / 面積平均 resample / encode。
// F-5 グラフィック生成 + サイズ自動調整
//
// Operating Principle 1 (外部 CLI 依存の禁止) のため、画像処理は node:zlib のみで自前実装する
// (repo 前例: scripts/oklch-color.mjs / scripts/wcag-contrast.mjs の色数学と同じ線引き)。
// 生成 API の出力 (8bit RGB / RGBA / gray、非 interlace の PNG) に必要十分な範囲だけを実装し、
// 対応外の形式 (palette / 16bit / interlace) は明示エラーで呼び出し側の失敗経路
// (SKILL.md の degrade 分岐) へ返す — 黙って劣化させない。
//
// 縮小は alpha 前乗算の面積平均 (box filter): 透過 slot (gpt-image-1.5 出力) の縁に
// 背景色が滲む halo を防ぐ。拡大方向も同じ被覆計算で吸収する (本 skill の拡大は
// 長辺 cap / 固定サイズ族由来の軽微なもののみ — preflight.mjs planGeneration が warning を出す)。

import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (PNG 仕様の多項式 0xEDB88320)。node:zlib の crc32 に依存せず自前で持つ —
// 決定的動作を Node の minor version に依存させない。
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

// IHDR 寸法の受理上限。IHDR は API 応答由来の未検証入力のため、破損/不正応答の極端な寸法を
// メモリ確保 (inflate / Buffer.alloc) より前に弾く。21e の生成キャンバス長辺は 1536 上限
// (preflight.mjs MAX_LONG_SIDE) なので、正常応答が超えることのない余裕値を採る。
const MAX_DIMENSION = 4096;

/**
 * PNG decode → { width, height, pixels } (pixels = RGBA8 の Buffer、length = w*h*4)。
 * 対応: bit depth 8 / color type 0 (gray)・2 (RGB)・4 (gray+alpha)・6 (RGBA) / 非 interlace。
 * 対応外は Error(code 付き message) を throw する。tRNS chunk (color type 0/2 のパレット外透過)
 * は無視する (不透明扱い) — 生成 API の透過出力は RGBA (type 6) で来るため実害なし。
 */
export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("PNG ではない (signature 不一致)");
  }
  let pos = 8;
  let ihdr = null;
  const idatParts = [];
  while (pos + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString("latin1", pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (dataStart + len + 4 > buffer.length) throw new Error(`PNG chunk ${type} が途中で切れている`);
    const data = buffer.subarray(dataStart, dataStart + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos = dataStart + len + 4;
  }
  if (!ihdr) throw new Error("PNG に IHDR が無い");
  if (ihdr.bitDepth !== 8) throw new Error(`未対応 PNG: bit depth ${ihdr.bitDepth} (対応: 8)`);
  const channels = CHANNELS_BY_COLOR_TYPE[ihdr.colorType];
  if (!channels) throw new Error(`未対応 PNG: color type ${ihdr.colorType} (対応: 0/2/4/6 — palette は非対応)`);
  if (ihdr.interlace !== 0) throw new Error("未対応 PNG: interlace (Adam7)");
  if (!idatParts.length) throw new Error("PNG に IDAT が無い");

  const { width, height } = ihdr;
  if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`未対応 PNG: 寸法 ${width}x${height} (許容: 1〜${MAX_DIMENSION})`);
  }
  const stride = width * channels;
  // 非 interlace の 8bit PNG の inflate 後サイズは (stride+1)*height ちょうど — 上限を渡して
  // 圧縮爆弾 (小さな IDAT が巨大展開される細工) をネイティブ確保前に catch 可能な throw にする
  const raw = zlib.inflateSync(Buffer.concat(idatParts), { maxOutputLength: (stride + 1) * height });
  if (raw.length < (stride + 1) * height) throw new Error("PNG scanline データが不足している");

  // unfilter (filter 0-4) — 前行/前画素は unfilter 済みの値を参照する
  const img = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[(stride + 1) * y];
    const src = (stride + 1) * y + 1;
    const dst = stride * y;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const left = x >= channels ? img[dst + x - channels] : 0;
      const up = y > 0 ? img[dst + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? img[dst + x - stride - channels] : 0;
      let v;
      switch (filter) {
        case 0:
          v = cur;
          break;
        case 1:
          v = cur + left;
          break;
        case 2:
          v = cur + up;
          break;
        case 3:
          v = cur + Math.floor((left + up) / 2);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          v = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`未対応 PNG: filter type ${filter}`);
      }
      img[dst + x] = v & 0xff;
    }
  }

  // RGBA8 へ正規化
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, o = 0; i < img.length; i += channels, o += 4) {
    if (channels === 1) {
      pixels[o] = pixels[o + 1] = pixels[o + 2] = img[i];
      pixels[o + 3] = 255;
    } else if (channels === 2) {
      pixels[o] = pixels[o + 1] = pixels[o + 2] = img[i];
      pixels[o + 3] = img[i + 1];
    } else if (channels === 3) {
      pixels[o] = img[i];
      pixels[o + 1] = img[i + 1];
      pixels[o + 2] = img[i + 2];
      pixels[o + 3] = 255;
    } else {
      pixels[o] = img[i];
      pixels[o + 1] = img[i + 1];
      pixels[o + 2] = img[i + 2];
      pixels[o + 3] = img[i + 3];
    }
  }
  return { width, height, pixels };
}

/** PNG encode (RGBA8 固定 / filter 0 / 非 interlace)。 */
export function encodePng({ width, height, pixels }) {
  if (pixels.length !== width * height * 4) throw new Error("encodePng: pixels 長が width*height*4 と不一致");
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[(stride + 1) * y] = 0; // filter: none
    pixels.copy(raw, (stride + 1) * y + 1, stride * y, stride * (y + 1));
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
    return Buffer.concat([head, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace: none
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** 中心 crop の矩形 (target のアスペクト比で最大の内接領域、中央寄せ)。 */
export function centerCropRect(srcW, srcH, targetW, targetH) {
  const targetAR = targetW / targetH;
  let w = srcW;
  let h = srcH;
  if (srcW / srcH > targetAR) w = Math.max(1, Math.round(srcH * targetAR));
  else h = Math.max(1, Math.round(srcW / targetAR));
  return { x: Math.floor((srcW - w) / 2), y: Math.floor((srcH - h) / 2), w, h };
}

/**
 * 面積平均 resample (alpha 前乗算) — crop 矩形 → target 寸法。
 * 縮小はアンチエイリアスされた box 平均、拡大は同じ被覆計算 (境界画素の按分) で連続的に振る舞う。
 */
export function resample(src, rect, targetW, targetH) {
  const out = Buffer.alloc(targetW * targetH * 4);
  const sx = rect.w / targetW;
  const sy = rect.h / targetH;
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = rect.y + ty * sy;
    const y1 = rect.y + (ty + 1) * sy;
    const yStart = Math.floor(y0);
    const yEnd = Math.min(rect.y + rect.h, Math.max(yStart + 1, Math.ceil(y1)));
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = rect.x + tx * sx;
      const x1 = rect.x + (tx + 1) * sx;
      const xStart = Math.floor(x0);
      const xEnd = Math.min(rect.x + rect.w, Math.max(xStart + 1, Math.ceil(x1)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = yStart; y < yEnd; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = xStart; x < xEnd; x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (y * src.width + x) * 4;
          const alpha = src.pixels[i + 3] / 255;
          r += src.pixels[i] * alpha * w;
          g += src.pixels[i + 1] * alpha * w;
          b += src.pixels[i + 2] * alpha * w;
          a += alpha * w;
          area += w;
        }
      }
      const o = (ty * targetW + tx) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = area > 0 ? Math.round((a / area) * 255) : 0;
    }
  }
  return { width: targetW, height: targetH, pixels: out };
}

/**
 * 生成 API 出力 → 確定 size_px への適合 (ユーザーフロー ⑩ の本体):
 * 中心 crop で target のアスペクト比に合わせてから面積平均で target 寸法へ resample する。
 * 寸法が既に一致していれば入力をそのまま返す (無加工)。
 */
export function fitToTarget(src, targetW, targetH) {
  if (src.width === targetW && src.height === targetH) return src;
  const rect = centerCropRect(src.width, src.height, targetW, targetH);
  return resample(src, rect, targetW, targetH);
}

/** alpha チャネルに 255 未満の画素があるか (透過生成の簡易検証 — 精査は 21f の責務)。 */
export function hasTransparency({ pixels }) {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true;
  return false;
}
