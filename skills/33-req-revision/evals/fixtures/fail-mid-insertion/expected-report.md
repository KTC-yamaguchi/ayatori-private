# Cross-reference Integrity Report — Run 2026-07-06-005

Run ID: 2026-07-06-005  |  Date: 2026-07-06

## 観点 1: 削除済 ID 参照残存

違反 0 件

## 観点 2: manifest 宣言と実装の一致 (ID 種別非依存)

- F-03: PASS — expected [05-features.md] ⊆ actual [05-features.md]

## 観点 3: Append-only 規則遵守 (renumber/shift + 途中挿入の 2 段検出。欠番=即違反にはしない)

- **違反 (b)**: F に append-only でない追加があります [3] (max_baseline=5 以下の番号への挿入)

## 結論: FAIL
