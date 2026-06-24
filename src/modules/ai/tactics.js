// 基础战术工具：识别一步取胜、双杀及无法同时封堵的直接威胁。
import { WINNING_MOVE_SCORE } from "./constants.js";
import { withTemporaryMove } from "./board.js";
import { getCandidateMoves } from "./candidates.js";
import { evaluateMove } from "./evaluator.js";

/** 返回当前局面下玩家所有一步成五的落点。 */
export function getImmediateWinningMoves(board, player) {
  return getCandidateMoves(board).filter(({ row, col }) => {
    return evaluateMove(board, row, col, player) === WINNING_MOVE_SCORE;
  });
}

/** 统计一步取胜点，达到 limit 后提前停止。 */
export function countImmediateWinningMoves(board, player, limit = 3) {
  let count = 0;

  for (const { row, col } of getCandidateMoves(board)) {
    if (evaluateMove(board, row, col, player) !== WINNING_MOVE_SCORE) continue;
    count += 1;
    if (count >= limit) return count;
  }

  return count;
}

/** 统计落子后能同时产生至少两个成五点的双杀手。 */
export function countDoubleKillMoves(board, player, limit = 3) {
  let count = 0;

  for (const { row, col } of getCandidateMoves(board)) {
    const winningMoves = withTemporaryMove(board, row, col, player, (nextBoard) => {
      return countImmediateWinningMoves(nextBoard, player, 2);
    });
    if (winningMoves < 2) continue;
    count += 1;
    if (count >= limit) return count;
  }

  return count;
}

/** 判断玩家是否拥有对手单手无法全部封堵的直接胜点。 */
export function hasUnstoppableImmediateThreat(board, player) {
  return getImmediateWinningMoves(board, player).length >= 2;
}
