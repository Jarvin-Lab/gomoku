// 战略局面评估：量化势力、连接、封锁、先手权债务和分离威胁源。
import {
  BLOCKED_THREE_SCORE,
  DIRECTIONS,
  EMPTY,
  FORCE_ATTACK_SCORE,
  JUMP_THREE_SCORE,
  OPEN_THREE_SCORE,
} from "./constants.js";
import { getOpponent } from "./board.js";
import { getCandidateMoves } from "./candidates.js";
import { evaluateMove } from "./evaluator.js";

const INFLUENCE_RADIUS = 2;
const MAX_THREAT_SOURCES = 6;

/** 返回指定玩家的战略特征明细与加权总分。 */
export function evaluateStrategicPosition(board, player) {
  const influence = evaluateInfluence(board, player);
  const connection = evaluateConnections(board, player);
  const blockade = evaluateBlockade(board, player);
  const pressureProfile = evaluatePressureProfile(board, player);
  const opponentPressure = evaluatePressureProfile(board, getOpponent(player));
  const initiative = pressureProfile.initiative;
  const initiativeDebt = Math.max(
    0,
    opponentPressure.forcingPressure - pressureProfile.forcingPressure,
  );
  const threatSources = pressureProfile.threatSources;
  const total =
    influence * 2 +
    connection * 3 +
    blockade * 2 +
    initiative * 3 +
    threatSources.pressure * 4 -
    initiativeDebt * 5;

  return {
    blockade,
    connection,
    influence,
    initiative,
    initiativeDebt,
    threatSourceCount: threatSources.count,
    threatSourcePressure: threatSources.pressure,
    total,
  };
}

function evaluateInfluence(board, player) {
  const influence = new Map();

  board.forEach((line, row) => {
    line.forEach((cell, col) => {
      if (cell !== player) return;

      for (let rowOffset = -INFLUENCE_RADIUS; rowOffset <= INFLUENCE_RADIUS; rowOffset += 1) {
        for (let colOffset = -INFLUENCE_RADIUS; colOffset <= INFLUENCE_RADIUS; colOffset += 1) {
          const nextRow = row + rowOffset;
          const nextCol = col + colOffset;
          if (board[nextRow]?.[nextCol] !== EMPTY) continue;
          const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
          if (distance === 0 || distance > INFLUENCE_RADIUS) continue;
          const key = `${nextRow}:${nextCol}`;
          const weight = distance === 1 ? 3 : 1;
          influence.set(key, Math.min((influence.get(key) ?? 0) + weight, 8));
        }
      }
    });
  });

  return [...influence.values()].reduce((total, value) => total + value, 0);
}

function evaluateConnections(board, player) {
  let score = 0;

  for (const [rowStep, colStep] of DIRECTIONS) {
    board.forEach((line, row) => {
      line.forEach((cell, col) => {
        if (cell !== player || board[row - rowStep]?.[col - colStep] === player) return;

        let length = 1;
        while (board[row + rowStep * length]?.[col + colStep * length] === player) {
          length += 1;
        }
        if (length >= 2) {
          const leftOpen = board[row - rowStep]?.[col - colStep] === EMPTY;
          const rightOpen = board[row + rowStep * length]?.[col + colStep * length] === EMPTY;
          score += length * length * (1 + Number(leftOpen) + Number(rightOpen));
        }

        if (
          board[row + rowStep]?.[col + colStep] === EMPTY &&
          board[row + rowStep * 2]?.[col + colStep * 2] === player
        ) {
          score += 5;
        }
      });
    });
  }

  return score;
}

function evaluateBlockade(board, player) {
  const opponent = getOpponent(player);
  let score = 0;

  for (const [rowStep, colStep] of DIRECTIONS) {
    board.forEach((line, row) => {
      line.forEach((cell, col) => {
        if (cell !== opponent || board[row - rowStep]?.[col - colStep] === opponent) return;

        let length = 1;
        while (board[row + rowStep * length]?.[col + colStep * length] === opponent) {
          length += 1;
        }
        const leftBlocked = board[row - rowStep]?.[col - colStep] === player;
        const rightBlocked = board[row + rowStep * length]?.[col + colStep * length] === player;
        const blockedEnds = Number(leftBlocked) + Number(rightBlocked);
        score += length * blockedEnds * (blockedEnds === 2 ? 6 : 2);
      });
    });
  }

  return score;
}

function evaluatePressureProfile(board, player) {
  const sources = getCandidateMoves(board)
    .map((move) => ({ ...move, score: evaluateMove(board, move.row, move.col, player) }))
    .sort((a, b) => b.score - a.score);
  const initiative = sources.reduce((score, source) => {
    if (source.score >= FORCE_ATTACK_SCORE) return score + 30;
    if (source.score >= OPEN_THREE_SCORE) return score + 14;
    if (source.score >= JUMP_THREE_SCORE) return score + 6;
    if (source.score >= BLOCKED_THREE_SCORE) return score + 2;
    return score;
  }, 0);
  const forcingPressure = sources.reduce((pressure, source) => {
    if (source.score >= FORCE_ATTACK_SCORE) return pressure + 12;
    if (source.score >= OPEN_THREE_SCORE) return pressure + 5;
    if (source.score >= JUMP_THREE_SCORE) return pressure + 2;
    return pressure;
  }, 0);
  const threatSources = selectSeparatedThreatSources(sources);

  return { forcingPressure, initiative, threatSources };
}

function selectSeparatedThreatSources(sources) {
  const forcingSources = sources
    .filter(({ score }) => score >= BLOCKED_THREE_SCORE)
    .sort((a, b) => b.score - a.score);
  const separatedSources = [];

  for (const source of forcingSources) {
    const isSeparated = separatedSources.every(
      (selected) => Math.abs(selected.row - source.row) + Math.abs(selected.col - source.col) >= 3,
    );
    if (!isSeparated) continue;
    separatedSources.push(source);
    if (separatedSources.length >= MAX_THREAT_SOURCES) break;
  }

  const count = separatedSources.length;
  return {
    count,
    pressure: count * 5 + Math.max(0, count - 1) * Math.max(0, count - 1) * 3,
  };
}
