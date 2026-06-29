// 威胁空间防守：预判“铺垫手→被迫防守→四三/双杀”并提前拆解入口。
import {
  FOUR_THREE_SCORE,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import {
  boardToKey,
  getCenterDistanceFromMove,
  withTemporaryMove,
} from "./board.js";
import {
  evaluateCandidate,
  getCandidateMoves,
  getSearchCandidates,
  isBetterEvaluation,
} from "./candidates.js";
import { getUrgentThreatDefenseCandidates } from "./defense.js";
import { evaluateMoveDetails, hasHardDefenseThreat } from "./evaluator.js";
import { getNextLayerThreatSources } from "./threat-search.js";
import {
  countDoubleKillMoves,
  countImmediateWinningMoves,
  getImmediateWinningMoves,
  hasUnstoppableImmediateThreat,
} from "./tactics.js";
import { LruCache } from "./lru-cache.js";

const THREAT_SPACE_CACHE_LIMIT = 120_000;
let threatSpaceCache = new LruCache(THREAT_SPACE_CACHE_LIMIT);

/** 清空威胁空间搜索缓存，避免不同对局间共享旧局面。 */
export function resetThreatSpaceDefenseCache() {
  threatSpaceCache = new LruCache(THREAT_SPACE_CACHE_LIMIT);
}

/** 搜索并选择可消除对手威胁空间计划的防守落点。 */
export function findThreatSpaceDefense(board, player, opponent, options, context) {
  const plans = getThreatSpacePlans(board, opponent, player, options.depth, options, context);
  if (plans.length === 0) return null;

  context.logs.push(
    `专家威胁空间: 发现${plans.length}个“铺垫→被迫防→四三/双杀”入口`,
  );

  const urgentCandidates = getUrgentThreatDefenseCandidates(
    board,
    player,
    opponent,
    options.defenseBranches,
  );

  const candidateMap = new Map();
  [
    ...urgentCandidates,
    ...getSearchCandidates(board, player, options.defenseBranches, true),
    ...plans,
  ].forEach((move) => candidateMap.set(`${move.row}:${move.col}`, move));

  const candidates = [...candidateMap.values()]
    .map((move) => ({
      ...move,
      evaluation: evaluateCandidate(board, move.row, move.col, player, opponent),
    }))
    .sort((a, b) => {
      if (isBetterEvaluation(a.evaluation, b.evaluation)) return -1;
      if (isBetterEvaluation(b.evaluation, a.evaluation)) return 1;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    });

  let bestMove = null;
  let fallbackMove = null;
  let fallbackRisk = null;
  for (const candidate of candidates) {
    if (isSearchTimedOut(context)) break;
    const outcome = withTemporaryMove(
      board,
      candidate.row,
      candidate.col,
      player,
      (nextBoard) => {
        const immediateWins = countImmediateWinningMoves(nextBoard, opponent);
        const doubleKills = countDoubleKillMoves(nextBoard, opponent);
        const risk = {
          doubleKills,
          immediateWins,
          nextLayerSources:
            immediateWins === 0 && doubleKills === 0
              ? getNextLayerThreatSources(nextBoard, opponent, options).length
              : Number.POSITIVE_INFINITY,
        };
        if (risk.immediateWins >= 2 || risk.doubleKills > 0) {
          return { remainingPlans: null, risk };
        }
        const remainingPlans = getThreatSpacePlans(
          nextBoard,
          opponent,
          player,
          options.depth,
          { ...options, planLimit: 1 },
          context,
        );
        return { remainingPlans, risk };
      },
    );
    const { remainingPlans, risk } = outcome;
    if (!fallbackRisk || isLowerDefenseRisk(risk, fallbackRisk)) {
      fallbackRisk = risk;
      fallbackMove = { row: candidate.row, col: candidate.col };
    }
    if (risk.immediateWins >= 2 || risk.doubleKills > 0) continue;
    if (context.timedOut) break;
    if (remainingPlans.length > 0) continue;

    bestMove = { row: candidate.row, col: candidate.col };
    break;
  }

  if (!bestMove) bestMove = fallbackMove;

  if (bestMove) {
    context.logs.push(`专家威胁空间拆解: ${formatMove(bestMove)}`);
  }
  return bestMove;
}

function isLowerDefenseRisk(candidate, current) {
  for (const key of ["immediateWins", "doubleKills", "nextLayerSources"]) {
    if (candidate[key] !== current[key]) return candidate[key] < current[key];
  }
  return false;
}

/** 返回攻击方在限定深度内可成立的威胁空间入口。 */
export function getThreatSpacePlans(board, attacker, defender, depth, options, context) {
  return findThreatSpacePlans(board, attacker, defender, depth, options, context, false);
}

function findThreatSpacePlans(board, attacker, defender, depth, options, context, allowTerminal) {
  if (depth <= 0 || isSearchTimedOut(context)) return [];
  context.nodes += 1;

  const cacheKey = `${boardToKey(board)}|space|${attacker}|${defender}|${depth}|${
    allowTerminal ? 1 : 0
  }`;
  if (threatSpaceCache.has(cacheKey)) return threatSpaceCache.get(cacheKey);

  const plans = [];
  const setupCandidates = getSetupCandidates(board, attacker, options);
  const planLimit = allowTerminal
    ? 1
    : Math.min(options.planLimit, Math.max(2, Math.ceil(setupCandidates.length / 3)));
  const previousThreatState = createThreatState(board, attacker);
  for (const { row, col } of setupCandidates) {
    if (isSearchTimedOut(context)) break;
    const hasPlan = withTemporaryMove(board, row, col, attacker, (nextBoard) => {
      const isTerminal = isDecisiveThreat(nextBoard, row, col, attacker);
      return (
        (allowTerminal && isTerminal) ||
        (!isTerminal &&
          forcesThreatSpaceWin(
            nextBoard,
            previousThreatState,
            attacker,
            defender,
            depth - 1,
            options,
            context,
          ))
      );
    });
    if (hasPlan) plans.push({ row, col });
    if (plans.length >= planLimit) break;
  }

  threatSpaceCache.set(cacheKey, plans);
  return plans;
}

function forcesThreatSpaceWin(
  board,
  previousThreatState,
  attacker,
  defender,
  depth,
  options,
  context,
) {
  if (isSearchTimedOut(context)) return false;
  context.nodes += 1;

  const responses = getForcedThreatResponses(board, previousThreatState, attacker, options);
  if (responses.length === 0) return false;

  return responses.every(({ row, col }) => {
    if (isSearchTimedOut(context)) return false;
    return withTemporaryMove(board, row, col, defender, (nextBoard) => {
      return (
        findThreatSpacePlans(
          nextBoard,
          attacker,
          defender,
          depth,
          options,
          context,
          true,
        ).length > 0
      );
    });
  });
}

function getForcedThreatResponses(board, previousThreatState, attacker, options) {
  const immediateWins = getImmediateWinningMoves(board, attacker).filter(
    (move) => !previousThreatState.immediateWins.has(moveToKey(move)),
  );
  if (immediateWins.length > 0) return immediateWins;

  return getCandidateMoves(board)
    .map((move) => ({
      ...move,
      details: evaluateMoveDetails(board, move.row, move.col, attacker),
    }))
    .filter(({ row, col, details }) => {
      if (!hasHardDefenseThreat(details)) return false;
      return !previousThreatState.hardThreats.has(`${row}:${col}`);
    })
    .sort((a, b) => {
      if (b.details.score !== a.details.score) return b.details.score - a.details.score;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, options.responseBranches)
    .map(({ row, col }) => ({ row, col }));
}

function createThreatState(board, attacker) {
  return {
    hardThreats: new Set(
      getCandidateMoves(board)
        .filter(({ row, col }) =>
          hasHardDefenseThreat(evaluateMoveDetails(board, row, col, attacker)),
        )
        .map(moveToKey),
    ),
    immediateWins: new Set(getImmediateWinningMoves(board, attacker).map(moveToKey)),
  };
}

function moveToKey(move) {
  return `${move.row}:${move.col}`;
}

function getSetupCandidates(board, attacker, options) {
  return getCandidateMoves(board)
    .map((move) => ({
      ...move,
      details: evaluateMoveDetails(board, move.row, move.col, attacker),
    }))
    .filter(({ details }) => details.score >= options.setupScore)
    .sort((a, b) => {
      if (b.details.score !== a.details.score) return b.details.score - a.details.score;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, options.setupBranches)
    .map(({ row, col }) => ({ row, col }));
}

function isDecisiveThreat(board, row, col, attacker) {
  const details = evaluatePlacedMoveDetails(board, row, col, attacker);
  return (
    details.score === WINNING_MOVE_SCORE ||
    details.compoundScore >= FOUR_THREE_SCORE ||
    hasUnstoppableImmediateThreat(board, attacker)
  );
}

function evaluatePlacedMoveDetails(board, row, col, player) {
  const previousBoard = board.map((line) => [...line]);
  previousBoard[row][col] = 0;
  return evaluateMoveDetails(previousBoard, row, col, player);
}

function isSearchTimedOut(context) {
  const safetyMs = context.timeoutSafetyMs ?? 0;
  if (Date.now() + safetyMs <= context.deadline) return false;
  context.timedOut = true;
  return true;
}

function formatMove(move) {
  return `${move.row + 1}行${move.col + 1}列`;
}
