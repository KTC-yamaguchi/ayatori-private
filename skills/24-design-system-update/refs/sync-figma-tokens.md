# Sync Figma Tokens

> **呼び出し元: Step 24 (design-system-update)、2 回目以降のループ専用**。本ファイルは `skills/12-design-system/refs/` から `skills/24-design-system-update/refs/` に物理移動済み (Step 12 はコード生成のみで Figma を触らない設計のため、本ファイルは Step 24 の責務に統合された)。初回構築 (Step 24 §Step C 全体実行) ではなく、Variables 値の差分のみを同期する高速パス用。

## Overview

Compare tokens.json against Figma Variables, then write differences safely.
Used in AYATORI pipeline step ㉔ (design-system-update) on **loop/revision iterations only** (initial creation uses Step 24 §Step B/C/D full path). Step 24 SKILL.md §「Loop 実行時の差分同期」から呼ばれる。

## Input

| File | Required | Content |
|---|---|---|
| `artifacts/{app_name}/tokens.json` | ✅ | W3C DTCG tokens (source of truth) |
| Figma Variables (via MCP) | ✅ | Current state in Figma file |
| `artifacts/{app_name}/figma-state.json` | ✅ | File key and node tracking |

## Output

| File | Content |
|---|---|
| `artifacts/{app_name}/sync-report.json` | Full execution log: comparison results, write results, verification results |
| Figma Variables (via MCP) | Updated to match tokens.json |

## Prerequisites

- Figma MCP connected and authenticated
- `figma-use` skill loaded before every `use_figma` call
- 3 つの Figma Variable Collections (`{app_name}/Primitives` / `{app_name}/Semantic` / `{app_name}/Component`) が存在 (Step 24 §Step B で作成済)

---

## Agent Prompt

When executing this skill, apply the following instructions.

---

**You are a design token synchronization engineer. Your job is to ensure Figma Variables match tokens.json exactly.**

### Sync Policies

These policies are fixed for AYATORI and must not be changed without human approval:

| Policy | Value | Reason |
|---|---|---|
| direction | `code_to_figma` | tokens.json is the single source of truth |
| conflict | `prefer_code` | Code wins on all conflicts |
| delete | `archive_only` | Never delete variables. Hide stale ones via scoping |
| naming | dot-to-slash | `color.primary` in JSON → `color/primary` in Figma |
| mode | nested-modes-to-figma-mode | Dual mode (Dark/Light) only when any color token in tokens.json has the symmetric `modes.dark.$value` + `modes.light.$value` nested structure (D1-a). Otherwise single mode (Default). Non-color tokens (spacing etc.) share the same value across all modes |

### Execution Model

This skill always executes the full flow: Read → Compare → Write → Verify → Report.
It does NOT handle approval logic — the orchestrator (CLAUDE.md) decides when to call this skill.

You will build up a `report` object throughout execution. Initialize it at the start:

```
report = {
  timestamp: current ISO timestamp,
  change_summary: null,   // populated in Step 3
  write_results: null,     // populated in Step 4
  verification: null,      // populated in Step 5
}
```

---

### Step 1: Read Current State

**Goal**: Build two normalized lists — `codeTokens` and `figmaTokens` — in the same format for comparison.

#### 1a. Read Code Side

Read `artifacts/{app_name}/tokens.json` and build `codeTokens` — an array of canonical records:

```
codeTokens = [
  { key: "color/primary", type: "COLOR", primaryValue: "#38BDF8", lightValue: null, aliasTarget: null },
  { key: "color/processing", type: "COLOR", primaryValue: null, lightValue: null, aliasTarget: "color/primary" },
  { key: "spacing/md", type: "FLOAT", primaryValue: 16, lightValue: null, aliasTarget: null },
  ...
]
// lightValue is non-null only when dual-mode is detected
//   (any color token in tokens.json has the symmetric modes.dark/light structure).
// primaryValue maps to "Default" mode (single) or "Dark" mode (dual).
// In dual mode: primaryValue = modes.dark.$value, lightValue = modes.light.$value.
```

**Normalization rules** (3 collections モデル対応、A-1 修正 / dual-mode symmetric D1-a 対応):

各 record は `{ key, layer, type, primaryValue, lightValue, aliasTarget }` の形式。`layer ∈ {'Primitives', 'Semantic', 'Component'}` で Figma collection と対応。

1. Walk `global.color.*` — `layer: 'Primitives'`, `key` = `"color/{name}"`. 各 token が:
   - **dual-mode** (`modes.dark.$value` + `modes.light.$value` の対称 nested 構造): `primaryValue` = `modes.dark.$value`, `lightValue` = `modes.light.$value`
   - **single-mode** (flat `$value`): `primaryValue` = `$value`, `lightValue` = null
2. Dual-mode 検出: tokens.json のいずれかの color token に `modes.dark` + `modes.light` 構造があれば全体を dual-mode 扱い (orphan mode は generate-tokens / build-tokens で弾かれている前提)。検出されなければ全 color token を single-mode 扱い (`lightValue` = null)
3. Walk `global.spacing.*` — `layer: 'Primitives'`, `key` = `"spacing/{name}"`, `primaryValue` = parsed number from px string (e.g., `"16px"` → `16`), `lightValue` = null
4. Walk `global.border-radius.*` — `layer: 'Primitives'`, same as spacing
5. Walk `global.typography.*` — `layer: 'Primitives'`, map to appropriate types:
   - `$type: "fontFamily"` → `type: "STRING"`, value = font string
   - `$type: "fontWeight"` → `type: "FLOAT"`, value = number
   - `$type: "dimension"` → `type: "FLOAT"`, value = parsed number from px string
   - `$type: "number"` → `type: "FLOAT"`, value = number
   - `$type: "string"` → `type: "STRING"`, value = string
6. **Skip**: `global.shadow.*` (composite, not a Figma Variable type — Effect Style として別管理)
7. **Walk `semantic.*` recursively** (A-1 新規) — `layer: 'Semantic'`, `key` = path with slash separator (例: `semantic.feedback.error-bg` → `"feedback/error-bg"`、semantic prefix は省略)。
   - **single-mode**: leaf に `$value` があれば、`{global.color.xxx}` 形式の alias として処理 → `aliasTarget` = `"color/xxx"`、`primaryValue/lightValue` = null
   - **dual-mode**: leaf は `modes.dark.$value` + `modes.light.$value` の対称構造。各 mode の `$value` は `{global.color.xxx.modes.dark}` / `{global.color.xxx.modes.light}` 形式の mode 明示 alias。両者の base key (`color/xxx`) を抽出して `aliasTarget` = `"color/xxx"` として 1 record にまとめる (Figma Variable は base name + 2 mode で表現するため)
8. **Walk `component.*` recursively** (A-1 新規) — `layer: 'Component'`, `key` = path with slash separator (例: `component.button.bg` → `"button/bg"`、component prefix は省略)。
   - **single-mode**: leaf の `$value` から alias 解決:
     - `{semantic.feedback.error-bg}` 形式 → `aliasTarget` = `"feedback/error-bg"` (Semantic collection 内)
     - `{global.color.surface}` 形式 → `aliasTarget` = `"color/surface"` (Primitives collection 内)
   - **dual-mode**: color alias は `modes.dark` / `modes.light` で fork されている。`{semantic.X.modes.dark}` → `aliasTarget` = `"X"` (Semantic 内、mode segment は base key 抽出時に除去)。dimension / shadow alias は theme-agnostic で flat のまま (`modes` を持たない) のため single-mode と同じ処理
   - cross-collection alias は Step 4d で `figma.variables.getVariableByIdAsync` 検索時に `layer` でスコープを絞る
9. For alias tokens (value starts with `{`): set `aliasTarget` = resolved key (mode segment を除去した base key)、set primaryValue/lightValue = null (1-8 のすべての layer で適用)

> ⚠ **A-1 対策**: 旧版は Step 1a で `semantic.*` / `component.*` を Skip していたため、tokens.json は Primitives のみ抽出される一方で、Step 1b の Figma READ は 3 collections 全変数を返す不整合があった。Step 2 比較で Semantic/Component の全 Variable が `removed` 判定 → Step 4e で archive される致命傷。本修正で codeTokens 側も 3 collections 対応にして対称化。

#### 1b. Read Figma Side (3 コレクションモデル対応、B1-6)

> ⚠ **B1-6 対策**: 旧版は単一 `"AYATORI Tokens"` collection 前提だったが、現在は 3 コレクション (`{app_name}/Primitives` / `{app_name}/Semantic` / `{app_name}/Component`) に分離されている。本 sync は **3 コレクション全部を走査して併合する** 必要がある。

Call `use_figma` to read all 3 collections. Build `figmaTokens` in the same format:

```javascript
// use_figma script: read all variables from 3 collections
const collections = await figma.variables.getLocalVariableCollectionsAsync();
// 3 コレクションを名前接尾辞で取得
const primColl = collections.find(c => c.name.endsWith('/Primitives'));
const semColl  = collections.find(c => c.name.endsWith('/Semantic'));
const compColl = collections.find(c => c.name.endsWith('/Component'));
if (!primColl || !semColl || !compColl) {
  return { error: 'Required 3 collections not found',
    found: collections.map(c => c.name) };
}

// 各コレクションの Default mode を取得 (Step 24 §Step B で `defaultModeId` を使用)
const modeIdFor = (col) => col.defaultModeId;

const toHex = (c) => `#${Math.round(c.r*255).toString(16).padStart(2,'0')}${Math.round(c.g*255).toString(16).padStart(2,'0')}${Math.round(c.b*255).toString(16).padStart(2,'0')}`.toUpperCase();

const results = [];
// 3 コレクションすべての variableIds を併合
const allVarIds = [
  ...primColl.variableIds.map(id => ({ id, layer: 'Primitives', col: primColl })),
  ...semColl.variableIds.map(id => ({ id, layer: 'Semantic', col: semColl })),
  ...compColl.variableIds.map(id => ({ id, layer: 'Component', col: compColl })),
];

for (const { id: varId, layer, col } of allVarIds) {
  const primaryModeId = modeIdFor(col);
  const lightModeId = null; // 旧 dual mode (Dark/Light) は現在未使用
  const v = await figma.variables.getVariableByIdAsync(varId);
  const primaryRaw = v.valuesByMode[primaryModeId];
  const lightRaw = lightModeId ? v.valuesByMode[lightModeId] : null;

  const record = { key: v.name, layer, type: v.resolvedType, scopes: v.scopes };

  // Primary value (Default mode or Dark mode)
  if (primaryRaw?.type === 'VARIABLE_ALIAS') {
    const target = await figma.variables.getVariableByIdAsync(primaryRaw.id);
    record.aliasTarget = target.name;
    record.primaryValue = null;
  } else if (v.resolvedType === 'COLOR' && primaryRaw) {
    record.primaryValue = toHex(primaryRaw);
    record.aliasTarget = null;
  } else {
    record.primaryValue = primaryRaw;
    record.aliasTarget = null;
  }

  // Light value
  if (lightRaw?.type === 'VARIABLE_ALIAS') {
    // alias target same as dark for aliases
    record.lightValue = null;
  } else if (v.resolvedType === 'COLOR' && lightRaw) {
    record.lightValue = toHex(lightRaw);
  } else {
    record.lightValue = lightRaw;
  }

  results.push(record);
}
return results;
```

The returned array IS `figmaTokens`.

---

### Step 2: Compare

**Goal**: Produce a `differences` array by comparing `codeTokens` against `figmaTokens`.

```
differences = []
```

**Algorithm** (A-1 修正: layer 複合キーで join):

1. **Build lookup**: Create a map of `figmaTokens` keyed by `"{layer}:{key}"` (例: `"Primitives:color/primary"`, `"Semantic:feedback/error-bg"`, `"Component:button/bg"`)
2. **For each record in `codeTokens`**:
   - Build同様の複合キー `"{layer}:{key}"`
   - If 複合キー NOT in figmaTokens → `{ key, layer, category: "added", code: {primaryValue, lightValue}, figma: null }`
   - If 複合キー in figmaTokens:
     - If codeToken.aliasTarget differs from figmaToken.aliasTarget → `{ key, layer, category: "alias_changed", code: codeToken.aliasTarget, figma: figmaToken.aliasTarget }`
     - If codeToken.type differs from figmaToken.type → `{ key, layer, category: "type_changed", code: codeToken.type, figma: figmaToken.type }`
     - If values differ (see comparison rules below) → `{ key, layer, category: "value_changed", code: {primaryValue, lightValue}, figma: {primaryValue, lightValue} }`
     - If neither → unchanged (do not add to differences)
3. **For each record in `figmaTokens`** not in codeTokens (複合キー不一致):
   - If figmaToken.scopes is already empty → skip (already archived)
   - Else → `{ key, layer, category: "removed", code: null, figma: {primaryValue, lightValue} }`

> 同名 key が複数 layer に存在するケース (例: `color/primary` が Primitives 実値 + Semantic alias) に対応するため、必ず複合キーで join する。

**Value comparison rules:**
- COLOR (hex string): Case-insensitive string comparison (both uppercase)
- FLOAT: `codeValue !== figmaValue` (strict numeric)
- STRING: `codeValue !== figmaValue` (strict string)
- Alias: Compare target key strings
- Compare primary and Light values independently. If either differs, it's `value_changed`. Light comparison is skipped when both sides have null lightValue (single mode)

---

### Step 3: Generate Change Summary

**Goal**: Produce `change_summary` from `differences` and save to report.

```
change_summary = {
  totals: {
    added: differences.filter(d => d.category === "added").length,
    removed: differences.filter(d => d.category === "removed").length,
    value_changed: differences.filter(d => d.category === "value_changed").length,
    alias_changed: differences.filter(d => d.category === "alias_changed").length,
    type_changed: differences.filter(d => d.category === "type_changed").length,
    unchanged: codeTokens.length - differences.length,
  },
  details: differences
}
```

Set `report.change_summary = change_summary`.

If `change_summary.totals` shows all zeros (no differences), skip Steps 4-5 and go directly to Step 6.

---

### Step 4: Write Changes

**Goal**: Apply each difference to Figma and record results.

Initialize:
```
write_results = { succeeded: [], failed: [] }
```

Execute in dependency order. Each operation is a **separate `use_figma` call**. After each call, record the result.

**Order:**

**4a. Ensure collection and modes exist**
- Check 3 collections (`{app_name}/Primitives` / `{app_name}/Semantic` / `{app_name}/Component`) exist (they should, per prerequisites)
- If any `codeTokens` has non-null `lightValue`: ensure Dark and Light modes exist (create Light mode if missing, rename Default → Dark if needed)
- If no `codeTokens` has non-null `lightValue`: use single Default mode (rename Dark → Default if needed, remove Light mode if exists)
- Record: `{ operation: "ensure_modes", status: "success" | "error", detail: "..." }`

**4b. Add new primitive variables** (category = `added`, aliasTarget = null)
- For each: create variable with `figma.variables.createVariable(key, collection, type)`
- Set primary mode value via `setValueForMode(primaryModeId, value)`
- Set Light mode value via `setValueForMode(lightModeId, value)` only if lightValue is non-null
- Set scopes based on type (COLOR → `["ALL_FILLS", "STROKE_COLOR"]`, FLOAT spacing → `["GAP"]`, FLOAT radius → `["CORNER_RADIUS"]`)
- Record: `{ operation: "add", key: "color/warning", status: "success", variableId: "..." }`

**4c. Add/update alias variables** (category = `added` with aliasTarget, or `alias_changed`)
- Resolve target variable ID by name from existing variables
- Set value as `{ type: 'VARIABLE_ALIAS', id: targetVarId }` for primary mode (and Light mode if dual mode)
- Record: `{ operation: "alias", key: "color/processing", status: "success", target: "color/primary" }`

**4d. Update values** (category = `value_changed`)
- For COLOR: convert hex to `{ r, g, b, a }` (0-1 range) and call `setValueForMode`
- For FLOAT: call `setValueForMode` with numeric value
- Update primary mode value. Update Light mode value only if lightValue is non-null
- Record: `{ operation: "update", key: "color/primary", status: "success", before: "#38BDF8", after: "#6366F1" }`

**4e. Archive removed variables** (category = `removed`)
- Set `variable.scopes = []` to hide from all pickers (do NOT delete)
- Record: `{ operation: "archive", key: "color/error", status: "success" }`

**On any `use_figma` error**: Record `{ operation: "...", key: "...", status: "error", error: "error message" }` in `write_results.failed`, then STOP. Do not continue with remaining writes.

Set `report.write_results = write_results`.

---

### Step 5: Verify

**Goal**: Confirm Figma now matches tokens.json.

1. Re-read Figma Variables (same `use_figma` script as Step 1b)
2. Re-run comparison algorithm (same as Step 2) against the original `codeTokens`
3. Build verification result:

```
verification = {
  remaining_differences: differences.length,  // should be 0
  status: differences.length === 0 ? "success" : "error",
  details: differences  // empty array if success
}
```

Set `report.verification = verification`.

If `verification.status === "error"`, append to `artifacts/{app_name}/feedback-log.md`:
```
- **[24] Token Sync**: Verification failed. {N} differences remain after write. Keys: {list of keys} → Possible cause: write partially failed → Manual inspection needed
```

---

### Step 6: Persist Report

Write the complete `report` object to `artifacts/{app_name}/sync-report.json`:

```json
{
  "timestamp": "2026-04-13T12:00:00Z",
  "change_summary": {
    "totals": { "added": 1, "removed": 1, "value_changed": 2, "alias_changed": 0, "type_changed": 0, "unchanged": 20 },
    "details": [ ... ]
  },
  "write_results": {
    "succeeded": [
      { "operation": "add", "key": "color/warning", "status": "success", "variableId": "VariableID:9:2" },
      { "operation": "update", "key": "color/primary", "status": "success", "before": "#38BDF8", "after": "#6366F1" },
      { "operation": "update", "key": "spacing/md", "status": "success", "before": 16, "after": 20 },
      { "operation": "archive", "key": "color/error", "status": "success" }
    ],
    "failed": []
  },
  "verification": {
    "remaining_differences": 0,
    "status": "success",
    "details": []
  }
}
```

This file is the single source of truth for what happened during sync. It must always be written, even if Step 4 or 5 failed — in that case, `write_results.failed` and/or `verification.status` will indicate the failure.

---

## Verification Checklist

- [ ] All tokens from tokens.json (except shadow/composite) are present in Figma Variables
- [ ] All color values match with RGBA tolerance 0.0001
- [ ] All dimension/number values match exactly
- [ ] Alias references resolve to correct targets
- [ ] No variables were deleted (archive_only policy)
- [ ] sync-report.json exists and contains all three sections: change_summary, write_results, verification
- [ ] write_results.failed is empty
- [ ] verification.remaining_differences is 0
- [ ] verification.status is "success"

## Known Limitations

- Shadow tokens (DTCG composite type) are skipped — Figma Variables do not support composite shadow values as a single variable
- `component.*` alias tokens may need manual verification if the referenced `global.*` token was renamed (alias target path changes)
- Mode detection: skill auto-detects single (Default) vs dual (Dark/Light) mode based on tokens.json content. If Figma collection already has custom mode names that differ from Default/Dark/Light, manual mapping config is needed
- Alias difference detection has not been tested with alias target changes (only tested with value changes on non-alias tokens). To be verified during formal implementation.
- Scalability with 20+ token changes has not been tested. To be verified during formal implementation.
