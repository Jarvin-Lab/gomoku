// 扫描专家失败棋谱，验证 schema，并阻止已修复局面再次回退。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAiDecision } from "../src/modules/ai.js";
import { validateRecord } from "../src/app/game-rules.js";
import { simulateMove } from "../src/modules/ai/board.js";
import { EXPERT_THREAT_OPTIONS } from "../src/modules/ai/constants.js";
import {
  EXPERT_FIXTURE_SCHEMA_VERSION,
  EXPERT_LOSS_CATEGORIES,
  diagnoseExpertLoss,
} from "../src/modules/ai/fixtures.js";
import {
  hasExpertForcedWinAtDepth,
  resetExpertThreatSearchCache,
} from "../src/modules/ai/threat-search.js";
import {
  countDoubleKillMoves,
  getImmediateWinningMoves,
} from "../src/modules/ai/tactics.js";

const BLACK = 1;
const WHITE = 2;
const fixtureRoot = fileURLToPath(new URL("./fixtures/expert-losses", import.meta.url));
const knownFailureBaseline = JSON.parse(
  await readFile(new URL("./fixtures/expert-losses/known-failures-baseline.json", import.meta.url), "utf8"),
);
let fixtureCount = 0;
let knownFailureCount = 0;
const knownFailureIds = [];

for (const [category, label] of Object.entries(EXPERT_LOSS_CATEGORIES)) {
  const directory = join(fixtureRoot, category);
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".json"));

  for (const filename of filenames) {
    const fixture = JSON.parse(await readFile(join(directory, filename), "utf8"));
    validateFixture(fixture, category, label, filename);
    verifyFixturePosition(fixture, filename);
    fixtureCount += 1;
    if (fixture.status === "known-failure") {
      knownFailureCount += 1;
      knownFailureIds.push(fixture.id);
    }
  }
}

assertKnownFailureBaseline(knownFailureIds, knownFailureBaseline.allowedIds);

console.log(
  `Expert fixture tests passed: ${fixtureCount} total, ${knownFailureCount} known failures`,
);

/** 验证 fixture 元数据及其原始对局。 */
function validateFixture(fixture, category, label, filename) {
  validateRecord(fixture);
  assert(fixture.schema === "expert-loss-fixture", `${filename}: invalid schema`);
  assert(
    [1, EXPERT_FIXTURE_SCHEMA_VERSION].includes(fixture.schemaVersion),
    `${filename}: unsupported schema version`,
  );
  assert(fixture.category === category, `${filename}: category must match its directory`);
  assert(fixture.categoryLabel === label, `${filename}: invalid category label`);
  assert(["known-failure", "resolved"].includes(fixture.status), `${filename}: invalid status`);
  assert(fixture.game?.aiLevel === "expert", `${filename}: must be an expert game`);
  assert(fixture.game?.mode === "ai", `${filename}: must be an AI game`);
  assert(fixture.game?.winner === BLACK, `${filename}: fixture must be a player win`);
  assert(Array.isArray(fixture.game?.moves), `${filename}: missing moves`);
  assert(fixture.game.moves.at(-1)?.player === BLACK, `${filename}: player must make final move`);
  const diagnosis = diagnoseExpertLoss(fixture.game);
  assert(diagnosis.category in EXPERT_LOSS_CATEGORIES, `${filename}: diagnosis failed`);
  assert(Array.isArray(diagnosis.tags), `${filename}: diagnosis tags missing`);
  assert(Number.isInteger(diagnosis.rootCause?.positionPly), `${filename}: diagnosis root cause missing`);
  if (fixture.schemaVersion >= 2) {
    assert(Array.isArray(fixture.tags) && fixture.tags.length > 0, `${filename}: missing tags`);
    assert(Number.isInteger(fixture.rootCause?.positionPly), `${filename}: missing root cause`);
    assert(fixture.expectation?.invariants, `${filename}: missing invariant expectations`);
    Object.entries(fixture.expectation.invariants).forEach(([name, value]) => {
      assert(Number.isFinite(value) && value >= 0, `${filename}: invalid invariant ${name}`);
    });
  }
}

/** 在记录的失败节点重新调用专家 AI，验证修复后的应手。 */
function verifyFixturePosition(fixture, filename) {
  const positionPly = fixture.rootCause?.positionPly ?? fixture.failure?.positionPly;
  assert(Number.isInteger(positionPly), `${filename}: missing failure.positionPly`);

  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  const history = fixture.game.moves.slice(0, positionPly);
  history.forEach((move, index) => {
    assert(move.player === (index % 2 === 0 ? BLACK : WHITE), `${filename}: invalid turn ${index + 1}`);
    assert(board[move.row]?.[move.col] === 0, `${filename}: duplicate/invalid move ${index + 1}`);
    board[move.row][move.col] = move.player;
  });

  assert(history.length % 2 === 1, `${filename}: failure position must be expert's turn`);
  // 正确性回归需要在不同性能的 CI runner 上完成相同搜索深度，因此放宽测试搜索时限。
  // Schema v2 fixture 仍通过 maxDecisionMs 单独约束生产环境的 10 秒性能预算。
  const result = createAiDecision(board, WHITE, "expert", {
    moveHistory: history,
    stageBudgetScale: 3,
    timeLimitMs: 30_000,
  });
  assert(result.move, `${filename}: expert returned no move`);

  if (fixture.status !== "resolved") return;

  const acceptableMoves = fixture.expectation?.acceptableMoves ?? [];
  const avoidMoves = fixture.expectation?.avoidMoves ?? [];
  if (acceptableMoves.length > 0) {
    assert(
      includesMove(acceptableMoves, result.move),
      `${filename}: expert chose (${result.move.row},${result.move.col}) outside accepted defenses`,
    );
  }
  assert(!includesMove(avoidMoves, result.move), `${filename}: expert repeated recorded losing move`);
  verifyPositionInvariants(fixture, board, result, filename);
}

/** 验证防后战术安全、限定深度强制杀和专家决策耗时。 */
function verifyPositionInvariants(fixture, board, result, filename) {
  const invariants = fixture.expectation?.invariants;
  if (!invariants) return;
  const nextBoard = simulateMove(board, result.move.row, result.move.col, WHITE);
  const immediateWins = getImmediateWinningMoves(nextBoard, BLACK).length;
  const doubleKills = countDoubleKillMoves(nextBoard, BLACK);

  assert(
    immediateWins <= invariants.maxOpponentImmediateWinsAfter,
    `${filename}: left ${immediateWins} immediate wins`,
  );
  assert(
    doubleKills <= invariants.maxOpponentDoubleKillsAfter,
    `${filename}: left ${doubleKills} double-kill moves`,
  );
  assert(
    result.diagnostics.elapsedMs <= invariants.maxDecisionMs + 250,
    `${filename}: decision exceeded ${invariants.maxDecisionMs}ms budget`,
  );

  if (invariants.maxOpponentForcedWinDepth > 0) {
    resetExpertThreatSearchCache();
    const context = {
      deadline: Date.now() + 2000,
      logs: [],
      nodes: 0,
      threatStats: { lowScoreSetups: 0, mustAnswerNodes: 0, tenukiNodes: 0 },
      timedOut: false,
    };
    const forcedWin = hasExpertForcedWinAtDepth(
      nextBoard,
      BLACK,
      invariants.maxOpponentForcedWinDepth,
      EXPERT_THREAT_OPTIONS,
      context,
    );
    assert(!context.timedOut, `${filename}: forced-win invariant timed out`);
    assert(!forcedWin, `${filename}: opponent still has a forced win within invariant depth`);
  }
}

/** 新增或移除已知失败时要求显式更新基线，避免 CI 静默放行。 */
function assertKnownFailureBaseline(actualIds, allowedIds) {
  const actual = [...actualIds].sort();
  const allowed = [...allowedIds].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(allowed),
    `known-failure baseline changed: expected [${allowed}], got [${actual}]`,
  );
}

function includesMove(moves, target) {
  return moves.some((move) => move.row === target.row && move.col === target.col);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
