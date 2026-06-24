// AI Worker 客户端：封装请求编号、过期结果过滤和 Worker 重建。
/** 创建单实例 AI Worker 客户端。 */
export function createAiClient({ onError, onResult }) {
  let activeRequestId = 0;
  let worker = createWorker();

  function createWorker() {
    const nextWorker = new Worker(new URL("../modules/ai/worker.js", import.meta.url), {
      type: "module",
    });
    nextWorker.addEventListener("message", (event) => {
      const data = event.data ?? {};
      if (data.type !== "move-result" || data.requestId !== activeRequestId) return;
      onResult(data);
    });
    nextWorker.addEventListener("error", (event) => {
      cancel();
      onError(event);
    });
    return nextWorker;
  }

  /** 提交不可变的棋盘与历史快照。 */
  function request({ board, level, moveHistory, player }) {
    activeRequestId += 1;
    worker.postMessage({
      board: board.map((line) => [...line]),
      level,
      moveHistory: moveHistory.map((move) => ({ ...move })),
      player,
      requestId: activeRequestId,
      type: "find-move",
    });
  }

  /** 取消当前请求并用新 Worker 隔离旧计算。 */
  function cancel() {
    activeRequestId += 1;
    worker?.terminate();
    worker = createWorker();
  }

  return { cancel, request };
}
