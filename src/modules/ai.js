// AI 公共入口与决策编排器：按战术优先级串联开局、杀棋、防守和评分搜索。
import {
  AI_PROFILES,
  EXPERT_OPENING_MOVE_LIMIT,
  EXPERT_TIME_BUDGETS,
  EXPERT_THREAT_SPACE_OPTIONS,
  EXPERT_THREAT_OPTIONS,
  EXPERT_THREAT_TRIGGER_SCORE,
  FORCE_ATTACK_SCORE,
} from "./ai/constants.js";
import { countBoardStones, getOpponent } from "./ai/board.js";
import { findUrgentThreatDefense } from "./ai/defense.js";
import { evaluateMove, resetMoveScoreCache } from "./ai/evaluator.js";
import { findDefenseAgainstKill, findKillMove, resetKillSearchCache } from "./ai/kill-search.js";
import { findExpertOpeningBookMove } from "./ai/opening-book.js";
import {
  chooseScoreSearchMove,
  getBestAttackScore,
  resetScoreSearchCache,
} from "./ai/score-search.js";
import { getImmediateWinningMoves } from "./ai/tactics.js";
import {
  findExpertThreatDefense,
  findExpertThreatMove,
  resetExpertThreatSearchCache,
} from "./ai/threat-search.js";
import {
  findThreatSpaceDefense,
  resetThreatSpaceDefenseCache,
} from "./ai/threat-space-defense.js";

export { evaluateLine, evaluateMove } from "./ai/evaluator.js";

/** 返回指定难度的最终落子。 */
export function createAiMove(board, player, level = "casual") {
  return createAiDecision(board, player, level).move;
}

/** 返回落子和完整搜索诊断，供 Worker、UI 与回归测试使用。 */
export function createAiDecision(board, player, level = "casual", options = {}) {
  const profile = AI_PROFILES[level] ?? AI_PROFILES.casual;
  const context = createSearchContext(level, profile, options);
  const move = createProfileAiMove(board, player, profile, context);

  return {
    diagnostics: createDiagnostics(context, move),
    move,
  };
}

export function createBasicAiMove(board, player) {
  return createAiMove(board, player, "casual");
}

export function createAdvancedAiMove(board, player) {
  return createAiMove(board, player, "advanced");
}

export function createExpertAiMove(board, player) {
  return createAiMove(board, player, "expert");
}

function createSearchContext(level, profile, options = {}) {
  const startAt = Date.now();
  const configuredTimeLimitMs = profile.useExpertThreatSearch
    ? EXPERT_THREAT_OPTIONS.timeLimitMs
    : 0;
  const timeLimitMs = Number.isFinite(options.timeLimitMs)
    ? Math.max(0, options.timeLimitMs)
    : configuredTimeLimitMs;
  const moveHistory = Array.isArray(options.moveHistory) ? options.moveHistory : [];
  const stageBudgetScale = Number.isFinite(options.stageBudgetScale)
    ? Math.max(1, options.stageBudgetScale)
    : 1;

  return {
    deadline: timeLimitMs > 0 ? startAt + timeLimitMs : Number.POSITIVE_INFINITY,
    elapsedMs: 0,
    level,
    logs: [],
    hadTimeout: false,
    forcedResponseStreak: countForcedResponseStreak(moveHistory),
    moveHistory,
    nodes: 0,
    searchStats: { quiescenceNodes: 0, transpositionHits: 0 },
    stageBudgetScale,
    stage: "start",
    startAt,
    threatStats: {
      lowScoreSetups: 0,
      mustAnswerNodes: 0,
      tenukiNodes: 0,
    },
    timedOut: false,
    timeoutStages: [],
    totalDeadline: timeLimitMs > 0 ? startAt + timeLimitMs : Number.POSITIVE_INFINITY,
  };
}

function countForcedResponseStreak(moveHistory) {
  const defensiveStages = new Set([
    "immediate-defense",
    "expert-threat-defense",
    "threat-space-defense",
    "urgent-threat-defense",
    "short-kill-defense",
  ]);
  let streak = 0;
  for (let index = moveHistory.length - 1; index >= 0; index -= 1) {
    const diagnostics = moveHistory[index]?.aiDiagnostics;
    if (!diagnostics) continue;
    if (!defensiveStages.has(diagnostics.stage)) break;
    streak += 1;
  }
  return streak;
}

/** 按“立即胜负→对手杀线→威胁空间→我方杀线→评分搜索”顺序决策。 */
function createProfileAiMove(board, player, profile, context) {
  resetAiCaches();
  const opponent = getOpponent(player);

  const winningMoves = getImmediateWinningMoves(board, player);
  if (winningMoves.length > 0) return finishDecision(context, winningMoves[0], "immediate-win");

  const opponentWinningMoves = getImmediateWinningMoves(board, opponent);
  if (opponentWinningMoves.length > 0) {
    return finishDecision(context, opponentWinningMoves[0], "immediate-defense");
  }

  if (profile.useFirstMoveOpening && shouldUseExpertOpening(board, player, opponent, context)) {
    const openingMove = findExpertOpeningBookMove(
      board,
      player,
      opponent,
      context.moveHistory,
      context,
    );
    if (openingMove) return finishDecision(context, openingMove, "expert-opening-book");
  }

  const shouldRunThreatSearch =
    profile.useExpertThreatSearch && shouldRunExpertThreatSearch(board, player, opponent, context);
  let defensiveFallback = null;

  if (shouldRunThreatSearch) {
    context.logs.push("专家: 优先检查对手 VCF/VCT 并验证拆杀点");
    const expertDefenseMove = runSearchStage(
      context,
      "VCF防守",
      EXPERT_TIME_BUDGETS.threatDefenseMs,
      () => findExpertThreatDefense(board, player, opponent, EXPERT_THREAT_OPTIONS, context),
    );
    if (expertDefenseMove && !context.timedOut) {
      return finishDecision(context, expertDefenseMove, "expert-threat-defense");
    }
    defensiveFallback = expertDefenseMove;
  }

  if (profile.useExpertThreatSearch && countBoardStones(board) > EXPERT_OPENING_MOVE_LIMIT) {
    context.logs.push("专家: 检查威胁空间防守");
    const threatSpaceDefense = runSearchStage(
      context,
      "威胁空间防守",
      EXPERT_TIME_BUDGETS.threatSpaceMs,
      () => findThreatSpaceDefense(
        board,
        player,
        opponent,
        EXPERT_THREAT_SPACE_OPTIONS,
        context,
      ),
    );
    if (threatSpaceDefense) {
      return finishDecision(context, threatSpaceDefense, "threat-space-defense");
    }
  }

  if (defensiveFallback) {
    context.logs.push("专家: 威胁空间未找到更安全点，采用已验证 VCF 防守回退");
    return finishDecision(context, defensiveFallback, "expert-threat-defense");
  }

  if (shouldRunThreatSearch) {
    context.logs.push("专家: 检查 VCF/VCT 进攻杀线");
    const expertKillMove = runSearchStage(
      context,
      "VCF进攻",
      EXPERT_TIME_BUDGETS.threatAttackMs,
      () => findExpertThreatMove(
        board,
        player,
        opponent,
        EXPERT_THREAT_OPTIONS,
        context,
      ),
    );
    if (expertKillMove) return finishDecision(context, expertKillMove, "expert-threat-attack");
  } else if (profile.useExpertThreatSearch) {
    context.logs.push("专家: 当前威胁不足，跳过 VCF/VCT");
  }

  if (profile.useExpertThreatSearch) {
    const urgentDefenseMove = findUrgentThreatDefense(board, player, opponent, context);
    if (urgentDefenseMove) return finishDecision(context, urgentDefenseMove, "urgent-threat-defense");
  }

  if (profile.useKillAttack) {
    const killMove = findKillMove(board, player, opponent);
    if (killMove) return finishDecision(context, killMove, "short-kill-attack");
  }

  if (profile.useKillDefense) {
    const defenseMove = findDefenseAgainstKill(board, player, opponent);
    if (defenseMove) return finishDecision(context, defenseMove, "short-kill-defense");
  }

  const scoreMove = profile.useExpertThreatSearch
    ? runSearchStage(
        context,
        "评分搜索",
        EXPERT_TIME_BUDGETS.scoreSearchMs,
        () => chooseScoreSearchMove(board, player, opponent, profile, context),
      )
    : chooseScoreSearchMove(board, player, opponent, profile, context);
  return finishDecision(context, scoreMove, "score-search");
}

/** 为搜索阶段设置独立预算，并保留此前阶段的超时诊断。 */
function runSearchStage(context, stageName, budgetMs, search) {
  context.timedOut = false;
  context.deadline = Math.min(
    context.totalDeadline,
    Date.now() + budgetMs * context.stageBudgetScale,
  );
  const result = search();
  if (context.timedOut) {
    context.hadTimeout = true;
    context.timeoutStages.push(stageName);
    context.logs.push(`${stageName}超时，保留阶段回退候选`);
  }
  return result;
}

function shouldUseExpertOpening(board, player, opponent, context) {
  const moveCount = countBoardStones(board);
  if (moveCount <= 0 || moveCount > EXPERT_OPENING_MOVE_LIMIT || context.moveHistory.length === 0) {
    return false;
  }

  return (
    getBestAttackScore(board, player) < EXPERT_THREAT_TRIGGER_SCORE &&
    getBestAttackScore(board, opponent) < EXPERT_THREAT_TRIGGER_SCORE
  );
}

function shouldRunExpertThreatSearch(board, player, opponent, context) {
  const moveCount = countBoardStones(board);
  const playerThreat = getBestAttackScore(board, player);
  const opponentThreat = getBestAttackScore(board, opponent);
  const strongestThreat = Math.max(playerThreat, opponentThreat);
  const hasForcingThreat = strongestThreat >= FORCE_ATTACK_SCORE;
  const hasDevelopedThreat =
    moveCount > EXPERT_OPENING_MOVE_LIMIT && strongestThreat >= EXPERT_THREAT_TRIGGER_SCORE;
  const shouldRun = hasForcingThreat || hasDevelopedThreat;

  context.logs.push(
    shouldRun
      ? `专家触发: 我方${playerThreat} / 对方${opponentThreat}`
      : `专家跳过: ${moveCount}手 / 我方${playerThreat} / 对方${opponentThreat}`,
  );

  return shouldRun;
}

function finishDecision(context, move, stage) {
  context.stage = stage;
  context.elapsedMs = Date.now() - context.startAt;
  if (move) {
    context.logs.push(`决策: ${stage} -> ${formatMove(move)}`);
  }
  return move;
}

function createDiagnostics(context, move) {
  context.elapsedMs = Date.now() - context.startAt;
  const threatStats = { ...context.threatStats };
  const logs = [...context.logs];
  if (context.forcedResponseStreak > 0) {
    logs.push(`连续被迫应手: ${context.forcedResponseStreak}`);
  }
  if (threatStats.mustAnswerNodes + threatStats.tenukiNodes + threatStats.lowScoreSetups > 0) {
    logs.push(
      `应手分类: 必须${threatStats.mustAnswerNodes} / 可脱先${threatStats.tenukiNodes} / 低分做棋${threatStats.lowScoreSetups}`,
    );
  }

  return {
    elapsedMs: context.elapsedMs,
    forcedResponseStreak: context.forcedResponseStreak,
    level: context.level,
    logs: logs.slice(-8),
    move,
    nodes: context.nodes,
    stage: context.stage,
    searchStats: { ...context.searchStats },
    timedOut: context.hadTimeout || context.timedOut,
    timeoutStages: [...context.timeoutStages],
    threatStats,
  };
}

function formatMove(move) {
  return `${move.row + 1}行${move.col + 1}列`;
}

function resetAiCaches() {
  resetMoveScoreCache();
  resetScoreSearchCache();
  resetKillSearchCache();
  resetExpertThreatSearchCache();
  resetThreatSpaceDefenseCache();
}
