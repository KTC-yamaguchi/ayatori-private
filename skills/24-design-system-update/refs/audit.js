// audit.js — Step 24 Self-Audit (Step G)
// Read this file from skill 24 §Step G, paste into use_figma context, and invoke runAudit().
//
// Inputs expected in scope:
//   - spec: parsed artifacts/{app_name}/build/component-spec.json
//   - tokensJson: parsed artifacts/{app_name}/tokens.json
//   - libraryFrame: FrameNode (Component Library Frame, from figma-state.json.nodes.component-library)
//   - variantsArchive: FrameNode | null (ComponentSet Variants Archive, from figma-state.json.nodes.variants-archive)
//     ↑ Step G-1b 取得手順:
//       const va = state.nodes['variants-archive']?.node_id
//         ? await figma.getNodeByIdAsync(state.nodes['variants-archive'].node_id)
//         : null;
//   - state: parsed artifacts/{app_name}/figma-state.json
//
// Output: auditResult = { overall, audits, failed, pattern_c, state }
// Side effect: console.log Overall + per-audit lines; updates state.audit.retry[name].
// Caller responsibility (skill 24 §G-1d): Write auditResult.state back to figma-state.json.

// ──────────────────────────────────────────────────────────
// Common helpers
// ──────────────────────────────────────────────────────────
function auditEq(name, expected, actual, note) {
  const pass = expected === actual;
  return { name, expected, actual, pass, note: note || '' };
}
function auditSubset(name, expectedKeys, actualKeys, note) {
  const missing = expectedKeys.filter(k => !actualKeys.includes(k));
  const extra = actualKeys.filter(k => !expectedKeys.includes(k));
  const pass = missing.length === 0 && extra.length === 0;
  return { name, expected: expectedKeys, actual: actualKeys, missing, extra, pass, note: note || '' };
}
function auditLiteralIncludes(name, expectedLiterals, actualTexts, note) {
  const missing = expectedLiterals.filter(lit => !actualTexts.some(t => t.includes(lit)));
  const pass = missing.length === 0;
  return { name, expectedCount: expectedLiterals.length, missing, pass, note: note || '' };
}
async function findChildrenByName(parent, namePattern) {
  return parent.findAll(n => namePattern.test(n.name));
}

// ── scope ヘルパー (B1-1 対策): libraryFrame + variantsArchive 両方を走査 ──
// 設計: skill 24 §D-0 で ComponentSet は variantsArchive (libraryFrame の外) に配置されるため、
//       「ComponentSet を探す」audit は両方の scope を走査する必要がある。
function getScopes() {
  const scopes = [];
  if (typeof libraryFrame !== 'undefined' && libraryFrame) scopes.push(libraryFrame);
  if (typeof variantsArchive !== 'undefined' && variantsArchive) scopes.push(variantsArchive);
  return scopes;
}
function findOneInScopes(predicate) {
  for (const scope of getScopes()) {
    const r = scope.findOne(predicate);
    if (r) return r;
  }
  return null;
}
function findAllInScopes(predicate) {
  const results = [];
  for (const scope of getScopes()) {
    results.push(...scope.findAll(predicate));
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 1-1d: Foundations 5 サブセクション
// ──────────────────────────────────────────────────────────
async function audit1Foundations() {
  const found = await libraryFrame.findAll(n =>
    n.type === 'FRAME' && /Foundations\s*\/\s*(Colors|Typography|Spacing|Touch Target|Radius)/.test(n.name)
  );
  const r0 = auditEq('1.sections', 5, found.length, 'Foundations 5 セクション必須 (Colors/Typography/Spacing/Touch Target/Radius)');

  // 1a: Color Swatches 件数 === tokens.json.global.color の key 数
  const colorsFrame = found.find(f => /Colors/.test(f.name));
  const expectedColors = Object.keys(tokensJson.global.color);
  const actualSwatches = colorsFrame ? colorsFrame.findAll(n => n.type === 'RECTANGLE' && /swatch/i.test(n.name || '')).length : 0;
  const r1a = auditEq('1a.colors', expectedColors.length, actualSwatches, '各 color key に Rectangle Swatch');

  // 1b: Typography sample_text を literal で配置
  const typoFrame = found.find(f => /Typography/.test(f.name));
  const expectedSampleTexts = (spec.foundations_samples?.typography || []).map(s => s.sample_text);
  const typoTextNodes = typoFrame ? typoFrame.findAll(n => n.type === 'TEXT').map(n => n.characters) : [];
  const r1b = auditLiteralIncludes('1b.typography', expectedSampleTexts, typoTextNodes, 'sample_text は HTML literal を使う (AP-2)');

  // 1c: Spacing scale items (xs/sm/md/lg/xl/2xl のみ、touch-target 除外)
  const spacingFrame = found.find(f => /Spacing/.test(f.name) && !/Touch Target/.test(f.name));
  const expectedSpacing = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
  const spacingBars = spacingFrame ? spacingFrame.findAll(n => /bar|scale-item/.test(n.name || '')).length : 0;
  const r1c = auditEq('1c.spacing', expectedSpacing.length, spacingBars, 'Spacing Scale 6 items (touch-target 別枠)');

  // 1d: Radius scale items
  const radiusFrame = found.find(f => /Radius/.test(f.name));
  const expectedRadius = Object.keys(tokensJson.global['border-radius'] || {});
  const radiusItems = radiusFrame ? radiusFrame.findAll(n => n.type === 'RECTANGLE').length : 0;
  const r1d = auditEq('1d.radius', expectedRadius.length, radiusItems, 'Radius Scale 全 border-radius key');

  return [r0, r1a, r1b, r1c, r1d];
}

// ──────────────────────────────────────────────────────────
// Audit 2: Variants 全件処理
// ──────────────────────────────────────────────────────────
async function audit2Variants() {
  const results = [];
  for (const compSpec of spec.components) {
    if (!compSpec.variants || compSpec.variants.length <= 1) continue;
    // ComponentSet は variantsArchive に配置されているため両 scope を走査 (B1-1)
    const csNode = findOneInScopes(n => n.type === 'COMPONENT_SET' && n.name === compSpec.name);
    const actualVariants = csNode ? csNode.children.length : 0;
    const note = csNode
      ? 'variants[] 全件 loop (AP-1)'
      : `ComponentSet "${compSpec.name}" 不在 (Step D-2 で combineAsVariants が呼ばれていない、または variantsArchive に配置されていない)`;
    results.push(auditEq(`2.${compSpec.name}`, compSpec.variants.length, actualVariants, note));
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 3: Button アイコン VECTOR ノード数
// ──────────────────────────────────────────────────────────
async function audit3Icons() {
  const buttonSpec = spec.components.find(c => c.name === 'Button');
  if (!buttonSpec) return [{ name: '3.icons', pass: true, note: 'Button 未定義のため skip' }];
  const expectedIcons = buttonSpec.variants.filter(v => v.icon_svg != null).length;
  // ComponentSet は variantsArchive に配置 (B1-1)
  const cs = findOneInScopes(n => n.type === 'COMPONENT_SET' && n.name === 'Button');
  // Detect illustration_policy from icon_svg sentinel values:
  //   pictogram             → icon_svg is an SVG string (starts with '<')
  //   illustration_character → icon_svg === 'illust-placeholder'
  //   emoji_casual          → non-null, non-SVG, non-placeholder (emoji char)
  const sampleIconSvg = buttonSpec.variants.find(v => v.icon_svg != null)?.icon_svg;
  if (sampleIconSvg === 'illust-placeholder') {
    // illustration_character: D-2 creates RECTANGLE nodes named 'illust-placeholder/{state}'
    const rectNodes = cs ? cs.findAll(n => n.type === 'RECTANGLE' && n.name?.startsWith('illust-placeholder/')) : [];
    return [auditEq('3.icons', expectedIcons, rectNodes.length, 'placeholder 矩形 (illustration_character)')];
  } else if (sampleIconSvg != null && !String(sampleIconSvg).trimStart().startsWith('<')) {
    // emoji_casual: D-2 creates TEXT nodes named 'emoji/{state}'
    const emojiTextNodes = cs ? cs.findAll(n => n.type === 'TEXT' && n.name?.startsWith('emoji/')) : [];
    return [auditEq('3.icons', expectedIcons, emojiTextNodes.length, 'emoji Text Node (emoji_casual)')];
  } else {
    // pictogram: D-2 uses createNodeFromSvg → VECTOR nodes
    // ⚠ 旧コードは上限クリップで余分な VECTOR を見逃した。actual を生値で厳密比較 (指摘 🔴1 対策)。
    const vectorNodes = cs ? cs.findAll(n => n.type === 'VECTOR') : [];
    return [auditEq('3.icons', expectedIcons, vectorNodes.length, 'createNodeFromSvg 取り込み (AP-5)')];
  }
}

// ──────────────────────────────────────────────────────────
// Audit 4: Preview Frame Instance 数 === variants 数
// ──────────────────────────────────────────────────────────
async function audit4PreviewFrame() {
  const results = [];
  for (const compSpec of spec.components) {
    if (!compSpec.variants || compSpec.variants.length <= 1) continue;
    // Preview Frame は section wrapper 内 (libraryFrame 配下) に配置される設計だが、念のため両 scope を走査
    const preview = findOneInScopes(n => n.type === 'FRAME' && n.name === `${compSpec.name} / Preview`);
    const instances = preview ? preview.findAll(n => n.type === 'INSTANCE') : [];
    results.push(auditEq(`4.${compSpec.name}.preview`, compSpec.variants.length, instances.length, 'Preview Frame で variants 横並び (AP-8)'));
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 5: Card literal_content 全 key 突合
// ──────────────────────────────────────────────────────────
async function audit5CardLiteral() {
  const cardSpec = spec.components.find(c => c.name === 'Card' || c.name === 'Chord Card');
  if (!cardSpec || !cardSpec.literal_content) return [{ name: '5.card', pass: true, note: 'Card literal_content なし、skip' }];
  // Card は variantsArchive (Component / ComponentSet) または section wrapper 内 (Instance) のいずれかに存在
  const card = findOneInScopes(n => (n.type === 'COMPONENT' || n.type === 'COMPONENT_SET') && /Card/.test(n.name));
  const texts = card ? card.findAll(n => n.type === 'TEXT').map(n => n.characters) : [];
  const expectedLiterals = Object.values(cardSpec.literal_content).flat().map(v => String(v));
  return [auditLiteralIncludes('5.card.literal', expectedLiterals, texts, 'literal_content 全 key を Text Node で配置 (AP-3)')];
}

// ──────────────────────────────────────────────────────────
// Audit 6: 06 表現制約 Text Node 数
// ──────────────────────────────────────────────────────────
async function audit6ExpressionConstraints() {
  const ec = spec.expression_constraints;
  if (!ec) return [{ name: '6.expression', pass: true, note: 'expression_constraints なし、skip' }];
  const ecFrame = await libraryFrame.findOne(n => n.type === 'FRAME' && /Expression Constraints/.test(n.name));
  const textCount = ecFrame ? ecFrame.findAll(n => n.type === 'TEXT').length : 0;
  const expected = 1 // title
    + (ec.do_cards?.length || 0) // each card has 1 heading
    + (ec.dont_cards?.length || 0)
    + (ec.do_cards || []).reduce((s, c) => s + (c.items?.length || 0), 0)
    + (ec.dont_cards || []).reduce((s, c) => s + (c.items?.length || 0), 0);
  return [auditEq('6.expression', expected, textCount, 'DO/DON'+"'"+'T 全件配置 (AP-4)')];
}

// ──────────────────────────────────────────────────────────
// Audit 7: 未バインド white fill 検出 (Card 子フレーム fills=[])
// ──────────────────────────────────────────────────────────
async function audit7WhiteFill() {
  // Component Library 内 + variantsArchive 内で、Variable bind なしの white fill (#FFFFFF) を検出
  // ⚠ boundVariables の判定は `.color` キーだけを厳密に見る (追加 5 対策、strokeWeight 等他キーの bind があるだけで色 bind 扱いされる旧バグを修正)
  const whites = findAllInScopes(n => {
    if (!n.fills || n.fills === figma.mixed) return false;
    return n.fills.some(f => {
      if (f.type !== 'SOLID') return false;
      const isWhite = f.color.r > 0.95 && f.color.g > 0.95 && f.color.b > 0.95;
      const hasColorBind = f.boundVariables && f.boundVariables.color;
      return isWhite && !hasColorBind;
    });
  });
  return [auditEq('7.white-fill', 0, whites.length, 'Card 子フレーム fills=[] ルール違反 (Slack 指摘 5)')];
}

// ──────────────────────────────────────────────────────────
// Audit 8: tokens.json alias 参照整合性
// ──────────────────────────────────────────────────────────
function audit8AliasIntegrity() {
  const violations = [];
  function walk(obj, path) {
    if (typeof obj !== 'object' || obj === null) return;
    if (obj.$value && typeof obj.$value === 'string') {
      const m = obj.$value.match(/^\{([\w.-]+)\}$/);
      if (m) {
        const targetPath = m[1].split('.');
        let cur = tokensJson;
        for (const seg of targetPath) {
          cur = cur && cur[seg];
          if (!cur) { violations.push({ path, ref: m[1] }); break; }
        }
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$')) continue;
      walk(v, [...path, k]);
    }
  }
  walk(tokensJson, []);
  return [auditEq('8.alias', 0, violations.length, `tokens.json alias 参照先存在チェック (violations: ${JSON.stringify(violations).slice(0, 200)})`)];
}

// ──────────────────────────────────────────────────────────
// Audit 9: Variables key 集合 vs tokens.json
// ──────────────────────────────────────────────────────────
async function audit9VariablesKeys() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const results = [];
  for (const layer of ['Primitives', 'Semantic', 'Component']) {
    const col = collections.find(c => c.name.endsWith(`/${layer}`));
    if (!col) { results.push({ name: `9.${layer}`, pass: false, note: 'collection 不在' }); continue; }
    const varIds = col.variableIds;
    // ⚠ getVariableByIdAsync が削除済 Variable で null を返した場合 v.name で TypeError → audit 全体落ち (追加 3 対策)。
    //    null を filter してから name 抽出 + null 件数を violations に積む。
    const varsRaw = await Promise.all(varIds.map(id => figma.variables.getVariableByIdAsync(id).catch(() => null)));
    const nullCount = varsRaw.filter(v => !v).length;
    const actualKeys = varsRaw.filter(v => v).map(v => v.name);
    const expectedSection = layer === 'Primitives' ? 'global' : layer === 'Semantic' ? 'semantic' : 'component';
    // A-2 修正: skill 24 §Step B の登録対象表に従って expectedKeys を計算
    //   - Primitives: color + typography + spacing + border-radius (shadow は除外、composite で Variable 不可)
    //   - Semantic / Component: 全 leaf (alias 経由で型継承)
    // typography を expectedKeys に含めるのは、skill 24 §Step B 本文で「typography も Variable 化」と明示したため。
    const allKeys = flattenKeys(tokensJson[expectedSection] || {});
    const expectedKeys = allKeys.filter(k => {
      // shadow は Figma の composite Effect で Variable 化不可 (blur のみ representative として個別登録は可だが、本 audit のスコープ外)
      return !k.startsWith('shadow/');
    });
    const auditResult = auditSubset(`9.${layer}`, expectedKeys, actualKeys, '周回 7 SoT 改竄パターン検出 + Step B 登録対象範囲チェック');
    if (nullCount > 0) {
      auditResult.note = `${auditResult.note} (削除済 Variable: ${nullCount} 件、auditResult から除外)`;
      auditResult.pass = false; // 削除済参照があれば不整合
    }
    results.push(auditResult);
  }
  return results;
}
function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('$')) continue;
    if (typeof v === 'object' && v !== null && '$value' in v) {
      keys.push(prefix + k);
    } else if (typeof v === 'object' && v !== null) {
      keys.push(...flattenKeys(v, prefix + k + '/'));
    }
  }
  return keys;
}

// ──────────────────────────────────────────────────────────
// Audit 10: Auto Layout sizingMode 明示
// ──────────────────────────────────────────────────────────
async function audit10SizingMode() {
  // Type guard: FRAME / COMPONENT / COMPONENT_SET のみ走査
  // ⚠ INSTANCE は除外: layoutMode を mainComponent から継承するが、layoutSizingHorizontal/Vertical を
  //    直接 set/get すると figma.mixed 化 / 仕様禁止操作になるため (追加 4 対策)。
  // ⚠ TEXT / RECTANGLE / VECTOR も layoutMode プロパティを持たないため除外。
  const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET']);
  const violations = libraryFrame.findAll(n => {
    if (!FRAME_TYPES.has(n.type)) return false;
    if (n.layoutMode === 'NONE' || !n.layoutMode) return false;
    return !n.layoutSizingHorizontal || !n.layoutSizingVertical;
  });
  return [auditEq('10.sizingMode', 0, violations.length, 'Auto Layout Frame は sizingMode 明示必須 (AP-10)')];
}

// ──────────────────────────────────────────────────────────
// Audit 11: Foundations / Components のラベル Text Node 検証
// (LLM が「ただ色矩形を並べただけ」で済ます Anti-Pattern を機械検出)
// ──────────────────────────────────────────────────────────
async function audit11Labels() {
  const results = [];

  // 11a: Color Swatches 各 cell に name + hex の Text Node 2 件必須
  const colorsFrame = libraryFrame.findOne(n =>
    n.type === 'FRAME' && /Foundations\s*\/\s*Colors/.test(n.name)
  );
  if (!colorsFrame) {
    // Frame 不在は skip ではなく FAIL として記録 (追加 7 対策)
    results.push({ name: '11a.color-labels', pass: false, expected: 0, actual: -1,
      note: 'Foundations / Colors Frame 不在 (Step C-1 で構築されていない)' });
  } else {
    const cells = colorsFrame.findAll(n => n.type === 'FRAME' && /^swatch-/.test(n.name || ''));
    const violations = cells.filter(cell => cell.findAll(n => n.type === 'TEXT').length < 2);
    results.push(auditEq('11a.color-labels', 0, violations.length,
      `各 swatch に tokenName + hex の Text Node 2 件必須 (cells: ${cells.length})`));
  }

  // 11b: Spacing Scale の各バー横に scale-label-* Text Node 必須
  // ⚠ 旧コードは `labels.length >= 6 ? 6 : labels.length` で上限クリップしていたため、
  //    7 件以上あっても PASS する穴があった (追加 1 対策、audit3 と同種のバグ)。
  const spacingFrame = libraryFrame.findOne(n =>
    n.type === 'FRAME' && /Foundations\s*\/\s*Spacing/.test(n.name) && !/Touch Target/.test(n.name)
  );
  if (!spacingFrame) {
    results.push({ name: '11b.spacing-labels', pass: false, expected: 6, actual: -1,
      note: 'Foundations / Spacing Frame 不在' });
  } else {
    const labels = spacingFrame.findAll(n => n.type === 'TEXT' && /scale-label-/.test(n.name || ''));
    results.push(auditEq('11b.spacing-labels', 6, labels.length,
      'Spacing Scale 各 6 件 (xs-2xl) に scale-label-* Text Node 必須'));
  }

  // 11c: Radius Scale の各矩形に radius-label-* Text Node 必須
  const radiusFrame = libraryFrame.findOne(n =>
    n.type === 'FRAME' && /Foundations\s*\/\s*Radius/.test(n.name)
  );
  if (!radiusFrame) {
    results.push({ name: '11c.radius-labels', pass: false, expected: -1, actual: -1,
      note: 'Foundations / Radius Frame 不在' });
  } else {
    const expectedKeys = Object.keys(tokensJson.global['border-radius'] || {});
    const labels = radiusFrame.findAll(n => n.type === 'TEXT' && /radius-label-/.test(n.name || ''));
    results.push(auditEq('11c.radius-labels', expectedKeys.length, labels.length,
      '各 Radius cell に radius-label-* Text Node 必須'));
  }

  // 11d: Components 大セクション タイトル "Components" Text Node 必須
  const componentsTitle = libraryFrame.findOne(n =>
    n.type === 'TEXT' &&
    (n.name === 'components-section-title' || n.characters === 'Components')
  );
  results.push(auditEq('11d.components-title', 1, componentsTitle ? 1 : 0,
    'Components 大セクションタイトル必須 (Foundations と Component の境界)'));

  // 11e: 各 ComponentSet の前に番号付きサブタイトル ('01 Button' 等) Text Node 必須
  // ⚠ 旧コードは regex `^\d{2}\s+\S` で characters マッチしていたため、Foundations サブタイトル
  //    (「01 Colors」「02 Typography Scale」「03 Spacing Scale」「04 Border Radius」) も誤検出して
  //    必ず false positive で FAIL する穴があった (B1-2 対策)。
  //    → node name `component-subtitle-` で filter する形に変更し、Components セクションだけを対象にする。
  const expectedComponentCount = (spec.components || []).length;
  const numberedSubtitles = libraryFrame.findAll(n =>
    n.type === 'TEXT' && /^component-subtitle-/.test(n.name || '')
  );
  results.push(auditEq('11e.numbered-subtitles', expectedComponentCount, numberedSubtitles.length,
    `各 ComponentSet に番号付きサブタイトル必須 (expected: ${expectedComponentCount} 件、node name 'component-subtitle-*' で識別)`));

  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 12: レイアウト sizingMode 適切値検証
// (各セクションフレームの FILL/HUG/FIXED が適切か = 表示崩れ防止)
// ──────────────────────────────────────────────────────────
async function audit12LayoutSizing() {
  const results = [];

  // 12a: Foundations 各サブフレームは FILL horizontal + HUG vertical 必須
  const foundationsFrames = libraryFrame.findAll(n =>
    n.type === 'FRAME' && /^Foundations\s*\/\s*/.test(n.name)
  );
  const foundationViolations = foundationsFrames.filter(f =>
    f.layoutSizingHorizontal !== 'FILL' || f.layoutSizingVertical !== 'HUG'
  );
  results.push(auditEq('12a.foundations-fill', 0, foundationViolations.length,
    `Foundations サブフレーム = FILL+HUG 必須 (violations: ${foundationViolations.map(f => `${f.name}(${f.layoutSizingHorizontal}/${f.layoutSizingVertical})`).slice(0, 3).join(', ')})`));

  // 12b: Components section wrapper (section-NN-{Name}) は FILL horizontal + HUG vertical 必須
  const sectionWrappers = libraryFrame.findAll(n =>
    n.type === 'FRAME' && /^section-\d{2}-/.test(n.name)
  );
  const sectionViolations = sectionWrappers.filter(f =>
    f.layoutSizingHorizontal !== 'FILL' || f.layoutSizingVertical !== 'HUG'
  );
  results.push(auditEq('12b.section-fill', 0, sectionViolations.length,
    `Components section wrapper = FILL+HUG 必須 (wrappers: ${sectionWrappers.length}, violations: ${sectionViolations.length})`));

  // 12c: Library 最外フレームは FIXED horizontal + HUG vertical 必須
  const libFrameOk =
    libraryFrame.layoutSizingHorizontal === 'FIXED' &&
    libraryFrame.layoutSizingVertical === 'HUG';
  results.push(auditEq('12c.library-fixed', 1, libFrameOk ? 1 : 0,
    `Library 最外 = FIXED+HUG (actual: ${libraryFrame.layoutSizingHorizontal}/${libraryFrame.layoutSizingVertical})`));

  // 12d: Library 最外の width が 800px 以上 (旧 ChordSketch 920px 並みの密度)
  const libWidthOk = libraryFrame.width >= 800;
  results.push(auditEq('12d.library-width', 1, libWidthOk ? 1 : 0,
    `Library 幅 >= 800px (actual: ${libraryFrame.width}px)`));

  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 13: Foundations サブタイトル + ComponentSet 配置責務
// ──────────────────────────────────────────────────────────
async function audit13Structure() {
  const results = [];

  // 13a: Foundations 各サブフレームの先頭子が Text Node (タイトル) 必須
  const subFrames = libraryFrame.findAll(n =>
    n.type === 'FRAME' && /^Foundations\s*\/\s*(Colors|Typography|Spacing|Touch Target|Radius)/.test(n.name)
  );
  const titleViolations = subFrames.filter(f => {
    const firstChild = f.children && f.children[0];
    return !firstChild || firstChild.type !== 'TEXT';
  });
  results.push(auditEq('13a.foundations-titles', 0, titleViolations.length,
    `Foundations 各サブフレームの先頭に title Text Node 必須 (subFrames: ${subFrames.length}, violations: ${titleViolations.map(f => f.name).join(', ')})`));

  // 13b: libraryFrame 内に COMPONENT_SET は配置禁止 (variantsArchive へ)
  const cssInLibrary = libraryFrame.findAll(n => n.type === 'COMPONENT_SET');
  results.push(auditEq('13b.no-cs-in-library', 0, cssInLibrary.length,
    `libraryFrame 内に ComponentSet 配置禁止 (variants が重なって表示崩れ。variantsArchive に置く)`));

  // 13c: section wrapper 内に COMPONENT_SET 配置禁止 (Preview Frame のみ)
  const sectionWrappers = libraryFrame.findAll(n =>
    n.type === 'FRAME' && /^section-\d{2}-/.test(n.name)
  );
  // 追加 2 対策: violations 詳細を note に含めて、どの section に CS が紛れているかが分かるようにする
  const violatingSections = sectionWrappers.filter(s => s.findOne && s.findOne(n => n.type === 'COMPONENT_SET'));
  const violatingSectionNames = violatingSections.map(s => s.name).slice(0, 5);
  results.push(auditEq('13c.no-cs-in-section', 0, violatingSections.length,
    `section wrapper 内に ComponentSet 配置禁止 (Preview Frame / Instance のみ)。違反 section: ${violatingSectionNames.join(', ') || 'なし'}`));

  return results;
}

// ──────────────────────────────────────────────────────────
// Audit 14: Focus Ring 仕様キャプション
// ──────────────────────────────────────────────────────────
async function audit14FocusRingCaption() {
  const results = [];

  const focusRingSpec = (spec.components || []).find(c => /focus.?ring/i.test(c.name));
  if (!focusRingSpec) {
    results.push({ name: '14.focus-ring-caption', pass: true, note: 'Focus Ring component 未定義のため skip' });
    return results;
  }

  // figma.currentPage または libraryFrame + variantsArchive 全体から Focus Ring の仕様キャプションを探す
  const allScopes = [libraryFrame, figma.currentPage];
  let captionFound = false;
  for (const scope of allScopes) {
    if (!scope) continue;
    const caption = scope.findOne && scope.findOne(n =>
      n.type === 'TEXT' && /focus-ring-spec-caption/.test(n.name || '')
    );
    if (caption) { captionFound = true; break; }
  }

  results.push(auditEq('14.focus-ring-caption', 1, captionFound ? 1 : 0,
    'Focus Ring に仕様キャプション (focus-ring-spec-caption Text Node) 必須'));

  return results;
}

// ──────────────────────────────────────────────────────────
// Retry state 管理 (3 回再実行で Pattern C エスカレート)
// ──────────────────────────────────────────────────────────
// 指摘 🔴2 対策: Pattern C 発生時に pattern_c フラグを **戻り値で返す**。
//                console.warn だけでは呼び出し元 (skill 24) が気づかないため。
function updateRetryState(failedAudits) {
  if (!state.audit) state.audit = { retry: {} };
  if (!state.audit.retry) state.audit.retry = {};
  for (const audit of failedAudits) {
    state.audit.retry[audit.name] = (state.audit.retry[audit.name] || 0) + 1;
  }
  const overLimit = failedAudits.filter(a => state.audit.retry[a.name] >= 3);
  let pattern_c = null;
  if (overLimit.length > 0) {
    pattern_c = overLimit.map(a => a.name);
    state.audit.pattern_c = pattern_c;
    console.warn('[Audit] Pattern C escalation: ', pattern_c);
  }
  return pattern_c;
}

// ──────────────────────────────────────────────────────────
// Overall PASS/FAIL + console.log
// ──────────────────────────────────────────────────────────
async function runAudit() {
  const audits = [
    ...(await audit1Foundations()),
    ...(await audit2Variants()),
    ...(await audit3Icons()),
    ...(await audit4PreviewFrame()),
    ...(await audit5CardLiteral()),
    ...(await audit6ExpressionConstraints()),
    ...(await audit7WhiteFill()),
    ...audit8AliasIntegrity(),
    ...(await audit9VariablesKeys()),
    ...(await audit10SizingMode()),
    ...(await audit11Labels()),
    ...(await audit12LayoutSizing()),
    ...(await audit13Structure()),
    ...(await audit14FocusRingCaption()),
  ];
  const failed = audits.filter(a => !a.pass);
  const overall = failed.length === 0 ? 'PASS' : 'FAIL';
  console.log('────────── Step 24 Self-Audit ──────────');
  for (const a of audits) {
    console.log(`[${a.pass ? '✓' : '✗'}] ${a.name}: ${a.note}`);
  }
  console.log(`Overall: ${overall} (failed: ${failed.length} / total: ${audits.length})`);
  // 指摘 🔴2 / 🔴3 対策:
  // - pattern_c を runAudit の戻り値に含めて呼び出し元 (skill 24 §G-1d) で分岐できるようにする
  // - state を戻り値に含めて、呼び出し元が figma-state.json に Write back する責務を明示
  let pattern_c = null;
  if (failed.length > 0) {
    pattern_c = updateRetryState(failed);
  } else {
    // B-7 修正: PASS 時に state.audit.retry を全 reset + pattern_c を null clear。
    //   旧版は increment のみで PASS 時に reset しないため、過去の Pattern C 配列が stale で残る +
    //   1 回 FAIL → 修正 → PASS → 後日 1 回 FAIL のシナリオで retry 累積 → 偽 Pattern C 発火。
    if (state.audit) {
      state.audit.retry = {};
      state.audit.pattern_c = null;
    }
  }
  // PASS した個別 audit の retry counter を decrement (B-7 補完): 各 audit 独立判定で
  //   今回 PASS した audit は retry を 0 にリセット。FAIL audit のみ retry が累積する。
  for (const audit of audits) {
    if (audit.pass && state.audit?.retry?.[audit.name]) {
      delete state.audit.retry[audit.name];
    }
  }
  return { overall, audits, failed, pattern_c, state };
}

// Entry point — call from use_figma:
//   const auditResult = await runAudit();
