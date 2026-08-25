# ナッジ理論 → ChargeMinder レバー マッピングツールキット

> **コアバリューノート**: このファイルはコンサルが介入案を設計するとき、行動科学の機構と具体レバーを正確に接続するための照合元。
> **禁止**: 「social proof だけで終わる一般論」は提案に出してはいけない。機構・レバー・具体例・可変点がすべて揃って初めて有効な打ち手になる。

---

## フレームワーク

介入案を作成するとき、下記4フレームワークのいずれかに帰属させ、使用する行動科学的機構を明示すること。**すべての打ち手案は「機構名 + フレームワーク帰属」の宣言が必須。**

| フレームワーク | 要素 |
|---|---|
| **EAST** | Easy（摩擦低減）/ Attractive（魅力づけ）/ Social（社会的規範）/ Timely（適切なタイミング） |
| **MINDSPACE** | Messenger / Incentives / Norms / Defaults / Salience / Priming / Affect / Commitment / Ego |
| **Fogg B=MAP** | Behavior = Motivation × Ability × Prompt（動機×能力×プロンプトの三位一体） |
| **COM-B** | Capability（能力）/ Opportunity（機会）/ Motivation（動機）→ Behavior |

---

## マッピングテーブル (1機構 = 1行、具体レバー+具体例+可変点 必須)

| ナッジ機構 | 行動科学的効果 | ChargeMinder レバー(具体) | 具体例(このアプリでの打ち手文) | 可変点 |
|---|---|---|---|---|
| **実行意図 (Implementation Intentions)** | if-then計画で実行率↑ (Gollwitzer 1999) | 充電計画API の承諾フロー (Phase1未使用を起こす) | 「次の週末はいつ・どこで充電するか計画として承諾させ、当日その時刻にリマインド」— ChargingScheduleSummaryView → ChargingPlanPopupView → accept_charging_plan でコミットメント計装 | 計画作成UI/承諾文言/リマインド時刻/Phase1有効化フラグ |
| **デフォルト効果 (Defaults)** | 初期値が選択に強く影響 (Thaler & Sunstein) | ナッジ発火4条件の初期値 + is_nudge_applied 既定 | 「昼間充電促進通知をデフォルトON、時間帯窓の初期値を8-16時に寄せる」— 発火条件①時間帯を昼間寄りに既定することでオプトアウトしない限り昼充電誘導が継続 | 発火条件の初期セット/エコ時間窓(8-16時)初期値/通知デフォルトON/OFF |
| **社会的証明 (Social Proof / Norms)** | 他者の行動が規範に (Cialdini) | ランキング + news パーソナライズ | 「『同じ実験群の上位30%は週4回昼充電』をnewsで提示」— news_master の personalize_condition で user_group を絞り、cohort内の昼充電統計を週次配信 | ランキング露出文言/news条件(user_group/週番号)/personalize_condition/統計集計軸 |
| **損失回避 + フィードバック** | 損失提示と即時FBで維持 (Kahneman & Tversky) | 週次トラッカー + WeeklyResultPopup | 「『今週は昼充電が先週比-2回』と赤字で可視化」— show_weekly_tracker オペログで接触率を計装し、eco_charge_count の週次差分を損失フレームで表示 | トラッカー集計軸(昼間判定条件)/ポップアップ文言/損失フレーム vs 利得フレームのA/B |
| **ゲーミフィケーション / 達成 (Incentives/Ego)** | 報酬と地位で動機↑ (MINDSPACE: Incentives + Ego) | バッジ master 条件 + ポイント配点 | 「『昼充電5回』で新バッジ、エコptを10→15に増点」— badge_master の target_field=eco_charge_count / threshold=5 に新バッジ追加、ポイント付与条件のエコ配点を引き上げ | badge_master target_field/threshold/新バッジレベル定義/エコpt配点(現行10pt→変更値) |
| **タイミング / 文脈プロンプト (EAST: Timely, Fogg: Prompt)** | 適切な瞬間の合図 | ナッジ発火4条件 | 「充電スポット入域×自動車移動時にだけ介入文を出す」— ジオフェンス50m入域 + CoreMotion自動車判定の発火条件が揃った瞬間にプッシュ。interact_push_notification CTRで反応率を計装 | ジオフェンス半径(50m)/対象地点カテゴリ/時間帯範囲/レート制限(1日1回上限)/通知文言 |
| **知識・規範形成 (COM-B: Capability)** | 知識付与で能力↑ | 週次3択クイズ + news | 「昼充電のCO2削減効果をクイズ化し正解で称賛」— quiz_master に昼充電リテラシー問題を追加、answer_quiz オペログで正答率を追跡。show_knowledge_tips でニュース閲覧率も計装 | 出題内容/解説文/週次配信スケジュール/選択肢設計/news連携テキスト |
| **Easy / 摩擦低減 (EAST: Easy)** | 手間↓で実行率↑ (Fogg: Ability) | 充電記録フロー(多段フォーム) | 「記録ステップを減らす/場所を自動補完して記録の手間を下げる」— introduction→preparation→sessionList→feedback の4ステップを短縮し、operate_charging_record 開始→完了のドロップ率を測定 | ステップ数/入力項目の必須/任意区分/場所自動補完精度/写真任意化/フィードバック文言 |
| **顕著性 (Salience / Priming)** | 注意を引く提示 (MINDSPACE: Salience) | 週次トラッカー太陽アイコン + ホーム赤バッジ | 「昼充電実績を太陽アイコンで強調、新着を赤バッジで顕在化」— show_weekly_tracker の昼間充電セルに太陽アイコンを付与し、未確認トラッカーはホームに赤バッジで通知。show_home オペログでCTRを追跡 | 太陽アイコン表示条件(eco_charge_count閾値)/赤バッジ表示トリガ/ホームからの遷移導線 |

---

## 各打ち手案に必須の記載

1. **機構名 + フレームワーク帰属** — 例: 「実行意図 (Fogg B=MAP: Prompt + MINDSPACE: Commitment)」
2. **使う具体レバー** — レバーカタログ(`chargeminder-levers.md`)に記載されたレバー名で特定。カタログ外の機能を使う場合は「**新規実装要求**」と明示
3. **具体例** — 「このアプリで何をどう変える/出す/表示するか」を1文で
4. **可変点** — A/Bテストや実験パラメータとして変えられる具体的な値・設定名
5. **期待効果 + 副作用/ガードレール** — 達成したいアウトカム指標 (例: eco_charge_count↑) と、意図しない副作用(例: 通知疲れ・過剰インセンティブによる行動の外発的動機付け化)を両記

---

## アンチパターン (提案で出してはいけない)

- ❌ **レバーに紐づかない一般論** — 「社会的証明を活用する」だけで終わる提案。ChargeMinderの「どのレバーで」「どの画面/API/設定値を」変えるかが書かれていない打ち手は無効
- ❌ **ChargeMinderに存在しない機能を前提** — `chargeminder-levers.md` に記載されていない機能(例: リアルタイム充電状態API、友達招待機能など)を前提にする打ち手。カタログ外は必ず「**新規実装要求**」と明示して提案すること
- ❌ **可変点が書かれていない打ち手** — 「通知のタイミングを最適化する」のような記述で可変点(何の閾値を/どの値に/どのAPIパラメータを)が空白な打ち手
- ❌ **フレームワーク帰属なしの提案** — EAST / MINDSPACE / Fogg B=MAP / COM-B のどれにも帰属させず「ナッジ的に」とだけ書く曖昧な提案
- ❌ **計装されていない介入** — 効果検証に使えるオペログ(`operation_type`)やUserStatsフィールドを参照せず、測定可能性を無視した打ち手(§8.1 測定可能性チェックに耐えない)
