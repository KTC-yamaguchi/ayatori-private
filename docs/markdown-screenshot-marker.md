# Markdown Screenshot Marker 仕様

`/ayatori-export` (`skills/35-md-to-html-export/refs/build-md-export.py`) で MD → HTML 結合時に、Markdown 内のマーカーを展開してスクリーンショット画像を base64 インラインで埋め込む仕組みの仕様。

---

## 1. マーカー構文

Markdown 本文に以下を記述すると、HTML 化時に画像群へ自動展開される。

```markdown
<!-- screenshots: SCR-XXX -->
```

| 形式 | 動作 |
|---|---|
| `<!-- screenshots: SCR-001 -->` | `screens/screenshots/` 配下から `SCR-001*.png` を検索して横並び展開 |
| `<!-- screenshots: SCR-002:none -->` | 「スクリーンショットなし」プレースホルダを表示 |

- マーカーは段落として 1 行で書く（前後に空行）
- 大文字 `SCR-` + `[A-Z0-9-]+` を screen_id として扱う

---

## 2. 画像ファイル名規約

```
artifacts/{app_name}/screens/screenshots/[...任意のサブディレクトリ]/{screen_id}[--{variant}].{ext}
```

| 要素 | 説明 | 例 |
|---|---|---|
| `screen_id` | 画面ID（大文字英数とハイフン） | `SCR-001`, `SCR-HOME-01` |
| `--{variant}` | 状態違いを示すサフィックス（任意） | `--default`, `--error`, `--loading`, `--popup-XXX` |
| `{ext}` | 画像フォーマット | `.png`（推奨）、`.jpg` / `.jpeg`、`.webp`、`.gif` |

- サブディレクトリは自由（プロジェクトのファイル管理しやすい構造で配置してよい）。スクリプトは `screenshots/` 配下を再帰的に探索する。
- 同一 variant で複数フォーマットが存在する場合は **PNG を優先** して埋め込む。
- フォーマットは大文字小文字を区別しない（`.PNG` / `.Jpg` 等も認識する）。

---

## 3. variant の並び順

複数 variant がヒットした場合、デフォルトはアルファベット順（priority 50）で並ぶ。

プロジェクト固有の固定順序が必要なら、`skills/35-md-to-html-export/refs/build-md-export.py` の `VARIANT_PRIORITY` を拡張する。`--order` 引数は後述の Markdown ファイル順序だけを制御し、variant の並び順には影響しない。

```python
# 例: A/B テスト用にcontrol→interventionの順で並べたい場合
VARIANT_PRIORITY = {"control": 0, "intervention": 1}
```

---

## 4. 出力 HTML

最大 4 列までの横並び `<figure>` で展開される。各画像は `data:{mime};base64,...` の形式でインライン埋め込みされるため、HTML ファイル単体で `file://` で開いても画像が表示される。MIME type は拡張子から自動解決する（`.jpg` → `image/jpeg`、`.webp` → `image/webp` 等）。

---

## 5. ファイル順序の決定

MD ファイルの章順は以下の優先度で決まる:

1. `skills/35-md-to-html-export/refs/build-md-export.py --order foo.md bar.md` で明示指定
2. ファイル名のアルファベット順（`_` プレフィックスのファイルは除外）

---

## 6. スクリーンショットの作成・保存方法

スクリーンショットは以下の方法で取得し、`screenshots/` に保存する。

### Step 22 の Figma キャプチャ（推奨）

`/ayatori-screens` の Step 22 (`figma-capture-runner`) を実行すると、Figma フレームのスクリーンショットが `artifacts/{app_name}/screens/screenshots/` に自動保存される（`FIGMA_MCP_ENABLED=true` 時）。

ファイル名は `{screen_id}[--{variant}].png` 形式で出力されるため、マーカー展開と自動的に対応する。

### ブラウザや Figma から手動キャプチャ

Step 22 を使わない場合は手動でキャプチャし、以下の命名規則でディレクトリに配置する:

```
artifacts/{app_name}/screens/screenshots/
  SCR-001.png                  # バリアントなし（デフォルト状態）
  SCR-001--error.png           # エラー状態
  SCR-002--loading.png         # ローディング状態
  SCR-002--default.png         # デフォルト状態
```

- **推奨フォーマット**: `.png`（ロスレスで Retina 対応）
- `.jpg`/`.jpeg`/`.webp` も使用可能（ファイルサイズを抑えたい場合）
- 同一 variant に複数フォーマットが混在する場合、PNG が優先される

### 出力先の確認

```bash
ls artifacts/{app_name}/screens/screenshots/
```

---

## 7. 関連

- スクリプト: `skills/35-md-to-html-export/refs/build-md-export.py`
- スキル: `skills/35-md-to-html-export/SKILL.md`
- Phase: `phases/export/SKILL.md`（コマンド `/ayatori-export`）
