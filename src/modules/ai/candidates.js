// 候选点生成与排序：融合进攻、防守、对手回复和战术优先级。
import {
  DANGEROUS_REPLY_SCORE,
  EMPTY,
  FORCE_ATTACK_SCORE,
  MAX_BRANCHES,
  MAX_TACTICAL_BRANCHES,
  URGENT_THREAT_SCORE,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import {
  getCenterDistance,
  getCenterDistanceFromMove,
  getOpponent,
  withTemporaryMove,
} from "./board.js";
import { evaluateMove } from "./evaluator.js";

/** 评估候选点的攻防价值及对手最佳回复。 */
export function evaluateCandidate(board, row, col, player, opponent = getOpponent(player)) {
  const attackScore = evaluateMove(board, row, col, player);
  const defenseScore = evaluateMove(board, row, col, opponent);
  const opponentReply = withTemporaryMove(board, row, col, player, (nextBoard) => {
    return evaluateBestReply(nextBoard, opponent);
  });

  return {
    attackScore,
    defenseScore,
    opponentBestReplyScore: opponentReply.bestScore,
    opponentThreatCount: opponentReply.threatCount,
    score: Math.max(attackScore, defenseScore),
  };
}

function evaluateBestReply(board, player) {
  return getSearchCandidates(board, player, MAX_BRANCHES).reduce(
    (reply, { row, col }) => {
      const score = evaluateMove(board, row, col, player);
      return {
        bestScore: Math.max(reply.bestScore, score),
        threatCount: reply.threatCount + (score >= DANGEROUS_REPLY_SCORE ? 1 : 0),
      };
    },
    { bestScore: 0, threatCount: 0 },
  );
}

export function isBetterEvaluation(nextEvaluation, currentEvaluation) {
  if (
    nextEvaluation.attackScore === WINNING_MOVE_SCORE ||
    currentEvaluation.attackScore === WINNING_MOVE_SCORE
  ) {
    return nextEvaluation.attackScore > currentEvaluation.attackScore;
  }

  if (
    nextEvaluation.defenseScore === WINNING_MOVE_SCORE ||
    currentEvaluation.defenseScore === WINNING_MOVE_SCORE
  ) {
    return nextEvaluation.defenseScore > currentEvaluation.defenseScore;
  }

  const nextHasForceAttack = nextEvaluation.attackScore >= FORCE_ATTACK_SCORE;
  const currentHasForceAttack = currentEvaluation.attackScore >= FORCE_ATTACK_SCORE;
  if (nextHasForceAttack !== currentHasForceAttack) return nextHasForceAttack;

  const nextHasDangerousReply =
    nextEvaluation.attackScore < FORCE_ATTACK_SCORE &&
    nextEvaluation.opponentBestReplyScore >= DANGEROUS_REPLY_SCORE;
  const currentHasDangerousReply =
    currentEvaluation.attackScore < FORCE_ATTACK_SCORE &&
    currentEvaluation.opponentBestReplyScore >= DANGEROUS_REPLY_SCORE;

  if (nextHasDangerousReply || currentHasDangerousReply) {
    if (nextEvaluation.opponentBestReplyScore !== currentEvaluation.opponentBestReplyScore) {
      return nextEvaluation.opponentBestReplyScore < currentEvaluation.opponentBestReplyScore;
    }

    if (nextEvaluation.opponentThreatCount !== currentEvaluation.opponentThreatCount) {
      return nextEvaluation.opponentThreatCount < currentEvaluation.opponentThreatCount;
    }
  }

  if (nextEvaluation.score !== currentEvaluation.score) {
    return nextEvaluation.score > currentEvaluation.score;
  }

  return nextEvaluation.attackScore > currentEvaluation.attackScore;
}

export function isBetterSearchEvaluation(nextEvaluation, currentEvaluation) {
  const nextTacticalPriority = getTacticalPriority(nextEvaluation);
  const currentTacticalPriority = getTacticalPriority(currentEvaluation);

  if (nextTacticalPriority !== currentTacticalPriority) {
    return nextTacticalPriority > currentTacticalPriority;
  }

  if (nextTacticalPriority > 0 && isBetterEvaluation(nextEvaluation, currentEvaluation)) {
    return true;
  }

  if (nextEvaluation.searchScore !== currentEvaluation.searchScore) {
    return nextEvaluation.searchScore > currentEvaluation.searchScore;
  }

  return isBetterEvaluation(nextEvaluation, currentEvaluation);
}

function getTacticalPriority(evaluation) {
  if (evaluation.attackScore === WINNING_MOVE_SCORE) return 6;
  if (evaluation.defenseScore === WINNING_MOVE_SCORE) return 5;
  if (evaluation.attackScore >= FORCE_ATTACK_SCORE) return 4;
  if (evaluation.defenseScore >= FORCE_ATTACK_SCORE) return 3;
  if (evaluation.attackScore >= DANGEROUS_REPLY_SCORE) return 2;
  if (evaluation.defenseScore >= DANGEROUS_REPLY_SCORE) return 2;
  if (evaluation.attackScore >= URGENT_THREAT_SCORE || evaluation.defenseScore >= URGENT_THREAT_SCORE) return 1;
  return 0;
}

/** 保留全部关键战术点，再补充限定数量的普通搜索候选。 */
export function getSearchCandidates(board, player, limit, includeReply = false) {
  const opponent = getOpponent(player);
  const evaluatedMoves = getCandidateMoves(board).map((move) => {
    const evaluation = includeReply
      ? evaluateCandidate(board, move.row, move.col, player, opponent)
      : evaluateCandidateShallow(board, move.row, move.col, player);
    const opponentAttackScore = evaluateMove(board, move.row, move.col, opponent);

    return {
      ...move,
      evaluation,
      isTactical:
        evaluation.attackScore >= URGENT_THREAT_SCORE ||
        evaluation.defenseScore >= URGENT_THREAT_SCORE ||
        opponentAttackScore >= URGENT_THREAT_SCORE,
    };
  });

  const tacticalMoves = evaluatedMoves
    .filter((move) => move.isTactical)
    .sort(compareEvaluatedMoves)
    .slice(0, MAX_TACTICAL_BRANCHES);
  const normalMoves = evaluatedMoves.filter((move) => !move.isTactical).sort(compareEvaluatedMoves);
  const selected = [];
  const seen = new Set();

  [...tacticalMoves, ...normalMoves.slice(0, limit)].forEach((move) => {
    const key = `${move.row}:${move.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push({ row: move.row, col: move.col });
  });

  return selected;
}

function compareEvaluatedMoves(a, b) {
  if (isBetterEvaluation(a.evaluation, b.evaluation)) return -1;
  if (isBetterEvaluation(b.evaluation, a.evaluation)) return 1;
  return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
}

export function getTopCandidates(board, player, limit, includeReply = false) {
  return getCandidateMoves(board)
    .map((move) => ({
      ...move,
      evaluation: includeReply
        ? evaluateCandidate(board, move.row, move.col, player)
        : evaluateCandidateShallow(board, move.row, move.col, player),
    }))
    .sort((a, b) => {
      if (isBetterEvaluation(a.evaluation, b.evaluation)) return -1;
      if (isBetterEvaluation(b.evaluation, a.evaluation)) return 1;
      return getCenterDistance(board, a) - getCenterDistance(board, b);
    })
    .slice(0, limit)
    .map(({ row, col }) => ({ row, col }));
}

export function evaluateCandidateShallow(board, row, col, player) {
  const opponent = getOpponent(player);
  const attackScore = evaluateMove(board, row, col, player);
  const defenseScore = evaluateMove(board, row, col, opponent);

  return {
    attackScore,
    defenseScore,
    opponentBestReplyScore: 0,
    opponentThreatCount: 0,
    score: Math.max(attackScore, defenseScore),
  };
}

/** 生成已有棋子两格范围内的合法候选点。 */
export function getCandidateMoves(board) {
  const candidates = [];
  const seen = new Set();
  const center = Math.floor(board.length / 2);
  const hasStone = board.some((line) => line.some((cell) => cell !== EMPTY));

  if (!hasStone) {
    return [{ row: center, col: center }];
  }

  board.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (cell === EMPTY) return;

      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let colOffset = -2; colOffset <= 2; colOffset += 1) {
          const nextRow = row + rowOffset;
          const nextCol = col + colOffset;
          const key = `${nextRow}:${nextCol}`;

          if (board[nextRow]?.[nextCol] !== EMPTY || seen.has(key)) continue;

          seen.add(key);
          candidates.push({ row: nextRow, col: nextCol });
        }
      }
    });
  });

  return candidates.sort((a, b) => getCenterDistance(board, a) - getCenterDistance(board, b));
}
