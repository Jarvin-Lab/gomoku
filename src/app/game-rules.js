// 纯游戏规则与棋谱结构校验，不依赖 DOM，供对局和回放共同使用。
import { BLACK, BOARD_SIZE, EMPTY, WHITE } from "./constants.js";

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** 创建一张标准的 15×15 空棋盘。 */
export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

/** 判断指定落子是否已经形成连续五子。 */
export function hasFiveInLine(board, row, col, player) {
  return DIRECTIONS.some(([rowStep, colStep]) => {
    return (
      1 +
        countStones(board, row, col, rowStep, colStep, player) +
        countStones(board, row, col, -rowStep, -colStep, player) >=
      5
    );
  });
}

/** 从普通棋谱或失败 fixture 中取得可回放的标准棋谱。 */
export function getPlayableRecord(record) {
  return record?.schema === "expert-loss-fixture" ? record.game : record;
}

/** 校验导入棋谱的结构、轮次、落点唯一性和最终胜负。 */
export function validateRecord(record) {
  const gameRecord = getPlayableRecord(record);
  if (!gameRecord || gameRecord.app !== "gomoku" || gameRecord.boardSize !== BOARD_SIZE) {
    throw new Error("Invalid record");
  }
  if (!Array.isArray(gameRecord.moves) || gameRecord.moves.length > BOARD_SIZE * BOARD_SIZE) {
    throw new Error("Invalid moves");
  }

  const occupied = new Set();
  const validationBoard = createEmptyBoard();
  let winningPlayer = null;
  gameRecord.moves.forEach((move, index) => {
    const key = `${move.row}:${move.col}`;
    const isValidMove =
      Number.isInteger(move.row) &&
      Number.isInteger(move.col) &&
      move.player === (index % 2 === 0 ? BLACK : WHITE) &&
      move.row >= 0 &&
      move.row < BOARD_SIZE &&
      move.col >= 0 &&
      move.col < BOARD_SIZE &&
      !occupied.has(key);

    if (!isValidMove || winningPlayer !== null) throw new Error("Invalid move");
    occupied.add(key);
    validationBoard[move.row][move.col] = move.player;
    if (hasFiveInLine(validationBoard, move.row, move.col, move.player)) {
      if (index !== gameRecord.moves.length - 1) throw new Error("Moves after game over");
      winningPlayer = move.player;
    }
  });

  if (
    gameRecord.winner !== undefined &&
    gameRecord.winner !== null &&
    (gameRecord.winner !== winningPlayer || ![BLACK, WHITE].includes(gameRecord.winner))
  ) {
    throw new Error("Invalid winner");
  }

  return gameRecord;
}

function countStones(board, row, col, rowStep, colStep, player) {
  let count = 0;
  let nextRow = row + rowStep;
  let nextCol = col + colStep;
  while (board[nextRow]?.[nextCol] === player) {
    count += 1;
    nextRow += rowStep;
    nextCol += colStep;
  }
  return count;
}
