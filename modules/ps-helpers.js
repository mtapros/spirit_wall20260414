import { action } from "photoshop";

export function unitToPx(v) {
  if (v == null) return 0;
  if (typeof v.as === "function") return v.as("px");
  if (typeof v.value  === "number") return v.value;
  if (typeof v._value === "number") return v._value;
  return Number(v) || 0;
}

export function boundsToRectPx(b) {
  return {
    left:   unitToPx(b.left),
    top:    unitToPx(b.top),
    right:  unitToPx(b.right),
    bottom: unitToPx(b.bottom),
  };
}

export async function getActiveLayerBounds() {
  const r = await action.batchPlay([{
    _obj: "get",
    _target: [
      { _property: "bounds" },
      { _ref: "layer", _enum: "ordinal", _value: "targetEnum" },
    ],
    _options: { dialogOptions: "dontDisplay" },
  }], { synchronousExecution: true });
  return boundsToRectPx(r[0].bounds);
}

export async function selectLayerById(layerId) {
  await action.batchPlay([{
    _obj: "select",
    _target: [{ _ref: "layer", _id: layerId }],
  }], { synchronousExecution: true });
}

export async function moveLayerBy(ox, oy) {
  await action.batchPlay([{
    _obj: "move",
    _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    to: {
      _obj: "offset",
      horizontal: { _unit: "pixelsUnit", _value: ox },
      vertical:   { _unit: "pixelsUnit", _value: oy },
    },
  }], { synchronousExecution: true });
}

export async function rasterizeActiveLayer() {
  try {
    await action.batchPlay([{
      _obj: "rasterizeLayer",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
    }], { synchronousExecution: true });
  } catch (e) {
    console.error("Rasterize failed:", e);
  }
}
