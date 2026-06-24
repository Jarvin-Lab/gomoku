// 评分搜索：迭代加深 alpha-beta/minimax，并在叶节点融合战术与厚势评估。
import {
  DANGEROUS_REPLY_SCORE,
  EXPERT_SEARCH_DEPTHS,
  MAX_BRANCHES,
  POSITION_CANDIDATE_LIMIT,
  POSITION_WEIGHTS,
  QUIESCENCE_BRANCHES,
  QUIESCENCE_DEPTH,
  SEARCH_WIN_SCORE,
  URGENT_THREAT_SCORE,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import { boardToKey, getOpponent, simulateMove, withTemporaryMove } from "./board.js";
import {
  evaluateCandidate,
  getCandidateMoves,
  getSearchCandidates,
  getTopCandidates,
  isBetterEvaluation,
  isBetterSearchEvaluation,
} from "./candidates.js";
import { evaluateMove, normalizeSearchScore } from "./evaluator.js";
import { evaluateStrategicPosition } from "./strategic-evaluator.js";

let scoreSearchCache = new Map();

export function resetScoreSearchCache() {
  scoreSearchCache = new Map();
}

/** 在没有更高优先级强制手时选择综合评分最高的落子。 */
export function chooseScoreSearchMove(board, player, opponent, profile, context) {
  if (profile.useIterativeSearch) {
    return chooseIterativeSearchMove(board, player, opponent, profile, context);
  }

  const candidates = getSearchCandidates(board, player, profile.rootBranches, true);

  let bestMove = null;
  let bestEvaluation = null;

  candidates.forEach(({ row, col }) => {
    const evaluation = evaluateCandidate(board, row, col, player, opponent);
    const searchScore =
      evaluation.attackScore === WINNING_MOVE_SCORE
        ? SEARCH_WIN_SCORE
        : withTemporaryMove(board, row, col, player, (nextBoard) =>
            minimax(
              nextBoard,
              player,
              opponent,
              profile.searchDepth - 1,
              false,
              -SEARCH_WIN_SCORE,
              SEARCH_WIN_SCORE,
            ),
          );
    const nextEvaluation = {
      ...evaluation,
      searchScore: searchScore - getForcedResponseDebtPenalty(evaluation, context),
    };

    if (!bestEvaluation || isBetterSearchEvaluation(nextEvaluation, bestEvaluation)) {
      bestEvaluation = nextEvaluation;
      bestMove = { row, col };
    }
  });

  logStrategicPressure(board, bestMove, player, opponent, context);

  return bestMove;
}

export function getBestAttackScore(board, player) {
  return getCandidateMoves(board).reduce((bestScore, { row, col }) => {
    return Math.max(bestScore, evaluateMove(board, row, col, player));
  }, 0);
}

function chooseIterativeSearchMove(board, player, opponent, profile, context) {
  const candidates = getSearchCandidates(board, player, profile.rootBranches, true);
  const staticChoice = chooseBestStaticMove(board, candidates, player, opponent);
  let bestMove = staticChoice?.move ?? null;
  let bestEvaluation = staticChoice?.evaluation ?? null;

  for (const depth of EXPERT_SEARCH_DEPTHS.filter((item) => item <= profile.searchDepth)) {
    if (isSearchTimedOut(context)) break;

    let depthBestMove = null;
    let depthBestEvaluation = null;

    for (const { row, col } of candidates) {
      if (isSearchTimedOut(context)) break;

      const evaluation = evaluateCandidate(board, row, col, player, opponent);
      const searchScore =
        evaluation.attackScore === WINNING_MOVE_SCORE
          ? SEARCH_WIN_SCORE
          : withTemporaryMove(board, row, col, player, (nextBoard) =>
              minimax(
                nextBoard,
                player,
                opponent,
                depth - 1,
                false,
                -SEARCH_WIN_SCORE,
                SEARCH_WIN_SCORE,
                context,
              ),
            );
      const nextEvaluation = {
        ...evaluation,
        searchScore: searchScore - getForcedResponseDebtPenalty(evaluation, context),
      };

      if (!depthBestEvaluation || isBetterSearchEvaluation(nextEvaluation, depthBestEvaluation)) {
        depthBestEvaluation = nextEvaluation;
        depthBestMove = { row, col };
      }
    }

    if (depthBestMove && !context.timedOut) {
      bestMove = depthBestMove;
      bestEvaluation = depthBestEvaluation;
      context.logs.push(`专家: 评分搜索完成深度${depth}`);
    }
  }

  if (Number.isFinite(bestEvaluation?.searchScore)) {
    context.logs.push(`专家: 评分=${bestEvaluation.searchScore}`);
  }

  logStrategicPressure(board, bestMove, player, opponent, context);

  return bestMove;
}

/** 在深搜开始前建立完整评估的安全回退，避免超时退回未验证的首候选。 */
function chooseBestStaticMove(board, candidates, player, opponent) {
  let choice = null;
  for (const { row, col } of candidates) {
    const evaluation = evaluateCandidate(board, row, col, player, opponent);
    if (!choice || isBetterEvaluation(evaluation, choice.evaluation)) {
      choice = { evaluation, move: { row, col } };
    }
  }
  return choice;
}

function getForcedResponseDebtPenalty(evaluation, context) {
  const streak = context?.forcedResponseStreak ?? 0;
  if (streak <= 0) return 0;
  return streak * (
    evaluation.opponentThreatCount * 120 +
    Math.min(evaluation.opponentBestReplyScore, 999) * 0.2
  );
}

/** 使用 alpha-beta 剪枝评估双方限定深度内的最佳应对。 */
function minimax(board, aiPlayer, currentPlayer, depth, isAiTurn, alpha, beta, context = null) {
  if (context && isSearchTimedOut(context)) return evaluatePosition(board, aiPlayer);
  if (context) context.nodes += 1;

  const originalAlpha = alpha;
  const originalBeta = beta;
  const cacheKey = createScoreSearchCacheKey(board, aiPlayer, currentPlayer, isAiTurn);
  const cached = scoreSearchCache.get(cacheKey);
  if (cached?.depth >= depth) {
    if (context?.searchStats) context.searchStats.transpositionHits += 1;
    if (cached.flag === "exact") return cached.value;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.value);
    if (cached.flag === "upper") beta = Math.min(beta, cached.value);
    if (alpha >= beta) return cached.value;
  }

  if (depth === 0) {
    const leafScore = quiescenceSearch(
      board,
      aiPlayer,
      currentPlayer,
      isAiTurn,
      alpha,
      beta,
      QUIESCENCE_DEPTH,
      context,
    );
    if (!context?.timedOut) {
      storeScoreSearchEntry(cacheKey, depth, leafScore, originalAlpha, originalBeta);
    }
    return leafScore;
  }

  const candidates = getTopCandidates(board, currentPlayer, MAX_BRANCHES);
  if (candidates.length === 0) {
    const leafScore = evaluatePosition(board, aiPlayer);
    scoreSearchCache.set(cacheKey, { depth, flag: "exact", value: leafScore });
    return leafScore;
  }

  if (isAiTurn) {
    let bestScore = -SEARCH_WIN_SCORE;

    for (const { row, col } of candidates) {
      if (context && isSearchTimedOut(context)) break;

      const moveScore = evaluateMove(board, row, col, currentPlayer);
      if (moveScore === WINNING_MOVE_SCORE) return SEARCH_WIN_SCORE;

      const score = withTemporaryMove(board, row, col, currentPlayer, (nextBoard) =>
        minimax(
          nextBoard,
          aiPlayer,
          getOpponent(currentPlayer),
          depth - 1,
          false,
          alpha,
          beta,
          context,
        ),
      );

      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }

    if (context?.timedOut) return evaluatePosition(board, aiPlayer);

    storeScoreSearchEntry(cacheKey, depth, bestScore, originalAlpha, originalBeta);
    return bestScore;
  }

  let bestScore = SEARCH_WIN_SCORE;

  for (const { row, col } of candidates) {
    if (context && isSearchTimedOut(context)) break;

    const moveScore = evaluateMove(board, row, col, currentPlayer);
    if (moveScore === WINNING_MOVE_SCORE) return -SEARCH_WIN_SCORE;

    const score = withTemporaryMove(board, row, col, currentPlayer, (nextBoard) =>
      minimax(
        nextBoard,
        aiPlayer,
        getOpponent(currentPlayer),
        depth - 1,
        true,
        alpha,
        beta,
        context,
      ),
    );

    bestScore = Math.min(bestScore, score);
    beta = Math.min(beta, bestScore);
    if (beta <= alpha) break;
  }

  if (context?.timedOut) return evaluatePosition(board, aiPlayer);

  storeScoreSearchEntry(cacheKey, depth, bestScore, originalAlpha, originalBeta);
  return bestScore;
}

/** 在普通深度边界继续搜索活三、冲四等强制手，避免静态评估停在战术爆发前。 */
function quiescenceSearch(
  board,
  aiPlayer,
  currentPlayer,
  isAiTurn,
  alpha,
  beta,
  remainingDepth,
  context,
) {
  if (context && isSearchTimedOut(context)) return evaluatePosition(board, aiPlayer);
  if (context) context.nodes += 1;
  if (context?.searchStats) context.searchStats.quiescenceNodes += 1;

  const standPat = evaluatePosition(board, aiPlayer);
  if (remainingDepth <= 0) return standPat;
  const candidates = getQuiescenceCandidates(board, currentPlayer);
  if (candidates.length === 0) return standPat;

  if (isAiTurn) {
    let bestScore = standPat;
    alpha = Math.max(alpha, bestScore);
    if (alpha >= beta) return bestScore;
    for (const { row, col } of candidates) {
      const moveScore = evaluateMove(board, row, col, currentPlayer);
      if (moveScore === WINNING_MOVE_SCORE) return SEARCH_WIN_SCORE;
      const score = withTemporaryMove(board, row, col, currentPlayer, (nextBoard) =>
        quiescenceSearch(
          nextBoard,
          aiPlayer,
          getOpponent(currentPlayer),
          false,
          alpha,
          beta,
          remainingDepth - 1,
          context,
        ),
      );
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
      if (alpha >= beta) break;
    }
    return bestScore;
  }

  let bestScore = standPat;
  beta = Math.min(beta, bestScore);
  if (alpha >= beta) return bestScore;
  for (const { row, col } of candidates) {
    const moveScore = evaluateMove(board, row, col, currentPlayer);
    if (moveScore === WINNING_MOVE_SCORE) return -SEARCH_WIN_SCORE;
    const score = withTemporaryMove(board, row, col, currentPlayer, (nextBoard) =>
      quiescenceSearch(
        nextBoard,
        aiPlayer,
        getOpponent(currentPlayer),
        true,
        alpha,
        beta,
        remainingDepth - 1,
        context,
      ),
    );
    bestScore = Math.min(bestScore, score);
    beta = Math.min(beta, bestScore);
    if (alpha >= beta) break;
  }
  return bestScore;
}

function getQuiescenceCandidates(board, player) {
  const opponent = getOpponent(player);
  return getCandidateMoves(board)
    .map((move) => ({
      ...move,
      attackScore: evaluateMove(board, move.row, move.col, player),
      defenseScore: evaluateMove(board, move.row, move.col, opponent),
    }))
    .filter(
      ({ attackScore, defenseScore }) =>
        attackScore >= DANGEROUS_REPLY_SCORE || defenseScore >= DANGEROUS_REPLY_SCORE,
    )
    .sort((a, b) => {
      const aPriority = Math.max(a.attackScore, a.defenseScore);
      const bPriority = Math.max(b.attackScore, b.defenseScore);
      return bPriority - aPriority;
    })
    .slice(0, QUIESCENCE_BRANCHES);
}

/** 计算 AI 与对手在战术潜力和战略厚势上的净优势。 */
function evaluatePosition(board, aiPlayer) {
  const opponent = getOpponent(aiPlayer);
  const aiPotential = getPositionPotentialScore(board, aiPlayer);
  const opponentPotential = getPositionPotentialScore(board, opponent);
  const aiStrategy = evaluateStrategicPosition(board, aiPlayer);
  const opponentStrategy = evaluateStrategicPosition(board, opponent);

  return (
    normalizeSearchScore(aiPotential) -
    normalizeSearchScore(opponentPotential) +
    aiStrategy.total -
    opponentStrategy.total
  );
}

function logStrategicPressure(board, move, player, opponent, context) {
  if (!move || !context) return;
  const nextBoard = simulateMove(board, move.row, move.col, player);
  const own = evaluateStrategicPosition(nextBoard, player);
  const rival = evaluateStrategicPosition(nextBoard, opponent);
  context.logs.push(
    `厚势: 势力${own.influence - rival.influence} / 连接${own.connection - rival.connection} / ` +
      `封锁${own.blockade - rival.blockade} / 先手${own.initiative - rival.initiative} / ` +
      `先手债${own.initiativeDebt}:${rival.initiativeDebt} / ` +
      `威胁源${own.threatSourceCount}:${rival.threatSourceCount}`,
  );
}

function getPositionPotentialScore(board, player) {
  const scores = getTopCandidates(board, player, POSITION_CANDIDATE_LIMIT)
    .map(({ row, col }) => evaluateMove(board, row, col, player))
    .sort((a, b) => b - a);

  if (scores.includes(WINNING_MOVE_SCORE)) return WINNING_MOVE_SCORE;

  const weightedScore = scores.reduce((total, score, index) => {
    return total + score * (POSITION_WEIGHTS[index] ?? 0);
  }, 0);
  const dangerousThreats = scores.filter((score) => score >= DANGEROUS_REPLY_SCORE).length;
  const urgentThreats = scores.filter((score) => score >= URGENT_THREAT_SCORE).length;

  return weightedScore + dangerousThreats * 120 + urgentThreats * 35;
}

function createScoreSearchCacheKey(board, aiPlayer, currentPlayer, isAiTurn) {
  return `${boardToKey(board)}|${aiPlayer}|${currentPlayer}|${isAiTurn ? 1 : 0}`;
}

function storeScoreSearchEntry(cacheKey, depth, value, alpha, beta) {
  const flag = value <= alpha ? "upper" : value >= beta ? "lower" : "exact";
  const existing = scoreSearchCache.get(cacheKey);
  if (!existing || existing.depth <= depth) scoreSearchCache.set(cacheKey, { depth, flag, value });
}

function isSearchTimedOut(context) {
  if (Date.now() <= context.deadline) return false;
  context.timedOut = true;
  return true;
}
