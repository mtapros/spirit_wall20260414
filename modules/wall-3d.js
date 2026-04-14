import { app, action } from "photoshop";
import { getVal }        from './dom-helpers.js';
import { setStatus }     from './dom-helpers.js';
import { getActiveLayerBounds, moveLayerBy, selectLayerById } from './ps-helpers.js';
import { isFeatureAllowed } from './licensing.js';

// =========================================================
//  TRUE PERSPECTIVE TRANSFORM
// =========================================================

export async function transformTruePerspective(layerId, side, fov, wallAngle) {
  const pBase = fov * 0.003;
  const perspectiveValue = side === "left" ? pBase : -pBase;

  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _id: layerId }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    width: { _unit: "percentUnit", _value: wallAngle },
    using: {
      _obj: "paint",
      horizontal: { _unit: "percentUnit", _value: perspectiveValue },
      vertical:   { _unit: "pixelsUnit",  _value: 0 },
    },
    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" },
  }], { synchronousExecution: true });
}

// =========================================================
//  3D WALL BUILDER
// =========================================================

export async function apply3DWall() {
  if (!(await isFeatureAllowed("Apply 3D Perspective"))) return;
  const doc = app.activeDocument;
  if (!doc) return;

  const rawCamHeight = getVal("camHeight") || 50;
  const fov          = getVal("fov")       || 5;
  const wallAngle    = getVal("wallAngle") || 70;
  const wallType     = document.querySelector('input[name="wallType"]:checked').value;
  const camAdjRefl   = document.getElementById("camAdjRefl") &&
                       document.getElementById("camAdjRefl").checked;

  setStatus("Applying 3D Perspective...");
  const origDocH = doc.height;
  const origDocW = doc.width;

  try {
    // 1. Merge visible wall layers to a canvas-clipped raster, then Smart Object it
    await action.batchPlay([{
      _obj: "selectAllLayers",
      _target: [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }],
    }], { synchronousExecution: true });

    const bgLayer = doc.layers.find(l => l.isBackgroundLayer || (l.name === "Background" && l.locked));
    if (bgLayer) {
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: bgLayer.id }],
        selectionModifier: { _enum: "selectionModifierType", _value: "removeFromSelection" },
      }], { synchronousExecution: true });
    }
    try {
      await action.batchPlay([{ _obj: "mergeLayers" }], { synchronousExecution: true });
    } catch (e) {
      // Merge can fail when only one non-background layer is selected; continue.
    }
    await action.batchPlay([{ _obj: "newPlacedLayer" }], { synchronousExecution: true });

    // 2. Padding Logic to Center Horizon
    const horizonOffset = camAdjRefl ? (rawCamHeight / 200) : (rawCamHeight / 100);
    const padNeeded     = Math.round(origDocH * horizonOffset * 2);
    const totalH        = origDocH + padNeeded;

    if (padNeeded > 0) {
      await action.batchPlay([{
        _obj: "canvasSize",
        height:   { _unit: "pixelsUnit", _value: totalH },
        vertical: { _enum: "verticalLocation", _value: "bottomLocation" },
      }], { synchronousExecution: true });
    }

    // 3. Anchor Pixels to force transform center
    // Blend mode "difference" means the white pixel inverts whatever is below it rather than
    // compositing as a solid white stripe at the compressed edge of the perspective transform.
    const drawAnchor = async (y) => {
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "contentLayer" }],
        using: {
          _obj: "contentLayer",
          type: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: 255, green: 255, blue: 255 } },
          shape: { _obj: "rectangle", top: y, left: 0, bottom: y + 1, right: 1 },
        },
      }], { synchronousExecution: true });
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", mode: { _enum: "blendMode", _value: "difference" } },
      }], { synchronousExecution: true });
    };
    await drawAnchor(0);
    await drawAnchor(totalH - 1);

    // 4. Final Smart Object Wrap of Wall + Anchors (exclude background again)
    await action.batchPlay([{
      _obj: "selectAllLayers",
      _target: [{ _enum: "ordinal", _ref: "layer", _value: "targetEnum" }],
    }], { synchronousExecution: true });
    if (bgLayer) {
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _id: bgLayer.id }],
        selectionModifier: { _enum: "selectionModifierType", _value: "removeFromSelection" },
      }], { synchronousExecution: true });
    }
    await action.batchPlay([{ _obj: "newPlacedLayer" }], { synchronousExecution: true });
    const activeSO = doc.activeLayers[0];

    // 5. Apply Transforms
    if (wallType === "single-left" || wallType === "single-right") {
      const side = wallType === "single-left" ? "left" : "right";
      await selectLayerById(activeSO.id);
      const preBounds = await getActiveLayerBounds();
      await transformTruePerspective(activeSO.id, side, fov, wallAngle);
      await selectLayerById(activeSO.id);
      const postBounds = await getActiveLayerBounds();
      const shiftX = side === "left"
        ? (preBounds.left - postBounds.left)
        : (preBounds.right - postBounds.right);
      if (Math.abs(shiftX) > 0.01) await moveLayerBy(shiftX, 0);
    } else if (wallType === "corner") {
      const leftLayerId = activeSO.id;
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _id: leftLayerId }],
      }], { synchronousExecution: true });
      const rightLayerId = doc.activeLayers[0].id;

      await transformTruePerspective(rightLayerId, "right", fov, wallAngle);
      await selectLayerById(leftLayerId);
      await transformTruePerspective(leftLayerId, "left", fov, wallAngle);

      // Center seam alignment
      const centerX = doc.width / 2;
      const bLeft   = await getActiveLayerBounds();
      await moveLayerBy(centerX - bLeft.right, 0);
      await selectLayerById(rightLayerId);
      const bRight  = await getActiveLayerBounds();
      await moveLayerBy(centerX - bRight.left, 0);
    }

    // 6. Final Cleanup — resize canvas back to the original dimensions using canvasSize.
    // Step 2's "bottomLocation" anchors the existing content at the bottom and adds new
    // space at the top, so padding sits above the content.  To remove that top padding we
    // must anchor at the top (topLocation), which removes rows from the top of the canvas
    // and keeps the bottom origDocH rows where the content lives.
    await action.batchPlay([{
      _obj: "canvasSize",
      width:      { _unit: "pixelsUnit", _value: origDocW },
      height:     { _unit: "pixelsUnit", _value: origDocH },
      horizontal: { _enum: "horizontalLocation", _value: "left" },
      vertical:   { _enum: "verticalLocation",   _value: "topLocation" },
    }], { synchronousExecution: true });

    setStatus("Done!");
  } catch (err) {
    setStatus("Transform failed: " + err);
    console.error("Transform error:", err);
  }
}
