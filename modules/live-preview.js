import { getVal, getStr }     from './dom-helpers.js';
import { appState }           from './state.js';
import { getColorFieldValue } from './color-field.js';
import { getTileEditorDims }  from './tile-dims.js';

const PREVIEW_BTN_STATES = {
  INITIAL: "initial",
  DIRTY:   "dirty",
  CURRENT: "current",
};

let previewBtnState = PREVIEW_BTN_STATES.INITIAL;
let hasRenderedPreview = false;

function getPreviewButton() {
  return document.getElementById("tePreviewBtn");
}

function setPreviewButtonState(state) {
  const btn = getPreviewButton();
  if (!btn) return;

  previewBtnState = state;
  btn.classList.remove("preview-btn-initial", "preview-btn-dirty", "preview-btn-current");

  if (state === PREVIEW_BTN_STATES.CURRENT) {
    btn.classList.add("preview-btn-current");
    btn.textContent = "Preview Current";
  } else if (state === PREVIEW_BTN_STATES.DIRTY) {
    btn.classList.add("preview-btn-dirty");
    btn.textContent = "Re-render Preview";
  } else {
    btn.classList.add("preview-btn-initial");
    btn.textContent = "Render Preview";
  }
}

export function initLivePreviewButton() {
  const btn = getPreviewButton();
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", renderLivePreview);
  setPreviewButtonState(PREVIEW_BTN_STATES.INITIAL);
}

export function resetLivePreviewState() {
  hasRenderedPreview = false;
  const canvas = document.getElementById("tePreviewCanvas");
  const overlay = document.getElementById("tePreviewText");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (overlay) overlay.innerHTML = "";
  setPreviewButtonState(PREVIEW_BTN_STATES.INITIAL);
}

export function markLivePreviewDirty() {
  if (!document.getElementById("tileEditor") || document.getElementById("tileEditor").classList.contains("hidden")) return;
  if (!hasRenderedPreview) {
    setPreviewButtonState(PREVIEW_BTN_STATES.INITIAL);
    return;
  }
  setPreviewButtonState(PREVIEW_BTN_STATES.DIRTY);
}

export function renderLivePreview() {
  updateLivePreview();
  hasRenderedPreview = true;
  setPreviewButtonState(PREVIEW_BTN_STATES.CURRENT);
}

export function scheduleLivePreview() {
  markLivePreviewDirty();
}

export function updateLivePreview() {
  const canvas  = document.getElementById("tePreviewCanvas");
  const overlay = document.getElementById("tePreviewText");
  if (!canvas || !overlay) return;

  const parent   = canvas.parentElement;
  if (!parent) return;
  let displayW   = parent.clientWidth;
  if (displayW <= 0) displayW = 250;

  const { tileW, tileH } = getTileEditorDims();
  const aspect   = tileH / tileW;
  let displayH   = Math.round(displayW * aspect);
  if (displayH <= 0) displayH = displayW;

  const sizeKey = `${displayW}x${displayH}`;
  if (canvas.dataset.previewSize !== sizeKey) {
    parent.style.height    = displayH + "px";
    parent.style.position  = "relative";
    parent.style.overflow  = "hidden";
    parent.style.contain   = "layout paint";

    canvas.style.position          = "absolute";
    canvas.style.top               = "0";
    canvas.style.left              = "0";
    canvas.style.width             = "100%";
    canvas.style.height            = "100%";
    canvas.style.pointerEvents     = "none";
    canvas.style.backfaceVisibility = "hidden";
    canvas.style.transform         = "translateZ(0)";
    canvas.width                   = displayW;
    canvas.height                  = displayH;

    overlay.style.position         = "absolute";
    overlay.style.top              = "0";
    overlay.style.left             = "0";
    overlay.style.width            = "100%";
    overlay.style.height           = "100%";
    overlay.style.display          = "flex";
    overlay.style.flexDirection    = "column";
    overlay.style.pointerEvents    = "none";
    overlay.style.backfaceVisibility = "hidden";
    overlay.style.transform        = "translateZ(0)";

    canvas.dataset.previewSize = sizeKey;
  }

  const ctx  = canvas.getContext("2d");
  if (!ctx) return;
  const w    = canvas.width;
  const h    = canvas.height;
  const type = getStr("teType");

  ctx.clearRect(0, 0, w, h);
  overlay.innerHTML = "";

  const fillRect = (color, rx, ry, rw, rh) => {
    ctx.fillStyle = color;
    ctx.fillRect(rx, ry, rw, rh);
  };

  if (type === "solid") {
    fillRect(getColorFieldValue("teSolidColor"), 0, 0, w, h);

  } else if (type === "solid-framed") {
    fillRect(getColorFieldValue("teFrameColor"), 0, 0, w, h);
    const thickPct = (getVal("teFrameThick") || 10) / 100;
    const tx = w * thickPct, ty = h * thickPct;
    fillRect(getColorFieldValue("teSolidColor"), tx, ty, w - tx*2, h - ty*2);

  } else if (type === "checkerboard") {
    const cA   = getColorFieldValue("teCheckA");
    const cB   = getColorFieldValue("teCheckB");
    fillRect(cA, 0, 0, w, h);
    const divs  = getVal("teGridDivs") || 4;
    const cellW = w / divs, cellH = h / divs;
    for (let r = 0; r < divs; r++) {
      for (let c = 0; c < divs; c++) {
        if ((r + c) % 2 === 1) {
          let cx2 = Math.round(c * cellW), cy2 = Math.round(r * cellH);
          let cw2 = Math.round((c + 1) * cellW) - cx2;
          let ch2 = Math.round((r + 1) * cellH) - cy2;
          fillRect(cB, cx2, cy2, cw2, ch2);
        }
      }
    }

  } else if (type.startsWith("icon")) {
    fillRect(getColorFieldValue("teIconBg"), 0, 0, w, h);
    if (appState.cachedIconImage) {
      let isGrid  = type === "icon-grid";
      let divs2   = isGrid ? (getVal("teGridDivs") || 2) : 1;
      let cellW2  = w / divs2, cellH2 = h / divs2;
      let scaleFac = w / (tileW || 400);
      let pad      = (getVal("teIconPad") || 0) * scaleFac;
      let fitW     = Math.max(1, cellW2 - pad*2);
      let fitH     = Math.max(1, cellH2 - pad*2);
      let imgScale = Math.min(fitW / appState.cachedIconImage.width, fitH / appState.cachedIconImage.height);
      let dw       = appState.cachedIconImage.width  * imgScale;
      let dh       = appState.cachedIconImage.height * imgScale;
      for (let r2 = 0; r2 < divs2; r2++) {
        for (let c2 = 0; c2 < divs2; c2++) {
          let cx3 = (c2 * cellW2) + (cellW2 - dw) / 2;
          let cy3 = (r2 * cellH2) + (cellH2 - dh) / 2;
          ctx.drawImage(appState.cachedIconImage, cx3, cy3, dw, dh);
        }
      }
    }

  } else if (type.startsWith("phrase")) {
    let text1  = getStr("teText").toUpperCase()  || "TEXT";
    let text2  = getStr("teText2").toUpperCase() || "TEXT 2";
    let font   = getStr("teFont") || "Arial";
    let scale  = (getVal("teTextScale") || 80) / 100;
    let tColor = getColorFieldValue("teTextColor");
    let bColor = getColorFieldValue("teBgColor");

    fillRect(bColor, 0, 0, w, h);
    overlay.style.justifyContent =
      (type === "phrase-single" || type === "phrase-multiline") ? "center" : "flex-start";

    if (type === "phrase-single") {
      let fs      = Math.floor(Math.min((w * scale) / ((text1.length || 1) * 0.6), h * scale));
      let lineDiv = document.createElement("div");
      lineDiv.style.cssText =
        `color:${tColor}; font-family:'${font}',sans-serif; font-weight:bold;` +
        ` font-size:${fs}px; line-height:1; margin:auto;`;
      lineDiv.textContent = text1;
      overlay.appendChild(lineDiv);

    } else if (type === "phrase-fill" || type === "phrase-fillcolor" || type === "phrase-altwords") {
      let altTColor = (type === "phrase-fillcolor" || type === "phrase-altwords")
        ? getColorFieldValue("teAltTextColor") : tColor;
      let altBColor = (type === "phrase-fillcolor" || type === "phrase-altwords")
        ? getColorFieldValue("teAltBgColor") : null;

      let longestStr = (type === "phrase-altwords" && text2.length > text1.length) ? text2 : text1;
      let fs2        = Math.floor((w * scale) / ((longestStr.length || 1) * 0.6));
      let numLines   = Math.max(1, Math.floor(h / (fs2 * 1.25)));
      let evenH      = h / numLines;

      for (let i = 0; i < numLines; i++) {
        let isAlt = (i % 2 === 1);
        if (isAlt && altBColor) fillRect(altBColor, 0, i * evenH, w, evenH);

        let lineDiv2 = document.createElement("div");
        lineDiv2.style.cssText =
          `width:100%; height:${evenH}px; display:flex; justify-content:center;` +
          ` align-items:center; color:${isAlt ? altTColor : tColor};` +
          ` font-family:'${font}',sans-serif; font-weight:bold; font-size:${fs2}px; line-height:1;`;
        lineDiv2.textContent = (type === "phrase-altwords" && isAlt) ? text2 : text1;
        overlay.appendChild(lineDiv2);
      }

    } else if (type === "phrase-multiline") {
      let words       = text1.split(/\s+/);
      let longestWord = words.reduce((a, b) => a.length > b.length ? a : b, "");
      let maxCharW    = w * scale, maxH2 = h * scale;
      let maxFsWord   = Math.floor(maxCharW / ((longestWord.length || 1) * 0.6));
      let fsArea      = Math.floor(Math.sqrt((maxCharW * maxH2) / ((text1.length || 1) * 0.72)));
      let fs3         = Math.min(maxFsWord, fsArea, Math.floor(maxH2));

      let lh, blockH, linesToDraw = [];
      while (fs3 > 4) {
        lh = fs3 * 1.2;
        let charsPerLine = Math.floor(maxCharW / (fs3 * 0.6));
        if (charsPerLine < 1) charsPerLine = 1;

        linesToDraw = [];
        let currentLine = [], currLen = 0;
        for (let wi = 0; wi < words.length; wi++) {
          let wd = words[wi];
          if (currLen === 0) { currentLine.push(wd); currLen = wd.length; }
          else if (currLen + 1 + wd.length > charsPerLine) {
            linesToDraw.push(currentLine.join(" "));
            currentLine = [wd]; currLen = wd.length;
          } else { currentLine.push(wd); currLen += 1 + wd.length; }
        }
        if (currentLine.length > 0) linesToDraw.push(currentLine.join(" "));
        blockH = linesToDraw.length * lh;
        if (blockH <= maxH2) break;
        fs3--;
      }

      let wrapDiv = document.createElement("div");
      wrapDiv.style.cssText = "margin: auto; text-align: center;";
      for (let li = 0; li < linesToDraw.length; li++) {
        let lineDiv3 = document.createElement("div");
        lineDiv3.style.cssText =
          `color:${tColor}; font-family:'${font}',sans-serif;` +
          ` font-weight:bold; font-size:${fs3}px; line-height:1.2;`;
        lineDiv3.textContent = linesToDraw[li];
        wrapDiv.appendChild(lineDiv3);
      }
      overlay.appendChild(wrapDiv);
    }
  }
}
