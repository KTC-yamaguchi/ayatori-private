# WCAG 基準参照（リダイレクト）

このファイルの内容は **`docs/wcag-standards.md`** に移動しました。

## 参照

WCAG 2.2 AA の基準・数値閾値・計算式・OKLCH補正アルゴリズムは以下を参照してください:

**[`docs/wcag-standards.md`](../../../docs/wcag-standards.md)**（単一正典）

### 該当セクション

- §2 準拠基準一覧（1.4.3 / 1.4.11 / 2.4.7 / 2.5.8 / 2.3.3 / 3.3.7 / 3.3.8）
- §3 数値閾値（contrast 4.5:1 / touch target 44px / focus ring 2px+2px / mobile font 12px）
- §4 計算式（相対輝度 / コントラスト比）
- §5 OKLCH補正アルゴリズム
- §6 contrast pair 検証対象一覧

### W3C 公式
- https://www.w3.org/TR/WCAG22/

---

## 移動理由

`docs/wcag-standards.md` を AYATORI パイプラインにおける WCAG の**単一正典**とすることで、以下を実現:

- 08（palette 導出）・09（HTML 安全網再検証）・11（制約確定+palette検証）・17（全画面検証）が同じソースを参照
- WCAG バージョン・閾値の変更が1ファイルで完結
- Phase 2 でプロジェクト単位のバージョン切替（AA→AAA 等）を拡張しやすい
