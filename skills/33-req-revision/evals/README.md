# Step 33 sub-step 4.5 相互参照 checker — CLI 契約 eval

`scripts/check-req-crossrefs.mjs` (change-manifest + snapshots + requirements/ → 3 観点検証 + report + JSON verdict) を黒箱 CLI として golden fixture で固定する。集合演算の白箱検証は `scripts/check-req-crossrefs.test.mjs` 側。

## 実行

```bash
npm test                                                                # node --test の規約 discovery で自動実行
node --test skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs   # 本 eval のみ
```

fixture の app/ は tmpdir へ複写してから実行するため (report は app 内へ書かれる)、`npm test` が fixture / 作業ツリーを汚すことはない。

## golden の再生成 (checker の判定・出力仕様を意図的に変えたとき)

```bash
node skills/33-req-revision/evals/check-req-crossrefs-evals.test.mjs --update
```

`npm run evals:regen-goldens` は WCAG eval 専用のため本 eval には効かない。再生成後は各 expected.json の `verdict` が fixture 名の意図 (pass-* / fail-*) と一致していることを確認すること。

## fixture 一覧 (fixtures/<name>/{app/, expected.json, expected-report.md})

| fixture | 固定している挙動 |
|---|---|
| pass-clean-full-coverage | 全 doc snapshot (full)・Entity 1/10 の可変桁・AC 範囲表記・NFR スラッシュ表記を含む合格系 |
| fail-removed-residue | 観点 1: 削除済 ID の参照残存を file:line 付きで FAIL |
| fail-manifest-doc-missing-ref | 観点 2: manifest が宣言した doc に ID が出現しない → FAIL (missing doc 列挙) |
| fail-missing-baseline-id | 観点 3(a): baseline ID が manifest 宣言なしに消えた (renumber/shift 徴候) |
| fail-mid-insertion | 観点 3(b): max_baseline 以下の番号への途中挿入 |
| qw3-partial-coverage-pass | 部分 snapshot 時の母集合統一 — snapshot 外 doc の既存 ID を途中挿入と誤検出せず PASS + coverage 警告 |
| removed-id-also-added | 置換系 entry: removed の summary が生存 ID (移行先) に言及しても、主体は section のみ導出のため誤 FAIL しない |
| fail-residue-hidden-in-modified-summary | modified の summary が削除 ID に言及しても残存検査は無効化されず FAIL する (観点 1 の素通り防止) |
| removed-section-without-id | removed entry の section に ID が無い場合、観点 1 は検証不能 — 沈黙 PASS にせず warnings で可視化 |
| invalid-entry-missing-doc | requirement_changes entry の doc 欠落 → exit 2 (想定外 crash による exit 契約破りを防ぐ) |
| kanten3-skipped-no-snapshots | snapshots/ 不在 → 観点 3 は skipped として明示し、観点 1/2 のみで判定 |
| phase5-variant-error | Phase 5 変形 manifest (changed_docs + baseline) → exit 2・stdout 空・report 未作成 |
