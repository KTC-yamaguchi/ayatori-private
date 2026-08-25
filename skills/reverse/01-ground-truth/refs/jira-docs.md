# reverse Step 01 sub-module: Jira Issue Collection (課題アーカイブ)

Step 01 の A0 dispatch から Read される手順書。inventory の `sources.docs.jira_issue_keys`
(+ 任意の `sources.docs.jira_jql`) が指す Jira 課題を MCP で取得し、root 直下の
`ground-truth/jira-{KEY}.md` にアーカイブする。

**証拠としての性質 (Confluence 文書との違い)**: Jira 課題は「ある時点の変更要求・作業記録」であり、
Confluence 仕様書のような「現在の仕様の記述」ではない (未実装・破棄された内容を含みうる)。
下流 (Step 02 / Step 03) は課題のみを根拠にした current-state の主張を時点情報として扱い、仕様書・code と
食い違う場合は Cross-Source Conflicts に記録する。アーカイブの形式・引用文法 (`ground-truth/{file}.md:line`)
は文書と共通で、provenance は `doc_backed`。

収集は「取得した本文をそのまま書き写す」機械的転写のため、`ayatori-doc-ground-truth-collector`
subagent に分離する (agent 定義が `model: haiku` を pin。自己機械検査・fragment 書き出しまで含めた
契約は `.claude/agents/ayatori-doc-ground-truth-collector.md` 参照)。main context には件数サマリだけを
返す (verbose な MCP 応答を main に入れない隔離を兼ねる)。

## 実行条件 / 冪等

- inventory の `sources.docs.jira_issue_keys` が非空、または `sources.docs.jira_jql` が set のときのみ実行 (A0 dispatch)。
- **課題キー冪等**: `ground-truth/jira-{KEY}.md` が既に存在する課題は skip。課題が Jira 側で更新された
  場合はユーザーが該当ファイルを削除して再実行する (local-docs と同じ規約 — mtime / updated の自動比較はしない)。
- **確定範囲の永続化**: J2 を通過したら main が確定 key 集合を `ground-truth/.jira-scope.json`
  (`{ "issue_keys": [...] }`) に書く (Confluence の `.collection-scope.json` と同型)。A0 の済み判定と
  J1/J2 はこの確定集合を読む — これが無いと resume のたびに元 JQL の再列挙 → 予算ゲート再発火 →
  同じ範囲の再質問が起きる (同一 target を二度聞かない — Operating Principle 4 Rule 6)。
  差分収集で範囲を広げたときは本ファイルも union 更新する。

## J1: 列挙 (本文は取得しない)

0. `ground-truth/.jira-scope.json` が存在すればその `issue_keys` を収集対象とする (JQL の再列挙は
   しない)。inventory の明示 key に scope 未収載のものがあれば union して本ファイルを更新する。
   **J2 は skip** して J3 へ進む (範囲は確定済み — 再質問しない)。
1. `jira_issue_keys` の明示列挙をベースにする。
2. `jira_jql` が set なら `searchJiraIssuesUsingJql` (fields: key / summary / status のみの低コスト列挙)
   で列挙し、明示 key と合算する (重複 key は dedup)。
3. 合算した総数を J2 の予算判断材料にする。

## J2: 収集範囲の予算ゲート (halt & ask)

上限は「黙って切り捨てる」ためではなく「**数字を見せて選ばせる**」ために使う (confluence-docs の D2 と同思想)。

- 総数が **30 課題以下** → 質問せず全収集に進む。
- **30 課題を超える** → 収集を開始せず停止し、AskUserQuestion 1 回で範囲を選ばせる:
  - 件数と**予想所要** (≈ 課題数 ÷ (6 課題/分 × worker 数)) を提示する。
  - 推奨 (既定) = 明示 key + JQL を epic / コンポーネント等で絞り込む案 (件数 + 予想所要を併記)。
  - 全量収集は明示 opt-in。
- **段階収集**: 範囲から外した課題は後から追加収集できる (課題キー冪等)。範囲外にした key は
  J4 の failed リストに reason `範囲外 (未収集)` で記録し、「存在しない」と区別する。
- **範囲確定の永続化**: 質問の有無に関わらず、J2 通過時点の確定 key 集合を
  `ground-truth/.jira-scope.json` に書いてから J3 へ進む (冪等節参照)。

## J3: worker fanout (収集本体)

### J3.0: 受信本文長の probe (独立測定 — 照合の正 + batch 分割の材料)

confluence 側 D3.0 と同じ手順を jira に適用する: collect に先立ち確定範囲の全課題を
`ayatori-doc-ground-truth-collector` の **`mode: probe`** で fetch し (1 probe batch **20 課題以下**)、
main が `ground-truth/.probe-issues.json` (`{ "source": "jira", "issues": [{ "id": "{KEY}", "body_chars" }] }`)
へ書く。この測定値が J4.5 の照合の正 (collect worker の自己申告は循環しうるため fallback のみ)。

### J3.1: batch 分割 (本文量ベース)

- probe の body_chars **累計が 40,000 字以下**になるように collect batch を切る (件数上限 30 課題/batch。
  probe が取れなかった課題は 5,000 字とみなす)。理由と worker 側の安全弁 (累計 60,000 字で中断 →
  `未着手` 返却 → 新 batch で再起動) は confluence 側 D3.1 と同じ。

### J3.2: collect worker 起動

- Input 契約は confluence 側 D3 と同形 (`source: jira`、`targets[]` = `{key}` の list)。
- agent の per-issue 手順 (詳細は agent 定義が SoT):
  1. `getJiraIssue` で summary / description / status / issue type / updated / コメントを取得する。
  2. **取得したら即 Write** してから次課題へ進む (streaming write — 中断時はディスクが真実)。
  3. **書き出し直後に自己機械検査** (要約マーカー grep + 受信本文長との照合) を行い、
     検出したらその場で再取得する。未解決は `.md.suspect` にリネーム保持 (削除禁止)。
  4. ファイル形式は agent 定義 (Phase 1) の template が SoT — 先頭ヘッダーの `**Source**:` を
     index 生成が jira 由来の判別に読む。YAML frontmatter 等の別形式は下記 J3 受入検査 3 が弾く。

- ファイル名は `jira-{KEY}.md` (課題キーは大文字のまま — key 自体が一意識別子)。
- **転写の忠実度**: description / コメントは verbatim (要約・整形・翻訳しない)。添付・画像は
  `[添付: {ファイル名}]` プレースホルダに転写する (実体はアーカイブに含まれない)。
- **fragment**: agent は batch ごとに `ground-truth/.batch{N}-issues.json` を書く —
  per-issue の `{ id: "{KEY}", file, expected_body_chars, verification }` (expected_body_chars =
  受信した description + 全コメントの文字数。agent 自身の自己検査の参考値で、J4.5 の照合の正は
  J3.0 の probe — 自己申告は probe 不在 entry の fallback)。共有ファイルには書かない。
- agent の return は件数サマリのみ (`収集 {N} 件 / 失敗 {M} 件: [{key, reason}]` + fragment パス +
  warnings)。本文は返さない。

### J3 受入検査 (batch ごと・main が return 直後に実行)

confluence 側 D3 受入検査と同じ趣旨 — agent の完了報告を受入の根拠にせず、return 直後に main が
機械検査する (形式逸脱は J4.5 の本文忠実度検査では検出できないため):

1. **fragment 実在**: `.batch{N}-issues.json` がディスクに存在し、JSON として parse できる。
2. **件数整合**: fragment の `issues[]` 件数 == batch の target 数 − return が報告した失敗数 − 未着手数
   (未着手 = context 予算超過による正常中断 — 不合格ではなく、完了分が揃っていれば合格とし
   未着手分を新 batch として再起動する)。
3. **ヘッダー形式**: fragment が列挙する全ファイルが規約ヘッダーを持つ:

   ```bash
   jq -r '.issues[].file' artifacts/{app_name}/ground-truth/.batch{N}-issues.json \
     | while read -r f; do
         grep -L '^\*\*Source\*\*: jira' "artifacts/{app_name}/ground-truth/$f"
       done   # 出力 = 形式逸脱ファイル (0 行が合格)
   ```

不合格が 1 件でもあれば当該 batch は**未完了**として扱い、同じ agent に是正を依頼して
再検査を通してから先へ進む。

## J4: 取得失敗の扱い

- 取得エラー (権限 / 404 等) はリトライ 1 回 → なお失敗なら**無言スキップせず** failed リストに記録する。
- main が `artifacts/{app_name}/ground-truth/.collection-failed.json` へ集約する — confluence sub-module と
  共用ファイルのため `Read or [] → append → Write back` で merge し、課題キーは `page_id` field に入れる
  (index の表示列を再利用): `[{"page_id": "{KEY}", "title": "{summary}", "reason": "..."}]`。

## J4.5: 転写忠実度の機械検査 (必須・backstop)

confluence 側 D4.5 と共通の検査を main が実行する (script・repair batch・ループブレーカー・
削除禁止の規約も D4.5 と同一 — 検査は confluence / jira の fragment を同一 run で合流して見る):

```bash
node scripts/check-ground-truth-fidelity.mjs {app_name}
```

⚠️ jira アーカイブの `[添付: {ファイル名}]` は正規の転写表記であり、検査の要約マーカーには
該当しない (script のどの検査語彙にも一致しない形)。

## J5: index 再生成 (決定論 — 手書き禁止)

全 batch 完了後、main が実行する (Step 01 A2 と同じ):

```bash
node scripts/build-ground-truth-index.mjs {app_name}
```

台帳は既定パス `artifacts/{app_name}/ground-truth/.collection-failed.json` を script が自動で読む
(`--failed` は別パスに置いた場合のみ)。

- `**Source**:` ヘッダーにより jira 由来として一覧される。content status 判定 (本文 / 薄い / 殻 等) は
  文書と共通で、下流の引用可否判断も同じ規則に従う。

## Output

- `artifacts/{app_name}/ground-truth/jira-{KEY}.md` — 課題 1 件につき 1 本
- `ground-truth/index.md` は J5 の script 再実行で更新される (本 sub-module は直接書かない)
