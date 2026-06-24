# Expert opening book source

The opening names and first-three-stone coordinate facts were re-authored from the
traditional 26-opening reference collected by
[`tc-imba/gomoku-openings`](https://github.com/tc-imba/gomoku-openings), inspected on
2026-06-22.

The source repository declares no license, so its code, README text, and JSON files are
not vendored here. This project retains only ten standard shapes labelled by that source
as “White-favorable or balanced”, removes source duplicates through symmetry matching,
and computes moves 4–12 locally with the freestyle-Gomoku strategic evaluator. Renju
forbidden-move assumptions are therefore not imported as game rules.
