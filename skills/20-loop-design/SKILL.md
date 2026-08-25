---
name: 20-loop-design
description: Phase 3 の Step 20。scores.json の採点結果に基づき、デザインを改善するループを継続するか、次の Step 21 人間レビューへ進むかを決定する。AI 改善可能な減点が 0 なら合格、上限到達なら人間エスカレーションする。
---

# 20 フィードバックループ制御（デザイン）

## 役割
採点結果に基づきデザインを改善するか、次ステップ（21 人間レビュー）へ進むかを決定する。

## 実行指示

`artifacts/{app_name}/scores.json` を読み込み、以下のロジックで分岐する：

```
if scores.current.ai_improvable_deductions == 0:
    → ループ合格。セッション分割チェックポイントへ（下記参照）

elif scores.attempt_count >= 3:
    「{attempt_count}回のデザインループでもAI改善可能な減点が残っています。人間エスカレーションします。」
    escalated = true で scores.json を更新
    → ループ上限到達。セッション分割チェックポイントへ（下記参照）

else:
    scores.attempt_count += 1 で scores.json を更新
    AI改善可能タグの一覧を表示:
    「attempt {attempt_count}/3: 以下のAI改善可能な問題が検出されました。17 から画面を再生成します:」
    {tags の中で type == "AI改善可能" のものを一覧表示}

    ※ 修正の実施は 17（画面生成）が担う。20 は改善指示の出力のみ行い、artifact は直接変更しない。

    → skills/17-screen-gen/SKILL.md を Read して 17 から再実行（画面生成からやり直す）
```

> **chrome（共通部品）指摘の routing**: `scores.json.current.tags` に `fix_location` フィールドを持つタグ（共通部品 = ボトムメニュー / ヘッダー由来）が含まれる場合、Step 17 への再生成指示で **修正先が正典であることを明示** する（`docs/html-generation-rules.md` §11.6）。
> - `fix_location == "chrome_canon"`（chrome の見た目/品質、AI改善可能）: 「**`_shared/components.html` / `components.css` の正典（値が token 由来なら `root-variables.css`）を Step 0b で直し、全画面へ再ペーストすること。個別画面の chrome を直接編集しないこと**」と再生成指示に明記する。正典 1 箇所を直せば self-check は新正典で再一致するため、Step 0b-3 の chrome self-check abort ループには陥らない。逆に個別画面を直すと毎回 abort するので厳禁。
> - `fix_location == "chrome_plan"`（chrome の IA、人間対応必要）: これは Step 19 で `type == "人間対応必要"` とされ `ai_improvable_deductions` に積まれないため、**本ループの自動修正対象に入らない**（Step 21 人間ゲートで提示され、承認者が Step 14 chrome プラン更新を判断する）。20 はこのタグを再生成指示に含めない。
> - chrome の見た目指摘を 3 attempt 消化しても解消しない場合は、正典の数値調整では足りない（IA / デザイン判断が必要な）可能性が高いため、escalation 経由で Step 21 人間ゲートへ送る（通常の escalation と同じ）。

> **L5 connectivity（各画面の入口/出口）defect の routing**: `fix_location` には chrome 系に加え `"mmd_structure"` が来る場合がある（`docs/screen-coverage-check.md` §4-5-5）。
> - `fix_location == "mmd_structure"`（L5 の `.mmd` 構造系 defect = `dangling_edge` / `orphan_in_list` / `unreachable` / `back_target_missing` 等の未配線・リンク切れ）: Step 17 の HTML 再生成では `.mmd`（Step 14 所有）を直せないため、Step 19 で `type == "人間対応必要"` とされ `ai_improvable_deductions` に積まれない。**本ループの自動修正対象に入らない**（chrome_plan と同型）。Step 21 人間ゲートで提示され、承認者が Step 14 再実行（`.mmd` 補完）を判断する。20 はこのタグを再生成指示に含めない。
> - 一方、L5 のうち `connectivity_back_affordance`（戻り先は親で確定するが HTML に戻る導線が無い、`fix_hint == back_affordance`）は `type == "AI改善可能"`（`fix_location` 無し）として `ai_improvable_deductions` に積まれるため、**通常どおり Step 17 再生成で自動修正を試みる**（戻るボタン等の導線追加）。

> `ai_improvable_deductions` には skill 19 が計算する `nfr_coverage.deductions_applied` (unaddressed NFR の累積減点) も含まれる。NFR 由来の漏れが検出されると本ループが palette / coverage 違反と同様に発火し、Step 17 への再生成指示に NFR 関連タグが含まれる (例: `nfr_coverage_unaddressed`)。ただし skill 17 が NFR-specific に対処できる範囲は限られるため、3 attempt 消化しても改善しない場合は escalation 経由で Phase 4 retro / skill 02 改修対象として扱う。`human_attested` / `deferred` の NFR は ai_improvable_deductions に積まれないため本ループには影響しない (Step 21 human gate / Phase 4 retro で処理)。

## セッション分割チェックポイント（ループ合格 / エスカレーション後）

Steps 21〜25 は Figma MCP・ブラウザ操作・Confluence 書き込みが集中する重処理セクションです。
ここでセッションを分割することで、コンテキスト肥大による不安定動作を防げます。

AskUserQuestion で以下を提示する：

```
【セッション分割チェックポイント — Step 20 完了】

デザインレビューループが完了しました。
  スコア: {total} / 100（attempt_count: {attempt_count}、escalated: {escalated}）

ここから Step 21〜25（全画面HTML承認 → Figma出力 → 最終承認 → デザインシステム更新 → コンポーネント構築）は
処理が重いため、新しいセッションでの実行を推奨します。

▶ このまま続ける     → Step 21（全画面HTMLレビュー）へ進みます
🔄 新しいセッションで → コピペ用プロンプトを表示して終了します
```

**「このまま続ける」の場合:**
→ `skills/21-screen-human-review/SKILL.md` を Read して実行

**「新しいセッションで」の場合:**
`pwd` を実行して `{repo_root}` を取得し、以下を表示して終了する：

```
✅ Step 20 完了。以下をコピーして新しい会話に貼り付けてください:

/ayatori-screens をお願いします。プロジェクト: {app_name}、作業ディレクトリ: {repo_root}
```

（新しいセッションの preamble が `ai_improvable_deductions == 0` かつ `screens_human_approved != true` を検出し、自動で Step 21 から再開します）

## scores.json 更新

ループバック時: `attempt_count` を +1 して保存
エスカレーション時: `escalated: true` を追加して保存

---

> **閾値の正規定義**: `pipeline.yaml` の `screens:` → `loop:` セクション。
