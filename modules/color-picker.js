// =========================================================
//  HONEYCOMB + COLOR PICKER
//  These two components share internal state (pickerX/Y,
//  honeycombSelectedHex) and call each other's draw helpers,
//  so they live in one module to avoid circular imports.
// =========================================================

import { hexToRgb, rgbToHex, hsvToRgb, rgbToHsv } from './color-utils.js';

// ---- Honeycomb state ----
let honeycombCells       = [];
let honeycombSelectedHex = null;
const HONEYCOMB_COLOR_ROWS = [
  ["#003366", "#336699", "#3366cc", "#003399", "#000099", "#0000cc", "#000066"],
  ["#006666", "#006699", "#0099cc", "#0066cc", "#0033cc", "#0000ff", "#3333ff", "#333399"],
  ["#669999", "#009999", "#33cccc", "#00ccff", "#0099ff", "#0066ff", "#3366ff", "#3333cc", "#666699"],
  ["#339966", "#00cc99", "#00ffcc", "#00ffff", "#33ccff", "#3399ff", "#6699ff", "#6666ff", "#6600ff", "#6600cc"],
  ["#339933", "#00cc66", "#00ff99", "#66ffcc", "#66ffff", "#66ccff", "#99ccff", "#9999ff", "#9966ff", "#9933ff", "#9900ff"],
  ["#006600", "#00cc00", "#00ff00", "#66ff99", "#99ffcc", "#ccffff", "#ccccff", "#cc99ff", "#cc66ff", "#cc33ff", "#cc00ff", "#9900cc"],
  ["#003300", "#009933", "#33cc33", "#66ff66", "#99ff99", "#ccffcc", "#ffccff", "#ff99ff", "#ff66ff", "#ff00ff", "#cc00cc", "#660066"],
  ["#336600", "#009900", "#66ff33", "#99ff66", "#ccff99", "#ffffcc", "#ffcccc", "#ff99cc", "#ff66cc", "#ff33cc", "#cc0099", "#993399"],
  ["#333300", "#669900", "#99ff33", "#ccff66", "#ffff99", "#ffcc99", "#ff9999", "#ff6699", "#ff3399", "#cc3399", "#990099"],
  ["#666633", "#99cc00", "#ccff33", "#ffff66", "#ffcc66", "#ff9966", "#ff6666", "#ff0066", "#cc6699", "#993366"],
  ["#999966", "#cccc00", "#ffff00", "#ffcc00", "#ff9933", "#ff6600", "#ff5050", "#cc0066", "#660033"],
  ["#996633", "#cc9900", "#ff9900", "#cc6600", "#ff3300", "#ff0000", "#cc0000", "#990033"],
  ["#663300", "#996600", "#cc3300", "#993300", "#990000", "#800000", "#993333"],
];

// ---- Picker state ----
const PICKER_W = 220, PICKER_H = 220;
let pickerX        = 0;
let pickerY        = 0.5;
let pickerDragging = false;
let _onColorChosen = null;   // callback set by openPicker callers
let _keepOpen      = false;  // whether to leave picker open after applying

// =========================================================
//  HONEYCOMB
// =========================================================

function buildHoneycombColors() {
  return HONEYCOMB_COLOR_ROWS;
}

function drawHexagon(ctx, cx, cy, radius, fillColor) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle   = fillColor;
  ctx.fill();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth   = 0.5;
  ctx.stroke();
}

function drawHexagonOutline(ctx, cx, cy, radius, strokeColor, lineWidth) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth   = lineWidth;
  ctx.stroke();
}

function drawHoneycomb() {
  const canvas = document.getElementById("honeycombCanvas");
  if (!canvas) return;

  const colorRows  = buildHoneycombColors();
  const cellRadius = 11;
  const cellW      = Math.sqrt(3) * cellRadius;
  const gapX = 2, gapY = 2;
  const totalRows  = colorRows.length;
  const maxCols    = Math.max(...colorRows.map(r => r.length));
  const canvasW    = Math.ceil(maxCols * (cellW + gapX) + cellW / 2 + 10);
  const canvasH    = Math.ceil(totalRows * (cellRadius * 1.5 + gapY) + cellRadius + 10);

  canvas.width  = canvasW;
  canvas.height = canvasH;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvasW, canvasH);
  honeycombCells = [];

  const centerX = canvasW / 2;
  const startY  = cellRadius + 4;

  for (let row = 0; row < totalRows; row++) {
    const cols     = colorRows[row];
    const colCount = cols.length;
    const rowY     = startY + row * (cellRadius * 1.5 + gapY);
    const rowWidth = colCount * (cellW + gapX) - gapX;
    const rowStartX = centerX - rowWidth / 2 + cellW / 2;

    for (let col = 0; col < colCount; col++) {
      const cx  = rowStartX + col * (cellW + gapX);
      const cy  = rowY;
      const hex = cols[col];
      drawHexagon(ctx, cx, cy, cellRadius, hex);
      honeycombCells.push({ cx, cy, radius: cellRadius, hex });
    }
  }

  if (honeycombSelectedHex) {
    const sel = honeycombCells.find(c => c.hex.toLowerCase() === honeycombSelectedHex.toLowerCase());
    if (sel) drawHexagonOutline(ctx, sel.cx, sel.cy, sel.radius + 1, "#ffffff", 2);
  }
}

function honeycombHitTest(mx, my) {
  for (const cell of honeycombCells) {
    const dx = mx - cell.cx, dy = my - cell.cy;
    if (Math.sqrt(dx * dx + dy * dy) <= cell.radius) return cell;
  }
  return null;
}

export function handleHoneycombClick(e) {
  const canvas = document.getElementById("honeycombCanvas");
  const rect   = canvas.getBoundingClientRect();
  const mx     = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my     = (e.clientY - rect.top)  * (canvas.height / rect.height);

  const cell = honeycombHitTest(mx, my);
  if (!cell) return;

  honeycombSelectedHex = cell.hex;

  const { r, g, b } = hexToRgb(cell.hex);
  const hsv = rgbToHsv(r, g, b);
  pickerX = hsv.h;
  if (hsv.s < 1.0 && hsv.v >= 0.99) pickerY = hsv.s * 0.35;
  else if (hsv.v < 1.0)              pickerY = 0.65 + ((1.0 - hsv.v) * 0.35);
  else                               pickerY = 0.5;

  drawPickerSquare();
  updatePickerUI();
  drawHoneycomb();
}

// =========================================================
//  COLOR PICKER
// =========================================================

function colorAtPos(xR, yR) {
  const h = xR;
  let s = 1.0, v = 1.0;
  if (yR < 0.35)      s = yR / 0.35;
  else if (yR > 0.65) v = 1.0 - ((yR - 0.65) / 0.35);
  const rgb = hsvToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, v)));
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function drawPickerSquare() {
  const cv  = document.getElementById("pickerSquare");
  cv.width  = PICKER_W;
  cv.height = PICKER_H;
  const ctx = cv.getContext("2d");

  const hg = ctx.createLinearGradient(0, 0, PICKER_W, 0);
  for (let i = 0; i <= 12; i++) {
    const { r, g, b } = hsvToRgb(i / 12, 1, 1);
    hg.addColorStop(i / 12, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, PICKER_W, PICKER_H);

  const wg = ctx.createLinearGradient(0, 0, 0, PICKER_H * 0.35);
  wg.addColorStop(0, "rgba(255,255,255,1)");
  wg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = wg;
  ctx.fillRect(0, 0, PICKER_W, PICKER_H * 0.35);

  const bg = ctx.createLinearGradient(0, PICKER_H * 0.65, 0, PICKER_H);
  bg.addColorStop(0, "rgba(0,0,0,0)");
  bg.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, PICKER_H * 0.65, PICKER_W, PICKER_H * 0.35);
}

function updatePickerUI() {
  const hex = colorAtPos(pickerX, pickerY);
  document.getElementById("pickerPreview").style.background  = hex;
  document.getElementById("pickerHexLabel").textContent      = hex;
  const m = document.getElementById("pickerMarker");
  m.style.left = Math.round(pickerX * PICKER_W) + "px";
  m.style.top  = Math.round(pickerY * PICKER_H) + "px";
}

/**
 * Open the color picker popup.
 * @param {string|null}  initialHex     – hex to pre-select, or null
 * @param {function}     onColorChosen  – called with the chosen hex when "Use Color" is clicked
 * @param {boolean}      [keepOpen]     – when true, the picker stays open after applying
 *                                        (used for the global "Pick Color → add to palette" flow)
 */
export function openPicker(initialHex, onColorChosen, keepOpen) {
  _onColorChosen  = onColorChosen || null;
  _keepOpen       = !!keepOpen;
  honeycombSelectedHex = initialHex || null;

  if (initialHex) {
    const { r, g, b } = hexToRgb(initialHex);
    const hsv = rgbToHsv(r, g, b);
    pickerX = hsv.h;
    if (hsv.s < 1.0 && hsv.v >= 0.99) pickerY = hsv.s * 0.35;
    else if (hsv.v < 1.0)              pickerY = 0.65 + ((1.0 - hsv.v) * 0.35);
    else                               pickerY = 0.5;
  }

  document.getElementById("pickerPopup").classList.remove("hidden");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawHoneycomb();
    drawPickerSquare();
    updatePickerUI();
  }));
}

export function closePicker() {
  document.getElementById("pickerPopup").classList.add("hidden");
  _onColorChosen       = null;
  _keepOpen            = false;
  honeycombSelectedHex = null;
}

export function handlePickerSquareInteraction(e) {
  const rect = document.getElementById("pickerSquare").getBoundingClientRect();
  pickerX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  pickerY = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
  updatePickerUI();
  honeycombSelectedHex = null;
  drawHoneycomb();
}

export function pickerApplyColor() {
  const hex = colorAtPos(pickerX, pickerY);
  if (_onColorChosen) _onColorChosen(hex);
  if (!_keepOpen) closePicker();
}

export function getPickerDragging()  { return pickerDragging; }
export function setPickerDragging(v) { pickerDragging = v; }
