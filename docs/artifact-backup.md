# 成果物バックアップ (修正前自動退避)

人間ゲートで確認する成果物を上書き・編集する直前に、現行 (= 修正前) の中身を
app ルート直下の `_backup/` フォルダ (元の相対構造をミラー) へ時刻付きで自動複製する仕組み。
誤った修正をしても直前のバージョンに戻せるようにするのが目的。

正本 (SoT):
- ポリシー宣言: `pipeline.yaml` § `artifact_backup`
- 実装 (enforcement): `.claude/hooks/backup-on-edit.sh` (PreToolUse `Write|Edit` hook)
- hook 登録: `.claude/settings.json` § `hooks.PreToolUse`

---

## 仕組み

Claude Code の PreToolUse hook は、`Write` / `Edit` ツールが**実行される直前**に走る。
その瞬間、ディスク上のファイルはまだ**修正前の中身**を保持している。hook はそれを
`_backup/` に複製してから、本来の上書きを続行させる。

```
Claude が requirements/05-features.md を上書きしようとする (Write)
        │
        ▼  PreToolUse hook (backup-on-edit.sh) が割り込む
        │
        ├─ file_path が対象成果物 glob に一致?  ── No → 何もせず素通り
        ├─ ファイルが既に存在?  ── No (新規生成) → 何もせず素通り
        ├─ 直前バックアップと md5 が同一?  ── Yes → 複製しない (増殖防止)
        │
        └─ cp 現行内容 → _backup/requirements/05-features.20260528_150000.md
        │
        ▼  Write が進行し原本を上書き  ← 直前バージョンは _backup/ に残る
```

特徴:
- **自動・決定論的**: Claude が「バックアップしよう」と覚える必要がない。取りこぼさない。
- **負担ゼロ**: 毎回取るが、複製は `cp` 1 回のみ。
- **delta / req-delta でも同一に動作**: 既存成果物を修正する経路 (Phase 1c / 5) にも追加実装なしで効く。
- **fail-open**: 複製に失敗しても `Write` / `Edit` をブロックしない (成果物保存を最優先)。

---

## トリガー経路（ツール経由 / スクリプト経由）

成果物を修正する経路は 3 つあり、どれでもバックアップが取られる:

1. **Write / Edit ツール経由** — 要件生成 (Step 02) / 画面生成 (Step 17) / req-delta 適用 (Step 33) /
   サンプル・サブ状態 HTML 生成 (Step 09 / 25b、subagent 含む) / 各種ループ再生成 (Step 05→02, 20→17 等)。
   → PreToolUse hook が**自動**で退避する。main セッション・subagent のどちらの Write でも発火する。

2. **スクリプト経由の一括修正** — 人間ゲート (07 / 10 / 13 / 16 / 21 / 23) のフィードバック反映
   (`skills/00-feedback-protocol`)。Python 等で `f.write_text()` 一括置換するため **hook は発火しない**。
   → このため `00-feedback-protocol` の置換スクリプト自身が、置換前に対象ファイルを同じミラー配置の
   `_backup/` へ退避する（プロトコル Step 2 に統合済み）。

3. **スクリプト経由の生成・patch** — パイプライン同梱スクリプトが対象成果物を上書き / patch する経路
   (`scripts/derive-transition-map.mjs` の `--force` による遷移図 SSoT 再生成、21g の graphic 埋め込み
   `html_transform_policy: deterministic_script` — 実装は `skills/21g-graphic-embed-review/scripts/preflight.mjs`
   の `backupFile`。21f 側に self-backup 実装は無い)。**Bash 起動なので hook は発火しない**。
   → **script 側の self-backup を義務**とする。規約は経路 1 と同一: ミラー配置
   (`_backup/{相対dir}/{stem}.{YYYYMMDD_HHMMSS}.{ext}`) / 直前バックアップと md5 同一ならスキップ /
   複製失敗でも本処理を block しない fail-open / 新規生成 (ファイル不在) は対象外。
   → `derive-transition-map.mjs` の `--force` 経路は **repo 内の正規呼び出しがまだ無い**
   (skills/reverse/06 / skills/14 のファストパス / 14-lite の 3 箇所すべてが「`--force` は渡さない」と明記)。
   実装を先に置いているのは、手動再導出 (人間が `--force` を付けて叩く運用) と将来の delta 配線で
   最初に必要になる箇所であり、後から足すと配線した瞬間に義務の穴が開くため。
   なお同 script の `--out` は **app ルート配下に限定**される (外を指すと引数エラー) — 許可リスト判定を
   迂回して「退避なしで任意パスを上書き」する経路を作らないため。

経路 1 は hook による強制（取りこぼし無し）、経路 2・3 はスクリプト自身による退避（スクリプトを書く際の必須ステップ）。
スクリプトで in-scope 成果物を直接書き換える処理を新設する場合は、同様に書き込み前退避を組み込むこと。
逆に **`artifact_backup.targets` に載っていない成果物** (例: `screens/00-coverage-check.json` を patch する
`scripts/validate-connectivity.mjs --write`) を書く script は対象外 — hook と同じ許可リスト方式に閉じ、
machine state / 中間ファイルを退避対象に広げない。

> **1 回の実行で 1 度だけ書く script は cooldown を持たない**: 経路 1 の cooldown（下記）は「1 回の修正指示が
> 複数 `Edit` に分割される」ことへの対策で、`derive-transition-map.mjs` のように 1 回の実行で対象を 1 度だけ
> 書く script には該当しない（md5 dedup があれば no-op 再実行の増殖は防げる）。逆に **1 つの人間ゲートの中で
> 何度も再実行され得る script**（21g の `backupFile` — 埋め込み → 差し戻し → 再埋め込みで同じ HTML を
> 繰り返し書き換える）は、経路 1 とまったく同じ理由で cooldown を持つ。

---

## 対象成果物

`pipeline.yaml` § `artifact_backup.targets` が正本 (`artifacts/{app_name}/` からの相対パス)。
`skills/_shared/human-gate-preview.md` の人間ゲート確認対象と整合する。

| 人間ゲート | 成果物 | パス |
| --- | --- | --- |
| Step 07 | ISO 29148 ドキュメント 8 点 | `requirements/*.md` |
| Step 10 | サンプル HTML 3 案 | `design-samples/**/*.html` |
| Step 13 | スタイルガイド / デザインシステム | `style-guide.md` / `screens/style-guide-view.html` / `tokens.json` |
| Step 16 | 画面一覧 / 画面遷移図 | `screens/*.md` / `screens/00-transition-map.{mmd,html}` |
| Step 21 | 全画面 HTML + 状態パターン | `screens/{web,web-sm,mobile}/*.html` |
| Step 23 | Figma 出力関連 | `figma-state.json` |
| Step 26 | 振り返りレポート | `pipeline-improvements.md` |

**対象外** (許可リスト方式のため上記 glob に一致しないものは自動的に除外される):
中間ファイル・ループ用 history (`scores.json` / `*-history.json` / `screens/00-coverage-check.json`)、
machine state / INPUT (`pipeline-state.json` / `requirements.json` / `design-brief.yaml` /
`pending-questions.json` / `requirement-deviations.json` / `generation-provenance.json`)、
共通部品 (`screens/_shared/*`)、`feedback-log.md` / `session-handoff.md`。

---

## 命名・配置

- **配置**: app ルート直下の `_backup/` に、元の相対ディレクトリ構造を**ミラー**して格納する。
  格納先 = `artifacts/{app_name}/_backup/{元の相対dir}/{stem}.{時刻}.{ext}`。
  例: `requirements/05-features.md` → `_backup/requirements/05-features.20260528_150000.md`、
  `screens/mobile/01-home.html` → `_backup/screens/mobile/01-home.20260528_150000.html`。
- **命名**: `{元ファイル名 stem}.{YYYYMMDD_HHMMSS}.{拡張子}`。時刻順にソートされ、衝突しない。

> **なぜ deliverable ディレクトリ直下 (`requirements/_backup/` 等) ではなく app ルートに集約するか**:
> パイプラインは `requirements/` や `screens/` を**再帰 grep / find** する処理を多数持つ
> (skill 33 の ID 整合 grep、C-18 / skill 18 の色整合 grep、skill 28/29 の find、skill 00/21/23 の grep 等)。
> deliverable ディレクトリの内側に `_backup/` を置くと、これらがバックアップを誤検出してしまう
> (旧 ID / 旧色が混入し誤った再生成や不整合判定を誘発)。`_backup/` を scan 対象ツリーの外
> (= app ルート直下) へ退避することで、**既存スキャンを一切変更せずに**衝突を回避する。

`artifacts/{app}/_backup/` の中身は元構造をミラーし、複数回修正すると時刻別に積み上がる:

```
artifacts/myapp/
├── requirements/
│   └── 05-features.md                            ← 最新 (deliverable 本体)
└── _backup/
    └── requirements/
        ├── 05-features.20260528_150000.md        ← 1 回目の修正前
        └── 05-features.20260528_161200.md        ← 2 回目の修正前
```

---

## バックアップが作られないケース

- **新規生成時**: 元バージョンが無いので複製しない。
- **内容が直前バックアップと同一**: 意味のない重複なので skip (md5 で判定)。
- **cooldown 中 (同一ファイルの直近バックアップが一定秒数以内)**: skip (下記参照)。

つまり「実際に内容が変わる上書き」かつ「直近の退避から一定時間が経過している」ときだけ積み上がる。

### cooldown — 連続 Edit の増殖防止

1 回の修正指示でも、変更箇所が散らばっていると **同じファイルへ複数回 `Edit` が走る**ことがある。
hook は `Write` / `Edit` ごとに発火するため、素朴には Edit の回数だけバックアップが増えてしまう。

これを防ぐため、**同一ファイルの直近バックアップが一定秒数以内なら退避を skip** する。結果として
「1 回の修正指示 ≒ バックアップ 1 件」となり、その 1 件は **最初の Edit の直前 (= 指示前) の状態**を保持する
(指示全体を取り消すのに最も必要なバージョン)。

- 秒数は環境変数 **`AYATORI_BACKUP_COOLDOWN_SECONDS`** で調整 (既定 **180**、`0` で無効化 = 毎 Edit 退避)。
- **ファイル単位**の判定。別々のファイルを修正した場合はそれぞれ退避される (まとめられない)。
- トレードオフ: cooldown 窓の中の *中間* バージョンは残らない (窓の直前の状態は常に保持されるため、
  「その修正指示を丸ごと戻す」用途には影響しない)。別々の修正指示を窓内 (既定 180 秒) に連続実行した
  場合のみ、後続指示の直前状態が残らない点に注意 (人間ゲートのレビュー間隔は通常それより長い)。
- `date` / `stat` が失敗した場合は skip せず退避する (fail-open: バックアップを取り逃さない)。

---

## 戻し方 / 整理

いずれも**ユーザーが手動**で行う (自動削除・容量上限は設けない)。

- **戻す**: `_backup/` の該当ファイルを元の場所へコピーし直すだけ。

  ```bash
  cp artifacts/myapp/_backup/requirements/05-features.20260528_150000.md \
     artifacts/myapp/requirements/05-features.md
  ```

- **整理 (削除)**: 不要になったバックアップは手動で削除する。

  ```bash
  # 例: 特定成果物の古いバックアップを全削除
  rm artifacts/myapp/_backup/requirements/05-features.*.md
  # 例: プロジェクトのバックアップを丸ごと削除
  rm -rf artifacts/myapp/_backup
  ```

`artifacts/` は `.gitignore` 対象のため `_backup/` も Git には含まれない (ローカル専用)。

---

## 既存の `.bak-{run_id}` 退避との関係

`phases/req-delta` / `phases/add-feature` には、前 run の中間分析ファイル (`doc-impact-analysis.md` /
`cross-reference-integrity-report.md` 等) を `*.bak-{prev_run_id}` へリネーム退避する仕組みが既にある。
これは「**前回 run の成果を次 run と混同しないための run 単位アーカイブ**」であり、本機能の
「**成果物を修正する直前のバージョン退避**」とは目的・対象・タイミング・命名がいずれも異なる
(対象は req-delta 中間ファイル、タイミングは新 run 開始時、命名は `.bak-{run_id}`)。
両者は別関心事のため意図的に統合せず別建てとする。

---

## 依存・移植性

`bash` + OS 標準コマンド (`cat` / `cp` / `mkdir` / `dirname` / `basename` / `date` / `ls` / `grep` / `awk` / `head` / `stat`) のみ。
stdin JSON の parse に `jq`、内容比較に `md5sum` (Linux) / `md5` (macOS)、cooldown の mtime 取得に `stat` (`-f %m` macOS / `-c %Y` Linux) を使う。
いずれかが不在でも hook は `exit 0` で素通りする (fail-open) ため、外部 CLI の導入は不要
(CLAUDE.md Operating Principle 1 準拠)。
