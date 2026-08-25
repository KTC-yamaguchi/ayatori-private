# reverse Step 01 sub-module: Confluence Document Collection (文書アーカイブ)

Step 01 の A0 dispatch から Read される手順書。`confluence_parent_ids` の各親配下のページ群を
MCP で取得し、root 直下の `ground-truth/{page}.md` にアーカイブする (親は複数ありうる — 別トリー・
別スペースでもよい)。

収集は「取得した本文をそのまま書き写す」機械的転写であり解釈を要しないため、本文の取得〜Write は
`ayatori-doc-ground-truth-collector` subagent に分離する (agent 定義が `model: haiku` を pin。
自己機械検査・fragment 書き出しまで含めた契約は `.claude/agents/ayatori-doc-ground-truth-collector.md` 参照)。
main context には件数サマリだけを返す。verbose な MCP 応答を main に入れないための隔離でもある。

## 実行条件 / 冪等

- inventory の `sources.docs.confluence_parent_ids` が非空のときのみ実行 (A0 dispatch)。
  旧単数 field `confluence_parent_id` しか無い既存 artifact は、その値を 1 要素の列挙として読む (reader 互換)。
- **page-ID 冪等**: 収集済みページの機械判定は
  `grep -h '^\*\*Page ID\*\*:' artifacts/{app_name}/ground-truth/*.md` で収集済み ID 集合を作り、
  D1 の列挙結果との差分を取る。部分収集で中断しても再実行は未収集分だけを対象にできる
  (worker が途中終了しても同じ判定で再開する)。

## D1: 列挙 (本文は取得しない)

1. `confluence_parent_ids` の**各親について** `getConfluencePageDescendants` で親 + 全子孫の
   page ID / title / status を列挙する (本文を含まない低コスト操作。予算判断はこの列挙だけで行う)。
2. 親が複数のときは列挙結果を **page_id で union + dedup** する — 親同士が入れ子・交差していても
   同じページを二度収集しない (アーカイブのファイル名が `cf-{page_id}-...` なので出所の親が
   どれでも成果物は同一)。
3. `status: draft` のページは収集対象から**除外**する (公開 API で本文を取得できない)。
   除外分は D4 の failed リストに理由 `未公開 (draft)` で記録する — 無言で消さない。
4. 列挙結果を**サブツリー (親直下の枝) ごとに件数集計**する (D2 の提示材料)。親が複数のときは
   「親ごと → その直下の枝ごと」の 2 階層で集計し、どの親から来たページかが D2 の表で分かるようにする。

## D2: 収集範囲の予算ゲート (halt & ask)

上限は「黙って切り捨てる」ためではなく「**数字を見せて選ばせる**」ために使う — 証拠アーカイブから
無言で抜けたページは、収集が遅いことより危険 (下流が「存在しない」と誤読する)。

- 収集対象の総数が **50 ページ以下** → 質問せず全収集に進む。
- **50 ページを超える** → 収集を開始せず停止し、AskUserQuestion 1 回で範囲を選ばせる:
  - サブツリー別の件数と**予想所要**を提示する。予想所要 ≈ `ページ数 ÷ (3 ページ/分 × worker 数)`。
  - 推奨 (既定) = 要件定義・画面仕様・機能設計・API 系のサブツリーに絞る案 (件数 + 予想所要を併記)。
  - 全量収集は明示 opt-in (こちらも件数 + 予想所要を併記)。
- **推奨案の材料 (初回 vs 差分)**: 初回収集ではページの中身がまだ無いため、推奨はタイトルの
  ヒューリスティックに拠るしかない。**差分収集 (2 回目以降の D2 再入) で既存の `index.md` が
  あるときは、content status を推奨案に使う**:
  - D1 の列挙結果と index を page_id で突合し、サブツリー別の内訳
    (本文系 {n} / 殻・図のみ {m} / テンプレート未記入 {k} / 未収集 {u}) をゲート表に併記する。
  - 推奨 (既定) = **本文あり率の高いサブツリーから広げる案** (件数 + 予想所要を併記)。
  - 収集済みで 殻 / 図のみ / テンプレート未記入 と判定済みのページは再収集候補から**自動除外**する
    (ソース側に本文が無いのだから再取得しても増えない — 図の実体が要るなら
    `input-sources/docs/` への画像エクスポートを案内する)。
- **段階収集**: 範囲から外したサブツリーは後から追加収集できる (page-ID 冪等)。まず絞った範囲で
  Step 02 まで進め、根拠不足が判明した分だけ追加収集するのが既定の進め方。範囲確定時に main が
  2 つのファイルを書く:
  - `ground-truth/.collection-scope.json` — 確定範囲の page-ID 集合
    (`{ "page_ids": [...] }`)。A0 の済み判定がこれと収集済み集合を比較するので、これが無いと
    「1 件でも収集済み = 完了」と判定されて差分収集の経路が塞がる。
  - 範囲外にした page は `.collection-failed.json` に
    `reason: "範囲外 (未収集)"` で記録する (D4 と同じ台帳・同じ merge 規約)。script は
    この台帳しか読まないため、ここに入れないと index に痕跡が残らず下流が「存在しない」と誤読する。

## D3: worker fanout (収集本体)

### D3.0: 受信本文長の probe (独立測定 — 照合の正 + batch 分割の材料)

collect に先立ち、確定範囲の全ページを `ayatori-doc-ground-truth-collector` の **`mode: probe`** で
fetch し、`{ id, body_chars }` の list を得る (1 probe batch **15 ページ以下** — probe は Write しないが
本文は context に受信するため、大きくしすぎると probe 自身が溢れる)。main が結果を
`ground-truth/.probe-pages.json` (`{ "source": "confluence", "pages": [{ "id", "body_chars" }] }`) へ
書く (writer は main。差分収集では既存 entry と id で merge)。

この測定値が D4.5 忠実度検査の**照合の正**になる — collect worker の自己申告
(fragment の `expected_body_chars`) は「短く書いた分だけ期待値も縮む」形で照合が循環しうるため、
照合の正には使わない (probe はアーカイブ未作成の時点で走り、書かれる内容を知らない)。

### D3.1: batch 分割 (本文量ベース) + ADF 直行ルーティング

- **ADF 直行ルーティング**: probe の body_chars が **10,000 字以上**のページは、collect target に
  `format: adf` を付けて **markdown を経由せず生 ADF JSON で収集**する。
  理由: 表・パネル・マクロの多いページは markdown 変換自体が内容を欠落させうるが、probe と
  アーカイブが同じ markdown 経路を通ると「受信した分は書いた」となり D4.5 の比率検査では
  構造的に検出できない (同源比較の盲点)。ADF は損失なしの原本形式で、この盲点そのものを消す。
  大きなページほど構造化コンテンツを含む傾向があるため本文量を trigger にする
  (markdown の文字数は表の整形パディングや画像 blob URL で膨らむ「見かけの量」であり
  内容量そのものではない — 閾値はあくまで「構造化が濃い可能性が高い」ことの proxy)。
  ADF アーカイブは下流がそのまま読まず、D4.6 の抽出本を読む。
- probe の body_chars **累計が 40,000 字以下**になるように collect batch を切る (件数上限 30 ページ/batch。
  probe が取れなかったページは 5,000 字とみなす)。`format: adf` のページは受信 JSON が
  markdown 比で数倍に膨らむため、**1 batch 2 ページまで**に絞る。
- ページ数ではなく本文量で切る理由: worker は受信本文をアーカイブへ逐語で書き出すため、context 消費は
  本文量に比例する (受信 + 書き出しエコーで本文量の 2 倍超)。予算を超えた worker は転写の質で帳尻を
  合わせようとする (= 要約) — これは検査で完全には防げないため、そもそも予算内に収める。
- worker 側にも安全弁がある (書いた本文の累計 60,000 字で中断し `未着手` を返す — agent 定義参照)。
  未着手が返ったら残りを新 batch として再起動する (page-ID 冪等により二重収集はない)。

### D3.2: collect worker 起動
- Input 契約 (main → agent、batch ごと):

  ```
  repo_root: {絶対パス}
  app_name: {app_name}
  source: confluence
  batch_id: {N}
  output_dir: {repo_root}/artifacts/{app_name}/ground-truth/
  site_base_url: {https://xxx.atlassian.net}
  targets:
    - { page_id: "123456", title: "ログイン仕様" }
    - { page_id: "789012", title: "API一覧", format: adf }   # D3.1 の直行ルーティング対象のみ
  ```

- agent の per-page 手順 (詳細は agent 定義が SoT):
  1. `getConfluencePage` で本文を取得する。
  2. **取得したら即 Write** してから次ページへ進む (streaming write — 中断時はディスクが真実。
     複数ページ分をメモリに溜めてまとめて書かない)。
  3. **書き出し直後に自己機械検査** (要約マーカー grep + 受信本文長との照合) を行い、
     検出したらその場で再取得する。未解決は `.md.suspect` にリネーム保持 (削除禁止)。
  4. ファイル形式は agent 定義 (Phase 1) の template が SoT — 先頭ヘッダーを D5 の index 生成と
     page-ID 冪等の両方が grep する。YAML frontmatter 等の別形式は下記 D3 受入検査 3 が弾く。

- ファイル名は **`cf-{page_id}-{sanitized-title}.md`** (sanitize: lowercase / 空白→ハイフン /
  特殊文字除去)。page_id を必ず含める理由:
  - Confluence は同名ページを別スペース・別階層に持てる。title だけだと衝突して**後の worker が
    先の worker のアーカイブを上書きし**、消えた側の `ground-truth/{file}.md:line` 引用が
    別ページの本文を指す (監査が誤った本文で「検証済み」を出す)。worker は並列なので同時書きにもなる。
  - 生成物の `index.md` とタイトル衝突する page (`Index` 等) も避けられる。
  - jira は `jira-{KEY}.md`、ローカル文書は `local-{stem}.md` と同じ「出所が分かる接頭辞」に揃う。
- **転写の忠実度**: 本文は verbatim (要約・整形・翻訳しない)。本文が大きすぎて markdown 変換
  できない場合は生 ADF JSON を ```json フェンスで保存する (D5 の index が `ADF生JSON` として区別する)。
- **fragment**: agent は batch ごとに `ground-truth/.batch{N}-pages.json` を書く —
  per-page の `{ id, file, expected_body_chars, verification }` (expected_body_chars =
  **API 応答として受信した本文**の文字数。agent 自身の Phase 2 自己検査の参考値で、
  D4.5 の照合の正は D3.0 の probe — 自己申告は probe 不在 entry の fallback)。共有ファイルには書かない
  (並列 batch の Read→merge→Write back は互いの更新を失う)。
- agent の return は件数サマリのみ (`収集 {N} 件 / 失敗 {M} 件: [{page_id, reason}]` + fragment パス +
  warnings)。本文は返さない。

### D3 受入検査 (batch ごと・main が return 直後に実行)

agent の完了報告は受入の根拠にしない — 「fragment を書いた」「規約どおり書いた」という自己申告と
ディスク上の実態は乖離しうる。この種の形式逸脱は D4.5 (本文忠実度検査) の対象外で、放置すると
index 生成と page-ID 冪等判定 (`grep '^\*\*Page ID\*\*:'`) が壊れる。各 batch の return を受け取ったら
main が即座に機械検査する:

1. **fragment 実在**: `.batch{N}-pages.json` がディスクに存在し、JSON として parse できる。
2. **件数整合**: fragment の `pages[]` 件数 == batch の target 数 − return が報告した失敗数 − 未着手数。
   未着手 (context 予算超過による正常中断 — agent 定義参照) は不合格ではない: 完了分の fragment が
   揃っていれば本検査は合格とし、未着手分は新 batch として再起動する。
   自 batch 以外の page が混入していないことも見る (fragment は batch 単位 — 他 batch 分を含めない)。
3. **ヘッダー形式**: fragment が列挙する全ファイルが規約ヘッダーを持つ:

   ```bash
   jq -r '.pages[].file' artifacts/{app_name}/ground-truth/.batch{N}-pages.json \
     | while read -r f; do
         grep -L '^\*\*Page ID\*\*:' "artifacts/{app_name}/ground-truth/$f"
       done   # 出力 = 形式逸脱ファイル (0 行が合格)
   ```

不合格が 1 件でもあれば当該 batch は**未完了**として扱い、同じ agent に是正 (fragment の実書き出し /
規約ヘッダーへの書き直し) を依頼して再検査を通してから先へ進む。本検査は形式のみ —
本文の忠実度は従来どおり D4.5 が担う (責務は重複しない)。

## D4: 取得失敗の扱い

- 取得エラー (権限 / 404 / 変換不能 等) はリトライ 1 回 → なお失敗なら**無言スキップせず**
  failed リストに記録する: `[{"page_id": "...", "title": "...", "reason": "..."}]`。
- main が全 worker の failed 報告を集約し `artifacts/{app_name}/ground-truth/.collection-failed.json`
  へ **`Read or [] → append → Write back` で merge** する (D5 の入力)。失敗 0 件かつ範囲外 0 件なら
  書かなくてよい。
  ⚠️ **全量上書きしない** — 本ファイルは jira sub-module と共用で、どちらが後に走っても
  相手の記録が消えてはならない (「未収集を無言で落とさない」という台帳の存在意義そのものが壊れる)。
  同一 `page_id` の重複は後勝ちで 1 件に潰す。

## D4.5: 転写忠実度の機械検査 (必須・backstop)

agent の「verbatim 完了」自己申告は検証せずに信用しない。agent 側の自己機械検査 (書き出し直後)
が第一防衛線で、本検査はその漏れを拾う backstop — 発火 = agent 側の自己検査が機能しなかった
シグナルとして warning に残す。全 batch 完了後、main が実行する:

```bash
node scripts/check-ground-truth-fidelity.mjs {app_name}
```

- 検査内容 (詳細は script が SoT): (a) 要約マーカーの検出 (マーカー形 + 日英 disclaimer 句 —
  散文中の一般語や jira の `[添付: ...]` は誤検出しない)、(b) 受信本文長とアーカイブ本文長の照合
  (受信の半分未満で flag、受信 500 字未満は skip。**照合の正 = D3.0 の `.probe-pages.json`**、
  probe 不在 entry のみ fragment の自己申告に fallback)、(c) **走査件数の必須出力**
  (0 件走査を「汚染 0 件」と読み替えない)。
- 検出されたページのみ **explicit-target の repair batch** で再収集する (同名ファイルを上書き —
  page-ID 冪等の「収集済み skip」はこのとき適用しない)。再収集後に本検査を再実行する。
- **ループブレーカー**: 再収集を 1 回行ってもマーカー検査のみ再発し、本文長照合は通る場合、
  そのページは正常本文にマーカー語が含まれるとみなして受容し、warning として記録する
  (検査語は本文に正常に現れうる)。
- 判定は再収集の起動条件に留める — **ファイルを削除しない** (誤検出時に証拠が不可逆に失われる)。

## D4.6: ADF 抽出本の生成 (決定論 — 手書き禁止)

D4.5 通過後、main が実行する:

```bash
node scripts/extract-adf-text.mjs {app_name}
```

生 ADF JSON アーカイブ (D3.1 の直行ルーティング分 + markdown 変換不能で fallback した分) ごとに、
見出し・段落・表・コードブロックを行引用可能な圧縮 markdown へ展開した
`{同名}.adf-extract.md` を並置する。**下流 (Step 02 / 03 / 05) は生 JSON ではなく抽出本を読み、
引用も抽出本の行を指す** — 生 JSON はバイト数の 9 割超が構造ボイラープレートで、
直読は context を浪費し、目視の表読みは隣接行の値を取り違える。抽出本は決定論生成なので
再実行でいつでも同一内容に再現でき、引用の再監査可能性は原本 (生 JSON) と等価。

## D5: index 生成 (決定論 — 手書き禁止)

全 worker 完了後、main が実行する:

```bash
node scripts/build-ground-truth-index.mjs {app_name}
```

台帳は既定パス `artifacts/{app_name}/ground-truth/.collection-failed.json` を script が自動で読む
(`--failed` は別パスに置いた場合のみ)。

- `index.md` は各ファイルの **content status** (本文 / 本文+図依存 / 薄い / テンプレート未記入 /
  ADF生JSON / 抽出本 / 殻 / 図のみ) を機械判定して記録する。下流 (Step 02 B1 / Step 03 の `doc_backed` 引用 /
  Step 05 監査) はこの status に従って引用可否を判断する。
- failed リスト (収集失敗 / draft 除外) と D2 の範囲外サブツリーは index に「収集できなかった /
  収集していない」ことが分かる形で残す — 下流が「存在しない」と誤読しないための必須記録。
- script はアーカイブ本文中の Confluence ページリンクも走査し、収集済みにも台帳にも無い page ID を
  **「参照されているが未収集」**として index に載せる。収集ツリーの外 (別の親・別スペース) にある
  参照先は列挙に現れず台帳にも痕跡が残らないため、この検出が無いと下流が「存在しない」と誤読する。
  載った ID は差分収集の候補としてユーザーに提示する (Step 01 の Output 参照)。
- index.md はこの script の出力のみ。手で書き足さない (再実行で消える)。
