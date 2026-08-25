---
name: 00-feedback-protocol
description: "人間ゲート（07 / 10 / 13 / 16 / 21 / 21g / 23）で「修正: ...」フィードバックを受領したときに、指摘箇所だけを直して終わらせることを禁止し、同じパーツ・値を持つ全 variant へ漏れなく反映するための共通プロトコル。"
---

# 00 修正フィードバック対応プロトコル（人間ゲート共通）

## 役割

人間ゲート（07 / 10 / 13 / 16 / 21 / 21g / 23）で「修正: ...」フィードバックを受領したときに、**指摘箇所だけを直して終わらせる**ことを禁止し、**同じパーツ／値を持つ全variantへ漏れなく反映**するための共通プロトコル。

再指摘の往復を生むのはほぼ「①スコープ漏れ」と「②黙って失敗する置換」の2層が重なるため、本プロトコルは両方を必須にする。

---

## いつ適用するか

人間ゲート（07 / 10 / 13 / 16 / 21 / 21g / 23）で、ユーザーから以下のような修正指示を受けたとき：

- 「{画面/コンポーネント/トークン/文言} を {変更内容} に直して」
- 「ボタンの色を変えて」「ヘッダーのpaddingを揃えて」「文言を統一して」 等

**1ファイル・1箇所だけの修正で完結させてはならない**。

---

## Operating Principle 4 — Disambiguation（本プロトコル = ユーザー修正指示の解釈 / flavor a）

ユーザーの修正指示も **input**。指示の **スコープが N≥2 に割れる** 場合（例:「色だけ直して」→ primary だけ /
全 state color / 全 palette のどれか不定 = enumeration）、勝手に 1 つに畳まず確認する。
`docs/principle4-disambiguation.md` §1 に従い解釈候補を列挙し、候補が N≥2 なら **ゲート対応中なので
その場で inline 確認**（人間ゲートは対話中のため）。後続に持ち越す場合は
`artifacts/{app_name}/pending-questions.json` に append（必須 field: `target` / `question` / `raised_by_step="00-feedback-protocol"` / `raised_at` [ISO 8601]、任意で `ambiguity_kind`。⚠️ 必須 field を省くと hook R3 が exit 2 で Write を弾く）。
持ち越す entry に **`reflect_to`（回答の反映先 artifact の相対パス）は書かない** — 本プロトコルは Phase 1b / 2 / 3 の**9 ゲート**（07 / 10 / 13 / 16 / 21 / 21a / 21g / 22 / 23）から呼ばれる汎用手順で、呼び出し元によって「自分より後に通る門」が変わるため、appender 側で受け手を静的に決められない（例: Phase 3 のゲートで `requirements/*.md` を宣言すると、次に通る Phase 4 retro は要件文書の writer ではないので受け付けず、retro で終わるプロジェクトでは永久に持ち越される）。未設定 = 次の門で必ず ask される従来挙動（`skills/_shared/preflight-gate.md` § append 経路 の 2 択のうち (b)）。
Step 1 の影響範囲洗い出しは **スコープ確定後** に行う（曖昧なまま全 variant を機械置換しない）。

---

## 必須4ステップ

### Step 1 — 影響範囲（全variant）の洗い出し

修正対象が**どのファイルに何箇所出現するか**を、修正に入る前に必ず列挙する。

**洗い出しコマンド例**:

| ゲート | 洗い出し対象 | コマンド例 |
|---|---|---|
| 07 | requirements/01〜08-*.md (修正対象本文) ＋ pipeline-state.json の approvals.step07_approved_at | `grep -n "{key}" artifacts/{app_name}/requirements/`、approvals は pipeline-state.json を Read |
| 10 | design-samples の3案 × N platform | `ls artifacts/{app_name}/design-samples/*/index.html` |
| 13 | tokens.json / style-guide.md / style-guide-view.html / screens/{web,web-sm,mobile}/*.html | `grep -rn "{old_value}" artifacts/{app_name}/` |
| 16 | screens/00-screen-list.md / 00-transition-map.mmd (SSoT) + 00-transition-map.html (派生) | `grep -n "{key}" artifacts/{app_name}/screens/00-*` |
| 21 | screens/{web,web-sm,mobile}/*.html（Web / Web(SM) / Mobile × default / empty / loading / error / dialog 等） | `grep -rln "{old_value\|class名\|hex}" artifacts/{app_name}/screens/` |
| 23 | screens/{web,web-sm,mobile}/*.html ＋ Figma 上の対応フレーム | grep（21と同等）＋ figma-state.json で関連 nodeId 列挙 |

**出力フォーマット**（ユーザーへ修正開始前に提示）:

```
【影響範囲確認】修正対象: {何を変えるか}
- 該当ファイル: N 件
  - artifacts/{app_name}/screens/web/home.html (3 箇所)
  - artifacts/{app_name}/screens/web/home--empty.html (3 箇所)
  - artifacts/{app_name}/screens/mobile/home.html (3 箇所)
  - ...
- 同一スクリプトで一括修正します。
```

**スコープ漏れ判定の鉄則**:
- 同じコンポーネント名／同じ class／同じ hex／同じ文言を持つファイルは**全件**対象。
- 「Web版だけ」「default状態だけ」のような部分修正はユーザーが明示指定したときのみ許可。指定がなければ全variantへ反映する。
- **色 hex を置換する場合**（gate 13 の `style-guide.md` 等）: 隣接する色チップ絵文字（🟦 等）は hex から導出しているため、hex を書き換えたら `skills/_shared/color-chip-mapping.md` に従い**チップも再導出**する（色相が変わる修正で古いチップが残るのを防ぐ）。

---

### Step 2 — 1ファイル修正 → 残りへコピー方式（CSS/HTML セット）

0. **修正前バックアップ（必須）**: 一括置換で上書きする前に、変更が入る各対象ファイルの現行内容を `artifacts/{app_name}/_backup/{元の相対パス}/{stem}.{時刻}.{ext}` へ退避する。配置・命名の正本は `pipeline.yaml` § `artifact_backup`（app ルート直下の `_backup/` に元構造をミラー）。
   - **なぜ本プロトコルが自分でバックアップするか**: Write/Edit ツール経由の修正は PreToolUse hook（`.claude/hooks/backup-on-edit.sh`）が自動退避するが、本プロトコルは**スクリプトによる一括置換**のため hook が発火しない。よって置換スクリプト自身が退避を担う（下の推奨パターンに統合済み）。
1. 代表となる1ファイルを修正し、見た目／構造が意図通りに変わることを確認する。
2. 同じ差分を残りの対象ファイルへ**同一スクリプト内で一括展開**する。
3. **CSS と HTML を別ステップで修正することを禁止**。同じ修正単位で両方を更新するスクリプトを書く。片方だけ変わる中間状態を作らない。

**禁止アンチパターン**:
- `Edit` を1ファイルずつ手作業で繰り返す（漏れの温床）
- `str.replace()` の戻り値を捨てる（一致しないと黙って無視される）
- HTML だけ先に直して CSS は次のターンで…という分割
- **修正前バックアップ（上記 0）を省く**（hook が発火しない経路なので、省くと修正前バージョンが永久に失われる）

**推奨パターン**:
```python
# 1スクリプトで (a) 修正前バックアップ → (b) CSS と HTML を同時に置換 → (c) 各ファイルの置換件数を記録
import pathlib, datetime, shutil
app = pathlib.Path("artifacts/{app_name}")
ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
targets = list((app / "screens").glob("*.html"))  # 対象は Step 1 で確定した実リストに置き換える
report = []
for f in targets:
    src = f.read_text(encoding="utf-8")         # 成果物は UTF-8 前提（locale 非依存）
    new = src.replace(OLD, NEW)
    n = src.count(OLD)
    if n == 0 or new == src:
        report.append((f.name, 0)); continue   # 変更が入らない / no-op (OLD==NEW 等) は退避も置換もしない
    # (a) 修正前バックアップ（pipeline.yaml § artifact_backup と同じミラー配置・命名）
    rel = f.relative_to(app)                    # 例: screens/web/home.html
    dest = app / "_backup" / rel.parent / f"{f.stem}.{ts}{f.suffix}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(f, dest)
    # (b) 置換
    f.write_text(new, encoding="utf-8")
    report.append((f.name, n))
print(report)  # 0 件のファイルがあれば要調査
```

---

### Step 3 — 置換後の grep / diff 検証（必須）

修正後、**実際に変わったか**を必ず検証する。検証なしで完了報告してはならない。

**最低2点を確認**:

1. **新値が全対象ファイルにヒットする**
   ```
   grep -rn "{NEW_value}" artifacts/{app_name}/screens/web artifacts/{app_name}/screens/web-sm artifacts/{app_name}/screens/mobile
   ```
   → 期待した N 件すべてにヒットすること。0 件のファイルがあれば置換失敗。

2. **旧値が0件である**
   ```
   grep -rn "{OLD_value}" artifacts/{app_name}/screens/web artifacts/{app_name}/screens/web-sm artifacts/{app_name}/screens/mobile
   ```
   → ヒット 0 件であること。残っていれば改行・空白・大小文字違いで `replace` がスキップしている。

   **例外** — 旧値が残ることに正当な理由がある場合（例: primary 色 `#0066CC → #0052AA` 変更時、別 variant の secondary ボタンが偶然同じ `#0066CC` を使用しているが意図的に据え置く等）は、**勝手に判断せず**残箇所を `grep -n` の出力ごとユーザーへ提示し、置換対象外として確定させてから完了報告へ進む。

**追加検証（任意）**:
- `git diff --stat artifacts/{app_name}/` で変更ファイル数を確認
- ブラウザで対象 variant を開き目視確認（21 / 23 ゲート時は推奨）

---

### Step 4 — 検証結果のユーザー報告

ユーザーへ次の3点を提示してから再ゲート（承認確認）に戻す：

```
【修正完了レポート】
- 修正内容: {何を変えたか}
- 対象ファイル: N 件 / 実際に変更が入ったファイル: M 件
  - 一致しない場合は失敗ファイル名を列挙
- 検証:
  - 新値ヒット: M ファイル × K 箇所
  - 旧値ヒット: 0 件
- CSS / HTML: 同一スクリプトでセット更新済み

再度 {対象 variant} をご確認ください。
```

M ≠ N の場合は**完了報告ではなく追加調査**へ進むこと。

---

## チェックリスト（ゲート側からの参照用）

修正フィードバック対応時、agent は以下4項目すべてに ✅ が付くまで「修正完了」と報告してはならない。

- [ ] **Step 1**: 影響範囲（全variant）を grep / ls で列挙し、ユーザーへ提示した
- [ ] **Step 2**: 変更が入る各ファイルを置換前に `_backup/`（ミラー配置）へ退避し、1スクリプトで全対象ファイルへ一括反映（CSS / HTML セット修正）
- [ ] **Step 3**: 新値が全対象ファイルにヒット、旧値が 0 件であることを grep で確認（旧値が残る正当理由がある場合はユーザーへ提示し合意を取る）
- [ ] **Step 4**: 修正対象数 / 実変更数 / 検証結果をユーザーへ報告

---

## 参照元

- 07 `skills/07-human-gate-req/SKILL.md`
- 10 `skills/10-sample-human-review/SKILL.md`
- 13 `skills/13-human-gate-design/SKILL.md`
- 16 `skills/16-design-doc-human-review/SKILL.md`
- 21 `skills/21-screen-human-review/SKILL.md`
- 23 `skills/23-human-final-approval/SKILL.md`

## 経緯

- step21 で1箇所だけ直して終わらせ、ユーザーが他variantを再指摘 → 上流（スコープ定義の欠如）と下流（黙って失敗する置換 + 検証なし）が重なって発覚した。
