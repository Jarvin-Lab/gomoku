// 紧急防守器：比较防后直接胜点、双杀入口和反击能力。
import { getCenterDistanceFromMove } from "./board.js";
import { evaluateCandidate, getCandidateMoves, isBetterEvaluation } from "./candidates.js";
import { evaluateMove, evaluateMoveDetails, hasHardDefenseThreat } from "./evaluator.js";
import { countDoubleKillMoves, countImmediateWinningMoves } from "./tactics.js";

/** 在对手硬威胁存在时选择防后风险最低的应手。 */
export function findUrgentThreatDefense(board, player, opponent, context) {
  const bestMove = getUrgentThreatDefenseCandidates(board, player, opponent, 1)[0];
  if (!bestMove) return null;

  context.logs.push(
    `专家硬防守: 对手强制威胁${bestMove.defenseScore}，防 ${formatMove(bestMove)}`,
  );
  return { row: bestMove.row, col: bestMove.col };
}

/** 返回按防后风险排序的硬威胁防守候选，供威胁空间统一复核。 */
export function getUrgentThreatDefenseCandidates(
  board,
  player,
  opponent,
  limit = Number.POSITIVE_INFINITY,
) {
  return getCandidateMoves(board)
    .map((move) => {
      const defenseDetails = evaluateMoveDetails(board, move.row, move.col, opponent);
      return { ...move, defenseDetails };
    })
    .filter(({ defenseDetails }) => hasHardDefenseThreat(defenseDetails))
    .map((move) => {
      const { defenseDetails } = move;
      return {
        ...move,
        afterDefense: evaluateDefenseAfterMove(board, move.row, move.col, player, opponent),
        defenseDetails,
        defenseScore: defenseDetails.score,
        evaluation: evaluateCandidate(board, move.row, move.col, player, opponent),
      };
    })
    .sort((a, b) => {
      if (a.afterDefense.opponentImmediateWins !== b.afterDefense.opponentImmediateWins) {
        return a.afterDefense.opponentImmediateWins - b.afterDefense.opponentImmediateWins;
      }
      if (a.afterDefense.opponentDoubleKills !== b.afterDefense.opponentDoubleKills) {
        return a.afterDefense.opponentDoubleKills - b.afterDefense.opponentDoubleKills;
      }
      if (b.defenseScore !== a.defenseScore) return b.defenseScore - a.defenseScore;
      if (b.afterDefense.counterScore !== a.afterDefense.counterScore) {
        return b.afterDefense.counterScore - a.afterDefense.counterScore;
      }
      if (isBetterEvaluation(b.evaluation, a.evaluation)) return 1;
      if (isBetterEvaluation(a.evaluation, b.evaluation)) return -1;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, limit);
}

function evaluateDefenseAfterMove(board, row, col, player, opponent) {
  const nextBoard = board.map((line) => [...line]);
  nextBoard[row][col] = player;

  return {
    counterScore: evaluateMove(board, row, col, player),
    opponentDoubleKills: countDoubleKillMoves(nextBoard, opponent),
    opponentImmediateWins: countImmediateWinningMoves(nextBoard, opponent),
  };
}

function formatMove(move) {
  return `${move.row + 1}行${move.col + 1}列`;
}
