# reverse Step 01 sub-module: Local Document Normalization (ローカル文書の正規化)

Step 01 の A0 dispatch から Read される手順書。ユーザーが `input-sources/docs/` に配置した
既存ドキュメント (md / txt / pdf) を、行番号で引用できる形に正規化して `ground-truth/` へアーカイブする。

**なぜ正規化するか**: doc_backed の provenance ref は `ground-truth/{file}.md:line` 文法。
`input-sources/docs/` の原本 (特に PDF) は行アンカーを持てないため、下流 (Step 02 / Step 03 / Step 05 監査) が
安定して引用・再監査できる Markdown 正規化本を `ground-truth/` に作る。原本には一切手を加えない
(input-sources の writer は user のみ)。

## 実行条件 / 冪等

- `source-inventory.json` の `sources.docs.local_files` が非空のときのみ実行。
- **ファイル別冪等**: `ground-truth/local-{stem}.md` が既に存在するファイルは skip。
  原本を更新した場合はユーザーが該当の `local-{stem}.md` を削除して再実行する
  (自動 mtime 比較はしない — 判定を単純に保つ)。

## 手順

`input-sources/docs/` の各ファイルについて、拡張子で分岐:

### md / txt

原文をそのまま (verbatim — 要約・整形・翻訳しない) コピーし、出所ヘッダーを付けて
`ground-truth/local-{stem}.md` に Write する:

```markdown
# {原本ファイル名}

**Source**: input-sources/docs/{原本ファイル名} (local)
**Normalized**: {ISO 8601}

---

{原文 verbatim}
```

### pdf

Read tool で **`pages` パラメータを渡さずに** 1 回で読む — `pages` 経路は poppler 依存の
画像変換パスであり、本パイプラインでは使えない (規則の SoT は `skills/00-memory-load/SKILL.md` の
「PDF reading」standing rule。**外部 PDF CLI (pdftotext / poppler 等) の導入も不可** —
Operating Principle 1)。

10 ページ超で読めなかった場合は、repo pin 済みの純 JS splitter で part に割ってから読む
(ユーザーに分割・再エクスポートを依頼しない — 分割はレンダリングと違い外部 CLI 不要):

```bash
node scripts/split-pdf.mjs "artifacts/{app_name}/input-sources/docs/{file}.pdf" \
  "artifacts/{app_name}/ground-truth/.pdf-split/{stem}/"
```

- 各 part を同じく `pages` なしで Read する。part ファイル名は **原本のページ範囲**
  (`{stem}.p10-16.pdf`) を持つので、転写の `## Page N` 見出しは原本ページ番号でつける
  (part 内の相対番号にしない — provenance の行アンカーが原本とずれる)。
- `.pdf-split/` は隠しディレクトリの中間生成物で、再実行時は上書きされる (削除不要)。
- split script が非 0 で失敗した場合 (暗号化 / 破損 PDF) のみ、従来どおり md / txt への
  再エクスポートか復号済み PDF の再提供をユーザーに依頼する。

読めた内容をページ単位の見出し付きで転写する:

```markdown
# {原本ファイル名}

**Source**: input-sources/docs/{原本ファイル名} (local, PDF transcription)
**Normalized**: {ISO 8601}

---

## Page 1

{ページ 1 の内容転写}

## Page 2
...
```

- 表は Markdown テーブルに、図・画像は `[図: {1 行説明}]` プレースホルダに転写する。
- 転写であって原文コピーではないため、読み取り不能・曖昧な箇所は `※ 判読不能` を明示する
  (推測で埋めない — Operating Principle 4)。

### その他の拡張子 (docx / xlsx 等)

変換しない。ユーザーに md / txt / pdf での再提供を依頼する (Operating Principle 1 —
変換のための外部 CLI 導入はしない):

> 「`input-sources/docs/{file}` は未対応形式です。md / txt / pdf でエクスポートして再配置してください。
>  (このファイルを除外して進めることもできます)」

## index.md への反映

index は手で書き足さない — 正規化が終わったら Step 01 の A3 (index 再生成) で
`node scripts/build-ground-truth-index.mjs {app_name}` を実行する。script が
`**Source**:` ヘッダーから local 由来を判別し、content status 判定込みで全量上書きする。

## Output

- `artifacts/{app_name}/ground-truth/local-{stem}.md` — 原本 1 ファイルにつき 1 本
- `ground-truth/index.md` は A3 の script 再実行で更新される (本 sub-module は直接書かない)
