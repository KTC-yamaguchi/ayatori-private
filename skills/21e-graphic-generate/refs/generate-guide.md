# 21e 生成ガイド (モデルルーティング・サイズ調整・リトライ・degrade テンプレート)

`skills/21e-graphic-generate/SKILL.md` の Step 3〜4 (失敗時) と、生成契約の背景説明のための
参照資料。routing / 分岐判断は SKILL.md 側、決定的処理は `scripts/` 側の責務であり、本書は
**契約の中身 (何がどう決まるか) と degrade 対話の文面** だけを定義する。数値・アルゴリズムの
実装 SoT は `scripts/preflight.mjs` (planGeneration / sourceDigestOf) — 本書と食い違ったら
script 側が正。

## §1 生成契約 (プロンプト・パラメタ)

- **prompt**: `graphic-prompts.json` の確定 prompt を**逐語**使用し、末尾に固定 tail
  (`No embedded text, no readable letters, no real brand likeness.`) を機械付加する
  (21d guide §1 の分担 — 21d は tail を書かない契約。二重指定しない)。tail は digest 対象外
  (tail の改訂が全 slot 再課金にならないため)。
- **size**: 確定 `size_px` から §2 のアルゴリズムで生成キャンバスを計画し、API の `size`
  パラメタに渡す。プロンプトにサイズ・解像度の文言は入れない (21d guide §2 の契約)。
- **output_format**: `png` 固定 — `graphics/raw/` の中間物契約 (設計 §7)。圧縮 (ユーザーフロー ⑫)
  は非搭載 (I-4 Skip + POCTEAMA-189 実装レビュー時のユーザー判断でスコープ除外) のため、
  21f も raw を無加工で PNG のまま正典化する。
- **n**: 1 固定。quality パラメタは指定しない (API 既定に委ねる — コスト knob が必要に
  なったら env ではなく pipeline.yaml 側で設計する)。

## §2 サイズ自動調整 (ユーザーフロー ⑩)

**不変量: `graphics/raw/{graphic_id}.png` は必ず確定 size_px ちょうどの寸法で置かれる。**
これにより「小さい箇所に巨大グラフィックを載せない / 大きい箇所には十分なサイズで生成する」
の両方が機械保証され、下流 (21g の `<img width height>`、C-26) は raw の実寸をそのまま使える。

生成キャンバスの計画 (`planGeneration`、非透過 slot):

1. **アスペクト比 clamp**: API 許容域 1:3〜3:1 の外なら域内に丸め、中心 crop で吸収する
   (端の内容が失われる — gather の warnings で事前報告される)。
2. **supersample**: 短辺 256px 未満の小さい slot は整数倍 (上限 4x) で大きく生成して縮小する
   (極小キャンバス直接生成のディテール崩れを避ける)。
3. **最小ピクセルバジェット floor**: gpt-image-2 は小さすぎる解像度を 400
   (`below the current minimum pixel budget`) で拒否する — 実測境界は script 内コメント参照。
   実測受理済みの最小面積 (約 0.72MP) まで比率維持で拡大し、拒否される要求を最初から出さない
   (閾値が変動した場合は §3 のサイズ fallback が拾う)。
4. **長辺 cap 1536px**: 生成キャンバスの長辺は 1536 まで (API の公開上限が不明のため既知の
   動作域に抑える)。超過分は crop 後の拡大で吸収 (warnings 併記)。
5. **16 の倍数へ切り上げ** (API 制約)。

生成後、寸法が size_px と一致しなければ **中心 crop (アスペクト比合わせ) → 面積平均縮小**
(`png-resize.mjs`、alpha 前乗算 — 透過縁の halo 防止) で size_px ちょうどに合わせる。
一致していれば API 出力バイトを無加工で置く (再圧縮劣化なし)。

用途別の目安 (21d が size_px を確定する際の size_role 早見表と生成キャンバスの対応例):

| 用途 (size_role) | 確定 size_px の例 | 生成キャンバス | ローカル調整 |
|---|---|---|---|
| hero (2:1 大) | 1216×608 | 1216×608 | なし (無加工) |
| hero (2:1) | 800×400 / 1200×600 | 1200×608 / 1216×608 (floor/丸め) | 中心 crop + 縮小 |
| content (カード内) | 320×200 | 1088×672 (supersample + floor) | 縮小 |
| small (ワンポイント/ボトムメニュー相当) | 64×64〜100×100 | 848×848 前後 (floor) | 縮小 |

## §3 モデルルーティングとリトライ

| slot | モデル | パラメタ | サイズ |
|---|---|---|---|
| `transparent_background: false` (既定) | `graphic-prompts.json` の `tool` (既定 gpt-image-2) | — | 任意解像度 (§2) |
| `transparent_background: true` | 透過対応モデル (既定 gpt-image-1.5) | `background: transparent` | 固定サイズ族 (1024×1024 / 1536×1024 / 1024×1536) から最近アスペクトを選び、crop + 縮小で size_px へ |

透過 slot を分岐する理由: gpt-image-2 は `background: transparent` 非サポート (指定するとエラー)。
既定値の SoT は `pipeline.yaml` `screens.graphic_generation.tool` / `tool_transparent`。

**リトライ規約** (`generate-graphics.mjs`):

- 再試行するのは **429 / 408 / 5xx / ネットワーク / タイムアウトのみ** (既定: 5s → 15s backoff で
  計 3 試行)。その他の 4xx はプロンプト・パラメタ起因で再試行しても直らないため即失敗にする。
- サイズ起因の 400 のみ、固定サイズ族への fallback を 1 回だけ試す (任意解像度がモデル側で
  拒否された場合の保険)。
- 失敗しても**成功済み slot の記録は残る** — リトライ (再実行) は pending 差集合により失敗分だけを
  再生成する (設計 §9-2b。全 slot 一括再生成の禁止)。

**コンテンツポリシー起因の失敗** (4xx で moderation / safety 系の message): リトライで直らない。
選択肢は「当該 slot を除外」または「ブロック中止」— プロンプト自体の改訂は 21d 確定済みのため
本 step では受けられない (21g 差し戻しのプロンプト起因 routing [設計 §9-2b] は 21g 到達後の経路。
生成前に改訂したい場合は設計 §5 の手動リセット運用による)。その旨を user に提示してから選ばせる。

## §4 degrade 対話テンプレート

### 生成失敗時 (`E_GENERATION_FAILED` — 設計 §8-4 generation_failure)

失敗一覧 (graphic_id / 試行回数 / エラー要旨) をチャットで提示してから、AskUserQuestion を出す。
`header` は 12 文字以内厳守:

```
header: "生成失敗対応"

question: |
  {failed_count} 件の slot の生成に失敗しました ({succeeded_count} 件は成功済み・再利用されます)。
  どう進めますか? エラー内容: {失敗一覧の要旨}

options:
  - label: "リトライ"
    description: "失敗した slot だけ再生成を試みる (成功分は課金されない)"
  - label: "失敗 slot を除外"
    description: "失敗した slot をグラフィックなしで確定し、残りで先へ進む (除外理由が記録される)"
  - label: "ブロック中止"
    description: "グラフィック生成ブロック全体を中止する (decision=skip — 生成済み分も埋め込まれない)"
  - label: "保留"
    description: "何も記録せず終了する。次回セッションで失敗分から自動再開する"
```

- 「失敗 slot を除外」を選んだ場合は、除外対象 slot ごとに理由を確認して `commit-degrade.mjs
  exclude` を実行する (reason 必須 — 無言の除外は禁止、Operating Principle 4)。
- エラーがコンテンツポリシー起因 (§3) の場合は「リトライ」で直らないことを question 文中で明示する。
- エラーが `API 401` / `API 403` (認証失敗) の場合は **キーの問題であって生成の問題ではない** —
  「リトライ」を推奨せず、先に `node scripts/setup-image-key.mjs --doctor` を実行して実効ソースを
  確認する (キーをローテーションしたのに env 側の旧キーが優先されている、というのが典型。
  キー未設定の `E_NO_API_KEY` ではこの症状は出ない — POCTEAMA-408)。実効ソースを直した後に
  「リトライ」で失敗分だけ再生成する。

### API キー未設定時 (`E_NO_API_KEY`)

キーの取得先 (チーム共有のサービスアカウント `ayatori-openai` — 取得先はチーム内で共有して
おり、不明な場合はチームに確認) と設定方法 (`docs/setup.md`「グラフィック生成 API キー」: 推奨はキーファイル
`~/.ayatori/image-api-key` — `node scripts/setup-image-key.mjs` で作成し、開いたファイルに
キーを 1 行貼り付けて保存。**再起動不要**。**repo 管理下のファイルにキーを書かない**) を
チャットで案内してから、AskUserQuestion を出す:

```
header: "APIキー未設定"

question: |
  グラフィック生成 API のキーが未設定です (env AYATORI_IMAGE_API_KEY /
  ~/.ayatori/image-api-key / env OPENAI_API_KEY のいずれにも無し)。どう進めますか?

options:
  - label: "その場で設定する (推奨)"
    description: "node scripts/setup-image-key.mjs でキーファイルを作成して開くので、キーを貼り付けて保存後に「設定した」と返信する。再起動不要で Step 1 (gather) から再実行できる"
  - label: "設定したので続行"
    description: "自分でキー設定済み。Step 1 (gather) から再実行する"
  - label: "ブロック中止"
    description: "グラフィック生成ブロック全体を中止する (decision=skip)"
  - label: "保留"
    description: "何も記録せず終了する。キー設定後の次回セッションで 21e から自動再開する"
```

- 「その場で設定する」が選ばれたら `node scripts/setup-image-key.mjs` を実行する (キーファイルを
  権限 600 で作成しエディタで開く)。**キーの値をチャットに貼らせない** — transcript にキーが
  残るのを避けるため、user 自身がエディタで貼り付ける (script はキー全量を出力しない設計)。
  user の「設定した」返信後、Step 1 から再実行する。
- 「設定したので続行」で `E_NO_API_KEY` が再発する場合は `node scripts/setup-image-key.mjs --doctor`
  を実行して実効ソースを確認する (キーファイル経路は再起動不要。~/.zshrc 等の env 経路は非対話
  shell から見えない / VSCode の env 固定により **VSCode 自体の再起動まで反映されない** —
  POCTEAMA-408。doctor が経路別に診断する)。

## §5 再利用・課金の注意 (user への提示に含める)

- 生成は低速・有料 (採用ツールは比較調査で選定 — 生成速度は代替候補の 2〜3 倍遅い)。
- 同一入力 (prompt + size_px + 透過 + tool) の再実行は digest 一致で**再生成されない**。
- プロンプトの部分改訂 (21g 差し戻し → 21d 再確定) 後は、改訂 slot だけが再生成される。
- `generated_files[]` が埋め込み対象集合の driver (設計 §9-2b) — raw/ のファイルを手で消しても
  state 上は fresh のままになるため、raw/ を直接操作しない (再生成は正規経路で)。
