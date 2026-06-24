// 专家败局 fixture：自动诊断失败类型并生成可回放、可回归的稳定 schema。
import { EXPERT_OPENING_MOVE_LIMIT, FORCE_ATTACK_SCORE } from "./constants.js";
import { evaluateMoveDetails } from "./evaluator.js";
import {
  countDoubleKillMoves,
  countImmediateWinningMoves,
} from "./tactics.js";

export const EXPERT_FIXTURE_SCHEMA_VERSION = 2;
export const EXPERT_FIXTURE_STORAGE_KEY = "gomoku.expert-loss-fixtures.v1";

export const EXPERT_LOSS_CATEGORIES = Object.freeze({
  "pattern-misread": "误判棋型",
  "missed-double-kill": "漏防双杀",
  "missed-vcf": "漏算 VCF",
  "defense-order": "防守次序错误",
  "opening-disadvantage": "开局劣势",
});

const BLACK = 1;
const WHITE = 2;
const ROOT_CAUSE_LOOKBACK_TURNS = 6;

/** 将玩家击败专家 AI 的棋谱转换为分类 fixture。 */
export function createExpertLossFixture(record) {
  if (!isExpertPlayerWin(record)) return null;

  const diagnosis = diagnoseExpertLoss(record);
  const createdAt = record.createdAt || new Date().toISOString();
  const id = createFixtureId(createdAt, record.moves);

  return {
    app: "gomoku",
    schema: "expert-loss-fixture",
    schemaVersion: EXPERT_FIXTURE_SCHEMA_VERSION,
    id,
    category: diagnosis.category,
    categoryLabel: EXPERT_LOSS_CATEGORIES[diagnosis.category],
    status: "known-failure",
    createdAt,
    diagnosis: {
      confidence: diagnosis.confidence,
      reasons: diagnosis.reasons,
    },
    rootCause: diagnosis.rootCause,
    tags: diagnosis.tags,
    failure: diagnosis.failure,
    expectation: {
      outcome: "expert-must-not-lose",
      acceptableMoves: [],
      avoidMoves: diagnosis.rootCause?.aiMove
        ? [diagnosis.rootCause.aiMove]
        : diagnosis.failure?.aiMove
          ? [diagnosis.failure.aiMove]
          : [],
      invariants: {
        maxDecisionMs: 10000,
        maxOpponentDoubleKillsAfter: 0,
        maxOpponentForcedWinDepth: 3,
        maxOpponentImmediateWinsAfter: 1,
      },
    },
    game: cloneRecord(record),
  };
}

/** 回溯末段专家应手，推断最可能的失败类型与败着位置。 */
export function diagnoseExpertLoss(record) {
  const turns = analyzeExpertTurns(record.moves);
  const failureIndex = findFailureTurnIndex(turns);
  const failureTurn = turns[failureIndex] ?? turns.at(-1);

  if (!failureTurn) {
    return createDiagnosis("opening-disadvantage", 0.5, ["没有可分析的专家落子"], null);
  }

  const rootTurn = findRootCauseTurn(turns, failureIndex);
  const rootCause = createRootCause(rootTurn, failureTurn);
  const tags = createDiagnosisTags(turns, rootTurn, failureTurn);

  const diagnostics = failureTurn.aiDiagnostics ?? {};
  const logs = Array.isArray(diagnostics.logs) ? diagnostics.logs.join("\n") : "";
  const failure = {
    positionPly: failureTurn.positionPly,
    aiMove: failureTurn.aiMove,
    aiStage: diagnostics.stage ?? "unknown",
    playerImmediateWinsAfter: failureTurn.after.immediateWins,
    playerDoubleKillsAfter: failureTurn.after.doubleKills,
  };

  if (failureTurn.after.immediateWins >= 2 || failureTurn.after.doubleKills > 0) {
    return createDiagnosis(
      "missed-double-kill",
      0.98,
      ["专家落子后玩家仍有双杀点或两个直接胜点"],
      failure,
      tags,
      rootCause,
    );
  }

  if (
    diagnostics.timedOut ||
    (logs.includes("VCF/VCT") && failureTurn.forcingPlayerMovesAfter >= 2)
  ) {
    return createDiagnosis(
      "missed-vcf",
      diagnostics.timedOut ? 0.9 : 0.74,
      [diagnostics.timedOut ? "威胁搜索超时后进入了败势" : "VCF/VCT 检查后仍出现连续强制手"],
      failure,
      tags,
      rootCause,
    );
  }

  if (
    failureTurn.before.immediateWins > 0 ||
    [
      "immediate-defense",
      "expert-threat-defense",
      "threat-space-defense",
      "urgent-threat-defense",
      "short-kill-defense",
    ].includes(diagnostics.stage)
  ) {
    return createDiagnosis(
      "defense-order",
      0.82,
      ["专家已经进入防守阶段，但所选次序未能解除后续威胁"],
      failure,
      tags,
      rootCause,
    );
  }

  if (failureTurn.positionPly <= EXPERT_OPENING_MOVE_LIMIT) {
    return createDiagnosis(
      "opening-disadvantage",
      0.76,
      ["最早可识别的败着发生在专家开局阶段"],
      failure,
      tags,
      rootCause,
    );
  }

  return createDiagnosis(
    "pattern-misread",
    0.62,
    ["未识别为双杀、VCF 或防守次序问题，归入棋型估值复核队列"],
    failure,
    tags,
    rootCause,
  );
}

export function getExpertFixturePath(fixture) {
  return `tests/fixtures/expert-losses/${fixture.category}/${fixture.id}.json`;
}

export function isExpertPlayerWin(record) {
  return record?.app === "gomoku" && record.mode === "ai" && record.aiLevel === "expert" && record.winner === BLACK;
}

function analyzeExpertTurns(moves) {
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  const expertPositions = [];

  moves.forEach((move, index) => {
    if (move.player === WHITE) {
      expertPositions.push({
        aiDiagnostics: move.aiDiagnostics,
        aiMove: { row: move.row, col: move.col },
        boardBefore: board.map((line) => [...line]),
        positionPly: index,
      });
    }

    board[move.row][move.col] = move.player;
  });

  return expertPositions.map((position) => {
    const before = getTacticalState(position.boardBefore, BLACK);
    const boardAfter = position.boardBefore.map((line) => [...line]);
    boardAfter[position.aiMove.row][position.aiMove.col] = WHITE;
    const after = getTacticalState(boardAfter, BLACK);

    return {
      ...position,
      after,
      before,
      forcingPlayerMovesAfter: countForcingPlayerMoves(
        moves.slice(position.positionPly + 1),
        boardAfter,
      ),
      isTacticallyBroken: after.immediateWins > 0 || after.doubleKills > 0,
    };
  });
}

function getTacticalState(board, player) {
  return {
    immediateWins: countImmediateWinningMoves(board, player),
    doubleKills: countDoubleKillMoves(board, player),
  };
}

function countForcingPlayerMoves(futureMoves, initialBoard) {
  const board = initialBoard.map((line) => [...line]);
  let count = 0;

  for (const move of futureMoves) {
    if (move.player === BLACK) {
      const details = evaluateMoveDetails(board, move.row, move.col, BLACK);
      if (details.score >= FORCE_ATTACK_SCORE) count += 1;
    }
    board[move.row][move.col] = move.player;
  }

  return count;
}

function findFailureTurnIndex(turns) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].isTacticallyBroken) return index;
  }
  return Math.max(0, turns.length - 1);
}

function findRootCauseTurn(turns, failureIndex) {
  const defensiveStages = new Set([
    "expert-threat-defense",
    "threat-space-defense",
    "urgent-threat-defense",
    "short-kill-defense",
  ]);
  const start = Math.max(0, failureIndex - ROOT_CAUSE_LOOKBACK_TURNS);
  const candidates = turns.slice(start, failureIndex + 1).filter((turn) => {
    const diagnostics = turn.aiDiagnostics ?? {};
    return diagnostics.timedOut || defensiveStages.has(diagnostics.stage);
  });
  return candidates[0] ?? turns[Math.max(0, failureIndex - 1)] ?? turns[failureIndex];
}

function createRootCause(rootTurn, failureTurn) {
  if (!rootTurn) return null;
  return {
    aiMove: rootTurn.aiMove,
    aiStage: rootTurn.aiDiagnostics?.stage ?? "unknown",
    positionPly: rootTurn.positionPly,
    symptomPositionPly: failureTurn?.positionPly ?? rootTurn.positionPly,
  };
}

function createDiagnosisTags(turns, rootTurn, failureTurn) {
  const tags = new Set();
  if (failureTurn?.after.immediateWins >= 2 || failureTurn?.after.doubleKills > 0) {
    tags.add("missed-double-kill");
  }
  const rootIndex = Math.max(0, turns.indexOf(rootTurn));
  const failureIndex = Math.max(rootIndex, turns.indexOf(failureTurn));
  const relevantTurns = turns.slice(rootIndex, failureIndex + 1);
  if (relevantTurns.some((turn) => turn.forcingPlayerMovesAfter >= 2)) tags.add("missed-vcf");
  if (
    relevantTurns.some((turn) =>
      ["expert-threat-defense", "threat-space-defense", "urgent-threat-defense"].includes(
        turn.aiDiagnostics?.stage,
      ),
    )
  ) {
    tags.add("defense-order");
  }
  if (relevantTurns.some((turn) => turn.aiDiagnostics?.timedOut)) tags.add("search-timeout");
  if ((rootTurn?.positionPly ?? Number.POSITIVE_INFINITY) <= EXPERT_OPENING_MOVE_LIMIT) {
    tags.add("opening-disadvantage");
  }
  return [...tags];
}

function createDiagnosis(category, confidence, reasons, failure, tags = [category], rootCause = null) {
  return { category, confidence, failure, reasons, rootCause, tags };
}

function createFixtureId(createdAt, moves) {
  const timestamp = createdAt.replace(/\D/g, "").slice(0, 14) || "undated";
  let hash = 2166136261;
  moves.forEach((move) => {
    hash ^= move.row * 31 + move.col * 7 + move.player;
    hash = Math.imul(hash, 16777619);
  });
  return `expert-loss-${timestamp}-${(hash >>> 0).toString(36)}`;
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}
