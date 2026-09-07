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
   の `backupFile`、21e の raw PNG 再生成上書きと 21f の正典 PNG 再正典化上書き — 実装は
   `skills/21e-graphic-generate/scripts/preflight.mjs` / `skills/21f-graphic-postprocess/scripts/preflight.mjs`
   の `backupFile`)。**Bash 起動なので hook は発火しない**。
   → **script 側の self-backup を義務**とする。規約は経路 1 と同一: ミラー配置
   (`_backup/{相対dir}/{stem}.{YYYYMMDD_HHMMSS}.{ext}`) / 直前バックアップと md5 同一ならスキップ /
   複製失敗でも本処理を block しない fail-open / 新規生成 (ファイル不在) は対象外。
   → **上書きだけでなく削除も同義務** — targets の成果物を script が `rm` する経路 (21e/21f
   `commit-degrade.mjs` の正典残骸掃除・retry `--canonical` の正典削除、21f の旧仕様 webp 残骸掃除)
   も削除前に同じ退避を行う。削除は上書きより復元可能性が低く、特に手動差し替えされた正典は
   削除前退避が唯一の保全点になる (レビューで検出)。
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
> 21e / 21f の `backupFile`（生成グラフィック PNG）はこの基準どおり **cooldown を持たない** — 各実行は
> 同一ファイルを 1 度しか書かず、cooldown があると 180 秒以内のリトライ再生成で**課金済みの旧世代を
> 黙って取り逃す**（過去に起きた事故の再発）。md5 dedup は持つ（内容が同一なら退避しない）。
> **hook 側もバイナリ画像 (png/webp) には cooldown を適用しない** — Edit ツールはバイナリを分割編集
> できず「1 指示複数 Edit」の前提が成立しない上、script 退避と `_backup/` プールを共有するため、
> 適用すると script 退避直後の 180 秒間だけ Write 誤操作の安全網に穴が開く（同チケットレビューで検出）。

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
| Step 21e / 21f (21g ゲートで確認) | 生成グラフィック (raw 中間物 / 正典) | `graphics/raw/*.png` / `screens/_shared/graphics/*.{png,webp}` (webp は旧仕様 run の legacy 正典のみ — 現行 writer は無く、掃除・削除経路が退避してから消す) |
| Step 23 | Figma 出力関連 | `figma-state.json` |
| Step 26 | 振り返りレポート | `pipeline-improvements.md` |

**対象外** (許可リスト方式のため上記 glob に一致しないものは自動的に除外される):
中間ファイル・ループ用 history (`scores.json` / `*-history.json` / `screens/00-coverage-check.json`)、
machine state / INPUT (`pipeline-state.json` / `requirements.json` / `design-brief.yaml` /
`pending-questions.json` / `requirement-deviations.json` / `generation-provenance.json` /
`graphics/raw/generation-manifest.json` / `graphics/postprocess-manifest.json`)、
共通部品 (`screens/_shared/*` — **ただし `graphics/*.{png,webp}` は除く**: CSS 土台・components 等は
`tokens.json` から決定的に再生成できる派生物なので対象外のまま、生成グラフィックは課金済みで
再生成不能のため対象)、`feedback-log.md` / `session-handoff.md`。

> **生成グラフィック PNG の退避は経路 3 (script self-backup)**: 正規 writer の 21e / 21f は Bash 起動
> script のため hook は発火しない。hook 側の許可 glob にも載せているのは pipeline.yaml `targets` との
> 同期維持 + 万一 `Write` ツールで PNG パスを潰す誤操作が起きた場合の安全網。

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
  ただし **バイナリ画像 (png/webp) には cooldown を適用しない** (上記の
  cooldown 適用基準の項を参照)。

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

### HTML と画像の対応づけ — 「ある時点の見た目」を再現する

画面 HTML は正典グラフィックを `<img src>` の相対パスで参照するため、HTML バックアップを復元しても
参照先の画像が当時のものでなければ見た目は再現できない。専用の snapshot 機構は持たず、両者の
バックアップが**同じタイムスタンプ命名・同じミラー配置**であることを使って手順で対応づける:

- バックアップは「上書きの**直前**」に取られる。つまり `{stem}.{時刻}.{ext}` は
  **その時刻まで生きていた内容** を保持している。
- 時点 T のファイル内容 = 「`時刻 > T` のバックアップのうち**最古**のもの。無ければ現行ファイル」。
- **HTML 側は画像側より粗いことがある**: HTML の退避 (経路 1 hook / 21g) は cooldown を持つため、
  180 秒以内に複数回書き換えられた場合の中間世代は退避されていない。画像 (png/webp) は hook /
  script とも cooldown なしで、この規則が正確に成り立つ。

```bash
# 例: 2026-08-18 12:00 時点の 01-home (web) の見た目を再現する
#   1) HTML:  _backup/screens/web/01-home.*.html のうち 20260818_1200 より後で最古のもの
#      (無ければ現行 screens/web/01-home.html) を screens/web/01-home.html へ
#   2) 画像:  参照している graphic_id ごとに _backup/screens/_shared/graphics/{id}.*.png を
#      同じ規則で選び screens/_shared/graphics/{id}.png へ
```

raw (`graphics/raw/`) と正典 (`screens/_shared/graphics/`) は両方退避される — 正典は raw の
バイト無加工コピーだが、正典が手動差し替えされていた場合は raw 側の退避だけでは戻せず、
HTML 復元時の対応づけにも raw→正典の読み替えが要るため、正典側も独立に退避する。

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
(CLAUDE.md Operating Principle 1 準拠)。`jq` の導入有無・案内は **README「前提条件」の optional 宣言が SoT** (本書は依存の説明のみで導入可否を定めない)。
