// 棋谱存储模块：创建、持久化、下载和读取对局记录及失败 fixture。
import { BLACK, BOARD_SIZE } from "./constants.js";

const MAX_STORED_FIXTURES = 50;

/** 将当前对局状态序列化为标准棋谱。 */
export function createGameRecord({ aiLevel, isAiMode, latestAiDiagnostics, moveHistory, resultText, winner }) {
  return {
    app: "gomoku",
    aiDiagnostics: latestAiDiagnostics,
    boardSize: BOARD_SIZE,
    createdAt: new Date().toISOString(),
    aiLevel: isAiMode ? aiLevel : null,
    mode: isAiMode ? "ai" : "human",
    moves: moveHistory.map((move) => ({ ...move })),
    resultText,
    winner,
  };
}

/** 专家 AI 败局转换为分类 fixture，其他对局原样返回。 */
export async function captureExpertLossFixture(record) {
  if (record.mode !== "ai" || record.aiLevel !== "expert" || record.winner !== BLACK) {
    return record;
  }

  const fixtureModule = await import("../modules/ai/fixtures.js");
  const fixture = fixtureModule.createExpertLossFixture(record);
  if (!fixture) return record;
  persistFixture(fixture, fixtureModule.EXPERT_FIXTURE_STORAGE_KEY);
  return fixture;
}

/** 管理棋谱下载所需的临时 Blob URL。 */
export function createRecordDownloadManager() {
  let url = null;

  function prepare(record) {
    revoke();
    url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
    );
  }

  function download(record) {
    if (!record || !url) return false;
    const link = document.createElement("a");
    link.href = url;
    link.download =
      record.schema === "expert-loss-fixture"
        ? `${record.category}--${record.id}.json`
        : `gomoku-${record.createdAt.replace(/[:.]/g, "-")}.json`;
    link.target = "_blank";
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  }

  function revoke() {
    if (!url) return;
    URL.revokeObjectURL(url);
    url = null;
  }

  return { download, prepare, revoke };
}

/** 异步读取并解析用户选择的 JSON 文件。 */
export function readRecordFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (error) {
        reject(error);
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

function persistFixture(fixture, storageKey) {
  try {
    const fixtures = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    const nextFixtures = fixtures.filter((item) => item.id !== fixture.id);
    nextFixtures.push(fixture);
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(nextFixtures.slice(-MAX_STORED_FIXTURES)),
    );
  } catch (error) {
    console.warn("Expert fixture could not be persisted locally", error);
  }
}
