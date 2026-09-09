# 制約環境での AYATORI 運用（分業パターン）

**対象**: トークン予算に制約のある環境（取引先・顧客貸与アカウント・従量課金の検証環境等）で
AYATORI パイプラインを実行し、設計・判断は制約のない環境で行う場合の運用規約。

⚠️ **本文書はパイプライン仕様ではない** — Phase / Step / artifact の振る舞いを定義するものではなく、
「同じパイプラインを、予算制約のある環境でどう回すか」の運用手順である。パイプライン仕様の SoT は
`pipeline.yaml` と `phases/*/SKILL.md`。

---

## 1. 原則: 判断は潤沢な環境で、実行は制約環境で

制約環境のトークンを食うのは **パイプライン本番実行そのものではなく、その手前の探索と相談**である。
「どのモジュールを対象にすべきか」「この見積は妥当か」を制約環境の Claude に相談すると、
リポジトリ探索が始まって数十万トークン単位で消える。

したがって役割を分ける:

| | 潤沢な環境（社内アカウント等） | 制約環境（取引先等） |
|---|---|---|
| **担う** | 見積の解釈 / 対象・モジュール選定 / プロンプト設計 / エラーの原因切り分け / 本文書の更新 | 決定論スクリプトの実行 / `/ayatori-*` の本番実行 / 人間ゲートの応答 |
| **禁止** | — | **探索的な相談**（「どれを選ぶべき?」「この repo は何をしている?」）。結論を持ち込む |

往復はテキストの貼り付けで足りる。決定論スクリプトの出力は数十行のプレーンテキストなので、
制約環境 → 潤沢な環境へのコピペコストはほぼゼロ。

---

## 2. コスト構造: 支配項は shard 数

リバース系のコード読み取りは subagent (shard worker) の**起動固定費が支配的**で、
読む行数はほぼ効かない。`scripts/build-code-inventory.mjs:119-124`:

```js
// Fixed cost per worker launch, measured on a real run (43 shards / 773-file KMP repo):
// a 1-file 7k-char shard consumed ~100k tokens — the launch itself (system prompt,
// tool schemas, auto-attached project docs, tool-use echoes) dwarfs the content.
const EST_SHARD_OVERHEAD_TOKENS = 100_000;
```

見積式（同 `:43-46`）:

```
est_tokens ≈ shards × 100,000 + in-scope chars ÷ 3.5 × 1.2
```

**節約とは「読む量を減らす」ことではなく「shard 数を減らす」こと**。ここを取り違えると努力が空振りする。

shard の切り方（同 `:107-108`, `:565-582`）:

| 定数 | 値 | 意味 |
|---|---|---|
| `SHARD_CHAR_BUDGET` | 120,000 字 | 1 shard の文字数上限 |
| `SHARD_FILE_CAP` | 40 files | 1 shard のファイル数上限（サイズ非依存の tool-call 固定費の上限） |
| `GATE_FILE_LIMIT` / `GATE_CHAR_LIMIT` | 120 files / 400,000 字 | 両方以内なら予算ゲート自動通過 |

- **どちらかの上限に達するごとに shard が 1 増える** → 概算 `shards ≒ max(⌈字数÷120,000⌉, ⌈files÷40⌉)`（貪欲詰めなので実際はこれ以上になり得る）
- 120,000 字**かつ** 40 files 以内の小さい module は**相乗り shard に詰められる**ので、小 module が多くても shard は線形には増えない

⚠️ 上記 `~100k/shard` は同 `:121-123` の注記どおり **general-purpose worker で測った値**で、「専用の軽量 worker
に移行したら下方修正せよ」とされている。reverse Step 02 / verify Step V2 が使う `ayatori-code-analysis-worker`
は READ 専用でツール数が少ないため、実測は見積より安く出る可能性がある。**見積は上限の目安として読む**。

---

## 3. 手順: 実行前に「無料で」見積を取る

`scripts/build-code-inventory.mjs` は **LLM を一切呼ばない決定論スクリプト**（分類も shard 計画も機械的）。
`--stdout` は台帳ファイルを書かない preview モードなので、何も壊さず何度でも実行できる。

制約環境の Claude Code に**そのまま貼る**:

```
トークン見積だけ知りたいので、下の手順だけを実行して。それ以外は何もしないで。

1. `ls artifacts/` でプロジェクト名を確認する（複数あれば一覧を見せて私に選ばせて）
2. `ls artifacts/{プロジェクト名}/input-sources/` で {stack} フォルダ名を確認する
3. `node scripts/build-code-inventory.mjs {プロジェクト名} --stdout` を実行する
4. 出力から次の項目だけを、そのまま貼って教えて:
   - 「予想: ~N tokens ...」の行
   - 「予算ゲート: ...」の行
   - 「module 別 (in-scope):」以下の一覧
   - WARNING で始まる行（あれば全部）

やらないでほしいこと:
- /ayatori-reverse-verify や /ayatori-reverse を起動する
- input-sources/ の中のソースコードを読む
- ファイルを新規作成・書き換えする
```

**最後の「やらないでほしいこと」が本体**。これが無いと、見積を取る前に探索や phase 起動で浪費する。

出力を潤沢な環境に貼り、そちらで対象モジュールを選定する。

### 3.1 範囲を絞った再見積

選定したモジュールで実額を取り直す（同じく無料）:

```
node scripts/build-code-inventory.mjs {プロジェクト名} --modules {module1},{module2},{module3} --stdout
を実行して、「予想: ~N tokens」の行と「予算ゲート:」の行だけ教えて。
それ以外は何もしないで。ファイルも書き換えないで。
```

⚠️ `--modules` に存在しない module 名を渡すと exit 1 で有効な一覧が出る（typo で空の計画を作らない安全弁）。

---

## 4. 巨大モジュールに当たったときの唯一の逃げ道: `--tiers`

`--modules` でモジュールを選ぶと、**その中の in-scope ファイルは全部**入る。`--require-files` は
導出が名指ししたファイルを tier 判定に関わらず計画に**固定（pin）する**機能であり、削る機能ではない
（モジュール外のパスを渡すと hard error で exit 1 — module 集合は人間が承認したスコープ境界のため）。

数百ファイル規模の module（モノレポの API サービス、Flutter の `targets/*` 等）は単独で 8〜9 shard に
なるため、tier で絞る:

```
node scripts/build-code-inventory.mjs {プロジェクト名} --modules {...} --tiers api,state,model --stdout
```

tier は `entry / navigation / screen / state / model / api / config` の 7 種（既定は全部）。
挙動の突合なら `api,state,model` で足りることが多く、`config` / `entry` を落とすだけでも効く。

⚠️ **preview で `--tiers` を使ったら、承認後の確定コマンドにも同じ `--tiers` を渡す**
（`skills/reverse-verify/01-target-scope/SKILL.md` § 6 の警告）。省略すると既定 7 tier に戻り、
人間が承認した見積より実際に読む量が増える。人間ゲートで承認する際に「同じ tiers で確定して」と添える。

---

## 5. 人間ゲートで機械的に外していいモジュール

対象が何であれ、以下は要件の根拠になりにくいのに shard を食う。Step V1 の範囲ゲートで
**B. 範囲を修正する**を選んで外す（自由記述で「〜は範囲から外して」と書けばよい）:

- CI / リリース系: `.github`, `release-process`, `runbooks`
- インフラ定義: `infra`, `pulumi`, `cdk`（数百ファイルで 3 shard 級になりやすい）
- 運用スクリプト: `scripts/*`, `tools/*`（`tools/app_store_connect` 等）
- バックアップ / 生成物: `backup`, `restore-backup`
- リポジトリ内文書: `docs`（`ground-truth/` に収集済みの文書とは別物）

対象を絞る**前**にこれだけで数 shard（数十万トークン）落ちることがある。

---

## 6. セッション運用

- **1 セッション = 1 run**。Phase 0c Completion の「別の対象で続ける」は選ばず、次の対象は新しい
  セッションで始める。会話履歴は毎ターン再送されるため、2 本目以降は 1 本目の履歴を払い続けることになる。
  run 単位の state は `pipeline-state.json.reverse_verify.runs[]` に残るのでセッションを分けても続く。
- **中断したら「続ける」を選ぶ**。Phase 0c の resume ladder は範囲ゲートで中断した run を
  「範囲ゲートのみ再提示」で再開する（grep も preview もやり直さない）。「破棄して別の対象」を選ぶと
  導出が全部やり直しになる。

---

## 7. ソースツリー配置の注意（固定費に直接効く）

`input-sources/{stack}/` に置くツリーの中身が worker 起動固定費を押し上げることがある:

- **大型 `CLAUDE.md` を置かない** — `scripts/build-code-inventory.mjs:126` の `AUTO_ATTACH_WARN_CHARS = 20_000`
  を超える in-tree `CLAUDE.md` は **worker 起動ごとに自動添付される**。script が WARNING を出すので、
  出たら `CLAUDE.md.bak` にリネームして退避する（shard 20 個なら 20 回分の差になる）。
- **`{stack}/` を 1 段挟む** — `input-sources/` 直下にファイルを置くとどの stack にも属さず解析対象外になる
  （script が WARNING を出す）。`.DS_Store` 等の混入は無害だが、リポジトリを直置きした場合は
  build manifest が直下に来るため配置ミスのシグナルになる。
- **`git clone` で持ち込む** — パイプラインは repo URL からコードを取得しない（Operating Principle 1）。
  配置はユーザー作業。

---

## 8. 権限の事前宣言を確認する

Operating Principle 2 のとおり、subagent は main session の permission を継承せず、
`.claude/settings.json` の `permissions.allow` で事前宣言する設計になっている。制約環境のクローンに
この設定が無いと、shard worker 起動ごとに permission prompt が出て
**sandbox 拒否で sequential 実行が中断する**（＝そこまでに払ったトークンが無駄になる）。

本番実行の前に確認する:

```
.claude/settings.json はこのリポジトリに存在する？ git で管理されている？ 確認だけして。
```

---

## 関連

- `docs/context-profiler.md` — 実行**後**に「どの message が context を食ったか」を可視化する補助ツール
  （本文書は実行**前**の予算設計。役割が逆）
- `skills/reverse-verify/01-target-scope/SKILL.md` — Step V1 の範囲導出と `--modules` / `--tiers` /
  `--require-files` の正確な契約
- `scripts/build-code-inventory.mjs` — 分類 tier / shard 計画 / 予算ゲート閾値の SoT（定数がすべて冒頭にある）
