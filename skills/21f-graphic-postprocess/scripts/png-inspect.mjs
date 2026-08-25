// Step 21f の透過検証 — 依存ゼロの PNG decode + alpha 統計 (ユーザーフロー ⑪ の「検証」実体)。
// POCTEAMA-189 (F-6 透過検証 → 正典化。圧縮 ⑫ は非搭載 — ユーザー判断でスコープ除外)
//
// I-3 (POCTEAMA-182) の結論により、透過は 21e の生成段階 (透過対応モデル + background:
// transparent) で作られる — Operating Principle 1 (外部 CLI 禁止) 下では後処理の背景除去
// (rembg 等) に経路が無いため、21f の透過責務は「後処理」ではなく **alpha チャネルの検証** に
// 縮小される (I-3 調査コメントの含意 3)。本モジュールは raw PNG を decode して alpha 統計を取り、
// 決定的な verdict (pass / fail + 数値根拠) を返す。閾値の背景は refs/postprocess-guide.md §2。
//
// decode 実装は 21e png-resize.mjs の decodePng の複製 (encode / resample は 21f に不要のため
// 持たない)。skill ディレクトリ単位の自己完結を優先する (21e preflight と同判断)。

import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };
// IHDR 寸法の後備上限 — expect (確定 size_px) を渡さない呼び出しでのみ使う。size_px は上流
// schema が上限を持たない (minimum:1 のみ) ため、固定 cap を常時 enforce すると 21e が正規に
// 生成・課金済みの大判 slot (例: retina 2x の 5120px hero) を 21f が恒久 decode 不能にする —
// 正しい防壁は「raw は size_px ちょうど」という 21e 契約そのもの (expect 引数で検証する)。
const MAX_DIMENSION = 4096;

/**
 * PNG decode → { width, height, pixels } (pixels = RGBA8 の Buffer)。
 * 対応: bit depth 8 / color type 0/2/4/6 / 非 interlace (21e decodePng と同一契約)。
 * @param {{width:number,height:number}} [expect] 確定 size_px。指定時は IHDR 寸法との完全一致を
 *   enforce する (21e の「raw は size_px ちょうど」契約の検証 — 一致すればメモリ確保量も
 *   user 確定値に bound される)。省略時は MAX_DIMENSION の後備 cap で守る。
 */
export function decodePng(buffer, expect) {
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
  if (width === 0 || height === 0) throw new Error(`未対応 PNG: 寸法 ${width}x${height}`);
  if (expect) {
    if (width !== expect.width || height !== expect.height) {
      throw new Error(
        `raw の寸法 ${width}x${height} が確定 size_px ${expect.width}x${expect.height} と不一致 (21e の「size_px ちょうど」契約違反 — 手動差し替え/破損の疑い)`
      );
    }
  } else if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`未対応 PNG: 寸法 ${width}x${height} (許容: 1〜${MAX_DIMENSION})`);
  }
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idatParts), { maxOutputLength: (stride + 1) * height });
  if (raw.length < (stride + 1) * height) throw new Error("PNG scanline データが不足している");

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

// ── 透過検証の閾値 (根拠と較正の考え方は refs/postprocess-guide.md §2) ──
// 「透明画素」= alpha ≤ ALPHA_TRANSPARENT_MAX (完全透明 0 に、生成モデルの縁の揺らぎ分だけ余裕)
export const ALPHA_TRANSPARENT_MAX = 8;
// fail: 外周画素の透明率がこの値未満 (被写体を中央に置く透過グラフィックは外周がほぼ透明になる。
// 5% 未満 = 背景が除去されていないと判断)
export const BORDER_FAIL_RATIO = 0.05;
// warn: fail ではないが外周透明率が低い (full-bleed 気味の構図) — pass にするが台帳へ warning
export const BORDER_WARN_RATIO = 0.3;

/**
 * alpha 統計 (決定的)。
 * @returns {{ has_alpha: boolean, transparent_ratio: number, border_transparent_ratio: number }}
 *   has_alpha = alpha < 255 の画素が 1 つでもあるか / transparent_ratio = 全画素中の透明画素率 /
 *   border_transparent_ratio = 外周 1px 帯の透明画素率 (いずれも透明 = alpha ≤ ALPHA_TRANSPARENT_MAX)
 */
export function alphaStats({ width, height, pixels }) {
  let hasAlpha = false;
  let transparent = 0;
  let borderTransparent = 0;
  let borderTotal = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixels[(y * width + x) * 4 + 3];
      if (a < 255) hasAlpha = true;
      const isTransparent = a <= ALPHA_TRANSPARENT_MAX;
      if (isTransparent) transparent++;
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        borderTotal++;
        if (isTransparent) borderTransparent++;
      }
    }
  }
  return {
    has_alpha: hasAlpha,
    transparent_ratio: transparent / (width * height),
    border_transparent_ratio: borderTotal ? borderTransparent / borderTotal : 0,
  };
}

/**
 * 透過検証 verdict (決定的 — 閾値は上記定数)。
 * @returns {{ pass: boolean, warnings: string[], stats: object }}
 */
export function verifyTransparency(decoded) {
  const stats = alphaStats(decoded);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  if (!stats.has_alpha || stats.transparent_ratio === 0) {
    return {
      pass: false,
      warnings: [`透過指定 slot だが全画素が実質不透明 (透明画素率 ${pct(stats.transparent_ratio)}) — 背景が透明化されていない`],
      stats,
    };
  }
  if (stats.border_transparent_ratio < BORDER_FAIL_RATIO) {
    return {
      pass: false,
      warnings: [
        `外周の透明率 ${pct(stats.border_transparent_ratio)} < ${pct(BORDER_FAIL_RATIO)} — 背景が画像の縁まで残っている (重ね置き用途で背景が見える)`,
      ],
      stats,
    };
  }
  const warnings = [];
  if (stats.border_transparent_ratio < BORDER_WARN_RATIO) {
    warnings.push(
      `外周の透明率 ${pct(stats.border_transparent_ratio)} が低め (full-bleed 気味の構図) — 重ね置き先で背景が覗く可能性。21g の埋め込みプレビューで要確認`
    );
  }
  return { pass: true, warnings, stats };
}
