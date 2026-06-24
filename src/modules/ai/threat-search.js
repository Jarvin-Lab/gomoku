// 专家威胁搜索：执行 VCF/VCT 攻防、应手分类和下一层杀源拆解。
import {
  DOUBLE_FOUR_SCORE,
  DOUBLE_OPEN_THREE_SCORE,
  FORCE_ATTACK_SCORE,
  FOUR_THREE_SCORE,
  OPEN_THREE_JUMP_THREE_SCORE,
  ROOT_BRANCHES,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import {
  boardToKey,
  getCenterDistanceFromMove,
  getOpponent,
  withTemporaryMove,
} from "./board.js";
import {
  evaluateCandidate,
  getCandidateMoves,
  getSearchCandidates,
  isBetterEvaluation,
} from "./candidates.js";
import {
  countThreats,
  evaluateMove,
  evaluateMoveDetails,
  hasExpertForcingThreat,
  hasHardDefenseThreat,
} from "./evaluator.js";
import {
  countDoubleKillMoves,
  getImmediateWinningMoves,
  hasUnstoppableImmediateThreat,
} from "./tactics.js";

let forcedThreatCache = new Map();
let forcingContinuationCache = new Map();

/** 清空跨回合复用的强制杀缓存。 */
export function resetExpertThreatSearchCache() {
  forcedThreatCache = new Map();
  forcingContinuationCache = new Map();
}

/** 迭代加深搜索当前玩家可成立的 VCF/VCT 进攻手。 */
export function findExpertThreatMove(board, player, opponent, options, context) {
  const candidates = getExpertForcingCandidates(board, player, options);
  context.logs.push(`专家进攻候选: ${candidates.length}个`);
  if (candidates.length === 0) return null;

  for (const depth of options.depths) {
    if (isSearchTimedOut(context)) return null;
    context.logs.push(`专家: VCF/VCT 进攻深度${depth}`);

    for (const { row, col } of candidates) {
      if (isSearchTimedOut(context)) return null;

      const attackScore = evaluateMove(board, row, col, player);
      if (attackScore === WINNING_MOVE_SCORE) return { row, col };

      const result = withTemporaryMove(board, row, col, player, (nextBoard) => {
        const unstoppable = hasUnstoppableImmediateThreat(nextBoard, player);
        return {
          forcedWin: unstoppable ? false : hasExpertForcedWin(
          nextBoard,
          player,
          opponent,
          depth - 1,
          false,
          options,
          context,
        ),
          unstoppable,
        };
      });
      if (result.unstoppable) {
        context.logs.push(`专家: ${formatMove({ row, col })} 形成双杀点`);
        return { row, col };
      }

      if (result.forcedWin) {
        context.logs.push(`专家: ${formatMove({ row, col })} 存在深度${depth}强制胜链`);
        return { row, col };
      }
    }
  }

  return null;
}

/** 验证对手强制杀线，并选择能拆掉下一层杀源的防守点。 */
export function findExpertThreatDefense(board, player, opponent, options, context) {
  const threatDepth = getExpertThreatDepth(board, opponent, options, context);
  if (!threatDepth) {
    return null;
  }

  context.logs.push(`专家: 检测到对手深度${threatDepth}强制杀线，开始拆杀验证`);
  const candidateMap = new Map();
  [
    ...getExpertDefenseResponses(board, opponent, player, options, options.defenseBranches),
    ...getNextLayerThreatSources(board, opponent, options),
    ...getSearchCandidates(board, player, ROOT_BRANCHES, true),
  ].forEach((move) => {
    candidateMap.set(`${move.row}:${move.col}`, move);
  });

  let bestMove = null;
  let bestEvaluation = null;
  let bestRisk = null;

  for (const { row, col } of candidateMap.values()) {
    if (isSearchTimedOut(context)) return bestMove;
    if (board[row]?.[col] !== 0) continue;

    const attackScore = evaluateMove(board, row, col, player);
    if (attackScore === WINNING_MOVE_SCORE) return { row, col };

    const outcome = withTemporaryMove(board, row, col, player, (nextBoard) => {
      const opponentStillWins = hasExpertForcedWin(
        nextBoard,
        opponent,
        opponent,
        threatDepth - 1,
        true,
        options,
        context,
      );
      return {
        opponentStillWins,
        risk: context.timedOut ? null : evaluateDefenseThreatRisk(nextBoard, opponent, options),
      };
    });
    // 超时返回 false 只代表搜索未完成，不能把当前点误当成已验证安全点。
    if (context.timedOut) return bestMove;
    if (outcome.opponentStillWins) {
      continue;
    }

    const risk = outcome.risk;
    const evaluation = evaluateCandidate(board, row, col, player, opponent);
    if (
      !bestRisk ||
      isLowerThreatRisk(risk, bestRisk) ||
      (isEqualThreatRisk(risk, bestRisk) &&
        (!bestEvaluation ||
          isBetterForcedDefenseTieBreak(
            { row, col },
            evaluation,
            bestMove,
            bestEvaluation,
            context,
          )))
    ) {
      bestRisk = risk;
      bestEvaluation = evaluation;
      bestMove = { row, col };
    }
  }

  if (bestMove) {
    context.logs.push(
      `专家拆杀源: 直胜${bestRisk.immediateWins} / 双杀${bestRisk.doubleKills} / ` +
        `强制源${bestRisk.forcingSources} / 下一层${bestRisk.nextLayerSources}`,
    );
  }

  return bestMove;
}

/**
 * 连续被迫应手时，风险相同的防点优先贴近对手上一手，切断正在延伸的威胁链。
 * 普通局面仍沿用攻防评分，避免该策略干扰主动进攻。
 */
function isBetterForcedDefenseTieBreak(
  candidateMove,
  candidateEvaluation,
  currentMove,
  currentEvaluation,
  context,
) {
  const lastMove = context.moveHistory?.at(-1);
  if (context.forcedResponseStreak >= 2 && lastMove && currentMove) {
    const candidateDistance = getMoveDistance(candidateMove, lastMove);
    const currentDistance = getMoveDistance(currentMove, lastMove);
    if (candidateDistance !== currentDistance) {
      return candidateDistance < currentDistance;
    }
  }

  return isBetterEvaluation(candidateEvaluation, currentEvaluation);
}

function getMoveDistance(first, second) {
  return Math.max(Math.abs(first.row - second.row), Math.abs(first.col - second.col));
}

/** 供回归测试验证指定局面在限定深度内是否仍存在攻击方强制胜。 */
export function hasExpertForcedWinAtDepth(board, attacker, depth, options, context) {
  return hasExpertForcedWin(board, attacker, attacker, depth, true, options, context);
}

function getExpertThreatDepth(board, attacker, options, context) {
  for (const depth of options.depths) {
    if (isSearchTimedOut(context)) return 0;
    if (hasExpertForcedWin(board, attacker, attacker, depth, true, options, context)) {
      return depth;
    }
  }

  return 0;
}

function hasExpertForcedWin(board, attacker, currentPlayer, depth, isAttackerTurn, options, context) {
  context.nodes += 1;
  if (isSearchTimedOut(context)) return false;

  const cacheKey = `${boardToKey(board)}|expert|${attacker}|${currentPlayer}|${depth}|${
    isAttackerTurn ? 1 : 0
  }`;
  if (forcedThreatCache.has(cacheKey)) return forcedThreatCache.get(cacheKey);

  if (depth <= 0) {
    forcedThreatCache.set(cacheKey, false);
    return false;
  }

  if (isAttackerTurn) {
    const immediateWins = getImmediateWinningMoves(board, attacker);
    if (immediateWins.length > 0) {
      forcedThreatCache.set(cacheKey, true);
      return true;
    }

    const candidates = getExpertForcingCandidates(board, attacker, options);
    for (const { row, col, isLowScoreSetup = false } of candidates) {
      if (isLowScoreSetup) context.threatStats.lowScoreSetups += 1;
      const result = withTemporaryMove(board, row, col, attacker, (nextBoard) => {
        const unstoppable = hasUnstoppableImmediateThreat(nextBoard, attacker);
        return {
          continues: unstoppable ? false : hasExpertForcedWin(
          nextBoard,
          attacker,
          getOpponent(attacker),
          depth - 1,
          false,
          options,
          context,
        ),
          unstoppable,
        };
      });
      if (result.unstoppable) {
        forcedThreatCache.set(cacheKey, true);
        return true;
      }

      if (result.continues) {
        forcedThreatCache.set(cacheKey, true);
        return true;
      }
    }

    forcedThreatCache.set(cacheKey, false);
    return false;
  }

  const defenderWinningMoves = getImmediateWinningMoves(board, currentPlayer);
  if (defenderWinningMoves.length > 0) {
    forcedThreatCache.set(cacheKey, false);
    return false;
  }

  const responsePolicy = getThreatResponsePolicy(board, attacker, currentPlayer, options);
  context.threatStats[
    responsePolicy.mode === "must-answer" ? "mustAnswerNodes" : "tenukiNodes"
  ] += 1;
  const responses = responsePolicy.responses;

  if (responses.length === 0) {
    forcedThreatCache.set(cacheKey, false);
    return false;
  }

  const hasForcedWin = responses.every(({ row, col }) => {
    if (isSearchTimedOut(context)) return false;
    return withTemporaryMove(board, row, col, currentPlayer, (nextBoard) => {
      return hasExpertForcedWin(nextBoard, attacker, attacker, depth - 1, true, options, context);
    });
  });
  forcedThreatCache.set(cacheKey, hasForcedWin);
  return hasForcedWin;
}

/** 生成强制手，并补入可在下一手升级为强威胁的低分做棋手。 */
export function getExpertForcingCandidates(board, player, options) {
  const evaluatedCandidates = getCandidateMoves(board)
    .map((move) => ({
      ...move,
      details: evaluateMoveDetails(board, move.row, move.col, player),
    }));
  const forcingCandidates = evaluatedCandidates
    .filter(({ details }) => details.score >= options.forcingScore && hasExpertForcingThreat(details))
    .sort((a, b) => {
      const priorityDiff = getExpertThreatPriority(b.details) - getExpertThreatPriority(a.details);
      if (priorityDiff !== 0) return priorityDiff;
      if (b.details.score !== a.details.score) return b.details.score - a.details.score;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, options.forcingBranches)
    .map(({ row, col }) => ({ row, col, isLowScoreSetup: false }));
  const lowScoreSetups = evaluatedCandidates
    .filter(
      ({ row, col, details }) =>
        details.score >= options.setupScore &&
        details.score < options.forcingScore &&
        createsForcingContinuation(board, row, col, player, options),
    )
    .sort((a, b) => {
      if (b.details.score !== a.details.score) return b.details.score - a.details.score;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, options.setupBranches)
    .map(({ row, col }) => ({ row, col, isLowScoreSetup: true }));

  return [...forcingCandidates, ...lowScoreSetups];
}

/** 区分必须应手与允许脱先，并给出防守方的合法应对集合。 */
export function getThreatResponsePolicy(board, attacker, defender, options) {
  const immediateThreats = getImmediateWinningMoves(board, attacker);
  if (immediateThreats.length > 0) {
    return { mode: "must-answer", responses: immediateThreats };
  }

  const mustAnswerMoves = getCandidateMoves(board)
    .filter(({ row, col }) => hasHardDefenseThreat(evaluateMoveDetails(board, row, col, attacker)))
    .slice(0, options.responseBranches);
  if (mustAnswerMoves.length > 0) {
    return { mode: "must-answer", responses: mustAnswerMoves };
  }

  const responseMap = new Map();
  [
    ...getExpertDefenseResponses(board, attacker, defender, options),
    ...getSearchCandidates(board, defender, options.tenukiBranches, true),
  ].forEach((move) => responseMap.set(`${move.row}:${move.col}`, move));

  return {
    mode: "can-tenuki",
    responses: [...responseMap.values()].slice(0, options.responseBranches),
  };
}

function createsForcingContinuation(board, row, col, player, options) {
  const cacheKey = `${boardToKey(board)}|continuation|${player}|${row}:${col}|${options.forcingScore}`;
  if (forcingContinuationCache.has(cacheKey)) return forcingContinuationCache.get(cacheKey);
  const createsContinuation = withTemporaryMove(board, row, col, player, (nextBoard) => {
    return getCandidateMoves(nextBoard).some((move) => {
      const details = evaluateMoveDetails(nextBoard, move.row, move.col, player);
      return details.score >= options.forcingScore && hasExpertForcingThreat(details);
    });
  });
  forcingContinuationCache.set(cacheKey, createsContinuation);
  return createsContinuation;
}

function evaluateDefenseThreatRisk(board, attacker, options) {
  return {
    doubleKills: countDoubleKillMoves(board, attacker),
    forcingSources: getExpertForcingCandidates(board, attacker, options).filter(
      (move) => !move.isLowScoreSetup,
    ).length,
    immediateWins: getImmediateWinningMoves(board, attacker).length,
    nextLayerSources: getNextLayerThreatSources(board, attacker, options).length,
  };
}

function isLowerThreatRisk(candidate, current) {
  for (const key of ["immediateWins", "doubleKills", "forcingSources", "nextLayerSources"]) {
    if (candidate[key] !== current[key]) return candidate[key] < current[key];
  }
  return false;
}

function isEqualThreatRisk(candidate, current) {
  return ["immediateWins", "doubleKills", "forcingSources", "nextLayerSources"].every(
    (key) => candidate[key] === current[key],
  );
}

/** 找出攻击方下一回合能够转化为硬威胁的潜在杀源。 */
export function getNextLayerThreatSources(board, attacker, options) {
  return getCandidateMoves(board)
    .filter(({ row, col }) => {
      const details = evaluateMoveDetails(board, row, col, attacker);
      return (
        details.score >= options.setupScore &&
        details.score < options.forcingScore &&
        createsForcingContinuation(board, row, col, attacker, options)
      );
    })
    .sort((a, b) => {
      const scoreDiff = evaluateMove(board, b.row, b.col, attacker) - evaluateMove(board, a.row, a.col, attacker);
      if (scoreDiff !== 0) return scoreDiff;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, options.sourceBranches);
}

function getExpertDefenseResponses(board, attacker, defender, options, limit = options.responseBranches) {
  return getCandidateMoves(board)
    .map((move) => {
      const attackerDetails = evaluateMoveDetails(board, move.row, move.col, attacker);
      const defenderDetails = evaluateMoveDetails(board, move.row, move.col, defender);
      const defenseScore = evaluateMove(board, move.row, move.col, attacker);
      const counterScore = evaluateMove(board, move.row, move.col, defender);
      return {
        ...move,
        attackerDetails,
        counterScore,
        defenseScore,
        defenderDetails,
        score: Math.max(defenseScore, counterScore),
      };
    })
    .filter(
      ({ counterScore, defenseScore }) =>
        defenseScore >= options.responseScore || counterScore >= FORCE_ATTACK_SCORE,
    )
    .sort((a, b) => {
      const priorityDiff =
        Math.max(getExpertThreatPriority(b.attackerDetails), getExpertThreatPriority(b.defenderDetails)) -
        Math.max(getExpertThreatPriority(a.attackerDetails), getExpertThreatPriority(a.defenderDetails));
      if (priorityDiff !== 0) return priorityDiff;
      if (b.score !== a.score) return b.score - a.score;
      if (b.defenseScore !== a.defenseScore) return b.defenseScore - a.defenseScore;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })
    .slice(0, limit)
    .map(({ row, col }) => ({ row, col }));
}

function getExpertThreatPriority(details) {
  const threatSet = new Set(details.threats);
  const openThreeCount = countThreats(details.threats, ["openThree"]);
  const jumpThreeCount = countThreats(details.threats, ["jumpThree"]);
  const fourCount = countThreats(details.threats, ["openFour", "jumpFour", "blockedFour"]);

  if (details.score === WINNING_MOVE_SCORE) return 100;
  if (details.compoundScore >= DOUBLE_FOUR_SCORE) return 95;
  if (details.compoundScore >= FOUR_THREE_SCORE) return 90;
  if (details.compoundScore >= DOUBLE_OPEN_THREE_SCORE) return 85;
  if (details.compoundScore >= OPEN_THREE_JUMP_THREE_SCORE) return 80;
  if (fourCount >= 1 && openThreeCount + jumpThreeCount >= 1) return 78;
  if (openThreeCount + jumpThreeCount >= 2) return 76;
  if (threatSet.has("openFour")) return 75;
  if (threatSet.has("jumpFour")) return 70;
  if (threatSet.has("blockedFour")) return 65;
  if (threatSet.has("openThree")) return 55;
  if (threatSet.has("jumpThree")) return 45;
  if (threatSet.has("blockedThree")) return 35;
  return 0;
}

function isSearchTimedOut(context) {
  if (Date.now() <= context.deadline) return false;
  context.timedOut = true;
  return true;
}

function formatMove(move) {
  return `${move.row + 1}行${move.col + 1}列`;
}
