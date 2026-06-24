// 专家开局决策：识别对称定式，并用厚势评估续走前 12 手。
import { EMPTY } from "./constants.js";
import { getCenterDistanceFromMove, simulateMove } from "./board.js";
import { evaluateCandidate, getCandidateMoves, isBetterEvaluation } from "./candidates.js";
import { evaluateStrategicPosition } from "./strategic-evaluator.js";
import { EXPERT_OPENING_SYSTEMS } from "./opening-book-data.js";

const OPENING_CANDIDATE_LIMIT = 18;

/** 从定式形状和战略评分中选择专家开局应手。 */
export function findExpertOpeningBookMove(board, player, opponent, moveHistory, context) {
  const anchor = moveHistory[0];
  if (!isMove(anchor)) return null;

  const opening = identifyOpeningSystem(moveHistory, anchor);
  const candidates = getOpeningCandidates(board, anchor, opening);
  if (candidates.length === 0) return null;

  const best = candidates
    .map((move) => {
      const evaluation = evaluateCandidate(board, move.row, move.col, player, opponent);
      return {
        ...move,
        evaluation,
        openingScore: evaluateOpeningPreference(
          board,
          move,
          player,
          opponent,
          anchor,
          opening,
          evaluation,
        ),
      };
    })
    .sort((a, b) => {
      if (b.openingScore !== a.openingScore) return b.openingScore - a.openingScore;
      if (isBetterEvaluation(a.evaluation, b.evaluation)) return -1;
      if (isBetterEvaluation(b.evaluation, a.evaluation)) return 1;
      return getCenterDistanceFromMove(a) - getCenterDistanceFromMove(b);
    })[0];

  if (!best) return null;
  context.logs.push(
    opening
      ? `专家开局库: ${opening.name} / ${opening.family} / 厚势偏好${best.openingScore}`
      : `专家开局库: 自由形 / 厚势续走${best.openingScore}`,
  );
  return { row: best.row, col: best.col };
}

/** 在旋转和镜像等价下识别前三手开局体系。 */
export function identifyOpeningSystem(moveHistory, anchor = moveHistory[0]) {
  if (moveHistory.length < 3 || !isMove(anchor)) return null;
  const whiteMove = moveHistory.find((move) => move.player === 2);
  const secondBlackMove = moveHistory.filter((move) => move.player === 1)[1];
  if (!whiteMove || !secondBlackMove) return null;

  const actualWhite = [whiteMove.row - anchor.row, whiteMove.col - anchor.col];
  const actualBlack = [secondBlackMove.row - anchor.row, secondBlackMove.col - anchor.col];

  return EXPERT_OPENING_SYSTEMS.find((opening) => {
    return getSymmetries(opening.white, opening.black).some(
      ({ white, black }) => sameVector(white, actualWhite) && sameVector(black, actualBlack),
    );
  }) ?? null;
}

function getOpeningCandidates(board, anchor, opening) {
  const candidateMap = new Map();

  if (countStones(board) === 1) {
    const responseTemplates = opening ? [opening.white] : [[0, -1], [1, -1], [-1, 0], [-1, 1]];
    responseTemplates.forEach((offset) => {
      getVectorSymmetries(offset).forEach(([rowOffset, colOffset]) => {
        addCandidate(candidateMap, board, anchor.row + rowOffset, anchor.col + colOffset);
      });
    });
  }

  getCandidateMoves(board)
    .filter((move) => Math.abs(move.row - anchor.row) <= 4 && Math.abs(move.col - anchor.col) <= 4)
    .slice(0, OPENING_CANDIDATE_LIMIT)
    .forEach((move) => addCandidate(candidateMap, board, move.row, move.col));

  return [...candidateMap.values()];
}

function evaluateOpeningPreference(board, move, player, opponent, anchor, opening, evaluation) {
  const nextBoard = simulateMove(board, move.row, move.col, player);
  const own = evaluateStrategicPosition(nextBoard, player);
  const rival = evaluateStrategicPosition(nextBoard, opponent);
  const shapePressure =
    (own.total - rival.total) +
    own.connection * 6 +
    own.initiative * 5 +
    own.threatSourcePressure * 8 -
    rival.threatSourcePressure * 10;
  const passivePenalty =
    evaluation.opponentBestReplyScore * 2 + evaluation.opponentThreatCount * 90;
  const anchorDistance = Math.abs(move.row - anchor.row) + Math.abs(move.col - anchor.col);
  const systemPreference = opening?.preference ?? 1;

  return Math.round((shapePressure - passivePenalty - anchorDistance * 8) * systemPreference);
}

function getSymmetries(white, black) {
  return getTransforms().map((transform) => ({
    black: transform(black),
    white: transform(white),
  }));
}

function getVectorSymmetries(vector) {
  const unique = new Map();
  getTransforms().forEach((transform) => {
    const next = transform(vector);
    unique.set(next.join(":"), next);
  });
  return [...unique.values()];
}

function getTransforms() {
  return [
    ([row, col]) => [row, col],
    ([row, col]) => [col, -row],
    ([row, col]) => [-row, -col],
    ([row, col]) => [-col, row],
    ([row, col]) => [row, -col],
    ([row, col]) => [-row, col],
    ([row, col]) => [col, row],
    ([row, col]) => [-col, -row],
  ];
}

function addCandidate(candidateMap, board, row, col) {
  if (board[row]?.[col] !== EMPTY) return;
  candidateMap.set(`${row}:${col}`, { row, col });
}

function countStones(board) {
  return board.reduce((total, line) => total + line.filter((cell) => cell !== EMPTY).length, 0);
}

function sameVector(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function isMove(move) {
  return Number.isInteger(move?.row) && Number.isInteger(move?.col);
}
