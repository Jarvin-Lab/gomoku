// 统一测试入口：依次执行规则校验、AI 回归和专家失败棋谱测试。
await import("./game-rules.mjs");
await import("./coordinate-notation.mjs");
await import("./ai-regression.mjs");
await import("./expert-fixtures.mjs");
