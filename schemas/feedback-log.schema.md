# feedback-log.md — フォーマット規約

> パイプライン実行中に発生した修正・指摘・設計変更の記録。
> ⑰ 振り返りエージェント (`skills/26-retro` Phase A) が改善提案生成の唯一の定性ソースとして読み込む。
> CLAUDE.md 「Feedback Log」 セクション (実行ルール 6) に対応する公式仕様。

---

## ファイルパス

```
artifacts/{app_name}/feedback-log.md
```

`{app_name}` は `requirements.json.app_name` と一致。

---

## ファイル先頭テンプレート

新規作成時は以下のヘッダから始める：

```markdown
# フィードバックログ

> パイプライン実行中に発生した修正・指摘・設計変更を記録する。
> 26 振り返りエージェントが skills/NN-*/SKILL.md の改善提案を生成する際の唯一の定性ソース。
> CLAUDE.md「Feedback Log」 (実行ルール 6) に従い、発生のたびに即追記すること。

## ログ
```

---

## エントリ形式 (1 件 = 1 行)

```
- **[NN] PatternX (短い件名)**: {何が起きたか} → {原因} → {即時の対応}
```

### フィールド

| フィールド | 必須 | 内容 |
|---|---|---|
| `[NN]` | ✅ | step 番号 (`通しNO.`、2 桁ゼロ埋め)。`pipeline.yaml` の steps 配列に対応 (例: `[08]`, `[17]`)。⑰ 振り返り由来は `[26]`。複数 step に跨がる場合は最も上流の step を選択し、本文で他 step に言及する。|
| `PatternX` | ✅ | 下記「3 パターン」のいずれか。`Pattern A` / `Pattern B` / `Pattern C`。 |
| `(短い件名)` | 推奨 | 30 字以内の件名。同一ファイル内の grep / 振り返り表示で識別しやすくする。省略可。 |
| `何が起きたか` | ✅ | 観察された事象。⑰ が「現象」として再記述できる粒度。 |
| `原因` | ✅ | なぜそれが起きたか (SKILL.md の指示不足・出力定義不足・制約欠如・ヒアリング軸欠如など)。 |
| `即時の対応` | ✅ | その場でとった対応。⑰ が「次回からどう変わるか」を考える起点。 |

矢印は半角スペースを挟んだ ` → ` (U+2192) に統一する。

### 3 パターン

CLAUDE.md「Feedback Log」 セクション と一致。

| パターン | 定義 | 典型例 |
|---|---|---|
| **Pattern A** | 人間ゲートが修正指示を返した | 「⑦ 人間承認で『SHOULD 機能を 2 件追加して再生成』」 |
| **Pattern B** | エージェントがミスをしてやり直した | 「⑨ サンプル HTML がカラートークン未使用で再生成」 |
| **Pattern C** | パイプライン設計の欠陥が判明した | 「⑰ subagent の Write 権限不足で並列生成停止 → 設計変更要」 |
| **Pattern D** | Operating Principle 4 違反 (AI が UNCERTAIN を補完で済ませた) | 「② Step02 で Must 機能のスコアリング式を user 未確認のまま発明 (×2.0 等) → Step07 要件トレース監査が user 確定 input に突合できず `requirement-deviations.json` に phase=requirements で記録 → 人間ゲートで容認/修正」 (E2E 検証由来。旧 uncertainty.entries の hook R1 検出経路は撤去済) |

複数パターンに該当する場合、**根本原因に近い側を 1 つだけ選ぶ** (重複記録禁止)。

Pattern D の **検出経路は 4 つ**: (1) `.claude/hooks/schema-light-check.sh` の Write block (R3 pending-questions 必須 field / R5b target 文法 / R6 requirement-deviations) / (2) `pipeline.yaml constraints[P4-*]` 違反の人間目視 / (3) `pending-questions.json.entries[]` への append (skill / orchestrator 側 self-discipline) / (4) **output 側監査** = 生成後に review/gate (Step07/13/18/29/25c) が `requirement-deviations.json` に要件外追加を記録 (E2E 検証由来)。

Pattern D の **集計・改善提案**は `skills/26-retro` が担う (検出ではなく事後分析): (1)-(3) で蓄積された Pattern D entries を by-step / by-target / by-role (main/subagent) で集計し、3 件以上同 step 集中の場合は次回パイプライン改善対象として retro レポートに含める (SKILL.md Read 漏れ / pipeline.yaml constraints[P4-*] applies_to 拡張 / agent.md Contract 強化 等の提案)。

---

## 良い記録例

```
- **[08] Pattern A (ヒアリング揺れ戻し)**: 当初「既存仕様書から生成」で 6 軸ヒアリングをスキップ → ユーザーが「6 軸ヒアリングは飛ばさないで」と指示変更 → 残り 5 軸を再ヒアリングして design-brief.md を再生成。
- **[17] Pattern C (subagent Write 権限不足)**: 4 並列 general-purpose subagent に画面 HTML 生成を委譲 → Write tool の permission denial で全停止 → 大量ファイル生成は メインコンテキスト逐次 か 専用 subagent (allow リスト事前登録) でなければ不可、と判明。
```

良い記録の条件：
- **観察ファクト** (主観でなく観察された事象)
- **次回から防ぐための情報** (原因と対応のセット)
- **粒度が一定** (1 件の事象 = 1 行)

---

## NG (記録してはいけない)

| NG | 理由 |
|---|---|
| 「うまくいった」「OK」 | 失敗・修正の記録ではない。これは memory 側 (Phase I) に書く。 |
| 個人攻撃 (誰が悪い) | 仕組みの問題として書く。 |
| 単なる進捗ログ | 「⑩ 完了」みたいな進捗は別ツール (Jira) で管理する。 |
| パスワード・APIキー | 機密情報禁止。Confluence 等への外部共有可能性あり。 |

---

## 検証

⑰ 振り返りエージェントは以下を期待する：

1. ファイル先頭が `# フィードバックログ` ヘッダで始まる
2. `## ログ` セクション以下に 1 行 1 エントリで `- **[NN] PatternX ...**: ... → ... → ...` 形式
3. 文字エンコーディング UTF-8 / LF 改行
4. 1 ファイル ≤ 200 エントリ (超過時は次プロジェクトへ繰越)

`feedback-log.md` が空 (ヘッダのみ) または存在しない場合、⑰ は数値スコア (`scoring-history.json` / `scores.json`) のみで分析を続行するが、品質低下の警告を表示する (`skills/26-retro/SKILL.md` Phase A 参照)。
