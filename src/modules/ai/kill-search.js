// 短杀搜索：用小分支 AND/OR 搜索发现和拆解近距离强制杀棋。
import {
  KILL_BRANCHES,
  KILL_SEARCH_DEPTH,
  MAX_BRANCHES,
  URGENT_THREAT_SCORE,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import { boardToKey, getOpponent, withTemporaryMove } from "./board.js";
import { evaluateCandidate, getCandidateMoves, getSearchCandidates, isBetterEvaluation } from "./candidates.js";
import { evaluateMove, evaluateMoveDetails } from "./evaluator.js";
import { getImmediateWinningMoves } from "./tactics.js";

let killMoveCache = new Map();
let forcedKillCache = new Map();

export function resetKillSearchCache() {
  killMoveCache = new Map();
  forcedKillCache = new Map();
}

/** 搜索当前玩家的短程强制杀棋首手。 */
export function findKillMove(board, player, opponent) {
  const cacheKey = `${boardToKey(board)}|kill|${player}|${opponent}`;
  if (killMoveCache.has(cacheKey)) return killMoveCache.get(cacheKey);

  const candidates = getForcingCandidates(board, player, KILL_BRANCHES);

  for (const { row, col } of candidates) {
    const attackScore = evaluateMove(board, row, col, player);
    if (attackScore === WINNING_MOVE_SCORE) {
      const move = { row, col };
      killMoveCache.set(cacheKey, move);
      return move;
    }

    const hasKill = withTemporaryMove(board, row, col, player, (nextBoard) => {
      return hasForcedKill(nextBoard, player, opponent, KILL_SEARCH_DEPTH - 1, false);
    });
    if (hasKill) {
      const move = { row, col };
      killMoveCache.set(cacheKey, move);
      return move;
    }
  }

  killMoveCache.set(cacheKey, null);
  return null;
}

/** 验证候选应手能否消除对手短杀。 */
export function findDefenseAgainstKill(board, player, opponent) {
  const opponentKillMove = findKillMove(board, opponent, player);
  if (!opponentKillMove) return null;

  const candidates = getSearchCandidates(board, player, MAX_BRANCHES, true);
  let bestMove = null;
  let bestEvaluation = null;

  for (const { row, col } of candidates) {
    const opponentStillKills = withTemporaryMove(board, row, col, player, (nextBoard) => {
      return findKillMove(nextBoard, opponent, player);
    });
    if (opponentStillKills) continue;

    const evaluation = evaluateCandidate(board, row, col, player, opponent);
    if (!bestEvaluation || isBetterEvaluation(evaluation, bestEvaluation)) {
      bestEvaluation = evaluation;
      bestMove = { row, col };
    }
  }

  return bestMove;
}

function hasForcedKill(board, attacker, currentPlayer, depth, isAttackerTurn) {
  if (depth <= 0) return false;
  const cacheKey = `${boardToKey(board)}|forced|${attacker}|${currentPlayer}|${depth}|${
    isAttackerTurn ? 1 : 0
  }`;
  if (forcedKillCache.has(cacheKey)) return forcedKillCache.get(cacheKey);

  if (isAttackerTurn) {
    const candidates = getForcingCandidates(board, attacker, KILL_BRANCHES);

    for (const { row, col } of candidates) {
      const attackScore = evaluateMove(board, row, col, attacker);
      if (attackScore === WINNING_MOVE_SCORE) {
        forcedKillCache.set(cacheKey, true);
        return true;
      }

      const continues = withTemporaryMove(board, row, col, attacker, (nextBoard) => {
        return hasForcedKill(nextBoard, attacker, getOpponent(attacker), depth - 1, false);
      });
      if (continues) {
        forcedKillCache.set(cacheKey, true);
        return true;
      }
    }

    forcedKillCache.set(cacheKey, false);
    return false;
  }

  const winningThreats = getImmediateWinningMoves(board, attacker);
  const responses =
    winningThreats.length > 0
      ? winningThreats
      : getSearchCandidates(board, currentPlayer, KILL_BRANCHES);

  if (responses.length === 0) {
    forcedKillCache.set(cacheKey, false);
    return false;
  }

  const hasKill = responses.every(({ row, col }) => {
    return withTemporaryMove(board, row, col, currentPlayer, (nextBoard) => {
      return hasForcedKill(nextBoard, attacker, getOpponent(currentPlayer), depth - 1, true);
    });
  });
  forcedKillCache.set(cacheKey, hasKill);
  return hasKill;
}

function getForcingCandidates(board, player, limit) {
  return getCandidateMoves(board)
    .map((move) => ({
      ...move,
      details: evaluateMoveDetails(board, move.row, move.col, player),
    }))
    .filter(({ details }) => details.score >= URGENT_THREAT_SCORE)
    .sort((a, b) => b.details.score - a.details.score)
    .slice(0, limit)
    .map(({ row, col }) => ({ row, col }));
}
