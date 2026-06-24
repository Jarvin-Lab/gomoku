// 棋谱规则回归测试：确保导入数据满足轮流落子、坐标唯一和终局一致性。
import { validateRecord } from "../src/app/game-rules.js";

const validRecord = {
  app: "gomoku",
  boardSize: 15,
  winner: 1,
  moves: [
    { row: 7, col: 3, player: 1 },
    { row: 0, col: 0, player: 2 },
    { row: 7, col: 4, player: 1 },
    { row: 0, col: 1, player: 2 },
    { row: 7, col: 5, player: 1 },
    { row: 0, col: 2, player: 2 },
    { row: 7, col: 6, player: 1 },
    { row: 0, col: 3, player: 2 },
    { row: 7, col: 7, player: 1 },
  ],
};

/** 断言非法棋谱会被校验器拒绝。 */
function assertInvalid(name, record) {
  try {
    validateRecord(record);
  } catch {
    return;
  }
  throw new Error(`${name}: expected validation to fail`);
}

validateRecord(validRecord);

assertInvalid("duplicate coordinate", {
  ...validRecord,
  moves: validRecord.moves.map((move, index) =>
    index === 1 ? { ...move, row: 7, col: 3 } : move,
  ),
});

assertInvalid("wrong player order", {
  ...validRecord,
  moves: validRecord.moves.map((move, index) =>
    index === 1 ? { ...move, player: 1 } : move,
  ),
});

assertInvalid("move after game over", {
  ...validRecord,
  moves: [...validRecord.moves, { row: 0, col: 4, player: 2 }],
});

assertInvalid("winner mismatch", { ...validRecord, winner: 2 });

console.log("Game record validation passed.");
