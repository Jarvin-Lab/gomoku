// 专家开局体系的来源声明与规范化定式数据。
export const OPENING_BOOK_PROVENANCE = Object.freeze({
  importedAt: "2026-06-22",
  licenseStatus: "No license declared; only standard opening names and coordinate facts were re-authored",
  rules: "Renju reference shapes, filtered and re-evaluated for freestyle Gomoku",
  source: "https://github.com/tc-imba/gomoku-openings",
});

// Relative to Black's first stone. Only the source's "White-favorable or balanced"
// families are retained; continuations are evaluated by this project's freestyle engine.
export const EXPERT_OPENING_SYSTEMS = Object.freeze([
  { name: "残月", family: "direct", white: [0, -1], black: [2, -1], preference: 1.08 },
  { name: "新月", family: "direct", white: [0, -1], black: [2, 1], preference: 1.06 },
  { name: "丘月", family: "direct", white: [0, -1], black: [1, 1], preference: 1.12 },
  { name: "山月", family: "direct", white: [0, -1], black: [1, 2], preference: 1.1 },
  { name: "游星", family: "direct", white: [0, -1], black: [2, 2], preference: 1.04 },
  { name: "疏星", family: "direct", white: [0, -1], black: [2, -2], preference: 1.05 },
  { name: "斜月", family: "diagonal", white: [1, -1], black: [-1, 1], preference: 1.12 },
  { name: "长星", family: "diagonal", white: [1, -1], black: [2, -2], preference: 1.08 },
  { name: "流星", family: "diagonal", white: [1, -1], black: [2, 2], preference: 1.06 },
  { name: "彗星", family: "diagonal", white: [1, -1], black: [-2, 2], preference: 1.04 },
]);
