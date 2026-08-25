# Skill 作成規約（Skill Authoring Convention）

> 本ドキュメントは AYATORI パイプラインで `SKILL.md` を書く / 直すときの **唯一の作成基準（SoT）** である。
> AI（Claude）が新規 Skill を生成する際もこの MD を参照する。

---

## 0. なぜこの規約が必要か

Claude の Agent Skills には公式フォーマットがある（frontmatter に `name` / `description` を持つ `SKILL.md`）。
AYATORI の `skills/NN-name/SKILL.md`（Step スキル 57 個）は歴史的に **書き手ごとに構造・言語・大文字小文字がバラバラ**で、frontmatter 無しのものが多かった。

本規約は次を固定する:

1. **公式フォーマット準拠** — frontmatter（`name` / `description`）を必須化する（§2）。
2. **大文字小文字の統一** — ファイル名・ディレクトリ名・`name` の casing を 1 か所に確定する（§4）。
3. **メタ情報のノイズ除去** — 意味のない日付や bare な Jira 番号を本文に埋めない（§5）。
4. **本文構成の一貫性** — セクション順・見出し・言語を統一する（§6・§7）。

**公式リファレンス**: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — 公式ドキュメントと矛盾した場合は公式を優先し、本規約を更新すること。

---

## 1. スコープ — 3-Layer Skill アーキテクチャ

AYATORI の Skill は 3 層あり、**層ごとに `name` 規約が異なる**。混同しないこと。

| 層 | 実体 | Claude Code に登録されるか | `name` の付け方 |
|---|---|---|---|
| **L1: 登録 Skill** | `.claude/skills/ayatori-*/SKILL.md`（`phases/*/SKILL.md` への symlink） | ✅ される（`/ayatori-*` として起動可能） | `ayatori-<phase>`（例: `ayatori-question`） |
| **L2: Phase オーケストレーター** | `phases/*/SKILL.md` | L1 の symlink 実体としてされる | `ayatori-<phase>`（L1 と同一 frontmatter を共有） |
| **L3: Step スキル / 共通ヘルパー** | `skills/NN-name/SKILL.md`（phase 専用 step 群は `skills/<phase>/NN-name/SKILL.md` のグループディレクトリ 1 段を許容。例: `skills/reverse/01-ground-truth/`） | ❌ されない（Phase が Read して実行する内部プラグイン） | `<NN-name>`（= **leaf ディレクトリ名**そのまま。例: `12-design-system` / `01-ground-truth`。グループ名は含めない） |

- **L1 = L2**: `.claude/skills/ayatori-question/SKILL.md` は `phases/question/SKILL.md` への symlink。frontmatter は phases 側の 1 枚だけ。
- **L3 は登録されない**が、公式フォーマットに揃えることで「Skill とは何か」を Claude / 人間の双方が同じ形で読める。本規約の主対象は **L3**（適合対象も L3）。

> 参照: `README.md`「動作構成（3-Layer アーキテクチャ）」、`CLAUDE.md`「Pipeline Execution」。

---

## 2. frontmatter 規約（必須）

すべての `SKILL.md` は **1 行目から** YAML frontmatter で始める。

```markdown
---
name: <規約に従った名前>
description: <何をするか + いつ呼ばれるか>
---

# <タイトル>
...
```

### 2.1 `name`（必須）

- 文字種: **小文字英数字とハイフンのみ**（`a-z`, `0-9`, `-`）。最大 64 文字。**大文字は不可**。
- **ディレクトリ名と一致させる**（公式ルール）。
  - L3 Step スキル: `name` = ディレクトリ名。例: `skills/12-design-system/` → `name: 12-design-system`。
  - グループディレクトリ配下の L3: `name` = **leaf ディレクトリ名**（グループ名は含めない）。例:
    `skills/reverse/01-ground-truth/` → `name: 01-ground-truth`。
  - L1/L2 Phase: `name` = `ayatori-<phase>`。例: `phases/question/` → `name: ayatori-question`。
- 数字プレフィックス（`00` / `25a` / `29b` 等）はディレクトリ名の一部なのでそのまま含める。
- **例外: standalone コマンド系の L3（`phase_order` 非搭載の `/ayatori-train` / `/ayatori-cm-consult` 等）**。これらの
  ステップスキルは**パイプライン実行順の数字を持たない**ため、`NN-` プレフィックスの代わりに次を使ってよい（いずれも
  **`name` = ディレクトリ名は不変**＝ linter 準拠）:
  - コマンド名を表す kebab そのまま: `skills/cm-consult/` → `name: cm-consult`。
  - コマンド名プレフィックス + 連番（そのコマンド内の順序）: `skills/train-00-scenario-select/` 〜 `skills/train-07-retro/` →
    `name: train-00-scenario-select` 等。連番はパイプライン全体の実行順ではなくコマンド内順序を表す。
  - 番号を持たない共通ヘルパーは機能名でよい: `skills/train-handbook/` → `name: train-handbook`。
  - 注: `/ayatori-export`(`35-md-to-html-export`) / `/ayatori-index`(`36-artifact-index`) のように、番号空間に組み込まれた
    standalone は従来どおり `NN-` を持つ。番号を持つか否かは「パイプラインの連番に載っているか」で決まる。

### 2.2 `description`（必須）

- **何をするか（what）** を 1 文目に。可能なら **いつ呼ばれるか（when / どの Phase・Step から）** を続ける。
- 言語は **日本語**。三人称・断定形（「〜する」）。命令形や一人称にしない。
- 長さの目安: 1〜3 文（公式上限 1024 文字）。
- **書式は 1 行形式に統一**する。block scalar（`|` / `>`）は使わない。1024 文字上限内なら複数文でも 1 行で書く。quote 規則は層で異なる:

  | 層 | 書式 | 理由 |
  |---|---|---|
  | L1/L2（`phases/*/SKILL.md`） | `description: "..."` — **常にダブルクォート** | description が `Phase 3: ...` のようにコロン + スペースを含むことが多く、plain では YAML として不正になるため。層内統一で常に quote |
  | L3（`skills/NN-name/SKILL.md`） | `description: ...` — **plain（クォート無し）を既定** | 値に `: `（コロン + スペース）や ` #` など plain scalar として不正になる文字列を含む場合**のみ**ダブルクォートで囲む |

- **禁止**: プレースホルダ（`TODO` / 空文字）、実装の羅列だけで「何をするか」が読めないもの。

L1/L2（登録 Skill）の `description` は **起動判定に使われる**ため、「Use when 〜」に相当する起動条件を必ず含める。L3 は Phase から明示 Read されるため「役割」を優先してよい。

### 2.3 任意 frontmatter キー

公式サポートキー（`allowed-tools` / `license` / `metadata` 等）は必要時のみ。AYATORI では原則使わない（subagent の tool 制限は `.claude/agents/*.md` と `.claude/settings.json` で管理。`CLAUDE.md`「Operating Principle 2」参照）。

---

## 3. ファイル / ディレクトリ命名

- ファイル名は **`SKILL.md`** に統一。`skill.md`（小文字）は使わない。
- ディレクトリ名は **`NN-kebab-case`**（`NN` = 実行順の数字。枝番は `25a` / `29b`）。
  - **例外: standalone コマンド系（`phase_order` 非搭載の `/ayatori-train` / `/ayatori-cm-consult` 等）** はパイプラインの
    連番に載らないため `NN-` を持たなくてよい。`cm-consult`（bare kebab）/ `train-00-scenario-select`〜`train-07-retro`
    （コマンド名プレフィックス + コマンド内連番）/ `train-handbook`（番号なしヘルパー）の形を許容する。詳細と例は §2.1 の
    「例外」を参照。番号空間に組み込んだ standalone（`35-md-to-html-export` / `36-artifact-index`）は従来どおり `NN-` を持つ。
- 1 ディレクトリ = 1 `SKILL.md`。補助ファイル（テンプレート・スクリプト・参照資料）は同ディレクトリに置き、`SKILL.md` から相対パスで参照する（progressive disclosure）。
- **phase 専用 step 群のグループディレクトリ（1 段のみ）**: 特定 phase でしか使わない step スキル群は
  `skills/<phase>/NN-name/SKILL.md` の形でグループ化してよい（例: `skills/reverse/01-ground-truth/`）。
  グループディレクトリ自体は `SKILL.md` を持たない（skill ではなく名前空間）。`NN` はグループ内の実行順。
  ネストは 1 段まで（`scripts/lint-skills.mjs` の `SKILL_PATH_RE` と同期）。複数 phase から共有される
  step スキル（例: `06-confluence-save-req`）はグループに入れず従来どおり `skills/NN-name/` に置く。

---

## 4. 大文字小文字（casing）の統一

現状コードベースは casing がバラバラなので、**skill に関わる casing は以下で確定**する。層ごとに規則が反転する点に注意。

| 対象 | 規則 | 例（正） | 例（誤） |
|---|---|---|---|
| ファイル名 | ステム大文字 + 拡張子小文字 | `SKILL.md` | `skill.md`, `Skill.MD` |
| ディレクトリ名 | 全部小文字の kebab-case | `25a-state-pattern-plan` | `25A-StatePattern` |
| frontmatter `name` | 全部小文字（`a-z0-9-`） | `12-design-system` | `12-Design-System` |
| 本文 H1 タイトル | `NN: 要約` 形式（自然文の casing） | `# 12: E2E デザインシステム` | `# 12 DESIGN SYSTEM` |
| 定着した略語 | 慣用の大文字を維持 | `WCAG` / `ISO` / `HTML` / `JSON` / `MCP` / `OKLCH` | `wcag` / `Html` |
| 環境変数 | 慣用の大文字スネーク | `FIGMA_MCP_ENABLED` | `figma_mcp_enabled` |

- **見出しや本文を装飾目的で ALL-CAPS にしない**（強調は太字で。略語は上記の例外のみ）。
- artifact の JSON キー（`snake_case`）や pipeline.yaml のキーは各 schema が SoT。本規約の対象外だが、既存 schema の casing を勝手に変えないこと。

---

## 5. メタ情報の書き方（日付 / Jira チケット）

書き手ごとに「作成日」「担当チケット番号」を本文やコメントに埋める慣習があったが、**多くは無意味なノイズ**になっている。以下で統一する。

### 5.1 日付を装飾として書かない

- 「作成日」「更新日」を frontmatter / 本文見出し / コメントに埋め込まない。**変更履歴は git が持つ**（`git log` / blame が正）。
- **例外**: 「その時点のスナップショットである」ことに実質的な意味がある場合のみ可。
  - 例: 「現状（2026-07-02 時点）: L3 の適合は 3 / 57 件」— この日付は "いつ時点の集計か" を示すので意味がある。
- 迷ったら **書かない**。
- lint（§9.2 Rule 6）が本文中の日付を**警告**する（PR はブロックしない。スナップショット等の正当な日付は警告を無視してよい）。

### 5.2 Jira チケット番号を書かない

- チケット番号（bare / リンク形式を問わず）を `SKILL.md`・補助 md（`refs/` 等）・docs・スクリプトコメント・schema 記述・subagent 定義（`.claude/agents/*.md`）・`pipeline.yaml` に書かない。**変更の追跡はブランチ名・コミットメッセージ・PR が担う**（`git log` / blame から Jira に辿れる）。
- 番号の代わりに、**そのルール・変更の理由を内容そのもので 1 文説明する**（例: 「監査を subagent に分離する — 生成と監査が同一 session だと self-bias が漏れるため」）。番号だけの注記は説明の代わりにならない。
- 例外: ブランチ名・コミットメッセージ・PR タイトル / 本文にはチケット番号を含めてよい（そこがトレーサビリティの置き場所）。
- lint（§9.2 Rule 6）が本文中の番号を**警告**する（PR はブロックしない）。警告を見たら「番号を消して理由の 1 文に置き換えられないか」をまず検討する。

---

## 6. 本文（body）構造規約

frontmatter の直後に **`# タイトル`**（H1 を 1 つだけ）。`NN: 要約` 形式を推奨（例: `# 35: MD → HTML 配布物生成`）。

その下は以下の **推奨セクション順**に従う。すべて必須ではないが、**順序と見出し名を揃える**こと（現状 `役割`/`Role`、`目的`/`Purpose` が混在しているため統一する）。日本語見出しを既定とする。

| 順 | 見出し | 内容 | 必須度 |
|---|---|---|---|
| 1 | `## 役割` または `## 目的` | このステップが担う責務を 1〜3 文で | 必須 |
| 2 | `## 前提条件` | 実行前に満たすべき state / 入力（違反時は中断） | 推奨 |
| 3 | `## 入力` | 読み込む artifact / パラメータ（`artifacts/{app_name}/...`） | 推奨 |
| 4 | `## 実行指示` | 手順本体。Phase / Sub-step に分割してよい | 必須 |
| 5 | `## 出力` | 書き出す artifact と schema（`schemas/*.json`）参照 | 推奨 |
| 6 | `## 完了後` | 後続ステップへの受け渡し / state 更新 | 任意 |
| 7 | `## 参照` | 関連 skill / doc / pipeline.yaml セクションへのリンク | 任意 |

- **単一所有権**: 各 skill は自分が SoT のファイルだけを書く（`docs/artifact-file-responsibility.md`）。`## 出力` に「どのファイルの writer か」を明記する。
- **Operating Principles との整合**: 外部 CLI 非依存（P1）/ subagent 権限は事前宣言（P2）/ 一次ソース優先（P3）/ 未確定は補完せず質問（P4）/ 外部コマンド検知（P5）に反する手順を書かない。

---

## 7. 言語ルール

- `SKILL.md` 本文は **日本語を既定**とする（既存の英語 skill も段階的に寄せる。当面は英語のままでも可）。
- ユーザー向け出力（`AskUserQuestion` ラベル・推奨文・チャット応答）は **`pipeline.yaml → output_language`（現状 `ja`）** に従う。skill 本文が英語でも、実行時のユーザー向け文言は必ず `output_language` でレンダリングする。

---

## 8. skill-creator の活用（新規作成時）

新しい Skill を作るときは、まず Claude Code 付属の **`skill-creator`** スキル（`/skill-creator`）で雛形を生成することを **既定の出発点**とする。手書きで `SKILL.md` を新規作成しない（frontmatter 付け忘れ・構造ばらつきの再発防止）。

- **入手先**: Claude Code の公式プラグイン（`claude-plugins-official`）として同梱。`/skill-creator` で起動できる。
- `skill-creator` は frontmatter（`name` / `description`）付きの `SKILL.md` を生成するため、§2 の必須 frontmatter の付け忘れを防げる。
- 生成後は本規約に合わせて調整する: `name` を §2.1（L3 なら `NN-name`、L1/L2 なら `ayatori-<phase>`）に直し、本文セクションを §6 の順・見出し名に整え、§5（日付/チケットリンク）・§7（言語）に従う。
- 調整後は `npm run lint:skills`（§9.2）で §2〜§4 の適合を必ず確認してからコミットする。

---

## 9. 適合チェックリスト & 自動チェック

### 9.1 チェックリスト（1 ファイルずつ）

- [ ] 1 行目が `---` で始まり frontmatter が閉じている
- [ ] `name` あり。小文字英数 + ハイフン。**ディレクトリ名と一致**（L3）/ `ayatori-<phase>`（L1/L2）
- [ ] `description` あり。1 文目で「何をするか」が読める。日本語・三人称。プレースホルダでない
- [ ] `description` が 1 行形式（block scalar 不可）。quote 規則が §2.2 の層別ルールどおり
- [ ] ファイル名 `SKILL.md`。ディレクトリ名 `NN-kebab-case`（§4）
- [ ] H1 が 1 つ・`NN: 要約` 形式。本文セクションが §6 の順・見出し名
- [ ] 無意味な日付を埋めていない（§5.1）。チケット番号を書いていない（§5.2）
- [ ] `## 出力` に SoT ファイルと schema 参照（該当時）
- [ ] Operating Principles（P1〜P5）に反しない

### 9.2 自動チェック（PR 時に違反を検出）

§2〜§4 は **`scripts/lint-skills.mjs`** で機械検証する（決定論・LLM 不要、違反 = PR レッド）。§5（日付 / Jira 番号の埋め込み）は Rule 6 として**警告のみ**で検出する（PR はブロックしない — §5.1 / §5.2 に正当な例外があるため機械では白黒つけられない）。Rule 6 は `SKILL.md` に加えて **`phases/` / `skills/` 配下の補助 md（`refs/` 等）・`.claude/agents/*.md`（subagent 定義 — SKILL.md と同じ手順書性質）・`pipeline.yaml`（コメント / rule 文字列に履歴マーカーが堆積しやすい）にも適用**する（これらは Rule 6 のみ）。コードフェンス / インラインコード内は対象外。なお `docs/` / `CLAUDE.md` / `scripts/` は対象外 — 設計一次資料・ルーター文書としてリンク付き参照（§5.2 の例外）を多用するため、警告ノイズの氾濫を避ける。

- **PR 時**: `.github/workflows/lint-skills.yml` が発火し、**その PR で追加 / 変更された対象ファイルだけ**を検査する。触ったファイルが違反なら PR がレッドになる。既存の未適合ファイルで無関係な PR が落ちないよう差分内のファイルのみ対象。
- **手動監査**: `npm run lint:skills`（= 全対象ファイル一括: `SKILL.md` + 補助 md + `.claude/agents/*.md` + `pipeline.yaml`）。適合進捗の確認に使う。
- **Rule 6 警告の baseline (ratchet)**: 既知の埋め込み（Rule 6 導入時点の残存分）は `scripts/lint-skills.baseline.json` に記録して表示を抑制し、**新規 / 超過分だけ**を行番号付きで表示する（`lint-repo-refs` と同方式 — 変更頻度の高い `pipeline.yaml` 等で既知分が毎回ボットコメントに再掲されるのを防ぐ）。既知分を掃除したら `node scripts/lint-skills.mjs --write-baseline scripts/lint-skills.baseline.json` で縮める。
- 判定は **git が記録したパス**（casing 保持）で行う。macOS の case-insensitive FS では手元 glob が誤検出するため、CI / 監査とも git のファイル名を正とする。

> §5（日付 / チケット番号の埋め込み）は Rule 6 として警告実装済み（non-blocking）。

### 9.3 現状（2026-07-09 時点）

- L1/L2（`phases/*/SKILL.md`）: **全件適合済み**（`name` = `ayatori-*` + `description` 有り）。
- L3（`skills/NN-name/SKILL.md`, 57 件）: **全件適合済み**（frontmatter 付与 + `12-design-system` の `name` を §2.1 準拠に修正）。
- `description` 書式（§2.2 の 1 行形式 + 層別 quote 規則）: **全件統一済み**（block scalar 5 件を 1 行化 + YAML plain として不正だった 1 件をダブルクォート化。lint Rule 5 で機械検証）。
- §5（メタ情報の埋め込み）: Rule 6 追加時点で既存の埋め込みが大半のファイルに残存するため**警告のみ**とし、触った PR で順次「番号 / 日付を消して理由の 1 文に置き換える」掃除を進める。
- 本文（H1 / 構成 / 言語、§6〜§7）の整形は「段階的に寄せる」方針（§7）で当面据え置き（frontmatter のみ一括先行）。

---

## 10. 関連ドキュメント

- 公式: [Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- `README.md` — 動作構成（3-Layer アーキテクチャ）/ スキルの配置場所
- `CLAUDE.md` — Operating Principles / Pipeline Execution
- `docs/artifact-file-responsibility.md` — artifact 責務マップ / 設計原則
- `docs/html-generation-rules.md` / `docs/principle4-disambiguation.md` — 同種の作成規約ドキュメント
