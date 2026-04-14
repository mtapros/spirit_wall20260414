import { app, action, core } from "photoshop";
import { storage }            from "uxp";
import { tiles }              from './state.js';
import { setStatus, getStr }  from './dom-helpers.js';
import { getColorFieldValue } from './color-field.js';
import { getTileDims }        from './tile-dims.js';
import { psCreateDoc }        from './ps-draw.js';
import { renderTile }         from './ps-render.js';
import { isFeatureAllowed, getLicenseState, getAllowedTileTypes } from './licensing.js';
import { applyTrialWatermarkToActiveDocument } from './watermark.js';
import { OUTPUT_CAPS } from './constants.js';

const localFS = storage.localFileSystem;

let exportFolder = null;

// =========================================================
//  TAB SWITCHING
// =========================================================

export function switchTab(tabName) {
  const btnB  = document.getElementById("tabBtnBuilder");
  const btnE  = document.getElementById("tabBtnExport");
  const btnL  = document.getElementById("tabBtnLicense");
  const viewB = document.getElementById("viewBuilder");
  const viewE = document.getElementById("viewExport");
  const viewL = document.getElementById("viewLicense");

  // Reset all
  [btnB, btnE, btnL].forEach(b => { if (b) { b.style.background = "transparent"; b.style.color = "#aaa"; } });
  [viewB, viewE, viewL].forEach(v => { if (v) v.style.display = "none"; });

  if (tabName === "Builder") {
    btnB.style.background = "#2680eb"; btnB.style.color = "#fff";
    viewB.style.display = "block";
  } else if (tabName === "Export") {
    btnE.style.background = "#2680eb"; btnE.style.color = "#fff";
    viewE.style.display = "block";
  } else if (tabName === "License") {
    if (btnL) { btnL.style.background = "#2680eb"; btnL.style.color = "#fff"; }
    if (viewL) viewL.style.display = "block";
  }
}

// =========================================================
//  FOLDER SELECTION
// =========================================================

export async function selectExportFolder() {
  if (!(await isFeatureAllowed("Export Folder Selection", undefined, "advanced"))) return;
  try {
    const folder = await localFS.getFolder();
    if (folder) {
      exportFolder = folder;
      document.getElementById("expFolderLabel").textContent = "Selected: " + folder.nativePath;
      document.getElementById("btnExportTiles").disabled = false;
    }
  } catch (err) {
    console.log("Folder selection cancelled", err);
  }
}

// =========================================================
//  HI-RES TILE EXPORT
// =========================================================

export async function exportHiResTiles() {
  if (!(await isFeatureAllowed("Export Tiles", undefined, "advanced"))) return;
  if (!exportFolder || tiles.length === 0) {
    app.showAlert("Please add tiles and select an output folder.");
    return;
  }
  const licenseState = await getLicenseState();
  const allowedTypes = new Set(getAllowedTileTypes(licenseState));
  const firstBlocked = tiles.find(t => !allowedTypes.has(t.type));
  if (firstBlocked) {
    app.showAlert("Blocked: tile type '" + firstBlocked.type + "' is not available in your current tier.");
    return;
  }

  const longEdge = parseInt(document.getElementById("expLongEdge").value, 10) || 3000;
  const dpi      = parseInt(document.getElementById("expDpi").value,      10) || 300;
  if (longEdge > OUTPUT_CAPS.maxExportLongEdgePx) {
    app.showAlert("Blocked: export long edge exceeds cap (" + OUTPUT_CAPS.maxExportLongEdgePx + " px).");
    return;
  }
  if (dpi > OUTPUT_CAPS.maxExportDpi) {
    app.showAlert("Blocked: export DPI exceeds cap (" + OUTPUT_CAPS.maxExportDpi + ").");
    return;
  }

  const ratioStr    = getStr("tileRatio");
  const orientation = getStr("tileOrientation");
  const parts       = ratioStr.split(":");
  const rA          = parseFloat(parts[0]);
  const rB          = parseFloat(parts[1]);
  const ratioMax    = Math.max(rA, rB);
  const ratioMin    = Math.min(rA, rB);
  const shortEdge   = Math.round(longEdge * (ratioMin / ratioMax));
  let expW, expH;
  if (orientation === "landscape") { expW = longEdge; expH = shortEdge; }
  else                             { expW = shortEdge; expH = longEdge; }

  setStatus("Exporting Hi-Res Tiles...");
  try {
    await core.executeAsModal(async () => {
      for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        await psCreateDoc(expW, expH, "#ffffff");
        let doc = app.activeDocument;
        await renderTile(i, 0, 0, expW, expH, doc.id);
        let preFlattenOk = true;
        try { await doc.flatten(); } catch (err) {
          preFlattenOk = false;
          console.warn("Flatten failed before watermark; applying watermark to current top-level output:", err);
        }
        await applyTrialWatermarkToActiveDocument(licenseState);
        try { await doc.flatten(); } catch (err) {
          throw new Error("Final flatten failed after watermark (preFlattenOk=" + preFlattenOk + "): " + err.message);
        }
        await action.batchPlay([{
          _obj: "imageSize",
          resolution: { _unit: "densityUnit", _value: dpi },
        }], { synchronousExecution: true });
        let cleanType = t.type.replace(/[^a-zA-Z0-9_-]/g, "");
        let fileName  = "Tile_" + (i + 1) + "_" + cleanType + ".png";
        let fileEntry = await exportFolder.createFile(fileName, { overwrite: true });
        await doc.saveAs.png(fileEntry, { compression: 6 }, true);
        await doc.closeWithoutSaving();
      }
    }, { commandName: "Export Hi-Res Tiles" });

    setStatus("Ready.");
    app.showAlert("Successfully exported " + tiles.length + " tiles!");
  } catch (e) {
    console.error(e);
    setStatus("Export failed.");
    app.showAlert("Export failed: " + e.message);
  }
}
