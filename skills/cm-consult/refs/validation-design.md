# 効果検証設計テンプレート — validation-{slug}.md (pre/post KPI モニタリング)

> 統制群を必須としない軽量な pre/post 設計。Step 3-b/3-c で作成。

## 仮説
「{打ち手X}により、{行動指標Y}が介入期間内に{Z}だけ改善する」

## KPI 定義 (3層)
| 層 | KPI | 定義 | 測定源(候補) |
|---|---|---|---|
| 主要 | {例: 昼間充電比率} | {eco_charge / total} | {UserStats.eco_charge_count 等} |
| 補助 | {例: ナッジ反応率} | {通知タップ/配信} | {interact_push_notification} |
| ガードレール | {例: 離脱率/通知OFF率} | {副作用} | {end_experiment 等} |

## §8.1 測定可能性チェック表 (必須 — 要求3→要求2 の逆流関門)
各 KPI の測定源を refs/chargeminder-levers.md の計装インベントリと照合し ✅/△/❌ 判定。
△❌ は計装要求として proposal セクション2(計装要求)へ昇格する。

| KPI | 測定に必要なイベント/フィールド | 既存有無 | 判定 | 昇格した計装要求 |
|---|---|---|---|---|
| {KPI1} | {confirm_charging_records 等} | あり | ✅ 既存で測定可 | なし |
| {KPI2} | {通知に文言ID属性が必要} | 属性不足 | △ 粒度不足 | interact_push_notification に message_id 追加 |
| {KPI3} | {新規 operation_type が必要} | なし | ❌ 計装なし | 新規 operation_type 追加 |

判定基準:
- ✅ 既存で測定可 / △ イベントはあるが属性・粒度不足 / ❌ 計装そのものが存在しない

## 手順
1. ベースライン期間(pre)を {N週} 計測
2. 介入投入
3. 介入期間(post)を {M週} 計測。elapsed_days で週次集計
4. pre vs post 比較

## 評価基準
| KPI | 合格閾値 | 判定ルール |
|---|---|---|
| {主要KPI} | {例: pre比 +15pt} | {pre比 or 目標到達} |
| {ガードレール} | {例: 離脱率 <5%} | {上限超過で不合格} |
