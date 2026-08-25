// =====================================================
// Default grid layout for Step 22 captured frames
// rows = screens, cols = states × platforms (per user selection)
//
// Used by skills/22-figma-export/SKILL.md Step 2.5.
// Pass to mcp__figma__use_figma after all captures complete.
//
// Substitute these placeholders before passing to use_figma:
//   __SCREENS__       = JSON array of screen names in display order
//                       e.g., ['01-login','02-dashboard',...]
//   __NODES__         = JSON object mapping screen → platform → state → node_id
//                       e.g., { "01-login": { "mobile": { "default": "283:2", "empty": "284:2" } } }
//                       Built from figma-state.json.nodes.screens. State names are the actual
//                       state values from figma-state.json (NOT positional indices).
//   __PLATFORMS__     = JSON array, subset of ['web','web-sm','mobile'] (fixed order)
//                       (from Step 2.0 Q1 user selection)
//   __STATES__        = JSON array of base states from Step 2.0 Q2 user selection
//                       e.g., ['default','empty','loading','error']
//                       Extra per-screen states (paused, recording, etc.) are detected
//                       automatically from NODES and appended after base states.
//
// Layout computed dynamically:
//   - cols = union_states.length × PLATFORMS.length
//     where union_states = STATES + any extra states found in NODES across all screens
//   - rows = SCREENS.length
//   - row height = max(node.height) in that row + ROW_GAP
//   - col widths: web=1440, web-sm=390, mobile=390
//   - section gap between platform groups (inserted at every platform boundary: web / web-sm / mobile)
//   - screens missing a given state column show an empty cell (no crash)
// =====================================================

const SCREENS = __SCREENS__;
const NODES = __NODES__;    // screen → platform → state → node_id
const PLATFORMS = __PLATFORMS__;
const BASE_STATES = __STATES__;  // user-selected base states

const PLATFORM_W = { web: 1440, "web-sm": 390, mobile: 390 }; // web-sm = Web スマホ幅
const COL_GAP = 240;
const SECTION_GAP = 600; // extra gap between platform groups
const ROW_GAP = 400;
const ORIGIN_X = 0;
const ORIGIN_Y = 0;

// Derive union of all states: base states first, then any extra states found in NODES
const extraStates = new Set();
for (const screen of SCREENS) {
  for (const platform of PLATFORMS) {
    const stateMap = (NODES[screen] || {})[platform] || {};
    for (const state of Object.keys(stateMap)) {
      if (!BASE_STATES.includes(state)) extraStates.add(state);
    }
  }
}
const STATES = [...BASE_STATES, ...extraStates];

// Build flat column list: [{platform, state}, ...]
const cols = [];
for (const platform of PLATFORMS) {
  for (const state of STATES) {
    cols.push({ platform, state });
  }
}

// Compute column x positions with section gap between platforms
const colX = [];
let cx = ORIGIN_X;
let prevPlatform = null;
for (let i = 0; i < cols.length; i++) {
  if (prevPlatform !== null && cols[i].platform !== prevPlatform) cx += SECTION_GAP - COL_GAP;
  colX[i] = cx;
  cx += PLATFORM_W[cols[i].platform] + COL_GAP;
  prevPlatform = cols[i].platform;
}

// Helper: get node_id for a screen/platform/state combination (returns null if absent)
function getNodeId(screen, platform, state) {
  return ((NODES[screen] || {})[platform] || {})[state] || null;
}

// Step 0.5: pre-layout normalization — make every frame a self-contained tile.
//
// The Figma capture script can wrap the real screen (e.g. mobile .screen=390) inside a
// wider preview container, leaving the content offset (e.g. content.x≈554, centered for a
// ~1497px wrapper). With clipsContent=false that content overflows the frame's right edge
// and is drawn on top of the adjacent grid column — the frame bounding boxes do NOT collide,
// but the *content inside them* bleeds into the neighbor, so screens look stacked/overlapped.
// Re-gridding alone cannot fix this (it only moves the outer frames). The frame must first
// be normalized so its content sits at the origin and the frame is cropped to it.
//
// This runs at the end of EVERY capture episode (Step 22 default, Step 25e sub-state,
// delta re-capture) because the grid routine is shared — so newly added frames are always
// normalized to the same tile shape as the existing ones. It is idempotent: a frame whose
// content is already at (0,0) and whose size already matches its content is left unchanged.
//
// Per frame, UNCONDITIONALLY (not gated on over-width):
//   1. clear auto-layout padding (prevents resize from collapsing FILL children)
//   2. compute union bounding box of ALL meaningful children (not just the largest one)
//      — using union avoids clipping siblings that overflow the largest child's bounds
//   3. shift ALL children so the union top-left moves to (0,0)
//   4. resize the frame to the union width × height
//   5. set clipsContent=true so nothing can bleed past the frame edge into a neighbor
let trimmed = 0;
for (let row = 0; row < SCREENS.length; row++) {
  const screen = SCREENS[row];
  for (const c of cols) {
    const id = getNodeId(screen, c.platform, c.state);
    if (!id) continue;
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== 'FRAME' || !node.children || node.children.length === 0) continue;
    // 1) clear auto-layout padding before resize so FILL children don't collapse
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      node.paddingLeft = node.paddingRight = node.paddingTop = node.paddingBottom = 0;
    }
    // 2) union bounding box of all children (skip only zero-size capture artifacts —
    //    1px hairlines/dividers are legitimate content and must stay in the union)
    const kids = node.children.filter(k => k.width > 0.01 && k.height > 0.01);
    if (!kids.length) continue;
    const unionLeft   = Math.min(...kids.map(k => k.x));
    const unionTop    = Math.min(...kids.map(k => k.y));
    const unionRight  = Math.max(...kids.map(k => k.x + k.width));
    const unionBottom = Math.max(...kids.map(k => k.y + k.height));
    const uw = unionRight - unionLeft;
    const uh = unionBottom - unionTop;
    // 3) shift all children so union top-left lands at (0,0)
    if (Math.abs(unionLeft) > 0.5 || Math.abs(unionTop) > 0.5) {
      for (const k of node.children) { k.x -= unionLeft; k.y -= unionTop; }
    }
    // 4) crop the frame to the union size and clip so nothing overflows into neighbors
    if (Math.abs(node.width - uw) > 1 || Math.abs(node.height - uh) > 1) {
      node.resize(uw, uh);
      trimmed++;
    }
    node.clipsContent = true;
  }
}

// Step 1: measure per-row max height (frames may exceed min-height due to content)
const rowHeights = [];
for (let row = 0; row < SCREENS.length; row++) {
  const screen = SCREENS[row];
  let maxH = 0;
  for (const c of cols) {
    const id = getNodeId(screen, c.platform, c.state);
    if (!id) continue;
    const n = await figma.getNodeByIdAsync(id);
    if (n && n.height > maxH) maxH = n.height;
  }
  rowHeights[row] = maxH || 934; // default to 934 if row has no nodes
}

// Step 2: cumulative row y positions
const rowY = [];
let y = ORIGIN_Y;
for (let r = 0; r < SCREENS.length; r++) {
  rowY[r] = y;
  y += rowHeights[r] + ROW_GAP;
}

// Step 3: reposition all frames
let moved = 0;
let parentNode = null;
for (let row = 0; row < SCREENS.length; row++) {
  const screen = SCREENS[row];
  for (let i = 0; i < cols.length; i++) {
    const id = getNodeId(screen, cols[i].platform, cols[i].state);
    if (!id) continue; // screen doesn't have this state — skip cell
    const node = await figma.getNodeByIdAsync(id);
    if (node) {
      node.x = colX[i];
      node.y = rowY[row]; // top-align within row
      if (!parentNode) parentNode = node.parent;
      moved++;
    }
  }
}

// Step 4: cleanup any old labels we previously created at parent root
let labelsRemoved = 0;
if (parentNode && parentNode.children) {
  const oldLabels = parentNode.children.filter(c =>
    c.type === 'TEXT' && (
      /^Web · /.test(c.characters) ||
      /^Web SM · /.test(c.characters) ||
      /^Mobile · /.test(c.characters) ||
      SCREENS.includes(c.characters)
    )
  );
  for (const l of oldLabels) { l.remove(); labelsRemoved++; }
}

// Step 5: add column headers and row labels
let headersAdded = 0;
let rowLabelsAdded = 0;
try {
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  const HEADER_Y = ORIGIN_Y - 140;
  for (let i = 0; i < cols.length; i++) {
    const label = figma.createText();
    label.fontName = { family: "Inter", style: "Bold" };
    const platformPretty = cols[i].platform === 'web' ? 'Web' : cols[i].platform === 'web-sm' ? 'Web SM' : 'Mobile';
    label.fontSize = cols[i].platform === 'web' ? 36 : 28;
    label.characters = `${platformPretty} · ${cols[i].state}`;
    label.x = colX[i];
    label.y = HEADER_Y;
    if (parentNode && parentNode.appendChild) parentNode.appendChild(label);
    headersAdded++;
  }

  const ROW_LABEL_X = ORIGIN_X - 420;
  for (let r = 0; r < SCREENS.length; r++) {
    const label = figma.createText();
    label.fontName = { family: "Inter", style: "Bold" };
    label.fontSize = 32;
    label.characters = SCREENS[r];
    label.x = ROW_LABEL_X;
    label.y = rowY[r] + rowHeights[r] / 2 - 16;
    if (parentNode && parentNode.appendChild) parentNode.appendChild(label);
    rowLabelsAdded++;
  }
} catch (e) {
  // Inter font unavailable — skip labels but keep frame layout
}

// Step 6: orphan sweep — quarantine duplicate capture frames that are NOT part of the grid.
// Stale captureIds can complete late and drop a duplicate frame at an arbitrary position
// (overlapping the grid or floating far away). Duplicates are detected by NAME: a late
// capture produces a frame whose name is identical to a grid-owned frame but whose id is
// not in the grid. Scoping by name (not "every non-grid frame") spares manual frames the
// user may have added to the same page (annotations, comparisons, etc.). Matches are moved
// to a quarantine column on the right of the grid for human review — never auto-deleted.
const gridIds = new Set();
const gridNames = new Set();
for (const screen of SCREENS) {
  for (const c of cols) {
    const id = getNodeId(screen, c.platform, c.state);
    if (!id) continue;
    const normId = String(id).replace('-', ':'); // normalize "123-45" → "123:45" (Plugin API id form)
    gridIds.add(normId);
    const n = await figma.getNodeByIdAsync(normId);
    if (n) gridNames.add(n.name);
  }
}
let orphansMoved = 0;
const orphanNames = [];
if (parentNode && parentNode.children) {
  const gridRightEdge = Math.max(...cols.map((c, i) => colX[i] + PLATFORM_W[c.platform]));
  const quarantineX = gridRightEdge + SECTION_GAP * 2;
  let qy = ORIGIN_Y;
  const orphans = parentNode.children.filter(c =>
    c.type === 'FRAME' && !gridIds.has(c.id) && gridNames.has(c.name)
  );
  for (const o of orphans) {
    o.x = quarantineX;
    o.y = qy;
    qy += o.height + ROW_GAP;
    orphansMoved++;
    orphanNames.push(o.name);
  }
}

return {
  moved: moved,
  trimmed: trimmed,
  orphans_moved: orphansMoved,
  orphan_names: orphanNames,
  cols_per_row: cols.length,
  rows: SCREENS.length,
  base_states: BASE_STATES,
  extra_states: [...extraStates],
  all_states: STATES,
  totalCanvasHeight: Math.round(y),
  rowHeights: rowHeights.map((h, i) => ({ screen: SCREENS[i], maxH: Math.round(h) })),
  labelsRemoved: labelsRemoved,
  headersAdded: headersAdded,
  rowLabelsAdded: rowLabelsAdded,
  parent_id: parentNode ? parentNode.id : null
};
