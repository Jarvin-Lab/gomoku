// 棋型评估器：识别单线与复合威胁，并为候选落子提供统一分数。
import {
  BLOCKED,
  BLOCKED_FOUR_SCORE,
  BLOCKED_THREE_SCORE,
  BLOCKED_TWO_SCORE,
  DIRECTIONS,
  DOUBLE_FOUR_SCORE,
  DOUBLE_JUMP_THREE_SCORE,
  DOUBLE_OPEN_THREE_SCORE,
  EMPTY,
  FORCE_ATTACK_SCORE,
  FOUR_THREE_SCORE,
  JUMP_FOUR_SCORE,
  JUMP_THREE_SCORE,
  OPEN_FOUR_SCORE,
  OPEN_THREE_JUMP_THREE_SCORE,
  OPEN_THREE_SCORE,
  OPEN_TWO_SCORE,
  SEARCH_WIN_SCORE,
  WINNING_MOVE_SCORE,
} from "./constants.js";
import { boardToKey, buildLine } from "./board.js";
import { LruCache } from "./lru-cache.js";

const PATTERN_SCORES = [
  { name: "five", patterns: ["11111"], score: WINNING_MOVE_SCORE },
  { name: "openFour", patterns: ["011110"], score: OPEN_FOUR_SCORE },
  { name: "jumpFour", patterns: ["0111010", "0101110", "0110110"], score: JUMP_FOUR_SCORE },
  { name: "blockedFour", patterns: ["211110", "011112"], score: BLOCKED_FOUR_SCORE },
  { name: "openThree", patterns: ["0011100"], score: OPEN_THREE_SCORE },
  {
    name: "jumpThree",
    patterns: ["0010110", "0110100", "0011010", "0101100"],
    score: JUMP_THREE_SCORE,
  },
  {
    name: "blockedThree",
    patterns: ["211100", "001112", "211010", "010112", "210110", "011012"],
    score: BLOCKED_THREE_SCORE,
  },
  { name: "openTwo", patterns: ["001100", "0010100", "010100"], score: OPEN_TWO_SCORE },
  { name: "blockedTwo", patterns: ["21100", "00112", "21010", "01012"], score: BLOCKED_TWO_SCORE },
];

const MOVE_SCORE_CACHE_LIMIT = 300_000;
const MOVE_DETAILS_CACHE_LIMIT = 300_000;
let moveScoreCache = new LruCache(MOVE_SCORE_CACHE_LIMIT);
let moveDetailsCache = new LruCache(MOVE_DETAILS_CACHE_LIMIT);

export function resetMoveScoreCache() {
  moveScoreCache = new LruCache(MOVE_SCORE_CACHE_LIMIT);
  moveDetailsCache = new LruCache(MOVE_DETAILS_CACHE_LIMIT);
}

/** 返回指定落子的缓存棋型分数。 */
export function evaluateMove(board, row, col, player) {
  const cacheKey = `${boardToKey(board)}|${row},${col}|${player}`;
  if (moveScoreCache.has(cacheKey)) return moveScoreCache.get(cacheKey);

  const score = evaluateMoveDetails(board, row, col, player).score;
  moveScoreCache.set(cacheKey, score);
  return score;
}

/** 返回落子的单线、复合威胁和各方向棋型明细。 */
export function evaluateMoveDetails(board, row, col, player) {
  const cacheKey = `${boardToKey(board)}|details|${row},${col}|${player}`;
  if (moveDetailsCache.has(cacheKey)) return moveDetailsCache.get(cacheKey);

  if (board[row]?.[col] !== EMPTY) {
    const occupiedDetails = {
      compoundScore: -1,
      lineScore: -1,
      score: -1,
      threats: [],
    };
    moveDetailsCache.set(cacheKey, occupiedDetails);
    return occupiedDetails;
  }

  const nextBoard = board.map((line) => [...line]);
  nextBoard[row][col] = player;

  let hasWinningLine = false;
  const threats = [];
  const lineScore = DIRECTIONS.reduce((total, [rowStep, colStep]) => {
    const line = buildLine(nextBoard, row, col, rowStep, colStep, player);
    if (line.includes("11111")) {
      hasWinningLine = true;
    }
    const lineThreat = evaluateLineThreat(line);
    threats.push(lineThreat.name);
    return total + lineThreat.score;
  }, 0);

  if (hasWinningLine) {
    const winningDetails = {
      compoundScore: 0,
      lineScore: WINNING_MOVE_SCORE,
      score: WINNING_MOVE_SCORE,
      threats,
    };
    moveDetailsCache.set(cacheKey, winningDetails);
    return winningDetails;
  }

  const compoundScore = evaluateCompoundThreat(threats);

  const details = {
    compoundScore,
    lineScore,
    score: Math.max(lineScore, compoundScore),
    threats,
  };
  moveDetailsCache.set(cacheKey, details);
  return details;
}

export function evaluateLine(line) {
  return evaluateLineThreat(line).score;
}

function evaluateLineThreat(line) {
  const five = PATTERN_SCORES[0];
  if (five.patterns.some((pattern) => line.includes(pattern))) {
    return five;
  }

  const patternThreat = PATTERN_SCORES.slice(1).reduce((bestThreat, patternScore) => {
    const hasPattern = patternScore.patterns.some((pattern) => line.includes(pattern));
    return hasPattern && patternScore.score > bestThreat.score ? patternScore : bestThreat;
  }, { name: "none", patterns: [], score: 0 });
  const structuralThreat = evaluateStructuralLineThreat(line);

  return structuralThreat.score > patternThreat.score ? structuralThreat : patternThreat;
}

function evaluateStructuralLineThreat(line) {
  let bestThreat = { name: "none", patterns: [], score: 0 };

  for (let start = 0; start <= line.length - 5; start += 1) {
    const window = line.slice(start, start + 5);
    const threat = classifyFourWindowThreat(line, start, window);
    if (threat.score > bestThreat.score) {
      bestThreat = threat;
    }
  }

  return bestThreat;
}

function classifyFourWindowThreat(line, start, window) {
  const stones = countChars(window, "1");
  const spaces = countChars(window, "0");
  const blocks = countChars(window, "2");
  if (stones !== 4 || spaces !== 1 || blocks !== 0) return { name: "none", patterns: [], score: 0 };

  const left = line[start - 1] ?? String(BLOCKED);
  const right = line[start + window.length] ?? String(BLOCKED);
  const openEnds = Number(left === "0") + Number(right === "0");
  if (openEnds === 2) {
    return hasConsecutive(window, "1111")
      ? { name: "openFour", patterns: [], score: OPEN_FOUR_SCORE }
      : { name: "jumpFour", patterns: [], score: JUMP_FOUR_SCORE };
  }

  return { name: "blockedFour", patterns: [], score: BLOCKED_FOUR_SCORE };
}

/** 判断该棋型是否要求防守方立即处理。 */
export function hasHardDefenseThreat(details) {
  if (details.score === WINNING_MOVE_SCORE) return true;

  const openFourCount = countThreats(details.threats, ["openFour"]);
  const jumpFourCount = countThreats(details.threats, ["jumpFour"]);
  const blockedFourCount = countThreats(details.threats, ["blockedFour"]);
  const openThreeCount = countThreats(details.threats, ["openThree"]);
  const jumpThreeCount = countThreats(details.threats, ["jumpThree"]);
  const fourCount = openFourCount + jumpFourCount + blockedFourCount;
  const forcingFourCount = openFourCount + jumpFourCount;

  if (openFourCount > 0) return true;
  if (fourCount >= 2) return true;
  if (forcingFourCount > 0 && openThreeCount + jumpThreeCount > 0) return true;
  if (blockedFourCount > 0 && openThreeCount > 0) return true;

  return false;
}

export function hasExpertForcingThreat(details) {
  if (details.score === WINNING_MOVE_SCORE) return true;
  if (hasHardDefenseThreat(details)) return true;

  const threatSet = new Set(details.threats);
  if (threatSet.has("openThree")) return true;
  if (details.compoundScore >= OPEN_THREE_JUMP_THREE_SCORE) return true;

  return false;
}

function countChars(value, char) {
  return [...value].filter((item) => item === char).length;
}

function hasConsecutive(value, pattern) {
  return value.includes(pattern);
}

function evaluateCompoundThreat(threats) {
  const openFourCount = countThreats(threats, ["openFour"]);
  const jumpFourCount = countThreats(threats, ["jumpFour"]);
  const blockedFourCount = countThreats(threats, ["blockedFour"]);
  const fourCount = openFourCount + jumpFourCount + blockedFourCount;
  const forcingFourCount = openFourCount + jumpFourCount;
  const openThreeCount = countThreats(threats, ["openThree"]);
  const jumpThreeCount = countThreats(threats, ["jumpThree"]);
  const threeCount = openThreeCount + jumpThreeCount;

  if (fourCount >= 2) return DOUBLE_FOUR_SCORE;
  if (forcingFourCount >= 1 && threeCount >= 1) return FOUR_THREE_SCORE;
  if (blockedFourCount >= 1 && openThreeCount >= 1) return FOUR_THREE_SCORE;
  if (openThreeCount >= 2) return DOUBLE_OPEN_THREE_SCORE;
  if (openThreeCount >= 1 && jumpThreeCount >= 1) return OPEN_THREE_JUMP_THREE_SCORE;
  if (jumpThreeCount >= 2) return DOUBLE_JUMP_THREE_SCORE;

  return Math.max(openFourCount ? FORCE_ATTACK_SCORE : 0, 0);
}

export function countThreats(threats, names) {
  return threats.filter((threat) => names.includes(threat)).length;
}

export function normalizeSearchScore(score) {
  return score === WINNING_MOVE_SCORE ? SEARCH_WIN_SCORE : score;
}
