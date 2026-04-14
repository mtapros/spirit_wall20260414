// =========================================================
//  ENTRY POINT
//  Imports every module, wires callbacks and event listeners,
//  then initialises the UI.  No business logic lives here.
// =========================================================

import { app, core }             from "photoshop";
import { storage }               from "uxp";
import { fontMap }     from './modules/state.js';
import { setStatus }   from './modules/dom-helpers.js';

import {
  openPicker, closePicker,
  pickerApplyColor, handleHoneycombClick,
  handlePickerSquareInteraction,
  getPickerDragging, setPickerDragging,
} from './modules/color-picker.js';

import {
  registerColorField, setColorChangeCallback,
  refreshAllColorFields,
} from './modules/color-field.js';

import { palette }               from './modules/state.js';
import { renderSwatches, addColor } from './modules/palette-ui.js';
import { loadReferenceImage, handleRefCanvasClick } from './modules/reference-image.js';
import { appState }              from './modules/state.js';

import {
  computeCanvasSize, setLivePreviewCallback,
} from './modules/tile-dims.js';

import {
  initLivePreviewButton,
  markLivePreviewDirty,
  capturePreviewToDataUri,
} from './modules/live-preview.js';

import {
  renderTileList, showEditorSection, openEditor,
  saveTileFromEditor, cacheIconImage,
  openEditorFromSpec, buildTileFromEditor,
  setOnExportTile,
} from './modules/tile-editor.js';

import { generate }              from './modules/generation.js';
import { apply3DWall }           from './modules/wall-3d.js';
import {
  switchTab, selectExportFolder, exportHiResTiles,
} from './modules/export.js';

import {
  exportTile, exportAllTiles,
  importTile, importTilePack,
  importSpec, exportEditorSpec,
} from './modules/tile-io.js';

import {
  loadLicenseData,
  activateLicense,
  validateLicense,
  deactivateLicense,
  computeOfflineGraceRemaining,
} from './modules/license.js';

import {
  initLicensing,
  getLicenseState,
  applyLicenseStateToUI,
  MODE,
} from './modules/licensing.js';

const DEFAULT_PALETTE_COLORS = [
  "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#0000ff",
  "#800080", "#8b4513", "#ffffff", "#808080", "#000000",
];

// =========================================================
//  WIRE CROSS-MODULE CALLBACKS
//  (Breaks the color-field ↔ live-preview circular dep)
// =========================================================
setColorChangeCallback(markLivePreviewDirty);
setLivePreviewCallback(markLivePreviewDirty);

// Wire per-tile export callback (breaks tile-editor ↔ tile-io circular dep)
setOnExportTile(exportTile);

// Expose tab / export functions called by inline HTML attributes
window.switchTab          = switchTab;
window.selectExportFolder = selectExportFolder;
window.exportHiResTiles   = exportHiResTiles;

// =========================================================
//  SLIDER HELPER
// =========================================================
function setupSlider(sliderId, displayId, numberId) {
  const slider  = document.getElementById(sliderId);
  const display = document.getElementById(displayId);
  const numberInput = numberId ? document.getElementById(numberId) : null;
  if (!slider) return;

  const min = Number(slider.min);
  const max = Number(slider.max);
  const step = Number(slider.step) || 1;
  const clamp = (v) => {
    if (Number.isNaN(v)) return Number(slider.value);
    return Math.min(max, Math.max(min, v));
  };

  const syncTo = (rawVal) => {
    let v = clamp(Number(rawVal));
    if (step === 1) v = Math.round(v);
    slider.value = String(v);
    if (display) display.textContent = String(v);
    if (numberInput) numberInput.value = String(v);
  };

  syncTo(slider.value);
  slider.addEventListener("input", () => syncTo(slider.value));
  if (numberInput) {
    numberInput.addEventListener("input", () => syncTo(numberInput.value));
    numberInput.addEventListener("change", () => syncTo(numberInput.value));
  }
}

// =========================================================
//  LICENSE UI HELPERS
// =========================================================

function setLicenseStatusMsg(msg) {
  const el = document.getElementById("licStatus");
  if (!el) return;
  const em = document.createElement("em");
  em.textContent = msg;
  el.innerHTML = "";
  el.appendChild(em);
  const current = document.getElementById("licCurrentStatus");
  if (current) current.textContent = msg;
}

function escHtml(str) {
  if (str === null || str === undefined) return "—";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function maskLicenseKey(key) {
  if (!key) return "—";
  const clean = String(key).trim();
  if (!clean) return "—";
  const parts = clean.split("-");
  const tail = parts[parts.length - 1] || clean.slice(-4);
  return "XXXX-XXXX-XXXX-" + tail;
}

function getLicenseVersionFromData(data) {
  if (!data) return "unknown";
  const tier = data.tier === null || data.tier === undefined
    ? ""
    : String(data.tier).trim().toLowerCase();
  if (tier === "basic" || tier === "pro" || tier === "advanced") return tier;
  const rank = Number(data.tierRank);
  if (rank >= 3) return "advanced";
  if (rank >= 2) return "pro";
  if (rank >= 1) return "basic";
  return "unknown";
}

async function updateLicenseStatusUI(noticeMsg = "") {
  const data = await loadLicenseData();
  const el   = document.getElementById("licStatus");
  if (!el) return;
  const state = await getLicenseState();
  const current = document.getElementById("licCurrentStatus");
  let currentStatus = "No active license. Trial status shown in Builder banner.";
  if (state.mode === MODE.TRIAL_ACTIVE) {
    currentStatus = "TRIAL ACTIVE — " + state.daysLeft + " day(s) left";
  } else if (state.mode === MODE.TRIAL_EXPIRED || state.mode === MODE.UNLICENSED) {
    currentStatus = "TRIAL EXPIRED — purchase required";
  } else if (state.mode === MODE.OFFLINE_GRACE) {
    currentStatus = "LICENSE ACTIVE (OFFLINE GRACE) — " + String(state.paidTier || "unknown").toUpperCase();
  } else if (state.licensed) {
    currentStatus = "LICENSE ACTIVE — " + String(state.paidTier || "unknown").toUpperCase();
  }
  if (current) current.textContent = currentStatus;
  if (!data) {
    setLicenseStatusMsg("No license data. Enter a key and click Activate.");
    return;
  }
  const graceRemaining = computeOfflineGraceRemaining(data);
  const graceDays = graceRemaining !== null
    ? (graceRemaining / 86400).toFixed(1) + " days"
    : "—";
  const validatedStr = data.validatedAt
    ? new Date(data.validatedAt).toLocaleString()
    : "—";
  const statusStr = data.status ? data.status : "unknown";
  const versionStr = getLicenseVersionFromData(data);
  const noticeBlock = noticeMsg
    ? "<div style='margin-bottom:8px; color:#b8e994;'><b>" + escHtml(noticeMsg) + "</b></div>"
    : "";
  el.innerHTML =
    noticeBlock +
    "<div style='margin-bottom:8px;'><b>Current Status: <span style=\"font-size:12px; color:#fff;\">" + escHtml(currentStatus) + "</span></b></div>" +
    "<div style='display:grid; grid-template-columns:1fr 1fr; gap:3px 16px;'>" +
      "<span><b>Status:</b> <b style='color:#fff;'>" + escHtml(statusStr) + "</b></span>" +
      "<span><b>Version:</b> "   + escHtml(versionStr.toUpperCase())   + "</span>" +
      "<span><b>Tier:</b> "   + escHtml(data.tier)   + "</span>" +
      "<span><b>Tier Rank:</b> " + escHtml(data.tierRank) + "</span>" +
      "<span><b>Validated:</b> " + escHtml(validatedStr) + "</span>" +
      "<span style='grid-column:1/-1;'><b>Key:</b> " + escHtml(maskLicenseKey(data.licenseKey)) + "</span>" +
      "<span style='grid-column:1/-1;'><b>Offline Grace Remaining:</b> " + escHtml(graceDays) + "</span>" +
    "</div>";
}

async function refreshLicenseUiAndState(noticeMsg = "") {
  await updateLicenseStatusUI(noticeMsg);
  applyLicenseStateToUI(await getLicenseState());
}

function initTopChromeLayoutSync() {
  const topChrome = document.getElementById("topChrome");
  if (!topChrome) return;

  const sync = () => {
    const h = Math.ceil(topChrome.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty("--top-chrome-h", h + "px");
  };

  sync();
  requestAnimationFrame(sync);
  window.addEventListener("resize", sync);

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(sync);
    ro.observe(topChrome);
  }

  if (typeof MutationObserver !== "undefined") {
    const mo = new MutationObserver(() => sync());
    mo.observe(topChrome, { childList: true, subtree: true, attributes: true, characterData: true });
  }
}

// =========================================================
//  DOM READY
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  initTopChromeLayoutSync();

  // ---- Build font map from Photoshop ----
  try {
    app.fonts.forEach(f => {
      fontMap[f.name.toLowerCase()]   = f.postScriptName;
      if (!fontMap[f.family.toLowerCase()]) fontMap[f.family.toLowerCase()] = f.postScriptName;
    });
  } catch (err) { console.log("Font mapping failed:", err); }

  // ---- Register color fields ----
  registerColorField("canvasBgColor",  "cfCanvasBg",      "#ffffff");
  registerColorField("teTextColor",    "cfTextColor",     "#000000");
  registerColorField("teBgColor",      "cfBgColor",       "#ffffff");
  registerColorField("teAltTextColor", "cfAltTextColor",  "#ffffff");
  registerColorField("teAltBgColor",   "cfAltBgColor",    "#000000");
  registerColorField("teIconBg",       "cfIconBg",        "#ffffff");
  registerColorField("teSolidColor",   "cfSolidColor",    "#000000");
  registerColorField("teFrameColor",   "cfFrameColor",    "#000000");
  registerColorField("teCheckA",       "cfCheckA",        "#ffffff");
  registerColorField("teCheckB",       "cfCheckB",        "#000000");

  // ---- Tile-dimension inputs ----
  ["tileRatio", "tileOrientation", "tileLongSide"].forEach(id =>
    document.getElementById(id).addEventListener("change", computeCanvasSize)
  );
  document.getElementById("tileLongSide").addEventListener("input", computeCanvasSize);
  ["cols", "rows", "gapX", "gapY"].forEach(id =>
    document.getElementById(id).addEventListener("input", computeCanvasSize)
  );
  document.getElementById("stagger").addEventListener("change", computeCanvasSize);
  document.getElementById("staggerOffset").addEventListener("input", computeCanvasSize);

  document.getElementById("genReflGrid").addEventListener("change", e => {
    computeCanvasSize();
    const camAdjEl = document.getElementById("camAdjRefl");
    if (camAdjEl) camAdjEl.checked = e.target.checked;
    document.getElementById("reflectionOpts").classList.toggle("hidden", !e.target.checked);
  });

  // ---- Live-preview inputs (tile editor) ----
  ["teType", "teText", "teText2", "teFont", "teTextScale", "teIconPad", "teGridDivs", "teFrameThick"]
    .forEach(id => {
      document.getElementById(id).addEventListener("input",  markLivePreviewDirty);
      document.getElementById(id).addEventListener("change", markLivePreviewDirty);
    });

  // Tile-editor dimension inputs also dirty the live preview
  ["teTileRatio", "teTileOrientation"].forEach(id => {
    document.getElementById(id).addEventListener("change", markLivePreviewDirty);
  });
  document.getElementById("teTileLongSide").addEventListener("input",  markLivePreviewDirty);
  document.getElementById("teTileLongSide").addEventListener("change", markLivePreviewDirty);

  // "Set as Thumbnail" button — capture canvas PNG into appState
  document.getElementById("teSetThumbnailBtn").addEventListener("click", () => {
    try {
      const dataUri = capturePreviewToDataUri();
      if (!dataUri) { setStatus("Render the preview first, then set as thumbnail."); return; }
      appState.pendingThumbnailDataUri = dataUri;
      setStatus("Thumbnail set from preview.");
    } catch (e) {
      setStatus("Thumbnail capture failed: " + e.message);
    }
  });

  window.addEventListener("resize", () => {
    if (!document.getElementById("tileEditor").classList.contains("hidden"))
      markLivePreviewDirty();
  });

  // ---- 3D wall sliders ----
  setupSlider("fov",       "fovVal", "fovInput");
  setupSlider("camHeight", "camHeightVal", "camHeightInput");
  setupSlider("wallAngle", "wallAngleVal", "wallAngleInput");

  // ---- Initial canvas size calculation ----
  computeCanvasSize();

  // ---- Generate / 3D Wall buttons ----
  document.getElementById("btnGenerate").addEventListener("click", generate);
  document.getElementById("btn3DWall").addEventListener("click", async () => {
    try { await core.executeAsModal(apply3DWall, { commandName: "Apply 3D Wall" }); }
    catch (e) { setStatus("Modal error: " + e.message); }
  });

  // ---- Reference image (button disabled – future feature) ----
  document.getElementById("refCanvas").addEventListener("click",  handleRefCanvasClick);
  document.getElementById("btnCloseRef").addEventListener("click", () => {
    document.getElementById("refContainer").classList.add("hidden");
    appState.refImageData = null;
  });

  // ---- Global palette / color picker ----
  document.getElementById("btnOpenPicker").addEventListener("click",
    () => openPicker(null, hex => addColor(hex), true)
  );
  document.getElementById("pickerClose").addEventListener("click", closePicker);
  document.getElementById("pickerAdd").addEventListener("click",   pickerApplyColor);

  const sq = document.getElementById("pickerSquare");
  sq.addEventListener("mousedown", e => {
    setPickerDragging(true);
    handlePickerSquareInteraction(e);
  });
  sq.addEventListener("mousemove", e => {
    if (getPickerDragging()) handlePickerSquareInteraction(e);
  });
  document.addEventListener("mouseup", () => setPickerDragging(false));

  document.getElementById("honeycombCanvas").addEventListener("click", handleHoneycombClick);

  // ---- Palette swatches ----
  document.getElementById("btnClearColors").addEventListener("click", () => {
    palette.length = 0;
    renderSwatches();
    document.getElementById("refContainer").classList.add("hidden");
    appState.refImageData = null;
  });

  // ---- Tile editor ----
  document.getElementById("btnAddTile").addEventListener("click", () => openEditor(-1));
  renderTileList();
  initLivePreviewButton();

  document.getElementById("teType").addEventListener("change",
    () => showEditorSection(document.getElementById("teType").value)
  );

  document.getElementById("teBrowseIcon").addEventListener("click", async () => {
    try {
      const f = await storage.localFileSystem.getFileForOpening({
        types: ["png", "jpg", "jpeg", "gif", "bmp"],
      });
      if (f) {
        appState.iconFile = f;
        document.getElementById("teIconName").textContent = f.name;
        await cacheIconImage(f);
        markLivePreviewDirty();
      }
    } catch (e) { setStatus("File error: " + e.message); }
  });

  document.getElementById("teSave").addEventListener("click",   saveTileFromEditor);
  document.getElementById("teCancel").addEventListener("click", () => {
    document.getElementById("tileEditor").classList.add("hidden");
    appState.editingIdx = -1;
  });

  // ---- Tiles tab — library import/export ----
  document.getElementById("btnImportTile").addEventListener("click",    () => importTile());
  document.getElementById("btnImportAllTiles").addEventListener("click", () => importTilePack());
  document.getElementById("btnExportAllTiles").addEventListener("click", () => exportAllTiles());

  // ---- Tiles tab — editor spec import/export ----
  document.getElementById("btnImportSpec").addEventListener("click",  () => importSpec());
  document.getElementById("btnExportSpec").addEventListener("click",  () => exportEditorSpec(buildTileFromEditor));

  if (palette.length === 0) {
    DEFAULT_PALETTE_COLORS.forEach(addColor);
  } else {
    renderSwatches();
  }

  refreshAllColorFields();

  // ---- Trial + License UI (trial init must come before license UI refresh) ----
  initLicensing().then(state => applyLicenseStateToUI(state));

  // ---- License UI ----
  updateLicenseStatusUI().then(async () => {
    // Silent startup validate (non-blocking UI flow)
    const existing = await loadLicenseData();
    if (existing && existing.licenseKey) {
      const result = await validateLicense();
      if (result.ok) {
        await refreshLicenseUiAndState("Validation refreshed on startup.");
      } else {
        const state = await getLicenseState();
        if (state.mode === MODE.OFFLINE_GRACE) {
          await refreshLicenseUiAndState("Validation failed; offline grace is active.");
        } else {
          await refreshLicenseUiAndState("Validation failed; reconnect to refresh license status.");
        }
      }
    } else {
      applyLicenseStateToUI(await getLicenseState());
    }
  });

  document.getElementById("btnActivateLic").addEventListener("click", async () => {
    const key = document.getElementById("licKeyInput").value.trim();
    setLicenseStatusMsg("Activating…");
    const result = await activateLicense(key);
    if (result.ok) {
      document.getElementById("licKeyInput").value = "";
      await refreshLicenseUiAndState("Activation successful.");
    } else {
      setLicenseStatusMsg("Error: " + result.error);
    }
    applyLicenseStateToUI(await getLicenseState());
  });

  document.getElementById("btnValidateLic").addEventListener("click", async () => {
    setLicenseStatusMsg("Validating…");
    const result = await validateLicense();
    if (result.ok) {
      await refreshLicenseUiAndState("Validation successful.");
    } else {
      setLicenseStatusMsg("Error: " + result.error);
    }
    applyLicenseStateToUI(await getLicenseState());
  });

  document.getElementById("btnDeactivateLic").addEventListener("click", async () => {
    setLicenseStatusMsg("Deactivating…");
    const result = await deactivateLicense();
    if (result.ok) {
      await refreshLicenseUiAndState();
    } else {
      setLicenseStatusMsg("Error: " + result.error);
    }
    applyLicenseStateToUI(await getLicenseState());
  });
});
