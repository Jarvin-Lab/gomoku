// 浏览器应用层共享的棋盘、棋子与难度显示常量。
export const BOARD_SIZE = 15;
export const BOARD_COLUMNS = Object.freeze("ABCDEFGHJKLMNOP".split(""));
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const AI_LEVEL_LABELS = Object.freeze({
  casual: "休闲",
  advanced: "进阶",
  expert: "专家",
});

/** 将零基行列转换为棋盘坐标；列标跳过 I，避免与数字 1 混淆。 */
export function formatBoardCoordinate(row, col) {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= BOARD_SIZE ||
    col < 0 ||
    col >= BOARD_COLUMNS.length
  ) {
    throw new RangeError(`Invalid board coordinate: row=${row}, col=${col}`);
  }
  return `${BOARD_COLUMNS[col]}${BOARD_SIZE - row}`;
}
