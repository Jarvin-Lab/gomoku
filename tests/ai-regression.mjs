// AI 核心回归测试：覆盖评分、战术、开局、搜索阶段及战略评估行为。
import { createAiDecision, evaluateLine, evaluateMove } from "../src/modules/ai.js";
import {
  countDoubleKillMoves,
  getImmediateWinningMoves,
} from "../src/modules/ai/tactics.js";
import {
  boardToKey,
  makeMove,
  simulateMove,
  unmakeMove,
} from "../src/modules/ai/board.js";
import {
  AI_PROFILES,
  EXPERT_THREAT_SPACE_OPTIONS,
  EXPERT_THREAT_OPTIONS,
  EXPERT_TIME_BUDGETS,
} from "../src/modules/ai/constants.js";
import {
  getExpertForcingCandidates,
  getNextLayerThreatSources,
  getThreatResponsePolicy,
} from "../src/modules/ai/threat-search.js";
import { evaluateStrategicPosition } from "../src/modules/ai/strategic-evaluator.js";
import {
  getThreatSpacePlans,
  resetThreatSpaceDefenseCache,
} from "../src/modules/ai/threat-space-defense.js";
import { EXPERT_OPENING_SYSTEMS } from "../src/modules/ai/opening-book-data.js";
import { identifyOpeningSystem } from "../src/modules/ai/opening-book.js";

const BLACK = 1;
const WHITE = 2;

if (
  AI_PROFILES.casual.searchDepth >= AI_PROFILES.advanced.searchDepth ||
  AI_PROFILES.casual.rootBranches >= AI_PROFILES.advanced.rootBranches
) {
  throw new Error("difficulty profiles: casual must search less than advanced");
}
if (!AI_PROFILES.advanced.useKillAttack || !AI_PROFILES.advanced.useKillDefense) {
  throw new Error("difficulty profiles: advanced must enable short-kill attack and defense");
}
if (
  Object.values(EXPERT_TIME_BUDGETS).reduce((total, budget) => total + budget, 0) >
  EXPERT_THREAT_OPTIONS.timeLimitMs
) {
  throw new Error("expert time budgets must fit within the total deadline");
}

function createBoard(stones) {
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  stones.forEach(([row, col, player]) => {
    board[row][col] = player;
  });
  return board;
}

function assertMove(name, actual, expected) {
  if (!actual || actual.row !== expected.row || actual.col !== expected.col) {
    throw new Error(
      `${name}: expected ${expected.row + 1}行${expected.col + 1}列, got ${
        actual ? `${actual.row + 1}行${actual.col + 1}列` : "null"
      }`,
    );
  }
}

function assertMoveSet(name, actual, expected) {
  const actualSet = new Set(actual.map(({ row, col }) => `${row}:${col}`));
  const expectedSet = new Set(expected.map(({ row, col }) => `${row}:${col}`));

  if (actualSet.size !== expectedSet.size) {
    throw new Error(`${name}: expected ${expectedSet.size} moves, got ${actualSet.size}`);
  }

  expectedSet.forEach((move) => {
    if (!actualSet.has(move)) {
      throw new Error(`${name}: missing expected move ${move}`);
    }
  });
}

function assertContainsMove(name, actual, expected) {
  if (!actual.some((move) => move.row === expected.row && move.col === expected.col)) {
    throw new Error(`${name}: missing ${expected.row + 1}行${expected.col + 1}列`);
  }
}

function assertNoVcSearch(name, diagnostics) {
  const logs = diagnostics.logs.join("\n");
  if (logs.includes("VCF/VCT 进攻深度") || logs.includes("检查对手 VCF/VCT")) {
    throw new Error(`${name}: expected early position to skip VCF/VCT, got logs:\n${logs}`);
  }
}

function assertNotStage(name, diagnostics, stage) {
  if (diagnostics.stage === stage) {
    throw new Error(`${name}: expected stage not to be ${stage}, got logs:\n${diagnostics.logs.join("\n")}`);
  }
}

function assertStage(name, diagnostics, stage) {
  if (diagnostics.stage !== stage) {
    throw new Error(`${name}: expected stage ${stage}, got ${diagnostics.stage}\n${diagnostics.logs.join("\n")}`);
  }
}

function assertScore(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name}: expected score ${expected}, got ${actual}`);
  }
}

function assertGreater(name, actual, expectedLowerBound) {
  if (actual <= expectedLowerBound) {
    throw new Error(`${name}: expected ${actual} to be greater than ${expectedLowerBound}`);
  }
}

const hashBoard = createBoard([[7, 7, BLACK]]);
const originalHash = boardToKey(hashBoard);
const previousCell = makeMove(hashBoard, 7, 8, WHITE);
if (boardToKey(hashBoard) === originalHash) {
  throw new Error("zobrist hash: move must change the board key");
}
unmakeMove(hashBoard, 7, 8, previousCell);
if (boardToKey(hashBoard) !== originalHash || hashBoard[7][8] !== 0) {
  throw new Error("zobrist hash: unmake must restore board and key");
}

const transpositionStones = [
  [7, 7, BLACK],
  [7, 6, WHITE],
  [6, 6, BLACK],
];
const transpositionBoard = createBoard(transpositionStones);
const transpositionSnapshot = JSON.stringify(transpositionBoard);
const transpositionResult = createAiDecision(transpositionBoard, WHITE, "expert", {
  moveHistory: transpositionStones.map(([row, col, player], index) => ({
    col,
    player,
    row,
    step: index + 1,
  })),
});
if (transpositionResult.diagnostics.searchStats.transpositionHits <= 0) {
  throw new Error("transposition table: expected repeated score-search positions to hit cache");
}
if (transpositionResult.diagnostics.searchStats.quiescenceNodes <= 0) {
  throw new Error("quiescence search: expected tactical leaf extensions");
}
if (JSON.stringify(transpositionBoard) !== transpositionSnapshot) {
  throw new Error("in-place search: board state leaked after decision");
}

const halfFourStones = [
  [5, 5, 2],
  [6, 6, 1],
  [6, 7, 2],
  [7, 5, 1],
  [7, 6, 2],
  [7, 7, 1],
  [7, 8, 2],
  [7, 9, 2],
  [8, 5, 1],
  [8, 6, 2],
  [8, 8, 1],
  [9, 5, 2],
  [9, 7, 1],
  [9, 8, 1],
  [9, 9, 2],
  [10, 6, 1],
  [10, 7, 2],
  [10, 8, 1],
  [11, 8, 1],
];

const result = createAiDecision(createBoard(halfFourStones), WHITE, "expert", {
  moveHistory: halfFourStones.map(([row, col, player], index) => ({
    col,
    player,
    row,
    step: index + 1,
  })),
});

assertMove("expert blocks opponent half-four", result.move, { row: 12, col: 8 });

const earlyJumpThreeStones = [
  [6, 6, 1],
  [7, 7, 2],
  [6, 8, 1],
];

const earlyResult = createAiDecision(createBoard(earlyJumpThreeStones), WHITE, "expert", {
  moveHistory: earlyJumpThreeStones.map(([row, col, player], index) => ({
    col,
    player,
    row,
    step: index + 1,
  })),
});

assertNoVcSearch("expert skips early jump-three VCF/VCT", earlyResult.diagnostics);

const firstMoveOpening = createAiDecision(createBoard([[7, 7, BLACK]]), WHITE, "expert", {
  moveHistory: [{ row: 7, col: 7, player: BLACK, step: 1 }],
});
assertStage("expert uses opening book after the first move", firstMoveOpening.diagnostics, "expert-opening-book");
if (
  Math.max(Math.abs(firstMoveOpening.move.row - 7), Math.abs(firstMoveOpening.move.col - 7)) > 1
) {
  throw new Error("expert opening book: first response must stay adjacent to the anchor");
}

EXPERT_OPENING_SYSTEMS.forEach((opening) => {
  const history = [
    { row: 7, col: 7, player: BLACK, step: 1 },
    {
      row: 7 + opening.white[0],
      col: 7 + opening.white[1],
      player: WHITE,
      step: 2,
    },
    {
      row: 7 + opening.black[0],
      col: 7 + opening.black[1],
      player: BLACK,
      step: 3,
    },
  ];
  const identified = identifyOpeningSystem(history);
  if (identified?.name !== opening.name) {
    throw new Error(`opening book: expected ${opening.name}, got ${identified?.name ?? "unknown"}`);
  }
});

assertScore("blocked four does not score as open four", evaluateLine("00001111200"), 700);
assertScore("blocked jump three stays low", evaluateLine("00021110000"), 90);
assertScore("true open four remains urgent", evaluateLine("00001111000"), 999);
assertScore("true open three remains dangerous", evaluateLine("00011100000"), 450);

const connectedShape = evaluateStrategicPosition(
  createBoard([
    [7, 6, BLACK],
    [7, 7, BLACK],
    [7, 8, BLACK],
  ]),
  BLACK,
);
const scatteredShape = evaluateStrategicPosition(
  createBoard([
    [4, 4, BLACK],
    [7, 7, BLACK],
    [10, 10, BLACK],
  ]),
  BLACK,
);
assertGreater(
  "strategic evaluator rewards connected thickness",
  connectedShape.connection,
  scatteredShape.connection,
);

const blockadeShape = evaluateStrategicPosition(
  createBoard([
    [7, 5, BLACK],
    [7, 6, WHITE],
    [7, 7, WHITE],
    [7, 8, BLACK],
  ]),
  BLACK,
);
assertGreater("strategic evaluator rewards sealing both ends", blockadeShape.blockade, 0);

const multipleSourceShape = evaluateStrategicPosition(
  createBoard([
    [4, 4, BLACK],
    [4, 5, BLACK],
    [10, 9, BLACK],
    [10, 10, BLACK],
  ]),
  BLACK,
);
const singleSourceShape = evaluateStrategicPosition(
  createBoard([
    [7, 6, BLACK],
    [7, 7, BLACK],
  ]),
  BLACK,
);
assertGreater(
  "strategic evaluator rewards separated threat sources",
  multipleSourceShape.threatSourceCount,
  singleSourceShape.threatSourceCount,
);

const initiativeDebtShape = evaluateStrategicPosition(
  createBoard([
    [7, 6, BLACK],
    [7, 7, BLACK],
    [7, 8, BLACK],
    [3, 3, WHITE],
  ]),
  WHITE,
);
assertGreater(
  "strategic evaluator penalizes sustained forced-response pressure",
  initiativeDebtShape.initiativeDebt,
  0,
);

const earlyHalfThreeMistakeStones = [
  [4, 7, 1],
  [4, 8, 2],
  [5, 5, 2],
  [5, 6, 2],
  [5, 7, 1],
  [5, 8, 2],
  [6, 5, 2],
  [6, 6, 1],
  [6, 7, 2],
  [6, 8, 1],
  [7, 5, 1],
  [7, 7, 1],
  [7, 8, 1],
  [7, 9, 2],
  [8, 8, 1],
];

assertScore(
  "half-three mistake candidate is not forcing",
  evaluateMove(createBoard(earlyHalfThreeMistakeStones), 8, 4, 1),
  700,
);

const earlyHalfThreeResult = createAiDecision(
  createBoard(earlyHalfThreeMistakeStones),
  WHITE,
  "expert",
  {
    moveHistory: earlyHalfThreeMistakeStones.map(([row, col, player], index) => ({
      col,
      player,
      row,
      step: index + 1,
    })),
  },
);

assertNotStage("expert avoids hard defense for half-three mistake", earlyHalfThreeResult.diagnostics, "urgent-threat-defense");

const liveThreeSleepJumpMistakeStones = [
  [4, 7, 1],
  [4, 8, 2],
  [5, 5, 2],
  [5, 6, 2],
  [5, 7, 1],
  [5, 8, 2],
  [6, 5, 2],
  [6, 6, 1],
  [6, 7, 2],
  [6, 8, 1],
  [7, 5, 1],
  [7, 7, 1],
  [7, 8, 1],
  [7, 9, 2],
  [8, 4, 2],
  [8, 6, 1],
  [8, 8, 1],
];

assertScore(
  "live-three sleep-jump mistake candidate is not four-three",
  evaluateMove(createBoard(liveThreeSleepJumpMistakeStones), 7, 6, 1),
  790,
);

const liveThreeSleepJumpResult = createAiDecision(
  createBoard(liveThreeSleepJumpMistakeStones),
  WHITE,
  "expert",
  {
    moveHistory: liveThreeSleepJumpMistakeStones.map(([row, col, player], index) => ({
      col,
      player,
      row,
      step: index + 1,
    })),
  },
);

assertMove(
  "expert blocks true open-four instead of sleep-jump three",
  liveThreeSleepJumpResult.move,
  { row: 9, col: 5 },
);

const multiDoubleKillStones = [
  [7, 7, 1],
  [6, 6, 2],
  [6, 8, 1],
  [8, 6, 2],
  [7, 6, 1],
  [7, 5, 2],
  [5, 7, 1],
  [9, 7, 2],
  [10, 8, 1],
  [7, 9, 2],
  [5, 8, 1],
  [8, 8, 2],
  [6, 10, 1],
  [5, 9, 2],
  [6, 7, 1],
];

const multiDoubleKillResult = createAiDecision(
  createBoard(multiDoubleKillStones),
  WHITE,
  "expert",
  {
    moveHistory: multiDoubleKillStones.map(([row, col, player], index) => ({
      col,
      player,
      row,
      step: index + 1,
    })),
  },
);

assertMove(
  "expert validates defense after move against multiple double-kill entries",
  multiDoubleKillResult.move,
  { row: 8, col: 5 },
);

const fourThreeTrapReplayStones = [
  [7, 7, BLACK],
  [6, 7, WHITE],
  [6, 6, BLACK],
  [8, 8, WHITE],
  [6, 8, BLACK],
  [8, 6, WHITE],
  [7, 9, BLACK],
  [8, 7, WHITE],
  [8, 9, BLACK],
  [7, 5, WHITE],
  [5, 7, BLACK],
  [8, 10, WHITE],
  [5, 9, BLACK],
  [6, 9, WHITE],
  [5, 6, BLACK],
  [5, 8, WHITE],
  [4, 6, BLACK],
  [3, 5, WHITE],
  [3, 6, BLACK],
  [7, 6, WHITE],
  [2, 6, BLACK],
];

const fourThreeTrapBeforeWhite16 = fourThreeTrapReplayStones.slice(0, 15);
const fourThreeTrapBaselineResult = createAiDecision(
  createBoard(fourThreeTrapBeforeWhite16),
  WHITE,
  "expert",
  {
    moveHistory: fourThreeTrapBeforeWhite16.map(([row, col, player], index) => ({
      col,
      player,
      row,
      step: index + 1,
    })),
  },
);

assertMove(
  "four-three trap keeps the only immediate defense",
  fourThreeTrapBaselineResult.move,
  { row: 5, col: 8 },
);

const fourThreeTrapBeforeWhite14 = fourThreeTrapReplayStones.slice(0, 13);
const fourThreeTrapBeforeWhite14Board = createBoard(fourThreeTrapBeforeWhite14);
const fourThreeThreatSpaceResult = createAiDecision(
  fourThreeTrapBeforeWhite14Board,
  WHITE,
  "expert",
  {
    moveHistory: fourThreeTrapBeforeWhite14.map(([row, col, player], index) => ({
      col,
      player,
      row,
      step: index + 1,
    })),
  },
);

resetThreatSpaceDefenseCache();
const multiPlanContext = {
  deadline: Date.now() + 3000,
  logs: [],
  nodes: 0,
  threatStats: { lowScoreSetups: 0, mustAnswerNodes: 0, tenukiNodes: 0 },
  timedOut: false,
};
const threatSpacePlans = getThreatSpacePlans(
  fourThreeTrapBeforeWhite14Board,
  BLACK,
  WHITE,
  EXPERT_THREAT_SPACE_OPTIONS.depth,
  EXPERT_THREAT_SPACE_OPTIONS,
  multiPlanContext,
);
if (threatSpacePlans.length < 2) {
  throw new Error("threat-space search: expected dynamic multi-plan coverage");
}

const fourThreeThreatSpaceDefenseBoard = simulateMove(
  fourThreeTrapBeforeWhite14Board,
  fourThreeThreatSpaceResult.move.row,
  fourThreeThreatSpaceResult.move.col,
  WHITE,
);
if (
  getImmediateWinningMoves(fourThreeThreatSpaceDefenseBoard, BLACK).length >= 2 ||
  countDoubleKillMoves(fourThreeThreatSpaceDefenseBoard, BLACK) > 0
) {
  throw new Error("threat-space defense must remove immediate multi-source tactics");
}
assertStage(
  "threat-space defense recognizes setup forced-defense double-kill chain",
  fourThreeThreatSpaceResult.diagnostics,
  "expert-threat-defense",
);

const lowScoreSetups = getExpertForcingCandidates(
  fourThreeTrapBeforeWhite14Board,
  BLACK,
  EXPERT_THREAT_OPTIONS,
).filter((move) => move.isLowScoreSetup);
assertContainsMove(
  "VCF/VCT includes low-score setup move",
  lowScoreSetups,
  { row: 5, col: 6 },
);

assertContainsMove(
  "defense search includes next-layer kill source",
  getNextLayerThreatSources(fourThreeTrapBeforeWhite14Board, BLACK, EXPERT_THREAT_OPTIONS),
  { row: 5, col: 6 },
);

const forcedResponseBoard = createBoard(fourThreeTrapReplayStones.slice(0, 17));
const forcedResponsePolicy = getThreatResponsePolicy(
  forcedResponseBoard,
  BLACK,
  WHITE,
  EXPERT_THREAT_OPTIONS,
);
if (forcedResponsePolicy.mode !== "must-answer") {
  throw new Error(`threat response policy: expected must-answer, got ${forcedResponsePolicy.mode}`);
}
assertContainsMove(
  "must-answer policy keeps the unique forced block",
  forcedResponsePolicy.responses,
  { row: 3, col: 5 },
);

const tenukiBoard = createBoard([
  [7, 7, BLACK],
  [6, 6, WHITE],
  [7, 8, BLACK],
]);
const tenukiPolicy = getThreatResponsePolicy(
  tenukiBoard,
  BLACK,
  WHITE,
  EXPERT_THREAT_OPTIONS,
);
if (tenukiPolicy.mode !== "can-tenuki" || tenukiPolicy.responses.length === 0) {
  throw new Error("threat response policy: expected non-empty can-tenuki responses");
}

assertMoveSet(
  "four-three trap replay creates two immediate black wins",
  getImmediateWinningMoves(createBoard(fourThreeTrapReplayStones.slice(0, 19)), BLACK),
  [
    { row: 2, col: 6 },
    { row: 7, col: 6 },
  ],
);

// 实战回归：必须在连续冲四启动前拆掉多威胁源，不能重复原白24败着。
const p0MultiSourcePosition = [
  [4, 7, BLACK], [5, 7, WHITE], [4, 8, BLACK], [4, 9, WHITE],
  [5, 8, BLACK], [6, 8, WHITE], [4, 6, BLACK], [6, 9, WHITE],
  [5, 9, BLACK], [6, 10, WHITE], [6, 7, BLACK], [4, 5, WHITE],
  [7, 6, BLACK], [8, 5, WHITE], [6, 5, BLACK], [5, 6, WHITE],
  [5, 4, BLACK], [8, 7, WHITE], [6, 4, BLACK], [3, 7, WHITE],
  [7, 4, BLACK], [8, 4, WHITE], [8, 6, BLACK],
];
const p0MultiSourceBoard = createBoard(p0MultiSourcePosition);
const p0MultiSourceResult = createAiDecision(p0MultiSourceBoard, WHITE, "expert", {
  moveHistory: p0MultiSourcePosition.map(([row, col, player], index) => ({
    col,
    player,
    row,
    step: index + 1,
  })),
});
if (p0MultiSourceResult.move.row === 7 && p0MultiSourceResult.move.col === 7) {
  throw new Error("P0 multi-source defense repeated the recorded losing move");
}
const p0MultiSourceAfterDefense = simulateMove(
  p0MultiSourceBoard,
  p0MultiSourceResult.move.row,
  p0MultiSourceResult.move.col,
  WHITE,
);
if (
  getImmediateWinningMoves(p0MultiSourceAfterDefense, BLACK).length >= 2 ||
  countDoubleKillMoves(p0MultiSourceAfterDefense, BLACK) > 0
) {
  throw new Error("P0 multi-source defense left an immediate double-kill");
}

console.log("AI regression tests passed");
