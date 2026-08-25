# AYATORI セットアップガイド

チームメンバーがローカル環境で AYATORI パイプラインを実行するための手順書。

---

## 1. 必要な環境

| ツール | バージョン | 備考 |
|---|---|---|
| Claude Code | 最新 | `claude --version` で確認 |
| Claude モデル | Claude 5 世代推奨（Opus 5 / Fable 5 等） | CLAUDE.md が同世代前提で軽量化済み（参照到達性の recall 検証は Fable 5 / Opus 5。旧世代でも動作する設計だが未検証） |
| Figma アカウント | Full seat 以上 | Write-to-Canvas に必要 |
| Atlassian アカウント | - | kinto-dev.atlassian.net |

---

## 2. 必要な環境変数

以下を `~/.zshrc`（または `~/.bashrc`）に追加する。

```bash
# Figma
export FIGMA_MCP_ENABLED="true"
export FIGMA_FILE_KEY="KDE39lNXS2bThFVplwowyI"   # ACАDプロジェクトのFigmaファイルキー
```

> グラフィック生成 API キー (`AYATORI_IMAGE_API_KEY`) は `~/.zshrc` に書か**ない** —
> `~/.zshrc` は非対話 shell (Claude Code の Bash tool) から見えず、VSCode 起動では再起動まで
> 反映されない (POCTEAMA-408)。「3. 各トークン・キーの取得方法 > グラフィック生成 API キー」の
> キーファイル方式を使うこと。

> Confluence / Jira 用の環境変数（`CONFLUENCE_USER_EMAIL` / `CONFLUENCE_API_TOKEN` / `CONFLUENCE_BASE_URL`）は不要になった。Atlassian 認証は公式リモート MCP の OAuth で行う（「4. MCP の設定」参照）。

追加後に反映する：
```bash
source ~/.zshrc
```

---

## 3. 各トークン・キーの取得方法

### Figma File Key

Figma ファイルの URL から取得：
```
https://figma.com/design/{fileKey}/...
```
URL の `fileKey` 部分をコピーする。ACАDプロジェクトの場合は `KDE39lNXS2bThFVplwowyI`。

### グラフィック生成 API キー

グラフィック生成ブロック (21c テイストサンプル / 21e 本生成) が OpenAI Images API を呼ぶためのキー。

- **取得**: チーム共有のサービスアカウント `ayatori-openai` のキーを使う。取得先はチーム内で
  共有している (シークレットの在り処を指す情報はリポジトリに記載しない — TFS Standard 13.02.03
  シークレットの保存要件に基づく)。不明な場合はチームのチャンネルで確認する。
- **設定 (推奨 — キーファイル)**: リポジトリルートで `node scripts/setup-image-key.mjs` を実行し、
  開いたファイル (`~/.ayatori/image-api-key`) にキーだけを 1 行貼り付けて保存する
  (引用符・`KEY=` 前置・コメント行が混じっても実行時に自動除去する。ただしキーの中に空白や
  制御文字が混じった値は**無効 = 未設定扱い**になる — `--doctor` が検出して直し方を出す)。
  **ターミナルを開く必要はない** — VSCode の Claude Code チャットで「`node scripts/setup-image-key.mjs`
  を実行して」と依頼するか、プロンプトに `!node scripts/setup-image-key.mjs` と入力すれば
  その場で実行できる (キー自体は開いたファイルに自分で貼るため、会話ログにキーは載らない)。
  **設定後の再起動は不要** — 21c / 21e が実行時にファイルを直読する
  ため、起動方法 (VSCode / ターミナル) にも依存しない。ホーム直下なので案件をまたいで共通・
  リポジトリを再クローンしても再設定不要。設定状況の確認は `node scripts/setup-image-key.mjs --doctor`
  (診断が見る env は実行したプロセスのもの — VSCode 内の Claude Code で失敗した場合は、別ターミナル
  ではなく**同じ session 内で**実行する。README「設定確認」の注記参照)。
- **キー解決の優先順**: ① env `AYATORI_IMAGE_API_KEY` → ② キーファイル `~/.ayatori/image-api-key`
  → ③ env `OPENAI_API_KEY`。env 経路 (旧案内の `~/.zshrc` / `.claude/settings.local.json` の `env`
  ブロック / ホームの `~/.claude/settings.json` の `env`) も互換のため引き続き有効だが、
  **新規設定には推奨しない**: `~/.zshrc` は非対話 shell
  (Claude Code の Bash tool) が読まず、VSCode は起動時の env を固定するため再起動まで反映されない
  (POCTEAMA-408 の実障害)。`.claude/settings.local.json` は案件ローカルで再クローンのたびに消える。
  env 経路を使う場合のみ、設定後に Claude Code (VSCode 利用時は VSCode 自体) の再起動が必要。
- **禁止対象の明確化**: 書いてはならないのは **repo 管理下のファイル** — リポジトリ内の
  `.claude/settings.json` / SKILL.md / pipeline.yaml / docs 等 (commit されて全員の clone にキーが
  載る)。ホーム側の `~/.ayatori/image-api-key` は git 管理外・権限 600 (本人のみ読める) であり
  禁止対象では**ない**。「settings.json に書くな」の settings.json は**リポジトリ内**のファイルを
  指す (ホームの `~/.claude/settings.json` はファイル名が同じだけの別物)。
- **ホームの `~/.claude/settings.json` の `env`: 禁止ではないが推奨しない**。commit されないので
  「repo 管理下のファイル」の禁止には当たらないが、キーの置き場としては次の 3 点で劣る:
  ① `env` は Claude Code が派生する**全プロセス**に渡るため、tool 呼び出し中の `env` ダンプや
  verbose ログ経由で transcript に載りうる (キーファイルは 21c / 21e が呼び出しの瞬間に読むだけで、
  どのプロセスの環境にも入らない)。② `/config` や設定編集系の作業でこのファイル自体が読み書き
  されるため、キーが会話ログに現れる契機が多い (ホームの `~/.claude/` を dotfiles repo に入れて
  いる場合はさらに危険)。③ 権限は作成経路次第で、**既定で 600 とは限らない** (実測 644 = 同一
  マシンの他ユーザーから読める)。すでにここに置いている場合は `chmod 600 ~/.claude/settings.json`
  を実施し、キーファイルへ移す際は**この env を消す**こと (env 経路が優先されるため、消さないと
  新しいキーが遮蔽される — `--doctor` が検出する)。
- **多重管理の注意**: キーは原則 1 箇所 (キーファイル) に集約する。env とファイルの両方に置くと、
  キーのローテーション時に env 側が優先されて古いキーが使われ続ける事故が起きる
  (`--doctor` が全設置場所を走査して遮蔽警告を出す)。
- **`settings.json` 系から `env` を消すときは Claude Code を終了してから編集する**。実行中の
  Claude Code は permission entry を記録するたびに `.claude/settings.local.json` (およびホーム側の
  `settings.json`) を**自分の記憶している内容で丸ごと書き戻す**ため、session 中に消した `env` ブロックは
  次の書き戻しで復活する。実測: 削除に成功した直後から `permissions.allow` の件数が増えるたびに
  `env` が戻り、`--doctor` は「代入があります」を出し続ける。**手順**: ① Claude Code (VSCode 利用時は
  その window) を終了 → ② 素のターミナルで当該 `env` を削除 → ③ 再起動して
  `node scripts/setup-image-key.mjs --doctor` で消えたことを確認。この前提を知らないと「消したのに
  まだ古いキーで 401」という、本 ticket と同型の混乱に入る (削除自体は成功しているのに戻される)。
- 任意の上書き: `AYATORI_IMAGE_API_BASE` (エンドポイント差し替え、既定 `https://api.openai.com/v1`) /
  `AYATORI_IMAGE_MODEL` (非透過 slot のモデル) / `AYATORI_IMAGE_MODEL_TRANSPARENT` (透過 slot のモデル)。
  モデル既定値の SoT は `pipeline.yaml` `screens.graphic_generation.tool` / `tool_transparent`。
  モデル系 env は **21e の実行時呼び出し先だけ**を一時的に差し替える (21d が確定する
  `graphic-prompts.json` の `tool` や鮮度判定 digest には影響しない)。恒久的なモデル変更は
  env ではなく pipeline.yaml 側を編集する。
- **テスト専用**: `AYATORI_PIPELINE_YAML` (pipeline.yaml の fixture 差し替え) は
  `AYATORI_REPO_ROOT` (fixture ツリー差し込み) と**併用時のみ有効** — 単独で shell に残っても
  実 run では警告の上で無視される (tool 既定値・鮮度判定 digest を env が無言で差し替えない契約。
  21c/21d/21e/21f の preflight 共通)。`AYATORI_IMAGE_API_KEY_FILE` (キーファイルのパス差し替え)
  も同じくテスト専用で、**同じく `AYATORI_REPO_ROOT` 併用時のみ有効** — 単独残留の env に鍵の
  読み取り先を無言で差し替えさせない (警告の上で既定パスを使う。21c/21e preflight の
  `imageKeyFilePath()` と `scripts/setup-image-key.mjs` 共通)。いずれも実運用で設定する変数ではない。
- 未設定の場合もパイプラインは止まらない — 21c / 21e が degrade 分岐 (設定案内 / 中止 / 保留) を出す。
- **セキュリティ運用の推奨**:
  - キーファイルの権限は 600 (setup-image-key.mjs が自動で矯正する)。`~/.zshrc` にキーを残して
    いる場合は削除を推奨 (既定権限 644 = 同一マシンの他ユーザーから読める)。
  - 生成サービス (OpenAI) 側でサービスアカウントの利用金額上限を設定しておく。
  - キーのローテーション: `~/.ayatori/image-api-key` の中身を新キーで置き換えるだけ
    (保存後すぐ反映・再起動不要)。ローテーション後は `--doctor` で古い env 残留がないか確認する。
  - GitHub organization の Secret Scanning + Push Protection を有効化しておくと、キーを誤って
    repo 管理下のファイルに書いて push しても push 時点でブロックされる (最後の防衛線)。

---

## 4. MCP の設定

### Atlassian MCP

`.mcp.json` はリポジトリに含まれているため設定ファイルの編集は不要。Atlassian 公式リモート MCP サーバー（`https://mcp.atlassian.com/v1/mcp/authv2`、OAuth 2.1 認証）を使用する（旧 `npx -y mcp-atlassian` + API トークン方式は廃止）。初回のみ OAuth 認証を行う：

1. Claude Code のチャット欄に `/mcp` と入力
2. `atlassian` を選択
3. ブラウザで Atlassian の OAuth 認証（kinto-dev.atlassian.net へのアクセス許可）を完了する
4. `/mcp` で `atlassian: ✅ Connected` になっていることを確認

### Figma MCP

1. Claude Code のチャット欄に `/mcp` と入力
2. `figma` を選択
3. ブラウザで Figma の OAuth 認証を完了する
4. `/mcp` で `figma: ✅ Connected` になっていることを確認

---

## 5. 動作確認チェックリスト

パイプラインを開始する前に以下を確認する。

### Atlassian MCP 確認

Claude Code のチャットで `/mcp` → `atlassian` → `✅ Connected` を確認。未接続なら「4. MCP の設定」の OAuth 手順を実施する。

### Figma MCP 確認

Claude Code のチャットで `/mcp` → `figma` → `✅ Connected` を確認。

### 環境変数確認

```bash
echo "FIGMA_MCP_ENABLED: $FIGMA_MCP_ENABLED"
echo "FIGMA_FILE_KEY: $FIGMA_FILE_KEY"
```

全て値が表示されることを確認（空の場合は `~/.zshrc` を再確認）。

---

## 6. 初回実行手順

```bash
cd /path/to/AYATORI
claude
```

Claude Code が起動したら、以下の順番で Phase コマンドを実行する。
**各 Phase は別の会話で実行すること。**

**Step 1.** `/ayatori-status` を実行して現在のプロジェクト状態を確認（初回は空）

**Step 2.** `/ayatori-question` を実行して新規プロジェクトを開始
- 6軸インタビューでアイデアを構造化する
- 完了メッセージが出たら会話を終了する

**Step 3.** **新しい会話**で `/ayatori-requirements` を実行
- 前の Phase の成果物は `artifacts/` から自動で読み込まれる

**Step 4.** **新しい会話**で `/ayatori-design` → `/ayatori-screens` → `/ayatori-retro` を順番に実行

**中断した場合**: 同じ Phase コマンドを新しい会話で再実行すれば、`artifacts/` の状態を見て自動で再開地点を判断する。

**テスト用のサンプルデータを使う場合**:
`docs/test-fixtures/sample-app/` に用意されたサンプル入力を使って動作確認できる（詳細は `docs/test-fixtures/sample-inputs.md` を参照）。

---

## 7. よくある問題

| 症状 | 原因 | 対処 |
|---|---|---|
| Confluence への保存が失敗する | Atlassian MCP が未接続 / OAuth セッション切れ | `/mcp` → `atlassian` で再認証する |
| Figma に書き込めない | Full seat でない / OAuth 未完了 | Figma プランを確認・`/mcp` で再認証 |
| **Step 17 / 18 / 22 / 24 / 25 が「スタブモードで継続します」と警告を出してスタブ実行になる** (Step 12 は Figma を触らない設計なので対象外) | **`FIGMA_MCP_ENABLED` が Claude Code プロセスから見えていない** (この env var は AYATORI パイプラインが Figma MCP モードで動くための **必須スイッチ**) | (1) `~/.zshrc` に `export FIGMA_MCP_ENABLED=true` を追記 → 新しい terminal で Claude Code を起動 / (2) または `.claude/settings.local.json` の `env` ブロックに `"FIGMA_MCP_ENABLED": "true"` を追加 → Claude Code を再起動 |
| `FIGMA_MCP_ENABLED` を export 済みなのに警告が出続ける | export 後に Claude Code を再起動していない / 別 shell で起動した | Claude Code を完全終了し、`echo $FIGMA_MCP_ENABLED` が `true` を返す terminal から再度起動 |
| `artifacts/{app_name}/` が見つからない | Phase 1a が未実行 | `/ayatori-question` を実行してプロジェクトを作成する |

---

## 8. チーム担当ステップ一覧

各メンバーが担当するステップを把握しておくこと。

| 担当 | ロール | 担当ステップ |
|---|---|---|
| リードA | Figma MCPリード | ⑧デザインシステム・⑩画面生成 |
| リードB | 採点・プロンプトリード | ③④ルーブリック採点・AI/人間タグ |
| メンバーC | KMPエンジニア | ①②要件定義・⑥Confluence保存 |
| メンバーD | KMPエンジニア | ⑬⑭デザインレビュー・採点 |
| メンバーE | KMPエンジニア | ⑧デザインブレスト・⑨WCAG・⑯振り返り |

担当ステップ以外を編集する場合は担当者に確認すること。

---

*問題が解決しない場合は日向（マネージャー）または担当リードに連絡する。*
