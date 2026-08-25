# テストフィクスチャ

AYATORI パイプラインの動作確認に使うサンプルデータ。
新しいメンバーがパイプラインを初めて試す際や、ステップを変更した後の回帰テストに使う。

---

## 使い方

### 1. サンプルプロジェクトをセットアップする

```bash
cd /path/to/AYATORI

# フィクスチャをコピーして新しいプロジェクトとして配置する
cp -r docs/test-fixtures/sample-app "artifacts/テスト用タスク管理アプリ"
```

### 2. Claude Code を起動する

```bash
claude
```

CLAUDE.md を読んだとき、`artifacts/` 配下に `テスト用タスク管理アプリ` ディレクトリが見つかるため、
「継続: テスト用タスク管理アプリ」として再開するか確認ダイアログが表示される。

### 3. 01 から開始する場合

`sample-app` をコピーせず、セッション内で 01 から進めて `app_name = "テスト用タスク管理アプリ"` を答える。
7軸の想定回答は `docs/test-fixtures/sample-inputs.md` を参照（※ 7軸目「デザイン出力範囲」は新設のため、`sample-inputs.md` の既存 6軸に加えて自分で回答が必要）。

### 4. 期待される出力を検証する

各ステップ完了後、`expected/` 内のファイルと比較して正常動作を確認する：

```bash
# rubric.json (criteria 定義) と scoring-history.json (attempt 履歴) を分けて検証する
python3 -c "
import json
rubric = json.load(open('artifacts/テスト用タスク管理アプリ/rubric.json'))
history = json.load(open('artifacts/テスト用タスク管理アプリ/scoring-history.json'))
print('all criteria exist:', len(rubric['criteria']) == 5)
print('total check:', history['attempts'][-1]['total'] >= 80)
print('attempt_count check:', len(history['attempts']) <= 2)
"
```

---

## ファイル一覧

| ファイル | 内容 |
|---|---|
| `sample-inputs.md` | 01 質問エージェントへの想定回答（旧 6軸時点。7軸目は随時補足） |
| `sample-app/` | 02 完了後の期待出力（requirements/ 8ファイル + rubric.json / scoring-history.json / scores.json の空 stub） |
| `expected/rubric.json` | 03 完了後の期待出力スキーマ（criteria 定義のみ）|
| `expected/scoring-history.json` | 04 完了後の期待出力スキーマ（attempts[] に attempt が append される。スコアは参考値）|
| `expected/requirements.json` | 01 完了後の期待スキーマ（要件の純粋な記述のみ）|
| `expected/pipeline-state.json` | 06 完了後の期待出力スキーマ（`confluence.requirements.*` が埋まる。旧 rubric.json から分離）|

---

## 注意事項

- `expected/` 内のスコアは「こういう構造になるはず」の参考値。
  Claude の応答は非決定的なため、完全一致は求めない。
- 検証のポイント: **キー構造・型・必須フィールドの有無**。
- Confluence への保存は `confluence_parent_id = null` のまま試行可能（06 でスキップされる）。
