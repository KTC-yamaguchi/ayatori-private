#!/usr/bin/env node
// 21e eval 用の生成 API モックサーバ (テスト専用 — パイプライン実行では使わない)。
//
// usage: node mock-image-api.mjs <mode>
//   mode: ok         — 要求サイズどおりの PNG を返す (background: transparent なら alpha 入り)
//         badreq     — 常に 400 (非リトライ対象の検証)
//         unauthorized — 常に 401 (認証失敗の案内文が failures[].error に載ることの検証)
//         unauthorized-verbose — 本文の長い 401 (gateway 包装を模す。案内が 300 字の切り詰めで
//                        消えないこと = 案内が本文より前にあることの検証)
//         fail-marker — prompt に FAILMARKER を含む要求のみ常に 500 (部分失敗の検証)
//         flaky2     — 同一 prompt の先頭 2 回を 500、3 回目から成功 (リトライの検証)
//         rejectsize — 固定サイズ族 (1024x1024/1536x1024/1024x1536) 以外を 400 "size ..." で拒否
//                      (サイズ fallback の検証)
//         flaky2-rejectsize — 同一 prompt の先頭 2 回を 500、以降は rejectsize と同挙動
//                      (再試行 budget を使い切った最終試行での size 拒否でも fallback が送信される
//                      ことの検証)
//         wrongsize  — 要求と無関係に 512x512 を返す (実寸検証→適合経路の検証)
//         url        — b64_json でなく data[0].url 形式で返す (download 経路の検証)
//         url-flaky-download — url 形式 + 最初の download GET のみ 500 (download 失敗が
//                      retryable として外側の再試行 loop に拾われることの検証)
//
// 起動すると stdout に `PORT=<port>` を 1 行出力する。GET /__stats が受信要求の記録を返す。
// spawnSync でテスト対象 CLI を回す親プロセスのイベントループを塞がないよう、別プロセスで動かす。

import http from "node:http";
import { encodePng } from "../scripts/png-resize.mjs";

const mode = process.argv[2] || "ok";
const FIXED = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const countsByPrompt = new Map();
const requests = [];

function makePng(width, height, transparent) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = (i * 7) % 256;
    pixels[i * 4 + 1] = (i * 13) % 256;
    pixels[i * 4 + 2] = (i * 29) % 256;
    pixels[i * 4 + 3] = transparent && i % 2 === 0 ? 128 : 255;
  }
  return encodePng({ width, height, pixels });
}

let downloadCalls = 0;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/__stats") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ requests, downloadCalls }));
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/__img")) {
    downloadCalls++;
    if (mode === "url-flaky-download" && downloadCalls === 1) {
      res.statusCode = 500;
      res.end("transient download failure");
      return;
    }
    const q = new URL(req.url, "http://localhost").searchParams;
    const [w, h] = q.get("size").split("x").map(Number);
    res.setHeader("content-type", "image/png");
    res.end(makePng(w, h, q.get("t") === "1"));
    return;
  }
  if (req.method !== "POST" || !req.url.endsWith("/images/generations")) {
    res.statusCode = 404;
    res.end("{}");
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const j = JSON.parse(body);
  requests.push({ model: j.model, size: j.size, background: j.background ?? null, output_format: j.output_format ?? null });
  const n = (countsByPrompt.get(j.prompt) ?? 0) + 1;
  countsByPrompt.set(j.prompt, n);

  const fail = (code, message) => {
    res.statusCode = code;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message } }));
  };
  if (mode === "badreq") return fail(400, "invalid prompt parameter");
  if (mode === "unauthorized") return fail(401, "Incorrect API key provided: sk-old***");
  // LiteLLM / Azure 等の gateway が上流の 401 を包んで返す形を模した長い本文 (200 字超)。
  // 案内を本文の後ろに置くと failures[].error の 300 字切り詰めで案内が全部消える。
  if (mode === "unauthorized-verbose")
    return fail(
      401,
      "AuthenticationError: litellm.AuthenticationError: OpenAIException - Incorrect API key provided: sk-old***. " +
        "You can find your API key at https://platform.openai.com/account/api-keys. " +
        "Received Model Group=gpt-image-1.5 / Available Model Group Fallbacks=None. Please check your upstream credentials."
    );
  // 'size' の語を含むがサイズ起因ではない 4xx — SIZE_REJECTED_RE が fallback を誤発火しない検証用
  if (mode === "size-word-4xx") return fail(400, "Your prompt exceeds the maximum size limit.");
  // OpenAI 互換 gateway (LiteLLM/pydantic 系) の size 拒否措辞 — param:size も invalid/unsupported も
  // 含まない列挙形。SIZE_REJECTED_RE が fallback を発火させる検証用
  if (mode === "rejectsize-gateway" && !FIXED.has(j.size)) {
    return fail(400, "size: Input should be '1024x1024', '1536x1024' or '1024x1536' [type=literal_error]");
  }
  if (mode === "fail-marker" && j.prompt.includes("FAILMARKER")) return fail(500, "server exploded");
  if ((mode === "flaky2" || mode === "flaky2-rejectsize") && n <= 2) return fail(500, "temporary upstream error");
  if ((mode === "rejectsize" || mode === "flaky2-rejectsize") && !FIXED.has(j.size)) {
    return fail(400, `size '${j.size}' is not supported for this model`);
  }

  const [w, h] = j.size.split("x").map(Number);
  res.setHeader("content-type", "application/json");
  if (mode === "url" || mode === "url-flaky-download") {
    const t = j.background === "transparent" ? "&t=1" : "";
    res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${server.address().port}/__img?size=${j.size}${t}` }] }));
    return;
  }
  const outW = mode === "wrongsize" ? 512 : w;
  const outH = mode === "wrongsize" ? 512 : h;
  const png = makePng(outW, outH, j.background === "transparent");
  res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
});

server.listen(0, "127.0.0.1", () => {
  console.log(`PORT=${server.address().port}`);
});
