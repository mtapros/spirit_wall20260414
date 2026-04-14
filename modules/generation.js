import { app, action, core } from "photoshop";
import { storage }            from "uxp";
import { setStatus, getVal }  from './dom-helpers.js';
import { getColorFieldValue } from './color-field.js';
import { getTileDims, computeCanvasSize } from './tile-dims.js';
import { psCreateDoc, psRect }  from './ps-draw.js';
import { renderTile }            from './ps-render.js';
import {
  getActiveLayerBounds,
  moveLayerBy,
  rasterizeActiveLayer,
} from './ps-helpers.js';
import { tiles } from './state.js';
import { isFeatureAllowed, getLicenseState, getAllowedTileTypes } from './licensing.js';
import { applyTrialWatermarkToActiveDocument } from './watermark.js';
import { OUTPUT_CAPS } from './constants.js';

const localFS = storage.localFileSystem;

// =========================================================
//  PAPER / TEXTURE
// =========================================================

export async function getPaperFiles() {
  try {
    const pluginFolder  = await localFS.getPluginFolder();
    const assetsFolder  = await pluginFolder.getEntry("assets");
    const entries       = await assetsFolder.getEntries();
    return entries.filter(e =>
      e.isFile &&
      e.name.toLowerCase().startsWith("paper") &&
      e.name.toLowerCase().endsWith(".png")
    );
  } catch (e) {
    return [];
  }
}

// =========================================================
//  GRADIENT MASK
// =========================================================

export async function applyGradientMask(sx, sy, ey) {
  await action.batchPlay([{
    _obj: "make",
    new: { _class: "channel" },
    at:  { _ref: "channel", _enum: "channel", _value: "mask" },
    using: { _enum: "userMaskEnabled", _value: "revealAll" },
  }], { synchronousExecution: true });

  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }],
  }], { synchronousExecution: true });

  await action.batchPlay([{
    _obj: "gradientClassEvent",
    type:   { _enum: "gradientType",  _value: "linear" },
    useMask: true, reverse: false,
    gradientsInterpolationMethod: { _enum: "gradientInterpolationMethodType", _value: "smooth" },
    gradient: {
      _obj: "gradientClassEvent", name: "Custom",
      gradientForm:           { _enum: "gradientForm", _value: "customStops" },
      interfaceIconFrameDimmed: 4096,
      colors: [
        { _obj: "colorStop", color: { _obj: "RGBColor", red: 255, green: 255, blue: 255 }, type: { _enum: "colorStopType", _value: "userStop" }, location: 0,    midpoint: 50 },
        { _obj: "colorStop", color: { _obj: "RGBColor", red: 0,   green: 0,   blue: 0   }, type: { _enum: "colorStopType", _value: "userStop" }, location: 4096, midpoint: 50 },
      ],
      transparency: [
        { _obj: "transferSpec", opacity: { _unit: "percentUnit", _value: 100 }, location: 0,    midpoint: 50 },
        { _obj: "transferSpec", opacity: { _unit: "percentUnit", _value: 100 }, location: 4096, midpoint: 50 },
      ],
    },
    from: { _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: sx }, vertical: { _unit: "pixelsUnit", _value: sy } },
    to:   { _obj: "paint", horizontal: { _unit: "pixelsUnit", _value: sx }, vertical: { _unit: "pixelsUnit", _value: ey } },
    _options: { dialogOptions: "dontDisplay" },
  }], { synchronousExecution: true });

  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
  }], { synchronousExecution: true });
}

async function resizeCanvasAnchored(widthPx, heightPx, hAnchor, vAnchor) {
  await action.batchPlay([{
    _obj: "canvasSize",
    width:      { _unit: "pixelsUnit", _value: widthPx },
    height:     { _unit: "pixelsUnit", _value: heightPx },
    horizontal: { _enum: "horizontalLocation", _value: hAnchor },
    vertical:   { _enum: "verticalLocation",   _value: vAnchor },
  }], { synchronousExecution: true });
}

async function expandCanvasForLayerBounds(layerBounds, origW, origH, extraPad = 0) {
  const padded = {
    left:   layerBounds.left   - extraPad,
    top:    layerBounds.top    - extraPad,
    right:  layerBounds.right  + extraPad,
    bottom: layerBounds.bottom + extraPad,
  };
  const addLeft   = Math.max(0, Math.ceil(-padded.left));
  const addTop    = Math.max(0, Math.ceil(-padded.top));
  const addRight  = Math.max(0, Math.ceil(padded.right  - origW));
  const addBottom = Math.max(0, Math.ceil(padded.bottom - origH));
  let currW = origW;
  let currH = origH;

  if (addLeft > 0) {
    currW += addLeft;
    await resizeCanvasAnchored(currW, currH, "right", "topLocation");
  }
  if (addRight > 0) {
    currW += addRight;
    await resizeCanvasAnchored(currW, currH, "left", "topLocation");
  }
  if (addTop > 0) {
    currH += addTop;
    await resizeCanvasAnchored(currW, currH, "left", "bottomLocation");
  }
  if (addBottom > 0) {
    currH += addBottom;
    await resizeCanvasAnchored(currW, currH, "left", "topLocation");
  }

  return { addLeft, addTop, addRight, addBottom };
}

async function restoreCanvasAfterExpansion(origW, origH, expansion) {
  const { addLeft, addTop, addRight, addBottom } = expansion;
  if (addLeft === 0 && addTop === 0 && addRight === 0 && addBottom === 0) return;

  let currW = origW + addLeft + addRight;
  let currH = origH + addTop + addBottom;

  if (addRight > 0) {
    currW -= addRight;
    await resizeCanvasAnchored(currW, currH, "left", "topLocation");
  }
  if (addLeft > 0) {
    currW -= addLeft;
    await resizeCanvasAnchored(currW, currH, "right", "topLocation");
  }
  if (addBottom > 0) {
    currH -= addBottom;
    await resizeCanvasAnchored(currW, currH, "left", "topLocation");
  }
  if (addTop > 0) {
    currH -= addTop;
    await resizeCanvasAnchored(currW, currH, "left", "bottomLocation");
  }
}

// =========================================================
//  VIRTUAL BACKDROP GENERATION
// =========================================================

export async function generateVirtual() {
  const cols      = getVal("cols");
  const rows      = getVal("rows");
  const gX        = getVal("gapX");
  const gY        = getVal("gapY");
  const { tileW, tileH } = getTileDims();
  const stagger   = document.getElementById("stagger").checked;
  const sPct      = getVal("staggerOffset") / 100;
  const genRefl   = document.getElementById("genReflGrid") &&
                    document.getElementById("genReflGrid").checked;
  const { bW, bH } = computeCanvasSize();
  const canvasBgHex = getColorFieldValue("canvasBgColor");
  const applyPaper  = document.getElementById("applyPaper").checked;
  const paperOp     = getVal("paperOpacity");
  let paperFiles    = [];

  if (applyPaper) {
    paperFiles = await getPaperFiles();
    if (paperFiles.length === 0) { setStatus("No paper*.png files found in assets/ folder."); return; }
  }

  setStatus("Creating virtual backdrop...");
  await core.executeAsModal(async () => {
    const effectiveBgHex = genRefl ? "#ffffff" : canvasBgHex;
    await psCreateDoc(bW, bH, effectiveBgHex);
    const baseDoc     = app.activeDocument;
    const targetDocId = baseDoc.id;
    let bgLayerId     = null;
    if (baseDoc.layers.length > 0) bgLayerId = baseDoc.layers[baseDoc.layers.length - 1].id;

    // Load master paper layers (hidden)
    if (applyPaper) {
      for (let pi = 0; pi < paperFiles.length; pi++) {
        let pFile = paperFiles[pi];
        let pDoc  = await app.open(pFile);
        if (pDoc.layers.length > 1)
          await action.batchPlay([{ _obj: "flattenImage" }], { synchronousExecution: true });
        let srcLayerId = pDoc.activeLayers[0].id;
        await action.batchPlay([{
          _obj: "duplicate",
          _target: [{ _ref: "layer", _id: srcLayerId }],
          to: { _ref: "document", _id: targetDocId },
          _options: { dialogOptions: "dontDisplay" },
        }], { synchronousExecution: true });
        await pDoc.closeWithoutSaving();
        await action.batchPlay([{ _obj: "select", _target: [{ _ref: "document", _id: targetDocId }] }], { synchronousExecution: true });
        let b = await getActiveLayerBounds();
        let pw = b.right - b.left, ph = b.bottom - b.top;
        if (pw > 0 && ph > 0) {
          await action.batchPlay([{
            _obj: "transform",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
            width:  { _unit: "percentUnit", _value: (tileW / pw) * 100 },
            height: { _unit: "percentUnit", _value: (tileH / ph) * 100 },
          }], { synchronousExecution: true });
        }
        let b2 = await getActiveLayerBounds();
        let pcx = (b2.left + b2.right) / 2, pcy = (b2.top + b2.bottom) / 2;
        await moveLayerBy((tileW / 2) - pcx, (tileH / 2) - pcy);
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "layer", name: "MasterPaper_" + pFile.name, visible: false },
        }], { synchronousExecution: true });
      }
    }

    async function applyPaperAtPosition(pickedPaper, x, y) {
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _name: "MasterPaper_" + pickedPaper.name }],
        name: "AppliedPaper",
      }], { synchronousExecution: true });
      await action.batchPlay([{
        _obj: "show", null: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      }], { synchronousExecution: true });
      await moveLayerBy(x, y);
      await action.batchPlay([
        { _obj: "move",  _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _ref: "layer", _enum: "ordinal", _value: "front" } },
        { _obj: "set",   _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: paperOp } } },
      ], { synchronousExecution: true });
    }

    function getTopLevelLayerIds(doc) {
      const ids = new Set();
      for (let i = 0; i < doc.layers.length; i++) ids.add(doc.layers[i].id);
      return ids;
    }

    async function clipTopLevelLayersToRect(layerIds, left, top, right, bottom) {
      if (!layerIds || layerIds.length === 0) return;
      if (!(right > left && bottom > top)) return;

      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: {
            _obj: "rectangle",
            top:    { _unit: "pixelsUnit", _value: top },
            left:   { _unit: "pixelsUnit", _value: left },
            bottom: { _unit: "pixelsUnit", _value: bottom },
            right:  { _unit: "pixelsUnit", _value: right },
          },
        }], { synchronousExecution: true });
      } catch (e) {
        return;
      }

      for (let i = 0; i < layerIds.length; i++) {
        try {
          await action.batchPlay([{
            _obj: "select",
            _target: [{ _ref: "layer", _id: layerIds[i] }],
            makeVisible: false,
          }], { synchronousExecution: true });
          await action.batchPlay([{
            _obj: "make",
            new: { _class: "channel" },
            at:  { _ref: "channel", _enum: "channel", _value: "mask" },
            using: { _enum: "userMaskEnabled", _value: "revealSelection" },
          }], { synchronousExecution: true });
        } catch (e) {}
      }

      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _enum: "ordinal", _value: "none" },
        }], { synchronousExecution: true });
      } catch (e) {}
    }

    // Render tile grid
    const TILE_WIDTH_EPSILON = 0.01;
    const stepX = tileW + gX;
    let ti = 0, prevRowPapers = [];
    for (let r = 0; r < rows; r++) {
      let isOffsetRow = stagger && r % 2 !== 0;
      let rawOffset   = isOffsetRow ? stepX * sPct : 0;
      let rowOffset   = ((rawOffset % stepX) + stepX) % stepX;
      let xPos        = (isOffsetRow && rowOffset !== 0) ? (rowOffset - stepX) : rowOffset;
      let currentRowPapers = [], cIndex = 0;

      while (xPos < bW) {
        let yPos = r * (tileH + gY);
        let drawLeft  = Math.max(0, xPos);
        let drawRight = Math.min(bW, xPos + tileW);
        let drawW     = Math.max(0, drawRight - drawLeft);
        if (drawW > 0) {
          const shouldTrimOffsetEdgeTile = isOffsetRow && Math.abs(drawW - tileW) > TILE_WIDTH_EPSILON;
          const layerIdsBefore = shouldTrimOffsetEdgeTile ? getTopLevelLayerIds(baseDoc) : null;
          await renderTile(ti, xPos, yPos, tileW, tileH, targetDocId);
          if (shouldTrimOffsetEdgeTile && layerIdsBefore) {
            const newLayerIds = [];
            for (let li = 0; li < baseDoc.layers.length; li++) {
              const lid = baseDoc.layers[li].id;
              if (!layerIdsBefore.has(lid)) newLayerIds.push(lid);
            }
            const drawTop = Math.max(0, yPos);
            const drawBottom = Math.min(bH, yPos + tileH);
            await clipTopLevelLayersToRect(newLayerIds, drawLeft, drawTop, drawRight, drawBottom);
          }
        }

        let picked = null;
        if (applyPaper) {
          if (Math.abs(drawW - tileW) < TILE_WIDTH_EPSILON) {
            let exclude = [];
            if (cIndex > 0 && currentRowPapers[cIndex - 1]) exclude.push(currentRowPapers[cIndex - 1]);
            if (r > 0 && prevRowPapers[cIndex]) exclude.push(prevRowPapers[cIndex]);
            let avail = paperFiles.filter(pf => !exclude.includes(pf));
            if (avail.length === 0) avail = paperFiles;
            picked = avail[Math.floor(Math.random() * avail.length)];
            currentRowPapers.push(picked);
            await applyPaperAtPosition(picked, drawLeft, yPos);
          } else {
            currentRowPapers.push(null);
          }
        }

        ti++; cIndex++;
        xPos += stepX;
      }
      prevRowPapers = currentRowPapers;
    }

    // Remove hidden master paper layers
    if (applyPaper) {
      for (let pi2 = 0; pi2 < paperFiles.length; pi2++) {
        try {
          await action.batchPlay([{
            _obj: "delete", _target: [{ _ref: "layer", _name: "MasterPaper_" + paperFiles[pi2].name }],
          }], { synchronousExecution: true });
        } catch (e) {}
      }
    }

    // Group all tile layers
    let layersToGroup = [];
    for (let i = 0; i < baseDoc.layers.length; i++) {
      let l = baseDoc.layers[i];
      if (l.id !== bgLayerId && !l.name.startsWith("MasterPaper_")) layersToGroup.push(l);
    }

    if (layersToGroup.length > 0) {
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: layersToGroup[0].id }],
        makeVisible: false,
      }], { synchronousExecution: true });
      for (let i2 = 1; i2 < layersToGroup.length; i2++) {
        await action.batchPlay([{
          _obj: "select",
          _target: [{ _ref: "layer", _id: layersToGroup[i2].id }],
          selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
          makeVisible: false,
        }], { synchronousExecution: true });
      }
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "layerSection" }],
        from:  { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
        using: { _obj: "layerSection", name: "Wall Grid" },
      }], { synchronousExecution: true });

      if (genRefl) {
        setStatus("Generating Mirrored Floor Rows...");
        await action.batchPlay([{
          _obj: "duplicate",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          name: "Floor Reflection Grid",
        }], { synchronousExecution: true });
        await action.batchPlay([{
          _obj: "flip",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          axis: { _enum: "orientation", _value: "vertical" },
        }], { synchronousExecution: true });
        let topH = rows * tileH + gY * (rows - 1);
        await moveLayerBy(0, topH + gY);

        try { await action.batchPlay([{ _obj: "newPlacedLayer" }], { synchronousExecution: true }); } catch (e) {}
        try { await rasterizeActiveLayer(); } catch (e) {}

        let reflWobble = getVal("reflWobble") || 0;
        let reflBlur   = getVal("reflBlur")   || 0;
        let reflFade   = getVal("reflFade")   || 0;
        let expansion = { addLeft: 0, addTop: 0, addRight: 0, addBottom: 0 };
        let gsx = Math.round(bW / 2), gsy = 0, gey = 0;

        try {
          if (reflWobble > 0) {
            try {
              await action.batchPlay([{
                _obj: "ripple",
                amount: { _value: reflWobble * 10 },
                size:   { _enum: "rippleSize", _value: "medium" },
              }], { synchronousExecution: true });
            } catch (e) {}
          }

          let reflectionBounds = await getActiveLayerBounds();
          let blurPad          = reflBlur > 0 ? Math.ceil(reflBlur) + 2 : 0;
          expansion            = await expandCanvasForLayerBounds(reflectionBounds, bW, bH, blurPad);
          let cropOffsetX      = expansion.addLeft;
          let cropOffsetY      = expansion.addTop;
          let fadeDistPct      = reflFade > 0 ? reflFade : 100;
          let reflectionTop    = topH + gY;
          let fadeDist         = topH * (fadeDistPct / 100);
          gsx = Math.round((bW / 2) + cropOffsetX);
          gsy = Math.round(reflectionTop + cropOffsetY);
          gey = Math.round(reflectionTop + fadeDist + cropOffsetY);
          if (gey <= gsy) gey = gsy + 1;

          if (reflBlur > 0) {
            try {
              await action.batchPlay([{
                _obj: "set",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                to: { _obj: "layer", name: "Refl_Blurry" },
              }], { synchronousExecution: true });
              await action.batchPlay([{
                _obj: "duplicate",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
              }], { synchronousExecution: true });
              await action.batchPlay([{
                _obj: "set",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                to: { _obj: "layer", name: "Refl_Sharp" },
              }], { synchronousExecution: true });
              await applyGradientMask(gsx, gsy, gey);
              await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _name: "Refl_Blurry" }] }], { synchronousExecution: true });
              await action.batchPlay([{ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }] }], { synchronousExecution: true });
              await action.batchPlay([{ _obj: "gaussianBlur", radius: { _unit: "pixelsUnit", _value: reflBlur } }], { synchronousExecution: true });
              await action.batchPlay([
                { _obj: "select", _target: [{ _ref: "layer", _name: "Refl_Blurry" }], makeVisible: false },
                { _obj: "select", _target: [{ _ref: "layer", _name: "Refl_Sharp"  }], selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" }, makeVisible: false },
              ], { synchronousExecution: true });
              await action.batchPlay([{
                _obj: "make",
                _target: [{ _ref: "layerSection" }],
                from:  { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
                using: { _obj: "layerSection", name: "Floor Reflection" },
              }], { synchronousExecution: true });
            } catch (e) { await app.showAlert("Progressive Blur blocked: " + e.message); }
          }

          if (reflFade > 0) {
            try { await applyGradientMask(gsx, gsy, gey); } catch (e) {}
          }

          let reflOp = getVal("reflOpacity") || 50;
          await action.batchPlay([{
            _obj: "set",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: reflOp } },
          }], { synchronousExecution: true });
        } finally {
          await restoreCanvasAfterExpansion(bW, bH, expansion);
        }
      }
    }

    const licenseState = await getLicenseState();
    await applyTrialWatermarkToActiveDocument(licenseState);
    setStatus("Done - Grid generated successfully.");
  }, { commandName: "Generate Virtual Backdrop" });
}

// =========================================================
//  PRINT TILES GENERATION
// =========================================================

export async function generatePrint() {
  setStatus("Print mode is deprecated. Please use the Export tab for high-resolution tile output.");
  return;
}

// =========================================================
//  ENTRY POINT
// =========================================================

export async function generate() {
  if (tiles.length === 0) { setStatus("Add at least one tile type first."); return; }
  if (!(await isFeatureAllowed("Generate Graphics", undefined, "basic"))) return;
  const licenseState = await getLicenseState();
  const allowedTypes = new Set(getAllowedTileTypes(licenseState));
  const firstBlocked = tiles.find(t => !allowedTypes.has(t.type));
  if (firstBlocked) {
    setStatus("Blocked: tile type '" + firstBlocked.type + "' is not available in your current tier.");
    return;
  }

  const longSide = getVal("tileLongSide") || 500;
  if (longSide > OUTPUT_CAPS.maxTileLongSidePx) {
    setStatus("Blocked: Long Side exceeds cap (" + OUTPUT_CAPS.maxTileLongSidePx + " px).");
    return;
  }
  const { bW, bH } = computeCanvasSize();
  if (bW * bH > OUTPUT_CAPS.maxCanvasPixels) {
    setStatus("Blocked: Canvas exceeds cap (" + OUTPUT_CAPS.maxCanvasPixels + " px²).");
    return;
  }

  try {
    await generateVirtual();
  } catch (e) {
    setStatus("Error: " + (e.message || e));
  }
}
