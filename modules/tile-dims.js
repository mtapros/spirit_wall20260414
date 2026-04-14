import { getVal, getStr } from './dom-helpers.js';

// Callback registered by main.js so tile-dims can trigger a live-preview
// refresh without importing live-preview (which imports color-field,
// which imports color-picker — no circular deps this way).
let _livePreviewCallback = null;
export function setLivePreviewCallback(fn) { _livePreviewCallback = fn; }

export function getTileDims() {
  const ratioStr    = getStr("tileRatio");
  const orientation = getStr("tileOrientation");
  const longSide    = getVal("tileLongSide") || 500;

  const parts    = ratioStr.split(":");
  const rA       = parseFloat(parts[0]);
  const rB       = parseFloat(parts[1]);
  const ratioMax = Math.max(rA, rB);
  const ratioMin = Math.min(rA, rB);
  const shortSide = Math.round(longSide * (ratioMin / ratioMax));

  let tileW, tileH;
  if (orientation === "landscape") { tileW = longSide; tileH = shortSide; }
  else                             { tileW = shortSide; tileH = longSide; }

  return { tileW, tileH };
}

export function updateTileDimsLabel() {
  const { tileW, tileH } = getTileDims();
  document.getElementById("tileDimsLabel").textContent = "Tile: " + tileW + " x " + tileH + " px";
}

export function computeCanvasSize() {
  const { tileW, tileH } = getTileDims();
  const cols = getVal("cols");
  const rows = getVal("rows");
  const gX   = getVal("gapX");
  const gY   = getVal("gapY");
  const bW   = Math.ceil(cols * (tileW + gX) - gX);

  const genRefl   = document.getElementById("genReflGrid") &&
                    document.getElementById("genReflGrid").checked;
  const actualRows = genRefl ? rows * 2 : rows;
  const bH         = actualRows * tileH + gY * (actualRows - 1);

  updateTileDimsLabel();
  document.getElementById("canvasSizeHint").textContent = "Canvas: " + bW + " x " + bH + " px";

  if (!document.getElementById("tileEditor").classList.contains("hidden") && _livePreviewCallback) {
    _livePreviewCallback();
  }

  return { bW, bH, tileW, tileH };
}
