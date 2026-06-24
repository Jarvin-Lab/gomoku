// AI Web Worker 入口：在独立线程计算落子，并将诊断信息安全回传主界面。
import { createAiDecision } from "../ai.js";

self.addEventListener("message", (event) => {
  const { board, level, moveHistory, player, requestId, type } = event.data ?? {};
  if (type !== "find-move") return;

  try {
    const { diagnostics, move } = createAiDecision(board, player, level, { moveHistory });
    self.postMessage({
      diagnostics,
      move,
      requestId,
      type: "move-result",
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "AI worker error",
      move: null,
      requestId,
      type: "move-result",
    });
  }
});
