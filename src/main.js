// 浏览器应用入口：组装棋盘、AI、棋谱和回放模块，并协调全局对局状态。
import { createAiClient } from "./app/ai-client.js";
import { createBoardView } from "./app/board-view.js";
import {
  AI_LEVEL_LABELS,
  BLACK,
  BOARD_SIZE,
  EMPTY,
  WHITE,
  formatBoardCoordinate,
} from "./app/constants.js";
import { elements } from "./app/dom.js";
import {
  createEmptyBoard,
  getPlayableRecord,
  hasFiveInLine,
  validateRecord,
} from "./app/game-rules.js";
import {
  captureExpertLossFixture,
  createGameRecord,
  createRecordDownloadManager,
  readRecordFile,
} from "./app/record-store.js";

const {
  aiDebugLogs,
  aiDebugPanel,
  aiDebugSummary,
  board: boardElement,
  closeResultButton,
  difficultyButton,
  difficultyButtonText,
  difficultyControl,
  difficultyMenu,
  difficultyOptions,
  downloadRecordButton,
  modeButton,
  modeButtonText,
  modeMenu,
  modeOptions,
  moveLogs,
  playAgainButton,
  recordFileInput,
  replayEndButton,
  replayExitButton,
  replayNextButton,
  replayPanel,
  replayPlayButton,
  replayPrevButton,
  replayRecordButton,
  replayStartButton,
  replayStepText,
  resetButton,
  resultOverlay,
  resultTitle,
  statusText,
} = elements;

const boardView = createBoardView(boardElement);
const recordDownloads = createRecordDownloadManager();
const aiClient = createAiClient({
  onError: handleAiWorkerError,
  onResult: handleAiWorkerResult,
});

let board = createEmptyBoard();
let currentPlayer = BLACK;
let isAiMode = true;
let aiLevel = "expert";
let gameOver = false;
let isAiThinking = false;
let moveHistory = [];
let currentGameRecord = null;
let replayTimer = null;
let isReplaying = false;
let replayRecordData = null;
let replayStep = 0;
let latestAiDiagnostics = null;

initialize();

/** 完成 DOM 事件绑定并绘制初始棋盘。 */
function initialize() {
  bindEvents();
  boardView.render(handleMove);
  updateModeControls();
  resetMoveLog();
  updateStatus();
  updateBoardTurn();
  hideResultOverlay();
}

function bindEvents() {
  resetButton.addEventListener("click", resetGame);
  playAgainButton.addEventListener("click", resetGame);
  closeResultButton.addEventListener("click", hideResultOverlay);
  downloadRecordButton.addEventListener("click", downloadCurrentRecord);
  replayRecordButton.addEventListener("click", () => replayRecord(currentGameRecord));
  recordFileInput.addEventListener("change", handleRecordImport);
  replayStartButton.addEventListener("click", () => setReplayStep(0));
  replayPrevButton.addEventListener("click", () => setReplayStep(replayStep - 1));
  replayPlayButton.addEventListener("click", toggleReplayPlayback);
  replayNextButton.addEventListener("click", () => setReplayStep(replayStep + 1));
  replayEndButton.addEventListener("click", () => setReplayStep(replayRecordData?.moves.length ?? 0));
  replayExitButton.addEventListener("click", exitReplay);
  modeButton.addEventListener("click", toggleModeMenu);
  difficultyButton.addEventListener("click", toggleDifficultyMenu);

  modeOptions.forEach((option) => {
    option.addEventListener("click", () => {
      setGameMode(option.dataset.mode === "ai");
      closeModeMenu();
    });
  });
  difficultyOptions.forEach((option) => {
    option.addEventListener("click", () => {
      setAiLevel(option.dataset.level);
      closeDifficultyMenu();
    });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".mode-control")) closeModeMenu();
    if (!event.target.closest(".difficulty-control")) closeDifficultyMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeModeMenu();
    closeDifficultyMenu();
  });
}

/** 处理用户落子，并在 AI 模式下触发白棋搜索。 */
function handleMove(row, col) {
  if (gameOver || isAiThinking || isReplaying || board[row][col] !== EMPTY) return;
  placeStone(row, col, currentPlayer);

  if (isAiMode && !gameOver && currentPlayer === WHITE) {
    isAiThinking = true;
    updateStatus();
    window.setTimeout(requestAiMove, 220);
  }
}

/** 落子、记录手数、检查胜负并切换当前玩家。 */
function placeStone(row, col, player, options = {}) {
  board[row][col] = player;
  boardView.paintStone(row, col, player, options.step);
  if (!options.skipRecord) {
    moveHistory.push({ col, player, row, step: moveHistory.length + 1 });
  }
  appendMoveLog(row, col, player, options.step ?? moveHistory.length);

  if (!options.skipWinCheck && hasFiveInLine(board, row, col, player)) {
    finishGame(player);
    return;
  }

  currentPlayer = player === BLACK ? WHITE : BLACK;
  updateStatus();
  updateBoardTurn();
}

/** 结束对局并准备普通棋谱或专家失败 fixture。 */
function finishGame(winner) {
  gameOver = true;
  const message = getWinMessage(winner);
  statusText.textContent = message;
  currentGameRecord = createGameRecord({
    aiLevel,
    isAiMode,
    latestAiDiagnostics,
    moveHistory,
    resultText: message,
    winner,
  });
  prepareFinishedRecord(currentGameRecord);
  showResultOverlay(message);
  boardView.lock();
}

async function prepareFinishedRecord(record) {
  try {
    const capturedRecord = await captureExpertLossFixture(record);
    if (currentGameRecord !== record) return;
    currentGameRecord = capturedRecord;
    recordDownloads.prepare(capturedRecord);
    if (capturedRecord.schema === "expert-loss-fixture") {
      resultTitle.textContent = `你赢了 · 已收录：${capturedRecord.categoryLabel}`;
    }
  } catch (error) {
    console.error("Failed to capture expert loss fixture", error);
    recordDownloads.prepare(record);
  }
}

/** 向 Web Worker 提交当前局面，避免搜索阻塞 UI。 */
function requestAiMove() {
  if (!isAiMode || gameOver || isReplaying || currentPlayer !== WHITE) {
    isAiThinking = false;
    updateStatus();
    return;
  }

  updateAiDebugPanel({
    elapsedMs: 0,
    level: aiLevel,
    logs: ["AI 搜索中"],
    nodes: 0,
    stage: "thinking",
    timedOut: false,
  });
  aiClient.request({ board, level: aiLevel, moveHistory, player: WHITE });
}

/** 接收 Worker 决策并确保结果仍适用于当前对局。 */
function handleAiWorkerResult({ diagnostics, error, move }) {
  isAiThinking = false;
  updateAiDebugPanel(diagnostics);

  if (error) {
    statusText.textContent = "AI 计算失败";
    return;
  }
  if (!move || !isAiMode || gameOver || isReplaying || currentPlayer !== WHITE) {
    updateStatus();
    return;
  }

  placeStone(move.row, move.col, WHITE);
  attachAiDiagnosticsToLatestMove(diagnostics);
  updateStatus();
}

function handleAiWorkerError() {
  const wasThinking = isAiThinking;
  isAiThinking = false;
  if (wasThinking && !gameOver && !isReplaying) statusText.textContent = "AI 计算失败";
}

function attachAiDiagnosticsToLatestMove(diagnostics) {
  const latestMove = moveHistory.at(-1);
  if (!latestMove || !diagnostics) return;
  latestMove.aiDiagnostics = {
    elapsedMs: diagnostics.elapsedMs,
    logs: [...diagnostics.logs],
    nodes: diagnostics.nodes,
    stage: diagnostics.stage,
    threatStats: diagnostics.threatStats ? { ...diagnostics.threatStats } : undefined,
    timedOut: diagnostics.timedOut,
  };
}

function updateStatus() {
  if (gameOver) return;
  if (isAiThinking) {
    statusText.textContent = "AI 思考中";
    return;
  }
  statusText.textContent = `${currentPlayer === BLACK ? "黑棋" : "白棋"}回合`;
}

function updateBoardTurn() {
  boardView.setTurn(currentPlayer);
}

function toggleModeMenu() {
  if (modeMenu.hidden) openModeMenu();
  else closeModeMenu();
}

function openModeMenu() {
  modeMenu.hidden = false;
  modeButton.setAttribute("aria-expanded", "true");
}

function closeModeMenu() {
  modeMenu.hidden = true;
  modeButton.setAttribute("aria-expanded", "false");
}

function toggleDifficultyMenu() {
  if (difficultyMenu.hidden) openDifficultyMenu();
  else closeDifficultyMenu();
}

function openDifficultyMenu() {
  difficultyMenu.hidden = false;
  difficultyButton.setAttribute("aria-expanded", "true");
}

function closeDifficultyMenu() {
  difficultyMenu.hidden = true;
  difficultyButton.setAttribute("aria-expanded", "false");
}

function setGameMode(nextIsAiMode) {
  if (isAiMode === nextIsAiMode) return;
  isAiMode = nextIsAiMode;
  closeDifficultyMenu();
  updateModeControls();
  resetGame();
}

function setAiLevel(nextLevel) {
  if (!AI_LEVEL_LABELS[nextLevel] || aiLevel === nextLevel) return;
  aiLevel = nextLevel;
  closeModeMenu();
  updateAiLevelControls();
  resetGame();
}

function updateModeControls() {
  modeButtonText.textContent = isAiMode ? "人机对战" : "双人对战";
  difficultyControl.hidden = !isAiMode;
  aiDebugPanel.hidden = !isAiMode;
  modeOptions.forEach((option) => {
    option.setAttribute("aria-checked", String((option.dataset.mode === "ai") === isAiMode));
  });
  updateAiLevelControls();
}

function updateAiLevelControls() {
  difficultyButtonText.textContent = AI_LEVEL_LABELS[aiLevel];
  difficultyOptions.forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.level === aiLevel));
  });
}

function updateAiDebugPanel(diagnostics) {
  if (!isAiMode || !diagnostics) {
    aiDebugPanel.hidden = true;
    return;
  }
  latestAiDiagnostics = diagnostics;
  aiDebugPanel.hidden = false;
  const label = AI_LEVEL_LABELS[diagnostics.level] ?? AI_LEVEL_LABELS[aiLevel];
  const timeoutText = diagnostics.timedOut ? " / 超时回退" : "";
  aiDebugSummary.textContent = `${label} / ${diagnostics.stage} / ${diagnostics.elapsedMs}ms / ${diagnostics.nodes}节点${timeoutText}`;
  aiDebugLogs.innerHTML = "";
  diagnostics.logs.forEach((item) => {
    const logItem = document.createElement("li");
    logItem.textContent = item;
    aiDebugLogs.appendChild(logItem);
  });
}

function resetAiDebugPanel() {
  latestAiDiagnostics = null;
  aiDebugPanel.hidden = !isAiMode;
  aiDebugSummary.textContent = "等待落子";
  aiDebugLogs.innerHTML = "";
}

/** 以五子棋常用的字母列、数字行坐标记录每一手。 */
function appendMoveLog(row, col, player, step) {
  moveLogs.querySelector(".move-log-empty")?.remove();
  const coordinate = formatBoardCoordinate(row, col);
  const item = document.createElement("li");
  item.className = "move-log-item";

  const sequence = document.createElement("span");
  sequence.className = "move-log-sequence";
  sequence.textContent = `第 ${step} 手`;

  const side = document.createElement("span");
  side.className = player === BLACK ? "move-log-side move-log-black" : "move-log-side move-log-white";
  side.textContent = player === BLACK ? "黑方" : "白方";

  const position = document.createElement("strong");
  position.className = "move-log-coordinate";
  position.textContent = coordinate;

  const detail = document.createElement("span");
  detail.className = "move-log-detail";
  detail.textContent = `${BOARD_SIZE - row}行${col + 1}列`;

  item.append(sequence, side, position, detail);
  moveLogs.appendChild(item);
  moveLogs.scrollTop = moveLogs.scrollHeight;
}

function resetMoveLog() {
  moveLogs.innerHTML = "";
  const empty = document.createElement("li");
  empty.className = "move-log-empty";
  empty.textContent = "尚未落子";
  moveLogs.appendChild(empty);
}

function getWinMessage(player) {
  if (isAiMode) return player === BLACK ? "你赢了" : "你输了";
  return `${player === BLACK ? "黑棋" : "白棋"}获胜`;
}

function showResultOverlay(message) {
  resultTitle.textContent = message;
  resultOverlay.hidden = false;
}

function hideResultOverlay() {
  resultOverlay.hidden = true;
}

/** 重置所有对局、回放、下载和 AI 搜索状态。 */
function resetGame() {
  stopReplayPlayback();
  aiClient.cancel();
  recordDownloads.revoke();
  board = createEmptyBoard();
  currentPlayer = BLACK;
  gameOver = false;
  isAiThinking = false;
  isReplaying = false;
  replayRecordData = null;
  replayStep = 0;
  moveHistory = [];
  currentGameRecord = null;
  resetMoveLog();
  resetAiDebugPanel();
  hideResultOverlay();
  hideReplayPanel();
  boardView.render(handleMove);
  updateStatus();
  updateBoardTurn();
  updateModeControls();
}

function downloadCurrentRecord() {
  if (!recordDownloads.download(currentGameRecord)) {
    statusText.textContent = "暂无可下载棋谱";
    return;
  }
  statusText.textContent = "棋谱已生成";
}

/** 导入并校验 JSON 棋谱，然后进入回放模式。 */
async function handleRecordImport() {
  const file = recordFileInput.files?.[0];
  if (!file) return;
  try {
    const record = await readRecordFile(file);
    validateRecord(record);
    currentGameRecord = record;
    replayRecord(record);
  } catch (error) {
    statusText.textContent = "棋谱文件无效";
  } finally {
    recordFileInput.value = "";
  }
}

/** 初始化指定棋谱的回放状态。 */
function replayRecord(record) {
  if (!record) return;
  const gameRecord = getPlayableRecord(record);
  if (!gameRecord) return;

  stopReplayPlayback();
  hideResultOverlay();
  recordDownloads.revoke();
  currentGameRecord = record;
  replayRecordData = gameRecord;
  replayStep = 0;
  board = createEmptyBoard();
  currentPlayer = BLACK;
  gameOver = false;
  isAiThinking = false;
  isReplaying = true;
  moveHistory = [];
  boardView.render(handleMove);
  updateBoardTurn();
  showReplayPanel();
  setReplayStep(0);
}

/** 重建棋盘到指定回放手数。 */
function setReplayStep(nextStep) {
  if (!replayRecordData) return;
  replayStep = Math.min(Math.max(nextStep, 0), replayRecordData.moves.length);
  board = createEmptyBoard();
  currentPlayer = BLACK;
  gameOver = false;
  isReplaying = true;
  boardView.render(handleMove);
  resetMoveLog();

  replayRecordData.moves.slice(0, replayStep).forEach((move, index) => {
    if (board[move.row]?.[move.col] === EMPTY) {
      placeStone(move.row, move.col, move.player, {
        skipRecord: true,
        skipWinCheck: true,
        step: Number.isInteger(move.step) ? move.step : index + 1,
      });
    }
  });

  gameOver = replayStep === replayRecordData.moves.length;
  statusText.textContent = gameOver
    ? replayRecordData.resultText || "回放结束"
    : `回放中 ${replayStep}/${replayRecordData.moves.length}`;
  if (gameOver) {
    boardView.lock();
    stopReplayPlayback();
  } else {
    updateBoardTurn();
  }
  updateReplayControls();
}

function toggleReplayPlayback() {
  if (!replayRecordData) return;
  if (replayTimer) {
    stopReplayPlayback();
    updateReplayControls();
    return;
  }
  if (replayStep >= replayRecordData.moves.length) setReplayStep(0);
  replayTimer = window.setInterval(() => setReplayStep(replayStep + 1), 520);
  updateReplayControls();
}

function stopReplayPlayback() {
  if (!replayTimer) return;
  window.clearInterval(replayTimer);
  replayTimer = null;
}

function exitReplay() {
  stopReplayPlayback();
  isReplaying = false;
  replayRecordData = null;
  replayStep = 0;
  hideReplayPanel();
  resetGame();
}

function showReplayPanel() {
  replayPanel.hidden = false;
  updateReplayControls();
}

function hideReplayPanel() {
  replayPanel.hidden = true;
}

function updateReplayControls() {
  const total = replayRecordData?.moves.length ?? 0;
  replayStepText.textContent = `${replayStep} / ${total}`;
  replayStartButton.disabled = replayStep <= 0;
  replayPrevButton.disabled = replayStep <= 0;
  replayNextButton.disabled = replayStep >= total;
  replayEndButton.disabled = replayStep >= total;
  replayPlayButton.textContent = replayTimer ? "暂停" : "播放";
}
