import { app, action } from "photoshop";
import { psTextLine } from "./ps-draw.js";

const WATERMARK_TEXT = "VTK";
const WATERMARK_OPACITY = 75;
const WATERMARK_ROTATION_DEG = -30;

async function setActiveLayerOpacity(opacityPct) {
  await action.batchPlay([{
    _obj: "set",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: opacityPct } },
  }], { synchronousExecution: true });
}

async function rotateActiveLayer(deg) {
  await action.batchPlay([{
    _obj: "transform",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
    angle: { _unit: "angleUnit", _value: deg },
  }], { synchronousExecution: true });
}

function shouldApplyWatermark(_state) {
  // Watermarking is disabled — full functionality is available during trial.
  return false;
}

export async function applyTrialWatermarkToActiveDocument(state) {
  if (!shouldApplyWatermark(state)) return false;
  const doc = app.activeDocument;
  if (!doc) return false;

  const docW = Number(doc.width);
  const docH = Number(doc.height);
  if (!docW || !docH) return false;

  const targetTextWidth = Math.max(120, Math.round(docW * 0.6));
  const baseFontSize = Math.max(24, Math.floor(targetTextWidth / (WATERMARK_TEXT.length * 0.6)));
  const textBoxW = Math.max(targetTextWidth + Math.round(baseFontSize * 0.5), Math.round(docW * 0.8));
  const textBoxH = Math.max(Math.round(baseFontSize * 2), Math.round(docH * 0.22));
  const bx = Math.round((docW - textBoxW) / 2);
  const by = Math.round((docH - textBoxH) / 2);

  // Faux stroke: larger white text underlay + smaller gray text overlay.
  await psTextLine(bx, by, textBoxW, textBoxH, WATERMARK_TEXT, "Arial Black", Math.round(baseFontSize * 1.12), "#ffffff");
  await setActiveLayerOpacity(WATERMARK_OPACITY);
  await rotateActiveLayer(WATERMARK_ROTATION_DEG);

  await psTextLine(bx, by, textBoxW, textBoxH, WATERMARK_TEXT, "Arial Black", baseFontSize, "#808080");
  await setActiveLayerOpacity(WATERMARK_OPACITY);
  await rotateActiveLayer(WATERMARK_ROTATION_DEG);

  return true;
}
