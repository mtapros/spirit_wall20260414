import { action, app }   from "photoshop";
import { hexToRgb } from './color-utils.js';
import { fontMap }  from './state.js';
import {
  getActiveLayerBounds,
  moveLayerBy,
  rasterizeActiveLayer,
} from './ps-helpers.js';

function getPSFont(font) {
  const lower = font.trim().toLowerCase();
  if (fontMap[lower]) return fontMap[lower];
  if (lower === "arial black")                            return "Arial-Black";
  if (lower === "arial")                                  return "ArialMT";
  if (lower === "comic sans ms" || lower === "comic sans") return "ComicSansMS";
  if (lower === "times new roman")                        return "TimesNewRomanPSMT";
  if (lower === "courier new")                            return "CourierNewPSMT";
  if (lower === "impact")                                 return "Impact";
  return font.replace(/\s+/g, '');
}

function toPx(v) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if (typeof v._value === "number") return v._value;
    if (typeof v.value === "number") return v.value;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function getTextBoxOverflow(bx, by, bw, bh) {
  const doc = app.activeDocument;
  if (!doc) return { offX: false, offY: false };
  const docW = toPx(doc.width);
  const docH = toPx(doc.height);
  if (!Number.isFinite(docW) || !Number.isFinite(docH)) return { offX: false, offY: false };
  const eps = 0.01;
  return {
    offX: (bx < -eps) || ((bx + bw) > (docW + eps)),
    offY: (by < -eps) || ((by + bh) > (docH + eps)),
  };
}

export async function psCreateDoc(w, h, bgHex) {
  const c = hexToRgb(bgHex);
  await action.batchPlay([{
    _obj: "make",
    new: {
      _obj: "document", artboard: false, autoPromoteBackgroundLayer: false,
      width:      { _unit: "pixelsUnit",  _value: w },
      height:     { _unit: "pixelsUnit",  _value: h },
      resolution: { _unit: "densityUnit", _value: 72 },
      fill:       { _enum: "fill", _value: "color" },
      fillColor:  { _obj: "RGBColor", red: c.r, green: c.g, blue: c.b },
      mode:       { _class: "RGBColorMode" },
      depth: 8, profile: "sRGB IEC61966-2.1",
    },
    _isCommand: true,
  }], { synchronousExecution: false });
}

export async function psRect(x, y, w, h, hex) {
  const c = hexToRgb(hex);
  await action.batchPlay([{
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: {
      _obj: "contentLayer",
      type: { _obj: "solidColorLayer", color: { _obj: "RGBColor", red: c.r, green: c.g, blue: c.b } },
      shape: {
        _obj: "rectangle", unitValueQuadVersion: 1,
        top:    { _unit: "pixelsUnit", _value: y },
        left:   { _unit: "pixelsUnit", _value: x },
        bottom: { _unit: "pixelsUnit", _value: y + h },
        right:  { _unit: "pixelsUnit", _value: x + w },
      },
    },
    _isCommand: true,
  }], { synchronousExecution: true });
}

export async function psTextLine(bx, by, bw, bh, content, font, fontSize, textHex) {
  const c      = hexToRgb(textHex);
  const lh     = fontSize * 1.2;
  const top    = by + (bh - lh) / 2;
  const bot    = top + lh;
  const psFont = getPSFont(font);

  await action.batchPlay([{
    _obj: "make", _target: [{ _ref: "textLayer" }],
    using: {
      _obj: "textLayer", textKey: content,
      textShape: [{
        _obj: "textShape",
        bounds: {
          _obj: "rectangle",
          top:    { _unit: "pixelsUnit", _value: top },
          left:   { _unit: "pixelsUnit", _value: bx },
          bottom: { _unit: "pixelsUnit", _value: bot },
          right:  { _unit: "pixelsUnit", _value: bx + bw },
        },
        char: { _enum: "char", _value: "box" },
      }],
      textStyleRange: [{
        _obj: "textStyleRange", from: 0, to: content.length,
        textStyle: {
          _obj: "textStyle", fontName: psFont, fontPostScriptName: psFont,
          size:    { _unit: "pixelsUnit", _value: fontSize },
          color:   { _obj: "RGBColor", red: c.r, green: c.g, blue: c.b },
          leading: { _unit: "pixelsUnit", _value: lh },
        },
      }],
      paragraphStyleRange: [{
        _obj: "paragraphStyleRange", from: 0, to: content.length,
        paragraphStyle: { _obj: "paragraphStyle", align: { _enum: "alignmentType", _value: "center" } },
      }],
    },
    _isCommand: true,
  }], { synchronousExecution: true });

  await rasterizeActiveLayer();
  const overflow = getTextBoxOverflow(bx, by, bw, bh);
  const bounds  = await getActiveLayerBounds();
  const currCX  = (bounds.left + bounds.right)  / 2;
  const currCY  = (bounds.top  + bounds.bottom) / 2;
  const targetCX = bx + bw / 2;
  const targetCY = by + bh / 2;
  let dx = targetCX - currCX, dy = targetCY - currCY;
  if (overflow.offX) dx = 0;
  if (overflow.offY) dy = 0;
  if ((Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) && Number.isFinite(dx) && Number.isFinite(dy))
    await moveLayerBy(dx, dy);
}

export async function psTextBlock(bx, by, bw, bh, content, font, fontSize, textHex) {
  const c      = hexToRgb(textHex);
  const lh     = fontSize * 1.2;
  const psFont = getPSFont(font);

  await action.batchPlay([{
    _obj: "make", _target: [{ _ref: "textLayer" }],
    using: {
      _obj: "textLayer", textKey: content,
      textShape: [{
        _obj: "textShape",
        bounds: {
          _obj: "rectangle",
          top:    { _unit: "pixelsUnit", _value: by },
          left:   { _unit: "pixelsUnit", _value: bx },
          bottom: { _unit: "pixelsUnit", _value: by + bh },
          right:  { _unit: "pixelsUnit", _value: bx + bw },
        },
        char: { _enum: "char", _value: "box" },
      }],
      textStyleRange: [{
        _obj: "textStyleRange", from: 0, to: content.length,
        textStyle: {
          _obj: "textStyle", fontName: psFont, fontPostScriptName: psFont,
          size:    { _unit: "pixelsUnit", _value: fontSize },
          color:   { _obj: "RGBColor", red: c.r, green: c.g, blue: c.b },
          leading: { _unit: "pixelsUnit", _value: lh },
        },
      }],
      paragraphStyleRange: [{
        _obj: "paragraphStyleRange", from: 0, to: content.length,
        paragraphStyle: { _obj: "paragraphStyle", align: { _enum: "alignmentType", _value: "center" } },
      }],
    },
    _isCommand: true,
  }], { synchronousExecution: true });

  await rasterizeActiveLayer();
  const overflow = getTextBoxOverflow(bx, by, bw, bh);
  const bounds   = await getActiveLayerBounds();
  const currCX   = (bounds.left + bounds.right)  / 2;
  const currCY   = (bounds.top  + bounds.bottom) / 2;
  const targetCX = bx + bw / 2;
  const targetCY = by + bh / 2;
  let dx = targetCX - currCX, dy = targetCY - currCY;
  if (overflow.offX) dx = 0;
  if (overflow.offY) dy = 0;
  if ((Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) && Number.isFinite(dx) && Number.isFinite(dy))
    await moveLayerBy(dx, dy);
}
