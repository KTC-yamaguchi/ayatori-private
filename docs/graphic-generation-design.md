# グラフィック生成ブロック — パイプライン挿入位置設計

> **本ドキュメントの位置づけ**: 「グラフィック生成」エピックの実装ゲートとなる設計書。
> 挿入位置・Step 番号・前後依存・skip 動線・artifact 責務マップ・schema 一覧・`pipeline.yaml` 変更案を確定する。
> 本設計の成果物は **本文書 + 新規 schema 2 件** (`schemas/graphic-plan.schema.json` /
> `schemas/graphic-prompts.schema.json`)。schema は writer skill が存在するまで何からも参照されない
> inert なファイルのため、設計時点で先行投入しても既存パイプラインに影響しない
> (実装チケット F-2/F-4 はこれを消費するのみ)。
> 一方 **`pipeline.yaml` / skills 実体には本設計では手を入れない** — steps list に実体のない
> skill ディレクトリを載せると `/ayatori-screens` が全プロジェクトで即死するため、§8 の変更案は
> **最初の実装チケット (F-2A) が skill 実体と同時に本書から転記して適用**する
> (適用されるまで §8 が変更案の SoT)。
>
> **✅ F-2A 適用済み** §8 (pipeline.yaml 全項) / §9-1 (resume cascade、`phases/screens/SKILL.md`) / §9-3 (Step 15 2nd run・Step 22 の入口 assert) / §10 の既存 schema 追記 (F-2 と分担) / Step 01 Axis 7 質問 (7-g) / CLAUDE.md・`docs/html-generation-rules.md` §10 の転記は適用済み。**以後の SoT は pipeline.yaml / 各 skill 実体側** (本書は設計根拠のアーカイブとして参照される)。21c は F-3、21d は F-4、21e は F-5、21f は F-6、21g は (F-7、Step 29 再埋め込み + per-slot 却下採用を含む) で実装済み — 21e は I-3 の調査結果を反映し、§0 の「gpt-image-2 一本」前提を **per-slot モデルルーティング** (透過 slot のみ gpt-image-1.5 系 + `background: transparent`、pipeline.yaml `graphic_generation.tool_transparent`) に更新した。21f は I-3 の結論 (透過は生成段階で作る) により透過を「後処理」でなく **alpha 検証**として実装した。圧縮 (⑫、§0 I-4 の WebP 化) は **非搭載** — I-4 Skip に加え、F-6 実装レビュー時のユーザー判断 (2026-08-05) でスコープから除外し、21f は raw PNG を無加工で正典化する (再起票の受け皿は §11)。F-8 (Figma 書き出し) も完了 — §1-2/§8-8 の予定どおりキャプチャ経路無変更のまま、21g 承認済み fixture の実機 E2E (figma-capture-runner 経由 Step 22 フル手順) で「相対参照 `<img>` → バイト同一 IMAGE fill (imageHash = sha1 一致) / alt = レイヤ名 / 却下 slot 非出力 / graphics gate 通過」を確認し、制約マトリクスを `skills/22-figma-export/SKILL.md` の「グラフィック入り HTML の書き出し」節へ転記した (Step 24 Variables 非関与 [§6] / Step 25 SOLID-only バインドで IMAGE fill 素通り、の後工程整合込み)。
>
> 用語は本エピックの用語整理に従う: 「グラフィック」= AI 生成するイラスト・キャラクター・写真
> (ラスター画像)。「アイコン / ピクトグラム」= 既存の組み込み済み inline SVG 系統。

## 0. 設計インプット (事前調査の確定事項)

status 列は**本設計を確定した時点のスナップショット** (最新の進捗は各 Jira チケットを参照)。

| 調査 (status: 設計時点) | 結論 (本設計が依拠する事実) |
|---|---|
| I-1 (Figma 書き出し) **Done** | `<img src alt>` で HTML に埋め込めば、**現行 Step 22 の HTML キャプチャ経路のまま** バイト同一の image fill として Figma に書き出せる (実機検証済 — **Base64 / 相対ファイル参照 / 外部 URL の 3 形式すべて同一 imageHash で完全動作**。調査の推奨第一候補は Base64 だったが、本設計は LLM context コストを理由に相対参照を採用 — 3 形式とも実測済のため設計側で選択可能、§7)。`use_figma` の `createImage` は不採用。ラスターのみ (PNG/JPEG/GIF/WebP、SVG 不可)。`alt` が Figma レイヤ名になるため必須。`object-fit: cover→FILL / contain→FIT` |
| I-2 (生成ツール) **Done** | **gpt-image-2 採用** (サイズ・比率の正確さ、文字/実在ブランド混入の少なさで NanoBanana に勝る。生成速度は 2〜3 倍遅い) |
| I-3 (透過) 設計時点で調査中 | 透過 PNG の alpha 保持は未実測。**21f の透過仕様は透過調査の結論待ち** (本設計は挿入位置に影響しない前提で 21f を独立 step として確保) |
| I-4 (圧縮) **Skip** | 圧縮調査は skip 判断。21f は当面「透過 (+ 可能ならフォーマット変換)」のみ。アセットのファイルサイズは生成時の size_px 指定 (21d/21e) + WebP 化 (21f) で上流から統制する。**WebP 化の Operating Principle 1 準拠経路は 3 段**: ① 21e が生成 API の出力フォーマット指定で直接 WebP を得る (変換自体を不要化、第一候補) → ② repo に lock する純 JS encoder (`package.json` pin — style-dictionary と同じ npm 例外形態) → ③ いずれも不可なら **PNG のまま正典化する合法 degrade** (C-26 / schema / 正典命名は `png\|webp` 両許容)。外部 CLI (cwebp / imagemagick / sips) は経路に含めない。どの段を採るかの確定は F-6 (§11) |
| I-5 (必要性分析) **Done** | 実現可能。ピクトグラム抽出は SVG 形状署名照合で決定的に解ける。恒久フォールバック不要、runtime degrade (fail-open + F-2 疎結合) を仕様化。**F-1 への引き継ぎ論点「sub-state は 21↔22 時点で存在しない」→ §4 で回答** |

## 1. 結論サマリ

1. **挿入位置**: Phase 3 (`/ayatori-screens`) 内の **サブレター step ブロック `21a`〜`21g`**。
   実行順は **Step 21 承認 (screens_human_approved) → 21a〜21g → Step 15 再実行 (2nd Confluence save) → Step 22**。
   新 Phase / 新 slash command は作らない (§2 で棄却理由)。
2. **Step 22 (Figma export) のキャプチャ経路は無変更**。skill 側は入口の layer-1 assert 1 行のみ
   追加する (§9-3、F-2A が pipeline.yaml 変更案と同時に適用 — Step 15 の 2nd run 入口にも同じ assert)。
   F-8 の実装内容は「21g 承認済み HTML が既存キャプチャ経路でそのまま書き出されることの確認 + 制約ドキュメント化」。
3. **上流方針フィールドは新設** `design_output_scope.graphic_generation: ask | skip` (default `ask`)。既存 `illustration_policy` は**拡張しない** (§5)。
4. **skip 動線は 2 段 + 途中離脱 2 経路**: 上流 `skip` → ブロック丸ごと不実行 (skip 記録の writer は
   phase orchestrator、§9-1) / 21b で「不要」→ 21c〜21g を skip。途中離脱は 21d 全 slot 中止 /
   21e 生成失敗のブロック中止 (§8-4)。いずれも `screens.graphics.decision = "skip"` を記録して
   Step 15/22 へ素通し。
5. **sub-state (25a〜25e) との関係**: v1 は **main (default) HTML のみ対象**。25b の `inherit_main` 継承により、埋め込み済みグラフィックは sub-state HTML に自動継承される。25b 後の再分析は行わない (§4)。
6. **デザインシステム (12/24) への色取り込みは v1 では行わない**。逆方向 (tokens → グラフィック) のみ: テイスト選定・プロンプト生成が design-brief.yaml / tokens.json を入力参照して調和を担保 (§6)。
7. **グラフィック正典は `screens/_shared/graphics/`** (第 4 の正典系統)。HTML からは正典への**相対参照** `<img src>` で埋め込む — Base64 インラインは不採用 (逐語インライン規約の再評価と LLM context 保護、§7)。人間閲覧専用の派生レビュービュー (21a/21c/21g) のみ例外として render 時にファイル byte を data URI 内包する (SoT はファイル側・byte 一致の表示用複製 — §7「派生レビュービューの自己完結」)。

## 2. Step 番号体系 — `21a`〜`21g` を採用

エピック整理ページの論点①「22 の前に入れると番号が破綻する → 21.5 系サブ番号か Phase 追加か」への回答。

**採用: 親番号 21 + 小文字レターのサブ step 群** (`21a-graphic-recommend` 〜 `21g-graphic-embed-review`)。

- 本 repo の確立済み規約: レター付き step = 「step N の直後に挿入されたブロック」(`01b`, `25a`〜`25e`, `27b`, `29b`)。`25a-25e` が「25 (component build) の一部」ではなく独立した後付けブロックであるのと同型。(reverse 系はレター付きでなく `skills/reverse/` グループ内の連番 01〜06。)
- steps list は数値順ではなく**列挙順が実行順** (現に `16` が `15` より先に並ぶ、`pipeline.yaml:158-160`)。番号の再割当・小数番号は一切不要。
- skill ディレクトリ命名規約 (`{number}[letter]-{kebab-name}` / 大文字 `SKILL.md`) にそのまま適合。

**棄却案**:

| 案 | 棄却理由 |
|---|---|
| 新 Phase + 新 slash command (例 `/ayatori-graphics`) | `phase_order` / `command_policy.allowed_commands` / 完走前 Entry Guard / CLAUDE.md 表の全面追加が必要になる上、ユーザーに「21 承認後に別コマンドを打ち、終わったらまた `/ayatori-screens` に戻る」という往復を強いる。グラフィックは screens 成果物 (HTML) の加工であり、Phase 間通信 (JSON/MD) で切る必然性がない。既存の session split (S-01: Step 21 承認でセッション終了 → 再開セッションが 22 以降を実行) が「重い後半を別セッションで」という新 Phase 化の実益を既に提供している |
| 22 以降の番号繰り下げ | skills ディレクトリ名 / pipeline.yaml / schemas (`step22_figma_status` 等) / hooks / 全ドキュメントの横断 rename。回帰リスクに見合う利益なし |
| `21.5` 等の小数番号 | repo に前例なし。ディレクトリ名の sort 順も崩れる |

**7 step の内訳と実装単位の対応** (エピック フロー番号 ②'〜⑮):

| Step | skill 名 | エピック番号 | 実装単位 | Input → Output |
|---|---|---|---|---|
| 21a | `21a-graphic-recommend` | ②' 必要性分析 | F-2A | `screens/{web,web-sm,mobile}/*.html` + `requirements.json` (カテゴリ) + `illustration_policy` → `graphics/graphic-recommend.md` |
| 21b | `21b-graphic-hearing` | ③④ 要否・箇所 | F-2 | recommend.md → **人間ゲート** → `graphics/graphic-plan.json` or skip 記録 |
| 21c | `21c-graphic-taste` | ⑤⑥ テイスト 2 段階 | F-3 | plan.json + tokens.json → **人間ゲート** (言葉選択 → sample A/B/C) → plan.json `taste` セクション + `graphics/samples/` |
| 21d | `21d-graphic-prompts` | ⑦⑧ プロンプト確定 | F-4 | plan.json → **人間ゲート** (FB 反映) → `graphics/graphic-prompts.json` |
| 21e | `21e-graphic-generate` | ⑨⑩ 生成 + サイズ | F-5 | prompts.json → gpt-image-2 → `graphics/raw/{graphic_id}.png` |
| 21f | `21f-graphic-postprocess` | ⑪⑫ 透過 + 圧縮 | F-6 | raw/*.png → `screens/_shared/graphics/{graphic_id}.{png\|webp}` (正典) |
| 21g | `21g-graphic-embed-review` | ⑬⑭ 埋め込み + 承認 | F-7 | 正典 → `<img>` 相対参照埋め込み → screens HTML 更新 + screens/*.md 追記 → **人間ゲート** |
| (22) | `22-figma-export` **キャプチャ経路無変更** (入口 assert のみ追加、§9-3) | ⑮ Figma | F-8 | 承認済み HTML → Figma (既存キャプチャ経路) |

## 3. 前後依存とセッション内実行順

```
Step 20 loop 終了
  → Step 21 (人間ゲート: main HTML 承認)          … approvals.screens_human_approved = true
  → ★ Session Split Point S-01 (セッション終了)
──────────────────────────────────────────────────
再開セッション (/ayatori-screens 再実行):
  → [21a〜21g グラフィック生成ブロック]            … 本設計の挿入点
  → Step 15 再実行 (2nd Confluence save)           … post_loop_reexecute (既存)
  → Step 22 (Figma export)                         … キャプチャ経路無変更 (入口 assert のみ、§9-3)
  → Step 23 (final approval) → 24 → 25 → 25a〜25e
```

**なぜ Step 15 (2nd save) より前か**: 21g は screens HTML を書き換え、対応する画面仕様書
`screens/{screen}.md` に「使用グラフィック」節を追記する (§7)。2nd Confluence save が
グラフィック反映**後**の仕様書を上げるため、ブロックは 15 再実行より前で完結させる。
逆順にすると Confluence 上の仕様と HTML が乖離し、3 回目の save が必要になる。

**なぜ Step 21 承認より後か** (= 17 直後ではない理由): 21a の必要性分析 (I-5) は「完成し人間承認された
main HTML」を入力とする設計。review loop (17↔20) の途中で生成すると、loop の再生成 (17 は全画面を
書き直す) で埋め込みが消え、生成コスト (gpt-image-2 は低速・有料) が loop 回数分無駄になる。
HTML が確定してから 1 回だけ生成する。

**依存の要点**:

- **21a←21 依存**: `screens_human_approved == true` が 21a の起動前提 (Phase 0 assert)。
- **21g→15→22 依存**: 15 (2nd run) の save 対象仕様書 / 22 のキャプチャ対象 HTML は「21g 承認済み
  (`approvals.graphics_human_approved == true`) or graphics skip 確定 (`decision == "skip"`)」でなければならない。
  再起動経路は resume cascade (§9) で `graphics 未解決 → 21a` 判定を Step 15/22 判定より**上流**に
  置くことで保証し、連続セッション内のドリフトは Step 15 (2nd run) / Step 22 両入口の layer-1 assert
  (§9-3、条件は上記の肯定形そのもの) で塞ぐ。
- **25a〜25e との順序** (エピック論点②): 21a〜21g は main HTML のみ対象。25b は `inherit_main`
  で main HTML の `<head>/<style>/<body>` を継承するため、**main に埋め込まれた
  `<img>` 相対参照タグは sub-state HTML にそのまま自動継承される** (タグは数十 byte のテキスト
  であり、25b の Read/Write 契約への追加実装・token 統制とも不要 — §7 の相対参照採用が効く点)。
- **delta (27〜30) との関係**: Step 29 (partial-screen-regen) が対象画面を再生成する際、
  `graphics/graphic-plan.json` の slot 対応 (screen → graphic_id) と正典 `screens/_shared/graphics/`
  から再埋め込みする必要がある。前提ゲートと対象集合は **§9-2b の 21g/29 共通契約**に従う —
  `decision == "generate" AND graphics_human_approved == true` のときのみ実行し、復元 driver は
  `generated_files[]` (− `excluded_slots[]`)、plan は配置メタ参照 (ファイルの存在は有効シグナルではない)。**29 の再埋め込みは F-7 の実装スコープに含めて確定する**
  (§11)。「推奨」止まりにしない理由: §8-6 / §8-7 は 29 を plan/正典の reader・C-26 適用対象として
  **先に登録する** (F-2A が適用) ため、実装が無いまま放置すると要件 delta がグラフィック入り画面を
  再生成した際に承認済み (有料生成済み) のグラフィックが黙って脱落する — 色 lint は `<img>` を対象と
  せず src↔正典の存在照合も 21g 内にしか無いため、**検出機構が存在しない**。

## 4. sub-state (25a〜25e) との関係 — I-5 引き継ぎ論点への回答

I-5 の引き継ぎ: 「空状態・エラー状態は 25a〜25e で後追い生成されるため ②' 時点では存在しない。
デフォルト状態のみで割り切るか、25b 後に再分析を挟むか」。

**回答: v1 はデフォルト状態のみで割り切る。25b 後の再分析は行わない。**

- 25a〜25e は `final_approved` (Step 23) 後の**任意**ブロック。25b 後に 21a 相当の再分析 + 生成ループを
  挟むと、`state_pattern_loop` (25c→25b) とグラフィック生成の人間ゲート群が絡み、順序強制
  (`enforce-substate-scoring.sh` の territory 設計) を作り直すことになる。コストに対し、
  empty/error 状態の中心ビジュアルは現行規約 (`docs/html-generation-rules.md` §2: 単一アイコン拡大 /
  placeholder / 絵文字) で既に成立しており、v1 で必須ではない。
- 将来拡張点として `graphic-plan.json` の slot に `state` フィールドを持たせ、v1 は `"default"` 固定とする。
  sub-state 専用グラフィック (例: empty 状態のイラスト) は後続チケットで 25b が
  `state != "default"` の slot を消費する形で拡張できる (25b の Input 契約は inherit_main 切替で
  extension point として固定維持されている)。

## 5. 上流方針との接続 — `illustration_policy` は拡張せず新フィールド

エピック論点③/③-a への回答。**案 (b) 新フィールドを採用**:

```yaml
# requirements.json.design_output_scope / pipeline.yaml default_design_output_scope
graphic_generation: ask   # ask | skip
```

- `ask` (default): 21a 分析を実行し、21b でユーザーが要否を最終判断する。
- `skip`: ブロック全体 (21a 含む) を不実行。**phase orchestrator がグラフィックブロック入口
  (Step 21 承認後の 21a 位置) に到達した時点で** — resume cascade 経由 (§9-1) と連続 1 セッションの
  オーケストレータ進行の**両経路とも** — `pipeline-state.json.screens.graphics.decision = "skip"` +
  `decided_by: "upstream_scope"` を**一度だけ記録**して Step 15/22 へ (21a〜21g は 1 つも走らない
  ため、この記録の writer は 21x step ではなく orchestrator — §7 表 / §9-1 に明記。単一所有権を
  writer 未指定のまま放置しない)。writer を cascade 到達時に**限定しない**のは、連続セッション
  (S-01 非分割 — §9-3 自身が想定する脅威モデル) では cascade が発火せず、decision 未記録のまま
  §9-3 の Step 15 入口 assert に掛かって上流 skip プロジェクトが不当に中断されるため (PR #156 レビュー指摘)。

**`illustration_policy` に第 4 値 (`ai_graphic` 等) を追加しない理由**:

1. **軸が違う**: `illustration_policy` (pictogram | illustration_character | emoji_casual) は
   「Step 17 がアイコン・イラスト表現を**どう描画するか**」の規約 (SoT: `docs/html-generation-rules.md` §2 の
   適用マトリクス)。グラフィック生成は「確定した画面に AI 生成ラスター画像を**追加するか**」であり、
   両者は直交する (例: pictogram 方針のヘルスケアアプリにヒーローイラストを 1 枚だけ足す、は正当な組合せ)。
   第 4 値にすると Step 17 のアイコン描画分岐 (Step 0 icon gate) が新値で未定義になり §2 マトリクスが壊れる。
2. **決定タイミングが違う**: `illustration_policy` は Phase 1a (Q7) で決まり Step 09/17 が消費する。
   グラフィック要否の最終判断は「画面が無いと判断できない」ため 21b (画面確定後) に置く。
   1 フィールドに混ぜると (A) CONFIRMED の値が後段で書き換わる形になり、Artifact 責務分離
   (INPUT の requirements.json は Phase 5 delta 以外で変更しない) に反する。

**両者の連携** (I-5 の仕様通り): 21a は `illustration_policy` を入力参照し、推奨レポートに整合チェックを
含める (例: `emoji_casual` 方針 → グラフィック期待度を下げる / `illustration_character` 方針 →
既存 `illust-placeholder` ブロックが自然な埋め込み slot 候補になる)。

**Phase 1a への影響**: Step 01 (7 軸ヒアリング) の Axis 7 (design output scope) に
`graphic_generation` の質問を 1 項目追加 (default `ask`、初心者はそのまま Enter)。
既存プロジェクト (フィールド欠落) は `default_design_output_scope.graphic_generation: ask` に fallback —
つまり**後方互換は「聞く」側に倒す** (勝手に skip しない。Operating Principle 4: 補完せず質問する)。

**2 つの決定地点の関係** (エピック論点③本文への回答):

| 決定地点 | 何を決めるか | 効果 |
|---|---|---|
| Phase 1a Axis 7 (`graphic_generation`) | 「そもそもこのプロジェクトでグラフィック生成の検討をするか」 | `skip` ならブロック全体不実行 (21a の分析コストもかけない) |
| 21b 人間ゲート | 「(推奨レポートを見て) 実際に生成するか、どこに入れるか」 | 確定判断。`ask` 経路でも「不要」なら 21c〜21g skip |

上流 `ask` + 21b「不要」で skip した後の再入は設けない (v1)。25a の再入 AskUserQuestion 前例と異なり、
graphics skip は phase 完了の dead-end ではなく本流続行のため、resume のたびに再質問すると
P4-07 (同一 target への過剰質問禁止) に抵触する。skip 後にやはり欲しくなった場合、
`final_approved` 前なら `pipeline-state.json.screens.graphics` を手動リセットして `/ayatori-screens`
再実行 (運用手順として本書に明記)。このとき 2nd Confluence save 済み (`confluence.design.save_count
== 2`) なら **`save_count` も 1 に戻す** — §9-1 の cascade ガード (`design_save_count < 2`) の再入
条件を満たし、かつ 21g 反映後の仕様書が Step 15 で再 save される (Confluence↔HTML 乖離を作らない)
ための対の操作。さらに **Step 22 実行済み** (`screens.step22_figma_status` set
[FIGMA_MCP_ENABLED=false の stub 記録] または figma-state.json に export 記録) の場合は
**その完了記録もリセットする** — Step 22 は Step 23 final approval より前に完了し得るため
「22 済み・final_approved 前」の窓は正規に存在し、戻さないと再実行 cascade が Step 22 を完了扱いで
Step 23 へ跳び、21g 反映後の HTML が Figma へ再 export されないまま HTML↔Figma 乖離が固定される
(§3 が Confluence 側で禁じた乖離と同型)。リセットは **3 点セット** (① `screens.graphics` /
② `save_count` / ③ Step 22 完了記録 — ③ は該当時のみ)。`final_approved` 後は delta 領域 (§11 将来拡張)。

## 6. デザインシステム (12 / 24) への影響 — v1 は「色を取り込まない」

エピック設計観点「グラフィック由来の色をシステムに取り込むか」への回答: **取り込まない**。

- グラフィックはラスター `<img>` であり、色 lint (C-25) の対象外 — C-25 の rule 文
  (pipeline.yaml) が raster img の除外を明記済み。lint 実装上は `scripts/lint-screen-colors.mjs` の
  属性走査が**全タグ** (VOID_TAGS 含む) の色を運ぶ属性 (COLOR_ATTRS + `style`) を検査するが、
  C-26 形式の `<img src alt width height>` は色を運ぶ属性を 1 つも持たないため検出対象にならない
  (「`img` を VOID_TAGS として構造的に skip」ではない — VOID_TAGS はアイコン色解決の ancestor-stack
  構築 (L545) にのみ使われる)。なお `<img>` に `style="background:#..."` 等の色リテラルを書けば
  L1 違反として検出されるが、それは zero-literal の**正常動作** (placeholder 背景も `var(--token)`
  で書く) であり誤検出ではない。Figma 書き出し調査の TODO「色 lint がグラフィック画像を誤検出しないか」
  への回答: C-26 形式を守る限り誤検出しない。
  token 体系 (Primitives/Semantic/Component) は CSS 変数の世界であり、ラスター内部の色は関与しない。
- **逆方向の整合で調和を担保する**: 21c (テイスト選定) と 21d (プロンプト生成) が
  `design-brief.yaml` の palette / `tokens.json` の primitives を入力参照し、生成プロンプトに
  カラーパレットヒントを含める (DERIVED: 導出元併記)。これによりグラフィックがデザインシステム側に
  寄る形で一貫性を作る。
- Step 24 (design-system-update) / Step 12 は**無変更**。将来、グラフィック主要色の palette 昇格が
  必要になれば Step 24 A-2b (装飾色昇格キュー) の拡張として別途設計する (v1 対象外)。

## 7. artifact 責務マップ + `_shared` 整合

新設ファイルはプロセス系 (`graphics/`) と正典系 (`screens/_shared/graphics/`) に分離する
(記述/状態の分離、docs/artifact-file-responsibility.md 設計原則 1 に準拠)。

| ファイル | 役割 | 主な writer | 主な reader | スキーマ |
|---|---|---|---|---|
| `graphics/graphic-recommend.md` | 必要性推奨レポート (derived、I-5 の 5 部構成: 推奨 3 段階 / 根拠 / インベントリ / 候補スロット / ガードレール + §4 の slot-anchors コメント) | **21a のみ** | 21b (人間ゲート提示) | schema なし (固定見出し構造、`delta/feature-add-brief.md` と同型 — `feedback-log` は `schemas/feedback-log.schema.md` を持つため precedent ではない) |
| `graphics/graphic-recommend.html` | 候補スロット視覚レポート (**派生ビュー**、SoT = 上記 MD §4)。候補位置を画面プレビュー (iframe srcdoc) 上でハイライト — 2 ファイル構成 (MD=テキスト詳細 / HTML=見た目で判断)。候補 0 件 / render 失敗時は不在 (fail-open) | **21a のみ** (`render-recommend-html.mjs` 決定論生成・手焼き禁止) | 21b (人間ゲートで auto-open) | — (派生ビュー) |
| `graphics/graphic-plan.json` | グラフィック slot 計画 (**loop 不変量**): slot 一覧 (graphic_id / screen / platform / 位置 / サイズ用途 / `state`="default" 固定) + taste 確定値 | **21b** (init + slots)。21c は `taste` キーのみ append (**key 分離**、coverage-check の 21 前例と同型) | 21d / 21e / 21g / 29 (delta 再埋め込み) | `schemas/graphic-plan.schema.json` |
| `graphics/graphic-prompts.json` | slot 別確定プロンプト (FB 反映後) + 生成パラメタ (サイズ px) | **21d のみ** | 21e | `schemas/graphic-prompts.schema.json` |
| `graphics/samples/` | テイスト 2 段階目の A/B/C サンプル画像 (ILLUSTRATIVE、実データ非昇格) | **21c のみ** | 人間 (21c ゲート内) | — (バイナリ) |
| `graphics/raw/{graphic_id}.png` | 生成直後の中間物 (透過/圧縮前) | **21e のみ** | 21f | — (バイナリ) |
| `screens/_shared/graphics/{graphic_id}.{png\|webp}` | **グラフィック正典 (第 4 の正典系統**: root-variables / components / illustrations に次ぐ**)**。HTML から `<img src>` で相対参照される正典実体 | **21f のみ** (29 は既存改変禁止・additive のみ、illustrations と同規約) | 21g / 29 (25b は HTML 経由で間接継承) | — (バイナリ) |
| `pipeline-state.json` (`screens.graphics.*` / `approvals.graphics_human_approved` / `approvals.step21g_approved_at`) | ブロック進行 state (キーの完全な一覧は §9-2) | 21a〜21g (§9-2 キー一覧) + **phase orchestrator** (① 上流 skip 時の `decision`/`decided_by` — §9-1、21a〜21g が走らない経路の単一 writer / ② 21g 差し戻し routing の `rework_pending` append + 該当完了時刻・`prompts_confirmed_at` のクリア — §9-2b) | resume cascade / 15(2nd)・22 入口 assert (§9-3) | `schemas/pipeline-state.schema.json` (追記) |

**`_shared` 規約との整合 — 逐語インライン規約の再評価とラスター埋め込み形式の決定**:

- **埋め込み形式は正典への相対参照**: `<img src="../_shared/graphics/{graphic_id}.png" alt="{graphic_id}" width height>`
  (`screens/{platform}/*.html` から見て `../_shared/`)。**Base64 data URI インラインは不採用**
  (人間閲覧専用の派生レビュービューのみ例外 — 本節末尾「派生レビュービューの自己完結」)。
  実ファイル名 (拡張子含む) の SoT は `pipeline-state.screens.graphics.generated_files[].file` —
  21g は例を写経せず必ずそこから解決すること (現行 21f 実装は png のみ生成 [圧縮 ⑫ 非搭載]。
  webp は C-26 / schema pattern が許容する将来拡張)。
- **逐語インライン規約 (`docs/html-generation-rules.md` §10/§11 の「`<link>`/`@import` 禁止・正典の
  逐語インライン」。constraint ID なし — **色 lint の C-25 とは別規約**なので混同しないこと) の再評価**:
  本規約の載っている根拠は
  (a) parallel subagent 生成での CSS 変数 / chrome 部品の byte 一致担保、(b) lint の形状署名照合
  (SVG 正典)、(c) キャプチャ時に外部 CSS が読み込まれない事故の防止 — いずれも **LLM が生成し
  linter が検証するテキスト正典**に固有の理由であり、ラスターには 1 つも当てはまらない
  (ラスターは単一のバイナリ正典 1 ファイルで、インライン複製より参照の方が一貫性が高い)。
  さらに同規約の文言自体が CSS 参照 (`<link>`/`@import`) の禁止であり、`<img>` の相対参照は
  そもそも違反しない。色 lint 側の **C-25 (pipeline.yaml、zero-literal) は rule 文で raster img を
  除外済み**のため変更不要 (§6)。**よって両規約とも削除・変更は不要 — 逐語インライン規約側に
  「ラスター `<img>` 相対参照には適用しない (敷衍しない)」という適用範囲の明確化のみ行う**
  (実装時に `docs/html-generation-rules.md` §10 へ 1 行注記)。
- **Base64 を不採用にする決定的理由 (LLM context 保護)**: HTML を LLM context に Read する step
  (25b inherit_main / 29 / 18 / 19 / 21g) にとって base64 は ~2〜3 文字 = 1 token と極端に
  高コストで、300KB の画像 1 枚 ≈ 100k token 級 — subagent context を 1 枚で溢れさせ得る。
  相対参照なら `<img>` タグは数十 byte で、**問題が発生する経路そのものが存在しない**
  (strip / 再 embed のような対症機構も不要)。Figma 書き出しは I-1 の実測マトリクスで
  **相対ファイル参照も Base64 と同一 imageHash で完全動作**が確認済みのため制約にならない。
- **自己完結性の責務整理**: 配布物の自己完結は authoring の責務ではなく **export の責務** —
  `/ayatori-export` (Step 35) が既に「画像を base64 インライン化した自己完結 HTML」を生成する
  設計であり、配布時はそこで埋め込む。作業ツリー内の閲覧 (file:// 二重クリック / `index.html`
  iframe) は相対パスがそのまま解決するため破綻しない。**単一 HTML ファイルだけを取り出して
  共有すると画像が抜ける**点のみ運用上の注意 (配布は Step 35 を使う)。
- **派生レビュービューの自己完結 (render の責務 — PR #199)**: 上記「作業ツリー内の閲覧は
  破綻しない」には例外がある — 閲覧環境側が file:// 子リソース読取をブロックする場合
  (macOS のフォルダ権限拒否・拡張機能・管理ポリシー等)、HTML 自体は開けても隣の画像だけが
  破像する。ユーザー環境の設定は把握も誘導もできないため、**人間閲覧専用で LLM Read 経路に
  乗らない派生レビュービュー** (21a `graphics/graphic-recommend.html` / 21c
  `graphics/samples/taste-compare.html` / 21g `graphics/graphic-embed-review.html`) に限り、
  render 時に画像ファイルの byte をそのまま base64 data URI として内包し自己完結させる
  (副次効果として単一ファイルのまま共有可能)。**画像の SoT は常に単独ファイル側** — 正典 /
  見本 PNG はそのまま残り単独プレビューでき、data URI はそのファイル byte の表示用複製で
  両者は構造上 byte 一致する (二重生成しない。render 再実行で常にファイルへ再同期)。
  「LLM context 保護」の不採用理由はこれらのファイルには当てはまらず (どの step も Read
  しない)、正典 screens HTML の C-26 相対参照は不変。
- 正典→参照の整合: `src` パス ↔ 正典ファイルの存在照合は決定的に検証できる (byte 照合 lint が
  不要になる点も参照方式の利点)。21g が埋め込み時に `graphic-plan.json` の slot ↔ `alt` 属性
  (= Figma レイヤ名) の対応を機械記録することで追跡可能にする。
- **機械的 HTML 変換は決定的スクリプトの責務** (LLM の Read-Edit-Write にしない): どこに挿すかの
  判断 (semantic) は 21g の LLM が担ってよいが、一括のタグ書き換え・src↔正典の存在照合・サイズ
  検査は script で行う (repo 前例: `lint-screen-colors.mjs --normalize-icons` /
  `render-color-report.mjs` の「手焼き禁止」と同じ線引き)。
- `<img>` には `alt` (レイヤ名 = `graphic_id`) と明示 `width/height` (CLS 防止 + キャプチャ安定) を必須とする
  → §8 の constraints 追加案 C-26。
- **screens/*.md への追記**: 21g は埋め込み先画面の仕様書に「使用グラフィック」節
  (graphic_id / 位置 / alt / 由来 = AI 生成 + 承認日) を追記する。仕様書↔HTML の整合原則
  (29b reverse-propagate と同じ方向性) に従い、2nd Confluence save (§3) がこれを拾う。
- **既存 hooks との整合**:
  - `backup-on-edit.sh`: `screens/` 配下は既に退避対象だが、本 hook は **Write/Edit ツールの
    PreToolUse でのみ発火**する (hook 実装が tool name を Write/Edit に限定)。21g のうち LLM が
    Write/Edit で行う編集は hook が退避する一方、**一括タグ書き換えの決定的 script (Bash 起動) は
    hook を発火しない**。よって feedback-protocol の置換スクリプト (CLAUDE.md「成果物バックアップ」
    の既存例外) と同じく、**21g の embed script 自身が置換前に同じミラー配置
    (`artifacts/{app}/_backup/`) へ退避する責務を持つ** (md5 同一 skip / cooldown も hook と同挙動に
    合わせる)。「追加実装不要」ではない — F-7 の script 実装要件に含める。
  - `lint-screen-html.sh` (手編集検知): 完了ガードが「`final_approved == true` OR
    `completed_at_states` set」を要求する (hook 実装 L93-96) ため、21g の HTML 書き換え
    (Step 23 より前 = 両フラグとも未 set) は edited-screens.json に誤記録されない。前提
    「21g は必ず final_approved 前に走る」は §9-1 の cascade ガード (`design_save_count < 2`) が
    機械的に保証する (完走済みプロジェクトは 21a〜21g へ流入しない)。
  - `schema-light-check.sh`: 新 schema 2 件を検証対象リストへ追加 (実装チケット側)。

## 8. `pipeline.yaml` 変更案

> 適用タイミング: F-2A の実装が skill 実体と同時に適用する。適用されるまで本節が変更案の SoT。

### 8-1. `screens.steps` — 21a〜21g 挿入 (現行 L165-166 の間)

```yaml
    - 21-screen-human-review
    # ── 21a-21g: グラフィック生成ブロック (挿入位置設計 docs/graphic-generation-design.md) ──
    # Step 21 承認済み main HTML を入力に、AI 生成グラフィック (イラスト/キャラ/写真、gpt-image-2) を
    # 生成して <img> 相対参照 (正典 screens/_shared/graphics/) で埋め込む任意ブロック。
    # Step 15 再実行 (2nd Confluence save) より前に完結。
    # 実機検証済み: 埋め込み済み HTML は現行 Step 22 キャプチャ経路のまま Figma に書き出せる
    # ため 22 側の変更は無し。skip 動線は graphic_generation (上流) と 21b (人間ゲート) の 2 段。
    # sub-state (25b inherit_main) には main HTML 経由で自動継承。v1 は default 状態のみ対象。
    - 21a-graphic-recommend      # F-2A: 必要性分析 → graphics/graphic-recommend.md
    - 21b-graphic-hearing        # F-2  要否+箇所 (人間ゲート) → graphics/graphic-plan.json
    - 21c-graphic-taste          # F-3  テイスト2段階 (人間ゲート) → plan.taste + samples/
    - 21d-graphic-prompts        # F-4  プロンプト確定 (人間ゲート) → graphics/graphic-prompts.json
    - 21e-graphic-generate       # F-5  gpt-image-2 生成+サイズ → graphics/raw/
    - 21f-graphic-postprocess    # F-6  透過(+圧縮) → screens/_shared/graphics/ (正典)
    - 21g-graphic-embed-review   # F-7  HTML/MD 埋め込み + 人間ゲート
    - 22-figma-export
```

### 8-2. `screens.gates` — 人間ゲート 4 件追加 (現行 L259-274 のブロック内)

```yaml
    21b-graphic-hearing:
      type: human
      description: "Decide whether graphics are needed and where (informed by 21a recommend report)"
    21c-graphic-taste:
      type: human
      description: "Select graphic taste (words first, then sample A/B/C comparison)"
    21d-graphic-prompts:
      type: human
      description: "Confirm per-slot generation prompts (feedback loop)"
    21g-graphic-embed-review:
      type: human
      description: "Approve screens with embedded graphics before 2nd Confluence save / Figma export"
```

(各ゲートは既存の `skills/_shared/human-gate-preview.md` 規約に従い preview + `refresh_index` を行う。)

### 8-3. `screens.output` 追記 (現行 L193-196)

```yaml
    - graphics/graphic-plan.json         # 21b init + 21c taste キー append (key 分離)
    - graphics/graphic-prompts.json      # 21d が確定プロンプトを書く
```

### 8-4. `screens` 直下に新サブセクション `graphic_generation:` (`figma_export:` の隣)

```yaml
  # ── 21a-21g グラフィック生成ブロック設定 (設計 SoT: docs/graphic-generation-design.md) ──
  graphic_generation:
    tool: gpt-image-2                  # 比較選定の採用ツール
    embed_format: img_relative_ref     # <img src="../_shared/graphics/{graphic_id}.png"> — 正典への相対参照 (§7。実ファイル名の SoT は generated_files[].file)。
                                       # Base64 data URI は不採用 (LLM context コストの根本回避)。
                                       # 相対参照も Base64 と同一 imageHash で完全動作を実測済。装飾背景のみ background-image 可
    alt_required: true                 # alt = graphic_id (Figma レイヤ名になる)。width/height 明示必須 (C-26)
    raster_formats: [png, webp]        # SVG 不可 (upload_assets 制約) / 正典は screens/_shared/graphics/
    state_scope: default_only          # v1: main (default) HTML のみ。sub-state 専用 slot は将来拡張 (plan.json の state field)
    skip_semantics:
      upstream: "requirements.json.design_output_scope.graphic_generation == 'skip' → 21a 含めブロック全体を不実行。skip 記録 (screens.graphics.decision='skip', decided_by='upstream_scope') の writer は 21a-21g ではなく phase orchestrator (ブロック入口到達時に一度だけ書く — resume cascade / 連続セッション進行の両経路、§5/§9-1) — 21a-21g は 1 つも走らないため"
      gate_21b: "21b で「不要」選択 → 21c-21g を skip。screens.graphics.decision='skip', decided_by='step21b' を記録"
      gate_21d_all_cancel: "21d で全 slot の生成中止を選択 → graphic-prompts.json は書かず (確定 prompt 0 件のため minItems:1 を満たせない = 正しく書けない)、screens.graphics.decision='skip', decided_by='step21d' を記録して 21e-21g を skip"
      reentry: "v1 では再入経路なし (P4-07 過剰質問禁止)。final_approved 前は手動リセット 3 点セット (§5): ① screens.graphics ② 2nd save 済みなら confluence.design.save_count を 1 に戻す (§9-1 cascade ガード再入条件 + 21g 反映後の仕様書再 save) ③ Step 22 実行済みならその完了記録 (screens.step22_figma_status / figma-state.json の export 記録) も戻す (Figma 再 export を走らせ HTML↔Figma 乖離を防ぐ — 22 済み・final_approved 前の窓は正規に存在する) — の上で /ayatori-screens 再実行。以後は delta 領域"
    degrade:
      recommend_failure: "21a の分析失敗/低信頼は fail-open — 21b は推奨レポートなしの素朴ヒアリングに degrade"
      generation_failure: "21e の生成失敗は AskUserQuestion (リトライ / 当該 slot を除外 → screens.graphics.excluded_slots[] に {graphic_id, reason, excluded_at} を記録 [記録なしの除外は禁止 — §9-2b の pending 定義に当該 slot が残り続け、resume ごとに再生成試行・再質問 (P4-07 抵触) を繰り返すため] / ブロック中止 → screens.graphics.decision='skip', decided_by='step21e' を記録)。除外の結果、全 slot が excluded になった場合はブロック中止と同義に扱い decision='skip', decided_by='step21e' を記録する (埋め込み対象 0 件の空 21g ゲートを回さない)"
    # サイズ統制の専用 knob は置かない (YAGNI): HTML は相対参照のため肥大せず (§7)、アセットの
    # ファイルサイズは生成時の size_px 指定 (21d 確定 → 21e が gpt-image-2 の size パラメタに使用) +
    # 21f の WebP 化 (OP1 準拠の 3 段経路は §0 I-4 — 不可なら PNG degrade) で上流から決まる —
    # 下流の budget 検査は 21d で人間確定済みの寸法判断の再検証に
    # しかならない。git / 配布物の肥大が実運用で問題化した場合の再起票は §11 (圧縮) が受け皿。
    html_transform_policy: deterministic_script   # 一括タグ書き換え・src↔正典の存在照合は LLM の
                                                  # Read-Edit-Write でなく script の責務 (§7。挿入位置の判断のみ LLM)。
                                                  # script は置換前に _backup/ へ self-backup する — Bash 起動は
                                                  # backup-on-edit.sh (PreToolUse Write|Edit) を発火しないため (§7)
    ordering:
      before: [15-confluence-save-design (2nd), 22-figma-export]   # 21g 承認 or skip 確定が 15/22 の前提
      layer1_assert: "15-confluence-save-design (2nd run) / 22-figma-export の両入口 (Phase 0 節を新設): screens.graphics.decision == 'skip' でも approvals.graphics_human_approved == true でもなければ実行を起動せず中断し、§9-1 cascade の該当 21x step へ差し戻す (肯定形条件 — decision='generate' のまま 21g 未承認の素通りを塞ぐ。read は canonical フラグ、§9-2/§9-3。legacy passthrough (c) 含む完全な条件は §9-3)。15 側の発火は 2nd run のみ = confluence.design.save_count >= 1 のとき (無条件実装は 1st save を自己 deadlock させる、§9-3)。適用は F-2A"
      cascade_guard: "§9-1 の graphics 分岐は design_save_count < 2 が前提条件 — 完走済み / 2nd save 通過済みプロジェクトを 21a へ吸い込まない (完走後の後付けは delta 領域、§5)"
```

### 8-5. `default_design_output_scope` 追記 (現行 L627-638)

```yaml
  graphic_generation: ask   # ask | skip — AI グラフィック生成ブロック (21a-21g) の起動方針。
                            # ask=21a 分析+21b 人間判断 (default) / skip=ブロック全体不実行。
                            # 既存 illustration_policy とは別軸 (アイコン描画規約 vs ラスター生成の有無)。
                            # 詳細: docs/graphic-generation-design.md §5
```

### 8-6. `file_topology.conditional` 追記 (現行 L741 以降)

```yaml
    - path: graphics/graphic-recommend.md
      role: graphic_necessity_report
      when: "design_output_scope.graphic_generation != 'skip' (21a 実行時)"
      primary_writer: 21a-graphic-recommend
      readers: [21b-graphic-hearing]
      note: "5 部構成 (推奨 3 段階/根拠/インベントリ/候補スロット/ガードレール)。derived レポート、schema なし (固定見出し)。"
    - path: graphics/graphic-plan.json
      role: graphic_slot_plan   # loop 不変量
      when: "21b で「必要」選択時"
      primary_writer: "21b-graphic-hearing (init + slots)"
      secondary_writers: [21c-graphic-taste]   # taste キーのみ (key 分離)
      readers: [21d-graphic-prompts, 21e-graphic-generate, 21g-graphic-embed-review, 29-partial-screen-regen]
      schema: schemas/graphic-plan.schema.json
      note: "slot = graphic_id/screen/platform/位置/サイズ用途/state (v1 は 'default' 固定・将来 sub-state 拡張点)。"
    - path: graphics/graphic-prompts.json
      role: graphic_prompt_confirmed
      when: "21d 完了時"
      primary_writer: 21d-graphic-prompts
      readers: [21e-graphic-generate]
      schema: schemas/graphic-prompts.schema.json
    - path: graphics/samples/          # テイスト A/B/C サンプル (ILLUSTRATIVE)
      role: graphic_taste_samples
      when: "21c 実行時"
      primary_writer: 21c-graphic-taste
      readers: []                       # 人間ゲート閲覧用
    - path: graphics/raw/               # {graphic_id}.png 生成直後の中間物
      role: graphic_intermediate
      when: "21e 実行時"
      primary_writer: 21e-graphic-generate
      readers: [21f-graphic-postprocess]
    - path: screens/_shared/graphics/   # {graphic_id}.png|webp
      role: graphic_canonical           # 第 4 の正典系統 (root-variables / components / illustrations に続く)
      when: "21f 完了時"
      primary_writer: "21f-graphic-postprocess (29 は additive のみ・既存改変禁止)"
      readers: [21g-graphic-embed-review, 29-partial-screen-regen]
      note: "HTML から <img src> で相対参照される正典実体 (§7)。25b (inherit_main) は main HTML のタグごと継承しファイルは読まない。"
```

### 8-7. `constraints` 追加案

```yaml
  - id: C-26
    applies_to: [21g-graphic-embed-review, 29-partial-screen-regen]
    rule: "AI 生成グラフィックは <img src='../_shared/graphics/{graphic_id}.(png|webp)' alt='{graphic_id}' width height> の正典相対参照で埋め込む (設計 §7)。Base64 data URI インラインは使わない (LLM context 保護)。alt 必須 (Figma レイヤ名)・width/height 明示必須。CSS background-image は装飾背景のみ可。SVG 形式のグラフィックは禁止 (ラスターのみ)。object-fit は cover(→FILL)/contain(→FIT) のみ使用。"
```

### 8-8. 変更しないもの (明示)

| 項目 | 理由 |
|---|---|
| `phase_order` / `command_policy.allowed_commands` | in-phase ブロック採用のため新コマンドなし |
| `figma.affected_steps` | 21a〜21g は Figma MCP を使わない (Figma 書き出しは既存 22/25e/30 のまま) |
| `screens.figma_export` / Step 22 のキャプチャ経路 | I-1 の結論 (同一キャプチャ経路で自動書き出し)。skill への変更は入口 layer-1 assert 1 行のみ (§9-3、F-2A が適用)。F-8 は検証+ドキュメントのみ |
| `illustration_policy` の値域 | §5 (新フィールドで直交させる) |
| Step 12 / 24 (design system) | §6 (v1 は色を取り込まない) |
| `state_pattern_gate_enforcement` (hook) | 21 系の順序強制は resume cascade (§9-1 ガード込み) + 15(2nd)/22 両入口の layer-1 assert で担保 (§9-3)。layer-2 hook は実事故が起きてから追加 (25c hook が事故駆動で導入された経緯に合わせ YAGNI) |

## 9. `phases/screens/SKILL.md` 変更案 (resume cascade / state キー)

### 9-1. resume cascade 挿入 (現行 手順 8、`screens_human_approved and design_save_count < 2 → Step 15` の**直前**)

```
- `screens_human_approved` AND `design_save_count < 2` AND `design_output_scope.graphic_generation == "skip"`
  AND `screens.graphics.decision` NOT set:
    → screens.graphics.decision = "skip" + decided_by = "upstream_scope" を記録 (writer = phase
      orchestrator、一度だけ — §5/§7/§8-4) して次行以降の判定を続行 (Step 15 行へ抜ける)
- `screens_human_approved` AND `design_save_count < 2` AND `design_output_scope.graphic_generation != "skip"`
  AND `screens.graphics.decision` NOT set:
    - `screens.graphics.step21a_completed_at` NOT set → resume from Step 21a
    - set → resume from Step 21b (分析済み・要否未回答)
- `screens.graphics.decision == "generate"` AND NOT `approvals.graphics_human_approved`:
    - `taste_confirmed_at` NOT set → Step 21c / `prompts_confirmed_at` NOT set → Step 21d /
      `step21e_completed_at` NOT set → Step 21e (再生成は §9-2b の pending slot のみ) /
      `step21f_completed_at` NOT set → Step 21f / else → Step 21g
- (既存) `screens_human_approved` and `design_save_count < 2` → resume from Step 15 (2nd save)
  ※ graphics 判定が上流に入るため、この行に到達する = graphics 解決済み (decision set)
```

**`design_save_count < 2` ガード (graphics 分岐すべての前提条件)**: 2nd Confluence save 通過済みの
プロジェクトは graphics 分岐にマッチせず、従来どおり Step 22/23/24/25/25a の判定行へ抜ける。
完走済みプロジェクトは必ず 2nd save を通過している (`save_count == 2`) ため、このガードが
「`final_approved` 後は delta 領域」(§5) を機械的に保証する。ガードが無いと first-match で
2 つの事故が起きる: (a) 完走済みレガシープロジェクト (graphics キー未存在 = decision 未 set、
`graphic_generation` 欠落 → default `ask`) が sub-state 再開などの `/ayatori-screens` 再実行のたびに
21a へ吸い込まれ、承認済み HTML が final_approved 後に書き換えられる。(b) 「2nd save 済み・Step 22
未実行」で中断中のプロジェクト (Step 22 の中断 resume は P-15 で明示サポートされる正規状態) に
21g が HTML/仕様書を書き換えた後、3 回目の save 機構が無いため Confluence↔HTML が恒久乖離する
(§3 が禁じる状態そのもの)。

`design_output_scope.graphic_generation == "skip"` の場合は 2 番目の分岐にマッチせず、skip 記録
(上記 1 行目、orchestrator が単一 writer) だけを残して Step 15 へ抜ける。後方互換で 21a に入る
レガシープロジェクトは **2nd save 前 (`save_count < 2`) の進行中プロジェクトのみ** (§5 後方互換)。
完走後・2nd save 後の後付け追加は delta 領域 (§5 / §11)。

### 9-2. `pipeline-state.json` 新キー一覧 (`schemas/pipeline-state.schema.json` へ追記が必要 — `screens` / `approvals` とも `additionalProperties: false` のため schema 追記は必須)

```
screens.graphics: {
  decision: "generate" | "skip",
  decided_by: "upstream_scope" | "step21b" | "step21d" | "step21e",
                                                 # upstream_scope = orchestrator が記録 (§9-1) / step21b = 要否ゲートで不要 /
                                                 # step21d = 全 slot 中止 / step21e = 生成失敗によるブロック中止 (§8-4)
  step21a_completed_at, taste_confirmed_at, prompts_confirmed_at,
  step21e_completed_at, step21f_completed_at,
                                                 # 21g に completed_at は置かない — 21g は人間ゲート step のため
                                                 # 「完了 = 承認」であり、approvals.graphics_human_approved が
                                                 # その記録 (25d と同じ扱い)。completed_at 系は非ゲート step
                                                 # (21a/21e/21f) のみ。reader の無い三重記録を作らない
  generated_files: [ {graphic_id, file, generated_at, source_digest} ],
                                                 # 21e/21f の resume 用 (step25b.completed_files と同用途。あちらは string[]、
                                                 # こちらは graphic_id との対応 + 鮮度判定 (§9-2b) が要るため object[])。
                                                 # 21g/29 の埋め込み対象集合の driver でもある (§9-2b 共通契約)
  excluded_slots: [ {graphic_id, reason, excluded_at} ],
                                                 # 21e 生成失敗 degrade「当該 slot を除外」の記録 (writer = 21e、§8-4)。
                                                 # §9-2b の pending / 埋め込み対象集合から除かれる — 記録なしの除外は
                                                 # 当該 slot が永久 pending 化する (§9-2b)。21g の per-slot 却下 (F-7 で
                                                 # 要否判断、§11) を採用する場合も本キーを再利用する
  rework_pending: [ {graphic_id, instruction} ]
                                                 # 21g 差し戻し (プロンプト起因) の per-slot 指示 queue (writer =
                                                 # orchestrator、§9-2b。prompts_confirmed_at のクリアと同一 Write)。
                                                 # 21d が消費 (提示 → 再確定 → entry 除去)。中断後 resume でも差し戻し
                                                 # 意図が失われないためのディスク記録
}
approvals.graphics_human_approved: true           # 21g 承認 (canonical フラグ — cascade / assert はこちらを読む)
approvals.step21g_approved_at: ISO8601            # 補助 timestamp (screens_human_approved + step21_approved_at の既存対と同型)
```

21g 承認の read は **canonical フラグ `graphics_human_approved` に統一**する (§9-1 cascade / §9-3
assert / §3 とも)。既存 cascade が boolean 側 (`screens_human_approved` / `final_approved`) を読む
規約に合わせ、timestamp は補助記録に留める — flag と timestamp のどちらを読むかが箇所ごとに割れると、
stub や skill が片方だけ set したときに resume と assert の判定が食い違う。

### 9-2b. slot 単位の再利用・無効化規則 (21g 差し戻し / 途中 resume / プロンプト部分改訂)

25b の resume 契約 (`pending = expected_files − completed_files`、ファイル単位 idempotent) と同じ
差集合方式を **slot 単位** で適用する。gpt-image-2 は低速・有料のため、**無効化されていない slot の
正典画像は必ず再利用し、再生成しない** (全 slot 一括再生成の禁止)。

- **鮮度判定 (決定的・per-slot)**: `generated_files[].source_digest` = 生成に使った
  `graphic-prompts.json` の当該 entry (prompt + size_px + transparent_background + tool — tool は
  省略時 pipeline.yaml `graphic_generation.tool` の既定値に正規化してから含める。将来ツールを
  差し替えた際に旧ツール生成画像が fresh 扱いのまま残らないため) から決定的 script で
  導出した digest。slot が **fresh** ⇔ 現在の prompts entry の digest と一致。21e の pending =
  `prompts[]` のうち **`excluded_slots[]` (§9-2) に載らず**、fresh な generated_files entry を持たない
  slot (stale entry は再生成で上書き)。除外 slot を pending 定義から引かないと、除外 slot が永久
  pending 化して resume のたびに再生成試行 / 再質問 (P4-07 抵触) を繰り返す。
  これにより 21d の部分改訂後の resume は改訂 slot だけを再生成し、未改訂 slot を再利用する —
  改訂前画像をそのまま出荷する事故と、全量再生成のコスト暴発の両方を防ぐ。**file-level の
  `prompts_confirmed_at` を鮮度判定に使ってはならない** (1 slot の改訂で全 slot が stale 化するため。
  `prompts_confirmed_at` は §9-1 cascade の「21d を通過したか」の判定にのみ使う)。
- **21g 差し戻し (修正指示) の routing**: 修正指示を slot 単位に分類し、該当 slot だけを差し戻す。
  **routing の意図は必ずディスク状態に落とす** — 品質起因は entry 削除がその記録になっているのと
  同等の記録をプロンプト起因にも置く。記録なしで 21d へ「口頭 routing」すると、差し戻し直後の
  中断で resume cascade が `prompts_confirmed_at` set を見て 21d を飛ばし、プロンプト未改訂 =
  digest 一致 = 全 slot fresh で 21e/21f が空転し、21g が同じ画像を再提示して修正指示が消失する:
  - プロンプト起因 (内容・構図) → orchestrator が **`prompts_confirmed_at` をクリア** +
    **`rework_pending[]` (§9-2) に {graphic_id, instruction} を append** (両方を同一 Write で原子的に) →
    21d が rework_pending の指示を提示して当該 slot のみ再確定し、確定時に該当 entry を除去して
    `prompts_confirmed_at` を再 set → digest 不一致で自動 stale 化 → 21e
  - 生成品質起因 (同 prompt でリトライ) → 当該 slot の `generated_files` entry を削除 → 21e
  - 配置起因 (位置・サイズ属性・alt) → 21g 内で修正 (画像は再利用、生成レイヤへ戻らない。
    21g は人間ゲート未承認のまま = resume は §9-1 分岐 3 の else で 21g に戻るため追加記録不要)

  生成レイヤへ戻る経路では orchestrator が `step21e_completed_at` / `step21f_completed_at` を
  クリアし、§9-1 cascade / 連続セッションが pending slot のみで 21e/21f を再通過する。21g の
  差し戻しは `decision` を変更しない (`generate` のまま — skip への転換は 21b/21d/21e 経路 (§8-4) と 21g 全 slot 却下 (§11) のみ)。
  なお生成後のテイスト再選定 (21c への差し戻し) は 3 分類に**含めない** — style_directive は全 slot の
  プロンプトに合成されるため全 slot が stale 化 = 全量再生成のコスト暴発経路であり、v1 非対応 (§11)。
- **埋め込み対象集合 (21g / 29 共通契約)**: 21g の埋め込み・29 (delta) の再埋め込みの対象 slot =
  「`generated_files[]` に fresh entry を持ち、`excluded_slots[]` に載らない slot」のみ。
  **`graphic-plan.json` の slots[] を直接 driver にしない** — 21d の per-slot 省略 (prompts schema が
  正規に許容する取り下げ記録) / 21e の除外は plan に残置されるため、plan-driven だと取り下げ済み
  slot の正典不在で src↔存在照合が壊れる。plan は配置メタ (screen / platform / placement) の参照のみ。
  29 はさらに前提ゲート `screens.graphics.decision == "generate" AND
  approvals.graphics_human_approved == true` を要求する — **plan / prompts ファイルの存在はブロック
  有効のシグナルではない** (21d 全中止 / 21e 中止の decision='skip' はファイル生成後に起きるため、
  skip 済みプロジェクトにも両ファイルは残置される。有効判定の SoT は pipeline-state 側)。

### 9-3. Step 15 (2nd run) / Step 22 skill への layer-1 assert 追加 (各 1 行、適用 = F-2A)

> Phase 0: 次の (a)〜(c) の**いずれも成立しない**場合、実行 (2nd save / capture) を起動せず中断し、
> §9-1 cascade の該当 21x step へ差し戻す (25d/25e の layer1_skill_assert と同型。read は canonical
> フラグ — §9-2): (a) `screens.graphics.decision == "skip"` / (b) `approvals.graphics_human_approved
> == true` / (c) **legacy passthrough** — `screens.graphics` キー未存在 AND `confluence.design.save_count
> >= 2` (§9-1 の `design_save_count` と同値)。

- **発火条件 — Step 15 側は 2nd run のみ (機械可読条件: `confluence.design.save_count >= 1`)**:
  skill 15 は 1st/2nd run が同一入口のため、本 assert を無条件に転記すると 1st save
  (save_count == 0、Step 21 未承認・graphics 未着手の時点) で (a)〜(c) がすべて偽になり、
  Phase 3 主線が初回 Confluence save で自己 deadlock する。assert は `save_count >= 1` の
  ときのみ評価すること (F-2A 転写時の必須条件)。Step 22 側は常時評価でよい (22 は 2nd save
  通過後にしか到達しない)。
- **(c) legacy passthrough は §9-1 cascade ガードと対称に必須** (PR #156 レビュー指摘)。§9-1 の
  `design_save_count < 2` ガードは「2nd save 済み・Step 22 未実行で中断中」のレガシープロジェクト
  (graphics キー未存在 = decision 未 set) を意図的に graphics 分岐へ入れず Step 22 へ抜けさせる
  (§9-1 事故 (b) の保護対象)。(c) が無いとこの同じプロジェクトが Step 22 入口 assert で中断→差し戻し
  になるが、差し戻し先の 21x 分岐はすべて `save_count < 2` 必須で match しないため decision を書く
  経路が存在せず、resume 不能 (deadlock) になる。(c) は「graphics ブロック導入前に 2nd save まで
  到達していた」ことの決定的証拠であり、graphics ブロックを通って進行中のプロジェクトは
  `screens.graphics` キーが必ず存在する (21a 完了時刻 or decision が書かれる) ため、`decision =
  "generate"` のまま 21g 未承認の素通りリークは (c) からは生じない (下記の肯定形原則と両立)。
- 連続セッション (S-01 非分割) の**上流 skip** プロジェクトは、§5 の writer 契約 (skip 記録は
  cascade 到達時に限定せず**ブロック入口到達時**に orchestrator が書く) により、assert 到達時点で
  必ず (a) を満たす — writer を cascade 限定にすると decision 未記録のまま Step 15 入口 assert に
  掛かり不当に中断されるため、§5 側で契約を広げて塞いだ。
- **条件は「skip 確定 or 21g 承認済み (+ legacy 証拠)」の肯定形で書く**。「`decision` 未 set かつ upstream != skip」を
  見る形は不可 — 21b が `decision = "generate"` を書いた時点で素通しになり、連続 1 セッションで
  オーケストレータが 21e/21f から 15/22 へ直行するリーク (§3 の不変量「21g 承認済み or skip 確定」の
  破り) を止められない。
- 対象は **Step 22 だけでなく Step 15 の 2nd run も含む** (§8-4 `ordering.before` の 2 step とも)。
  15 を素通しすると「使用グラフィック」節の無い仕様書が Confluence に上がり、21g 反映後に再 save
  機構が無いため乖離が固定される (§3 と同じ理由)。連続セッション内のドリフトは resume cascade
  (新規再起動時のみ発火) では塞げない — CLAUDE.md「Sub-state 採点スキップ防止」が文書化した前例と
  同じ穴のため、両入口に assert を置く。
- **適用は F-2A** (pipeline.yaml 変更案の転記と同時)。21a〜21g が steps list に載った瞬間からリークが
  成立し得るため、F-8 (検証+ドキュメント) まで遅延させない。`skills/22-figma-export/SKILL.md` には
  現状 Phase 0 節が無いため、skill 冒頭 (「実行指示」の前) に Phase 0 節を新設して置く。
  §1/§2/§8-8 の「Step 22 無変更」は**キャプチャ経路**を指す — 入口 assert 1 行の追加はこの限りでない。

layer-2 hook (territory キー方式) は v1 では追加しない (§8-8)。

## 10. schema 一覧

新規 schema 2 件は **本設計の成果物** (schema 設計はエピック整理ページの本チケット要件) であり、
writer skill ができるまで inert (何からも参照されない)。既存 schema への**追記**は実装チケット側で行う
(追記は skill 実体と同時でないと `additionalProperties: false` の検証が通らないため)。

| schema | 新規/追記 | 状態 / 担当 |
|---|---|---|
| `schemas/graphic-plan.schema.json` | 新規 (slots[] + taste [21c key 分離]。required: app_name, created_at, slots) | **本設計の成果物 (定義済)**。F-2 (init writer) が消費 |
| `schemas/graphic-prompts.schema.json` | 新規 (graphic_id ↔ prompt ↔ size_px。required: app_name, confirmed_at, prompts) | **本設計の成果物 (定義済)**。F-4 (writer) が消費 |
| `schemas/pipeline-state.schema.json` | 追記 (§9-2 のキー。`additionalProperties: false` のため必須) | F-2A (最初に state を書く step) |
| `schemas/requirements.schema.json` | 追記 (`design_output_scope.graphic_generation` enum) | F-2A 実装時 (Step 01 側の質問追加と同時) |
| `graphic-recommend.md` | schema なし (固定見出し構造を F-2A skill 内で定義) | F-2A |

`.claude/hooks/schema-light-check.sh` の検証対象へ新 schema 2 件を追加すること (実装チケット側)。

## 11. フォローアップ (本設計で確定しない事項)

| 事項 | 引き継ぎ先 |
|---|---|
| 透過 PNG の alpha 保持 (Figma 実測) → 21f の透過仕様 | I-3 → F-6 |
| 圧縮方式 — **F-6 で結論済み: 非搭載** (I-4 Skip に加え、実装レビュー時のユーザー判断で WebP 化を含む圧縮をスコープ除外。21f は raw PNG を無加工で正典化する)。本行は**再起票の受け皿**として残す — アセット肥大が実運用で問題化したら再起票し、その際は §0 I-4 の 3 段経路 (①生成 API 出力フォーマット指定 → ②repo lock 純 JS encoder → ③PNG のまま degrade) を出発点にすること。Operating Principle 1 (外部 CLI 禁止) 下では cwebp / imagemagick も OS 同梱 (macOS `sips` は Linux CI に無い) も経路に含めない。当面のファイルサイズ統制は生成時の size_px 指定 (21d 確定 → 21e) のみ | 再起票時 (F-6 は非搭載で完了) |
| Step 29 (delta partial regen) のグラフィック再挿入対応 (前提ゲート `decision == "generate" AND graphics_human_approved` + 復元対象は `generated_files[]` − `excluded_slots[]` 基準 [§9-2b 共通契約、plan は配置メタ参照] で `<img>` 相対参照タグを復元 + 21g と同じ src↔正典存在照合を実行) | **✅ F-7 で実装済み** — `skills/29-partial-screen-regen/SKILL.md` Step 4a (Step 4 の後・4b [inherit_main] の前) が 21g の scripts (`--delta --screens` mode) で再埋め込み + spec 節復元 + src↔正典照合を行う |
| 21g での per-slot 却下 (再生成でなく **slot 自体の取り下げ**) の採用要否 — 生成**前**の per-slot 取り下げは本設計で定義済み (21d の省略記録 [prompts schema] / 21e の `excluded_slots[]`、§8-4/§9-2)。未定義なのは生成・承認段階 (21g) での却下のみで、採用する場合は `excluded_slots[]` を再利用した上で 2 点を定義すること: (a) 当該 `generated_files[]` entry の削除、(b) 正典 `_shared/graphics/` の生成済みファイルの処分方針。29 再埋め込み (上行) が却下済み slot を復元しない点は §9-2b 共通契約 (driver = `generated_files[]` − `excluded_slots[]`、plan は driver にしない) で構造的に担保済みのため個別対処不要。`graphic-plan.json` への書込権限追加も不要 (plan は配置メタのまま不変で良い) | **✅ F-7 で採用・実装済み** — (a) `generated_files[]` entry 削除 + `excluded_slots[]` append (reason に「21g 却下:」prefix) / (b) 正典ファイルは孤児として保持 (削除しない)。全 slot 却下は decision='skip', decided_by='step21g' (schema enum 拡張済み)。writer 実体は `skills/21g-graphic-embed-review/scripts/commit-approval.mjs` reject |
| 生成後のテイスト再選定 (21c への差し戻し) — §9-2b の差し戻し 3 分類に含めない (style_directive が全 slot のプロンプトに合成されるため全 slot が stale 化 = 全量再生成のコスト暴発経路)。v1 は非対応とし、必要になった場合の経路 (全量再生成の明示確認ゲート等) は採用要否から判断する | **F-7 で v1 非対応を確定** (21g は該当指示を受けず手動リセット運用 [§5] を案内する — `skills/21g-graphic-embed-review/refs/embed-guide.md` §5)。将来必要になったら再起票 |
| 逐語インライン規約 (`docs/html-generation-rules.md` §10/§11 の `<link>`/`@import` 禁止 — **色 lint の C-25 とは別規約**、§7) の適用範囲注記 1 行 (「ラスター `<img>` 相対参照は対象外」) を同 doc §10 へ追記。C-25 側は rule 文で raster img 除外を明記済みのため変更不要 | pipeline.yaml 変更案の適用と同時 (F-2A、§7 参照) |
| Step 35 export のグラフィック対応確認 — screens/*.md 内の画像参照は既に base64 インライン化されるが、`screens/{platform}/*.html` を配布対象に含める場合は `_shared/graphics/` 相対参照の inline 化が要ることの確認 | `/ayatori-export` 拡張時 (現行 Step 35 の対象は MD のみのため即時対応は不要) |
| sub-state 専用グラフィック (plan.json `state` field の "default" 以外) | 将来チケット (25b Input 契約の extension point を利用) |
| skip 後の後付け追加 (final_approved 後) を delta の entry mode に載せるか | 将来チケット (/ayatori-delta feature-add 亜種) |
| gpt-image-2 API 到達性 (キー未設定環境) の扱い — env flag 新設 vs 21e 実行時 degrade | F-5 (本設計は degrade 案を §8-4 に既定として記載) |
| docs/artifact-file-responsibility.md の責務マップ表 / CLAUDE.md Phase 表への転記 | pipeline.yaml 変更案の適用と同時 (F-2A) |
