# 二段階完了モデル — 完走判定式の設計根拠

> 完走判定式そのもの (正本 / SoT) は `CLAUDE.md`「完走後 Phase 共通 Entry Guard」節。本ファイルは、判定式が 2 条件 (`final_approved` OR `completed_at_states`) で十分であり、`state_pattern_skipped` を条件に含めない理由の検討記録を保持する。

**なぜ S を消し C を残すか** (設計根拠。判定実行には「2 条件のみ」で十分):
- 通常フローでは `state_pattern_skipped ⟹ final_approved` (25a が `final_approved == true` を前提とするため、`skills/25a-state-pattern-plan/SKILL.md`「前提条件」節)、`completed_at_states ⟹ final_approved` (25e も同前提) がいずれも成り立つ。よって両者とも 2 条件判定では冗長で、skip ケースも完全完了ケースも `final_approved` で拾える。
- **S は削る (有害な冗長)**: S を独立条件にすると唯一効くのが `(F=false, C=未set, S=true)` という 25a 前提に反する手書き stub のみで、main 未承認を完走扱いする誤判定を生む。かつ S を起動条件として読む live consumer は retro 以外に存在しない。
- **C は残す (consumer のある冗長)**: `completed_at_states` は delta/delta-mini が sub-state 完全完了の識別 (`sub_state_aware` 判定、`skills/28-impact-analysis/SKILL.md`) で読む live consumer を持つため 2 条件の一方として維持する (起動判定上は冗長だが、消すと他 consumer に波及する)。

**Reverse 基線の例外 (`baseline_approved_at`) を 2 条件に混ぜない理由**: reverse 経路プロジェクトの基線印は F / C とは別キーで持ち、Phase 1d / 5 / 6 が accept する (SoT は CLAUDE.md「完走後 Phase 共通 Entry Guard」節)。F に混ぜる (reverse 側が `final_approved: true` を書く) と、開けるつもりのない扉 (Phase 4 retro / lint hook の完了ガード等、F を読む全 consumer) が一斉に開き、「画面レビュー済み」という F の従来の意味が壊れるため。別キー + 扉ごとの opt-in なら、accept する Phase を判定式の追加箇所単位で制御できる。

ただし別キーにした代償として、**F / C が持っていた「鍵の出自が鍵の意味を保証する」構造が失われる**。F の writer は Step 23、C の writer は Step 25e であり、鍵の存在と「人間が画面レビューを承認した」事実が同一物だったため、forward 経路で Phase 3 進行中のプロジェクトは検査以前に構造的に排除されていた。`baseline_approved_at` の正規 writer は `/ayatori-screens` の screens-lite ルート出口にあるベースライン承認ゲート (`phases/screens/SKILL.md` § Execution — screens-lite の lite-4c) で実装済みだが、検証・Standalone 運用のための手動 stub でも同じ鍵を書けるため、鍵の存在だけで出自が保証される構造には戻りきらない。そのため判定式に由来検査 (`requirements.json.status == "REVERSE_ENGINEERED"`) を AND で置く (SoT は CLAUDE.md「完走後 Phase 共通 Entry Guard」節)。実装済みのゲートは reverse 経路にしか存在せず (Route 選択自体が REVERSE_ENGINEERED 限定 + 押印直前に同 status を assert)、F / C と同じ構造にほぼ戻っている — 由来検査はその分冗長になったが、手動 stub 運用が残る限り forward への誤適用防御として維持する (冗長だが無害)。

**扉の選定は嗜好ではなく材料の不変条件から導出する**: `baseline_approved_at` が保証する材料は「requirements/*.md 8 文書 + screens/00-screen-list.md + 画面仕様 (.md) + tokens.json + screens-lite が作る遷移図 (`00-transition-map.mmd` + 派生ビュー) と共通部品の正典 (`screens/_shared/`)」のみで、**画面 HTML / scores.json / figma-state.json は保証しない**。これらを必須材料とする step を含む Phase は accept できない — retro (scores.json 等を fallback なしで読む) が閉である理由はここから導出される。delta-mini は run 記録 + feedback-log しか読まないため accept できる (当初 2 扉案から材料検査の結果 3 扉に拡張。動機は「reverse したプロジェクトで機能追加とその改善ループを完結させる」)。今後扉を増やす提案は、この材料検査 (その Phase が必須参照する artifact を列挙 → 基線が保証する集合に含まれるか) を通してから判断する。
