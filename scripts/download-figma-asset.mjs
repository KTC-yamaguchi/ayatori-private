#!/usr/bin/env node
// Download a Figma asset export (temporary URL returned by the Figma MCP
// download_assets tool) to a local file using Node's built-in fetch —
// no external CLI dependency (Operating Principle 1).
//
// Both arguments are validated before any network or filesystem access. This
// script is invoked by a capture subagent under a pre-approved `Bash(node:*)`
// permission, and its inputs come from MCP responses — i.e. from content a
// third party can edit. Without validation it would be a general
// "fetch any URL, write any path" primitive that bypasses the narrow
// `Write(./artifacts/**)` permission the rest of the pipeline runs under.
//
// Usage: node scripts/download-figma-asset.mjs <url> <output-path>
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

// Figma serves asset exports from its own domain or from the signed S3 bucket it
// redirects to. Every redirect hop is re-checked against this, so a redirect
// cannot walk the request onto an internal host.
const ALLOWED_HOST = /(?:^|\.)(?:figma\.com|s3[.-][a-z0-9-]+\.amazonaws\.com)$/;
// The archive layout this script exists to populate. Accepts both a
// repo-relative and an absolute output path.
const ALLOWED_OUT = /(?:^|\/)artifacts\/[^/]+\/ground-truth\/figma\//;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  fail('Usage: node scripts/download-figma-asset.mjs <url> <output-path>');
}

const checkUrl = (raw, label) => {
  let u;
  try {
    u = new URL(raw);
  } catch {
    fail(`refused ${label}: not a valid URL`);
  }
  if (u.protocol !== 'https:') {
    fail(`refused ${label}: only https is allowed (got ${u.protocol})`);
  }
  if (!ALLOWED_HOST.test(u.hostname)) {
    fail(`refused ${label}: host ${u.hostname} is not a Figma asset host`);
  }
  return u;
};

const resolvedOut = resolve(out);
if (!ALLOWED_OUT.test(resolvedOut.split('\\').join('/'))) {
  fail(
    `refused output path: must be under artifacts/{app_name}/ground-truth/figma/ (resolved to ${resolvedOut})`,
  );
}
// PNG export is the only use case; without the extension gate a caller could
// overwrite text evidence the downstream steps cite (*.design-context.md /
// variables.json / manifest fragments), and the PNG signature check below would
// never apply to such a write.
if (!resolvedOut.toLowerCase().endsWith('.png')) {
  fail(`refused output path: only .png output is supported (resolved to ${resolvedOut})`);
}

let current = checkUrl(url, 'URL');
let res;
for (let hop = 0; ; hop++) {
  res = await fetch(current, {
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (![301, 302, 303, 307, 308].includes(res.status)) break;
  const location = res.headers.get('location');
  if (!location) fail(`download failed: HTTP ${res.status} without a Location header`);
  if (hop >= MAX_REDIRECTS) fail(`download failed: more than ${MAX_REDIRECTS} redirects`);
  current = checkUrl(new URL(location, current).toString(), 'redirect target');
}

if (!res.ok) {
  fail(
    `download failed: HTTP ${res.status} ${res.statusText} (URL may have expired — re-run download_assets)`,
  );
}

const declared = Number(res.headers.get('content-length'));
if (Number.isFinite(declared) && declared > MAX_BYTES) {
  fail(`download failed: content-length ${declared} exceeds ${MAX_BYTES} bytes`);
}
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length === 0) fail('download failed: empty response body');
if (buf.length > MAX_BYTES) fail(`download failed: body ${buf.length} exceeds ${MAX_BYTES} bytes`);
// A signed-URL failure often answers 200 with an HTML or XML error document.
// Writing that as a .png leaves a file that only looks like visual evidence.
// Unconditional: the extension gate above already guarantees every accepted
// output is a .png (case-insensitively), so re-testing the extension here
// would only reopen a gap for case variants like .PNG.
if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
  fail('download failed: response is not a PNG (expired URL or error page?)');
}

await mkdir(dirname(resolvedOut), { recursive: true });
await writeFile(resolvedOut, buf);
console.log(`saved ${buf.length} bytes -> ${out}`);
