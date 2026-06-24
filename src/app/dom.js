// 集中获取页面元素，启动时尽早暴露缺失 DOM 的模板错误。
function required(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

export const elements = Object.freeze({
  aiDebugLogs: required("#aiDebugLogs"),
  aiDebugPanel: required("#aiDebugPanel"),
  aiDebugSummary: required("#aiDebugSummary"),
  board: required("#board"),
  closeResultButton: required("#closeResultButton"),
  difficultyButton: required("#difficultyButton"),
  difficultyButtonText: required("#difficultyButtonText"),
  difficultyControl: required("#difficultyControl"),
  difficultyMenu: required("#difficultyMenu"),
  difficultyOptions: document.querySelectorAll(".difficulty-option"),
  downloadRecordButton: required("#downloadRecordButton"),
  modeButton: required("#modeButton"),
  modeButtonText: required("#modeButtonText"),
  modeMenu: required("#modeMenu"),
  modeOptions: document.querySelectorAll(".mode-option"),
  moveLogs: required("#moveLogs"),
  playAgainButton: required("#playAgainButton"),
  recordFileInput: required("#recordFileInput"),
  replayEndButton: required("#replayEndButton"),
  replayExitButton: required("#replayExitButton"),
  replayNextButton: required("#replayNextButton"),
  replayPanel: required("#replayPanel"),
  replayPlayButton: required("#replayPlayButton"),
  replayPrevButton: required("#replayPrevButton"),
  replayRecordButton: required("#replayRecordButton"),
  replayStartButton: required("#replayStartButton"),
  replayStepText: required("#replayStepText"),
  resetButton: required("#resetButton"),
  resultOverlay: required("#resultOverlay"),
  resultTitle: required("#resultTitle"),
  statusText: required("#statusText"),
});
