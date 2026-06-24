// 棋盘坐标回归测试：确保棋盘标尺与落子日志统一跳过字母 I。
import {
  BOARD_COLUMNS,
  BOARD_SIZE,
  formatBoardCoordinate,
} from "../src/app/constants.js";

if (BOARD_COLUMNS.length !== BOARD_SIZE) {
  throw new Error("Column label count must match board size");
}
if (BOARD_COLUMNS.includes("I")) {
  throw new Error("Column labels must skip I");
}

const expectations = [
  { row: 14, col: 0, expected: "A1" },
  { row: 7, col: 7, expected: "H8" },
  { row: 7, col: 8, expected: "J8" },
  { row: 0, col: 14, expected: "P15" },
];

expectations.forEach(({ row, col, expected }) => {
  const actual = formatBoardCoordinate(row, col);
  if (actual !== expected) {
    throw new Error(`Expected ${expected} for row=${row}, col=${col}, got ${actual}`);
  }
});

console.log("Coordinate notation tests passed.");
