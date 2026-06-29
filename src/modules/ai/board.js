// AI 棋盘工具：提供模拟落子、可撤销原地落子、方向线与 Zobrist 局面哈希。
import { BLOCKED, EMPTY } from "./constants.js";

const ZOBRIST_SIZE = 15;
const HASH_MASK = (1n << 64n) - 1n;
const boardHashCache = new WeakMap();
const boardKeyCache = new WeakMap();
const zobristTable = createZobristTable();

export function getOpponent(player) {
  return player === 1 ? 2 : 1;
}

export function countBoardStones(board) {
  return board.reduce((total, line) => {
    return total + line.filter((cell) => cell !== EMPTY).length;
  }, 0);
}

/** 克隆棋盘并模拟一步，不修改调用方局面。 */
export function simulateMove(board, row, col, player) {
  const nextBoard = board.map((line) => [...line]);
  nextBoard[row][col] = player;
  const previous = board[row][col];
  setBoardHash(nextBoard, updateHash(getBoardHash(board), row, col, previous, player));
  return nextBoard;
}

/** 原地落子并同步增量哈希，返回原单元值供撤销使用。 */
export function makeMove(board, row, col, player) {
  const previous = board[row][col];
  const hash = getBoardHash(board);
  board[row][col] = player;
  setBoardHash(board, updateHash(hash, row, col, previous, player));
  return previous;
}

/** 撤销原地落子并恢复增量哈希。 */
export function unmakeMove(board, row, col, previous = EMPTY) {
  const current = board[row][col];
  const hash = getBoardHash(board);
  board[row][col] = previous;
  setBoardHash(board, updateHash(hash, row, col, current, previous));
}

/** 在回调期间临时落子，确保正常返回或抛错时都会恢复棋盘。 */
export function withTemporaryMove(board, row, col, player, callback) {
  const previous = makeMove(board, row, col, player);
  try {
    return callback(board);
  } finally {
    unmakeMove(board, row, col, previous);
  }
}

/** 以候选点为中心构建相对棋型字符串。 */
export function buildLine(board, row, col, rowStep, colStep, player) {
  const values = [];

  for (let offset = -5; offset <= 5; offset += 1) {
    const nextRow = row + rowStep * offset;
    const nextCol = col + colStep * offset;
    values.push(getRelativeCell(board, nextRow, nextCol, player));
  }

  return values.join("");
}

export function getRelativeCell(board, row, col, player) {
  const cell = board[row]?.[col];
  if (cell === undefined) return String(BLOCKED);
  if (cell === EMPTY) return "0";
  if (cell === player) return "1";
  return "2";
}

export function getDistanceFromAnchor(move, anchor) {
  return Math.abs(move.row - anchor.row) + Math.abs(move.col - anchor.col);
}

export function getCenterDistance(board, move) {
  const center = Math.floor(board.length / 2);
  return Math.abs(move.row - center) + Math.abs(move.col - center);
}

export function getCenterDistanceFromMove(move) {
  const center = 7;
  return Math.abs(move.row - center) + Math.abs(move.col - center);
}

/** 生成搜索缓存使用的确定性局面键。 */
export function boardToKey(board) {
  const cached = boardKeyCache.get(board);
  if (cached !== undefined) return cached;

  const key = formatBoardHash(getBoardHash(board));
  boardKeyCache.set(board, key);
  return key;
}

export function getBoardHash(board) {
  const cached = boardHashCache.get(board);
  if (cached !== undefined) return cached;

  let hash = 0n;
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const player = board[row][col];
      if (player === 1 || player === 2) hash ^= zobristTable[row][col][player - 1];
    }
  }
  setBoardHash(board, hash);
  return hash;
}

function setBoardHash(board, hash) {
  boardHashCache.set(board, hash);
  boardKeyCache.set(board, formatBoardHash(hash));
}

function formatBoardHash(hash) {
  return hash.toString(16).padStart(16, "0");
}

function updateHash(hash, row, col, previous, next) {
  let updated = hash;
  if (previous === 1 || previous === 2) updated ^= zobristTable[row][col][previous - 1];
  if (next === 1 || next === 2) updated ^= zobristTable[row][col][next - 1];
  return updated;
}

function createZobristTable() {
  let seed = 0x9e3779b97f4a7c15n;
  const nextValue = () => {
    seed = (seed + 0x9e3779b97f4a7c15n) & HASH_MASK;
    let value = seed;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & HASH_MASK;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & HASH_MASK;
    return (value ^ (value >> 31n)) & HASH_MASK;
  };

  return Array.from({ length: ZOBRIST_SIZE }, () =>
    Array.from({ length: ZOBRIST_SIZE }, () => [nextValue(), nextValue()]),
  );
}
