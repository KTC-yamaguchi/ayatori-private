# ChargeMinder レバーカタログ & 計装インベントリ

> コンサルが介入設計時に参照する「使える武器」のカタログ。出典: `artifacts/charge_minder/reverse-engineered/raw-analysis.md` を蒸留。
> 「レバーカタログ」= 打ち手で使える機能と可変点。「計装インベントリ」= 効果検証(§8.1 測定可能性チェック)で照合する既存のログ・指標。

---

## レバーカタログ

| レバー | 内容 | 介入での使いどころ | 主な可変点 |
|---|---|---|---|
| ナッジ配信エンジン | ローカルプッシュ通知。発火4条件: ①時間帯 7:00–22:00 ②CoreMotionで自動車移動判定 ③ジオフェンス50m入域 ④当日その地点で未通知。Car Dealer / Other カテゴリは1日1回制限の例外。退域で通知トリガ除去。メッセージはカテゴリ別（自宅/職場/その他到着） | タイミング介入・文脈プロンプト（昼間充電誘導の主要手段） | 発火条件の閾値 / 通知文言 / 頻度（レート制限） / 対象地点カテゴリ |
| ポイント | 充電記録1件あたり: 通常10pt（常時）+ エコ10pt（8-16時窓に2時間以上重複、急速は15分以上）+ 連続5pt（当日初回充電）。cohort内ランキングに反映。手動付与API（POST /points）も有り | インセンティブ設計・昼間充電強化 | 配点（通常/エコ/連続）/ 付与条件 / エコ時間窓 |
| バッジ | badge_master で定義した条件（GTE/GT/LTE/LT/EQUALS/ALL_GTE × target_field × threshold）を充電記録ごとに UserStats と照合して自動評価。初級/中級/上級レベル。is_intervention フラグが true のバッジはナッジ非アクティブ時スキップ。プロフ画面で表示バッジ1個を選択可能 | 達成感・地位シグナル・段階的モチベーション | target_field / threshold / 新バッジ追加 / レベル定義 |
| 称号 | title_master で定義した累積ポイントの threshold に到達で解放（レベル順に付与）。新称号獲得時はポップアップ表示 | 段階的目標・長期継続 | threshold 設計 / レベル数 / 称号テキスト |
| クイズ（週次3択） | quiz_master で週別に出題内容を定義。EV知識に関する3択問題、正誤+解説表示、回答履歴保持（二重回答防止は UserDefaults で管理）。GET /quizzes → POST /quiz_answers | 知識・態度変容（EV / 昼間充電リテラシー向上） | 出題内容 / 解説テキスト / 週次配信スケジュール / 選択肢設計 |
| 豆知識（news） | news_master から週次・user_group 別にパーソナライズして配信（weekly_news_content_selector_service による personalize_condition 評価）。GET /news | 教育・社会的証明の継続配信 | 内容テキスト / 配信条件（user_group / 週番号）/ personalize_condition |
| 週次トラッカー | 7日分の充電を昼間 vs 総数で可視化（昼間充電に太陽アイコン）。WeeklyTrackerView。GET /charge_histories で集計 | フィードバック・進捗可視化（自己モニタリング促進） | 集計軸（昼間判定条件）/ 閲覧導線（ホームからの遷移タイミング） |
| 充電計画（ChargePlan） | 最適充電時間レコメンドをAPIが算出し、ChargingScheduleSummaryView で提示→ユーザーが承諾フロー（ChargingPlanPopupView）。accept_charging_plan で記録。API実装済みだが Phase1 未使用 | コミットメント・実行意図形成（介入群限定） | 計画UI / 承諾文言 / リマインド時刻 / Phase1 有効化フラグ |
| user_group / experiment_id | Cognito custom属性で Experiment（介入群 / ナッジあり）または Control（対照群 / ナッジなし）を設定。experiment_id で cohort を絞ってランキング・オペログ分析 | セグメント出し分け・A/B 比較群管理 | 群定義 / 出し分け条件 / cohort サイズ |
| 充電記録フロー | 多段フォーム: introduction → preparation → sessionList → feedback の 4 ステップ。入力項目: 日時/時間/場所/写真（任意）。送信失敗時も再入力不要で再試行可。ポイント/バッジ/称号付与の TransactWrite トリガ。confirm_charging_records で報酬モーメントを計装 | 記録のしやすさ（EAST: Easy）・行動完結の障壁低減 | ステップ数 / 入力項目 / フィードバック文言 / 写真任意化 |

---

## 計装インベントリ (§8.1 測定可能性チェックの照合元 — 全列挙)

### オペログ operation_type (20種)

共通フィールド: user_id / participant_id / experiment_id / user_group / elapsed_days(app_started_at起算) / operation_id / operated_at / operation_type / details

| operation_type | 何を測れるか |
|---|---|
| sign_in | アプリ起動頻度・セッション数・DAU/WAU |
| complete_onboarding | オンボーディング完了ファネル・離脱率 |
| show_splash | スプラッシュ画面表示回数・アプリ起動検知 |
| show_home | ホーム閲覧エンゲージメント・リテンション指標 |
| show_profile | プロフィール画面閲覧頻度・自己モニタリング行動 |
| show_charging_history_detail | 充電履歴詳細閲覧・振り返り行動の測定 |
| show_point_calendar | ポイント/カレンダー閲覧・インセンティブ関心度 |
| show_badge_list | バッジ一覧閲覧・達成感コンテンツへの関心度 |
| set_display_badge | 表示バッジ選択・自己表現/地位シグナル行動 |
| show_title_list | 称号一覧閲覧・長期目標への関心度 |
| show_knowledge_tips | 豆知識閲覧・コンテンツ接触率・教育介入効果 |
| use_help | ヘルプ利用頻度・UX 上の困りごとの代理指標 |
| operate_charging_record | 充電記録 CRUD（開始/アップロード/編集/削除）・記録行動の詳細追跡 |
| confirm_charging_records | 充電完了確認・獲得ポイント/バッジ/称号を含む報酬モーメント |
| accept_charging_plan | 充電計画の承諾・コミットメント形成の測定 |
| operate_charging_location | 充電地点 CRUD・利用地点管理行動の追跡 |
| answer_quiz | クイズ回答（quiz_id / correct_choice / user_answer）・知識変容・正答率 |
| interact_push_notification | プッシュ通知タップ/開封・ナッジ反応率・CTR |
| show_weekly_tracker | 週次トラッカー閲覧・進捗フィードバック接触率 |
| end_experiment | 実験参加終了・離脱 vs 完了の分類 |

### UserStats フィールド（全列挙）

| フィールド | 何を測れるか |
|---|---|
| total_record_count | 累計充電記録数・アプリ全体の利用継続量 |
| eco_charge_count | エコ充電（昼間充電）回数・介入の主要アウトカム指標 |
| charge_locations | 利用充電地点の集合（set）・行動多様性・地点開拓度 |
| spot_charge_count | 新規地点での充電回数・探索行動・地点レパートリー拡大 |
| record_type_counts | 場所別充電回数（home / office / public / other）・充電文脈の分布 |
| last_record_date | 最終充電日・離脱リスク判定・最終アクティブ日 |
| current_streak_charge_days | 現在の連続充電日数・習慣形成プロセスのリアルタイム追跡 |
| max_streak_charge_days | 最大連続充電日数・習慣形成の到達度 |
| record_week | 最終充電の週番号・実験週単位の行動パターン分析 |
| month | 最終充電の月・月次コホート分析の基準 |
| week_record_count | 今週の充電回数・週次行動量の変化追跡 |
| month_record_count | 今月の充電回数・月次行動量の変化追跡 |
