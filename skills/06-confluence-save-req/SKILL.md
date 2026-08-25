---
name: 06-confluence-save-req
description: スコア合格した要件定義ドキュメントパッケージ（8 ファイル）を Atlassian MCP 経由で Confluence に保存し、保存後に read-back 漏れチェックで内容の完全性を検証する。Phase 1b の Step 06 で呼ばれる。
---

# 6 Confluence 保存

## 役割

スコア合格した要件定義ドキュメントパッケージ（8ファイル）を Confluence に保存する。
Atlassian MCP（公式リモート MCP サーバー、`.mcp.json` で宣言）を使用する。
保存後は **read-back 漏れチェック (Step 3.5)** で保存内容をローカル MD と突合し、
通過した場合のみ `save_status = "success"` を記録する（ツールの戻り値「成功」だけでは成功と見なさない）。

---

## 実行指示

`artifacts/{app_name}/requirements/01-overview.md` 〜 `08-constraints.md` の全8ファイルと
`artifacts/{app_name}/requirements.json` (`confluence_parent_id` のみ INPUT として参照) と
`artifacts/{app_name}/pipeline-state.json` (cross-phase hot state、無ければ `{}` から init) を読み込む。

**重要 — 書込み先**:
- `requirements.json` には書き込まない (INPUT 専用、本 step は read-only)
- 生成系 page_id / save_status は `pipeline-state.json.confluence.requirements` に書く
- 最初の writer がこの step の場合、`pipeline-state.json` を `{ "app_name": "{app_name}" }` で lazy init してから merge する

### 保存するページ階層

```
confluence_parent_id（①で指定した親ページ）
└── {app_name}（プロジェクトページ）
    ├── 01. プロジェクト概要書
    ├── 02. スコープ定義書
    ├── 03. ユーザーフロー
    ├── 04. ユースケース一覧
    ├── 05. 機能一覧
    ├── 06. 非機能要件一覧
    ├── 07. データ定義・外部連携
    └── 08. 制約・前提・受け入れ条件
```

> `00-raw-input.md` は Confluence には保存しない（内部処理用）。

---

### Step 1: `confluence_parent_id` の決定

1. `artifacts/{app_name}/requirements.json` の `confluence_parent_id` が null でなければそれを使用
2. null の場合は AskUserQuestion で「Confluence の親ページ URL または page ID を教えてください」と確認
3. それでも未回答の場合は Step 3 をスキップし、`pipeline-state.json.confluence.requirements.save_status = "failed"` を記録して次ステップへ進む (Read or {} → merge → Write back)

---

### Step 2: プロジェクトページを作成する（初回のみ）

`pipeline-state.json` の `confluence.requirements.page_id` を確認する：

- **非 null の場合**: 既存のプロジェクトページを再利用する。作成処理はスキップし、既存の `page_id` をそのまま使用する。
- **null または未設定の場合**: 新規作成する：

```
<Atlassian MCP の実際のツール名>(
  title: "{app_name}",
  content: "<p>{app_name} プロジェクトの要件定義ドキュメント一覧</p>",
  parent_id: confluence_parent_id   # ← requirements.json から取得した INPUT
)
```

→ 作成されたページの page_id を `pipeline-state.json.confluence.requirements.page_id` に保存する (Read or {} → merge → Write back パターン)。

---

### Step 3: 8ページを作成または更新する

以下の順番で各ページを処理する（**表示順 = 番号順**。依存関係順ではない）:

```
処理順: ["01-overview", "02-scope", "03-user-flow", "04-use-cases",
         "05-features", "06-non-functional", "07-data-definition", "08-constraints"]
```

> **注意:** ②での書き出し順（依存関係順）と⑥の処理順は異なる。
> Confluence のサイドバーはページ作成順に並ぶため、01→08 の番号順で作成すること。

**Markdown → Confluence storage 形式への変換ルール（必須）:**

MDファイルの内容は **Confluence storage 形式（XHTML）** に変換してから渡すこと。Markdownをそのまま渡してはいけない。

| Markdown | Confluence storage 形式 |
|---|---|
| `# 見出し1` | `<h1>見出し1</h1>` |
| `## 見出し2` | `<h2>見出し2</h2>` |
| `### 見出し3` | `<h3>見出し3</h3>` |
| `**太字**` | `<strong>太字</strong>` |
| `- 箇条書き` | `<ul><li>箇条書き</li></ul>` |
| `1. 番号付きリスト` | `<ol><li>番号付きリスト</li></ol>` |
| `\| 列1 \| 列2 \|` + `\|---|---|` + `\| 値1 \| 値2 \|` | `<table><tbody><tr><th>列1</th><th>列2</th></tr><tr><td>値1</td><td>値2</td></tr></tbody></table>` |
| ` ```コードブロック``` ` | `<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[コードブロック]]></ac:plain-text-body></ac:structured-macro>` |
| `` `インラインコード` `` | `<code>インラインコード</code>` |
| `---` (水平線) | `<hr/>` |
| 空行（段落区切り） | `<p>...</p>` で囲む |
| `> 引用` | `<blockquote><p>引用</p></blockquote>` |

> Atlassian MCP ツールが `representation` パラメータをサポートしている場合は `"storage"` を指定すること。

各ドキュメントキーについて:

```
existing_id = pipeline-state.json の confluence.requirements.doc_page_ids[doc_key]
project_page_id = pipeline-state.json の confluence.requirements.page_id  # Step 2 で保存済み

if existing_id is null:
    # 新規作成
    page_id = <MCPツール>(
      title: "{連番}. {ページタイトル}",
      content: {該当MDファイルの内容を上記ルールでstorage形式に変換したXHTML},
      parent_id: project_page_id
    )
else:
    # 更新（ループ2回目以降）
    page_id = <MCPツール update>(
      page_id: existing_id,
      title: "{連番}. {ページタイトル}",
      content: {該当MDファイルの内容を上記ルールでstorage形式に変換したXHTML}
    )
    # 更新が 404 / エラーの場合（ページが Confluence 側で手動削除されたケース）:
    # → 新規作成にフォールバックする
    if update エラーの場合:
        page_id = <MCPツール create>(
          title: "{連番}. {ページタイトル}",
          content: {該当MDファイルの内容を上記ルールでstorage形式に変換したXHTML},
          parent_id: project_page_id
        )

pipeline-state.json の confluence.requirements.doc_page_ids[doc_key] = page_id   # Read or {} → merge → Write back
```

**ページタイトル対応表（処理順）:**

| 処理順 | doc_key | タイトル |
|---|---|---|
| 1 | 01-overview | 01. プロジェクト概要書 |
| 2 | 02-scope | 02. スコープ定義書 |
| 3 | 03-user-flow | 03. ユーザーフロー |
| 4 | 04-use-cases | 04. ユースケース一覧 |
| 5 | 05-features | 05. 機能一覧 |
| 6 | 06-non-functional | 06. 非機能要件一覧 |
| 7 | 07-data-definition | 07. データ定義・外部連携 |
| 8 | 08-constraints | 08. 制約・前提・受け入れ条件 |

---

### Step 3.5: 保存内容の漏れチェック（read-back verification）

Step 3 の保存が「成功」として返っても、実際には内容の一部が欠落しているケースがある
（ネットワーク不安定による部分保存、update ツールが success を返すのに永続化されない環境、
create ツールの content 長制限による切り詰め等。いずれも**エラーなしで欠落が発生する**）。
そのため、保存直後に必ず本チェックを実行し、通過をもって初めて保存成功と見なす。

検証パラメータの SoT は `pipeline.yaml → requirements.confluence_save.verification`
（`enabled` / `item_id_pattern` / `min_text_ratio` / `max_retry_per_page`）。`enabled: false` なら本 Step をスキップし
`verification = { "status": "unverified", "reason": "disabled_by_config", "checked_at": <ISO 8601> }` を記録して Step 4 へ進む
（read-back 不可の `unverified` とは事由が異なるため `reason` で区別する。表示文言も Step 4 / Step 07 で分岐）。

**3.5-1: 読み戻し（read-back）**

Step 3 で保存した各ページ（`doc_page_ids` の全 doc_key）について、Confluence から保存済み内容を取得する:

1. **primary**: read 系ツール（`read_confluence_page` 等）で page_id 指定取得
2. **fallback**: primary の返却 content が **空 / 明らかに短すぎる** 場合は export 系ツール
   （`export_confluence_page` 等、base64 markdown を decode）で再取得する。
   read 系が常に空 content を返す環境が確認されているため、空返却を「ページが空」と即断しないこと。
3. read 系 / export 系のいずれも利用不可（ツール不在・全ページでエラー）→ 該当ページ（または全体）を
   `"unverified"` とする（**fail-open**。検証不能を理由にパイプラインを止めない）。この経路で全体が
   `unverified` になる場合の `reason` は `"read_back_unavailable"`。

**3.5-2: ローカル MD からの構造指紋（fingerprint）抽出**

各 doc_key のローカル MD（`artifacts/{app_name}/requirements/{doc_key}.md` — 本 skill 冒頭の INPUT と同じファイル）から以下を抽出する:

| 指紋 | 抽出方法 | 判定 |
|---|---|---|
| 見出し | `^#{1,6}\s+(.+)$` の全見出しテキスト（`**` 等の MD 装飾記号は除去して正規化） | 全見出しが remote 本文に存在すること |
| 項目 ID | `item_id_pattern`（既定 `[A-Z]{1,4}-[0-9]+[a-z]?`、例: `F-01` / `F-02b` / `UC-03` / `NFR-12`）に一致する**一意 ID 全件** | 全 ID が remote 本文に存在すること |
| 本文長比 | タグ・MD 記号・空白を除去した remote 本文長 ÷ local MD 本文長 | `min_text_ratio`（既定 0.5）以上であること |

remote 側は storage 形式 (XHTML) または markdown で返るため、突合前に **タグ除去・HTML エンティティ decode・空白正規化** を行い、テキストとして比較する。

⚠️ **コードブロック（``` フェンス）内部は 3 指紋すべての抽出対象から除外する**（local MD 側で除外してから抽出する）。
コードブロックは remote 側で code マクロの CDATA になり、read-back の形式によっては本文テキストに含まれないため、
含めると誤検知 failed → 不要な再保存を招く（例: `03-user-flow.md` の mermaid 図内の画面 ID 等）。
remote 側の正規化でマクロ本文 (CDATA) が取れる場合にテキストへ含めるのは可（本文長比は下限判定のため、
remote 側が過剰になる分には安全）。

**3.5-3: 判定と自動再保存**

- 3 判定すべて通過 → 該当ページ `"passed"`
- いずれか欠落 → 該当ページのみ Step 3 と同じロジック（update、エラー時 create フォールバック）で
  **再保存**し、3.5-1〜3.5-2 を再実行する。再保存は 1 ページにつき `max_retry_per_page` 回（既定 1）まで。
- 再保存後も欠落が残る → 該当ページ `"failed"`。漏れた見出し / ID を記録する。
  - ⚠️ update が success を返すのに read-back が古いままの場合（update が永続化されない環境）、
    再 update を繰り返しても回復しない。retry 上限に達したら `"failed"` として止め、
    ユーザー報告（Step 4）に「update が永続化されない環境の可能性。新規作成による再保存や
    ページの手動削除が必要な場合があります」と付記する。

**3.5-4: 検証結果の記録**

`pipeline-state.json` の `confluence.requirements.verification` に記録する（Read or {init-stub} → merge → Write back）:

```json
"verification": {
  "checked_at": "<ISO 8601>",
  "status": "passed | failed | unverified",
  "reason": "disabled_by_config | read_back_unavailable",
  "pages": { "01-overview": "passed", "05-features": "failed", ... },
  "missing": { "05-features": ["見出し: Coming Soon（現行スコープ外）", "ID: F-07"] }
}
```

- ⚠️ **`verification` オブジェクトは毎回丸ごと置換 (replace) する**（`verification` 内部の key 単位 merge をしない。
  merge だと前回 run の `pages` / `missing` が残置され、今回全 passed でも古い漏れ情報が表示されるため）。
  `pipeline-state.json` のその他の key は通常どおり merge。
- `status` は全体サマリ: 全ページ `passed` → `"passed"` / 1 ページでも `failed` → `"failed"` /
  failed は無いが unverified がある（または check 自体が実行不能）→ `"unverified"`
- `reason` は `status == "unverified"` のときのみ記録: `"disabled_by_config"`（設定で意図的に OFF）/
  `"read_back_unavailable"`（read 系・export 系とも利用不可の fail-open）
- `missing` は failed ページのみ、漏れた指紋を「`見出し: {text}`」「`ID: {id}`」形式で列挙する（人間が Confluence 側を目視確認する手がかり）

---

### Step 4: ステータスを記録する

全8ページの処理 + Step 3.5 漏れチェック完了後:

- **全ページ保存成功 かつ `verification.status == "passed"`** → `confluence.requirements.save_status = "success"` を保存
- **`verification.status == "unverified"`** → `save_status = "success"` のまま記録し、`reason` に応じて表示を分ける:
  - `reason == "disabled_by_config"` → 「ℹ️ 漏れチェックは設定で無効化されています
    （`pipeline.yaml → requirements.confluence_save.verification.enabled: false`）。」（警告ではなく情報表示）
  - `reason == "read_back_unavailable"` → 「⚠️ Confluence 保存の漏れチェックが実行できませんでした（read-back 不可）。
    Confluence 側の内容がローカル 8 ファイルと一致しているか、承認時に目視確認してください。」（fail-open、従来挙動維持）
- **保存自体の失敗 または `verification.status == "failed"`** → `save_status = "failed"` を保存（成功分の ID / verification は保存済み）。
  漏れ検出の場合は以下の形式でユーザーに報告してから次ステップへ進む（Step 07 人間ゲートでも再掲される）:

```
⚠️ Confluence 保存の漏れチェックで欠落を検出しました（自動再保存でも回復せず）:
- {doc_key}: {missing の列挙}
save_status = "failed" として記録しました。次セッション再開時に Step 06 が再実行されます。
ローカルの artifacts/{app_name}/requirements/ が正本のため、以降のパイプラインは継続可能です。
```

---

### フォールバック（MCP 利用不可時）

Atlassian MCP が利用できない場合:
1. 「Confluenceへの保存をスキップしました。`artifacts/{app_name}/requirements/` の8ファイルを参照してください。」と表示
2. `pipeline-state.json` の `confluence.requirements.save_status = "failed"` を保存
3. 次ステップへ進む

> 8ファイルはローカルに存在するため、以降のパイプラインは問題なく継続できる。
> 次セッション再開時: `pipeline-state.json.confluence.requirements.save_status == "failed"` かつ `scoring-history.json.attempts[-1].total >= 80` かつ全軸が `pipeline.yaml → requirements.loop.per_axis_min` 以上の場合にこのステップを再実行する。

---

## 完了後

- `verification.status` が `"passed"` / `"unverified"` の場合: 「Confluenceに要件定義ドキュメントパッケージを保存しました（8ページ、漏れチェック: {verification.status}）。」と表示
- `verification.status == "failed"` の場合: 本行は表示しない（「保存しました」と欠落検出が矛盾するため）。Step 4 の欠落検出報告フォーマットのみとする
- Step 3.5 に到達しなかった場合（Step 1 で親ページ未決定 / MCP 利用不可フォールバック等、`verification` 未記録）: 漏れチェック結果は付記せず、各分岐で定義された表示（保存スキップの案内等）のみとする
