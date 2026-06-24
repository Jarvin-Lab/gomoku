// 棋盘视图模块：负责网格、星位、棋子和回合视觉状态，不持有游戏规则。
import { BLACK, BOARD_COLUMNS, BOARD_SIZE } from "./constants.js";

/** 创建与指定棋盘元素绑定的轻量视图控制器。 */
export function createBoardView(boardElement) {
  /** 重建棋盘，并把点击事件转交给应用控制器。 */
  function render(onMove) {
    boardElement.innerHTML = "";
    boardElement.style.setProperty("--board-size", BOARD_SIZE);
    renderCoordinateLabels();
    renderStarPoints();

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.type = "button";
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        cell.style.left = `${(col / (BOARD_SIZE - 1)) * 100}%`;
        cell.style.top = `${(row / (BOARD_SIZE - 1)) * 100}%`;
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `${row + 1}行${col + 1}列`);
        cell.addEventListener("click", () => onMove(row, col));
        boardElement.appendChild(cell);
      }
    }
  }

  /** 在棋盘边框内绘制与棋谱记录一致的坐标，列标跳过 I。 */
  function renderCoordinateLabels() {
    const boardWrap = boardElement.parentElement;
    if (!boardWrap || boardWrap.querySelector(".board-coordinates")) return;

    const coordinateLayer = document.createElement("div");
    coordinateLayer.className = "board-coordinates";
    coordinateLayer.setAttribute("aria-hidden", "true");

    for (let index = 0; index < BOARD_SIZE; index += 1) {
      const position = `${(index / (BOARD_SIZE - 1)) * 100}%`;

      const columnLabel = document.createElement("span");
      columnLabel.className = "board-coordinate board-coordinate-column";
      columnLabel.style.left = position;
      columnLabel.textContent = BOARD_COLUMNS[index];

      const rowLabel = document.createElement("span");
      rowLabel.className = "board-coordinate board-coordinate-row";
      rowLabel.style.top = position;
      rowLabel.textContent = String(BOARD_SIZE - index);

      coordinateLayer.append(columnLabel, rowLabel);
    }

    boardWrap.appendChild(coordinateLayer);
  }

  /** 绘制一枚棋子；回放传入 step 时同时在棋子中央显示手数。 */
  function paintStone(row, col, player, step = null) {
    boardElement.querySelector(".stone-latest")?.classList.remove("stone-latest");
    const cell = boardElement.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    const stone = document.createElement("span");
    stone.className =
      player === BLACK ? "stone stone-black stone-latest" : "stone stone-white stone-latest";
    if (Number.isInteger(step) && step > 0) {
      stone.classList.add("stone-with-step");
      stone.textContent = String(step);
      stone.setAttribute("aria-label", `第${step}手`);
    }
    cell.appendChild(stone);
    cell.disabled = true;
  }

  function lock() {
    boardElement.querySelectorAll(".cell").forEach((cell) => {
      cell.disabled = true;
    });
  }

  function setTurn(player) {
    boardElement.dataset.turn = player === BLACK ? "black" : "white";
  }

  function renderStarPoints() {
    const center = Math.floor(BOARD_SIZE / 2);
    const starPoints = [
      { row: center, col: center },
      { row: center - 4, col: center - 4 },
      { row: center - 4, col: center + 4 },
      { row: center + 4, col: center - 4 },
      { row: center + 4, col: center + 4 },
    ];
    starPoints.forEach(({ row, col }) => {
      const point = document.createElement("span");
      point.className = "star-point";
      point.style.left = `${(col / (BOARD_SIZE - 1)) * 100}%`;
      point.style.top = `${(row / (BOARD_SIZE - 1)) * 100}%`;
      boardElement.appendChild(point);
    });
  }

  return { lock, paintStone, render, setTurn };
}
