import { app, action }  from "photoshop";
import { tiles }         from './state.js';
import { psRect, psTextLine, psTextBlock } from './ps-draw.js';
import { getActiveLayerBounds, moveLayerBy } from './ps-helpers.js';

// =========================================================
//  PHRASE TILES
// =========================================================

export async function renderPhraseSingle(x, y, w, h, tile) {
  const content  = tile.text.toUpperCase();
  const scale    = (tile.textScale || 80) / 100;
  const fontSize = Math.floor(Math.min((w * scale) / ((content.length || 1) * 0.6), h * scale));
  await psRect(x, y, w, h, tile.bgColor);
  await psTextLine(x, y, w, h, content, tile.font, fontSize, tile.textColor);
}

export async function renderPhraseFill(x, y, w, h, tile) {
  const content1    = tile.text.toUpperCase();
  const content2    = (tile.text2 || "TEXT 2").toUpperCase();
  const isAltWords  = tile.type === "phrase-altwords";
  const longestStr  = (isAltWords && content2.length > content1.length) ? content2 : content1;
  const scale       = (tile.textScale || 80) / 100;
  const fontSize    = Math.floor((w * scale) / ((longestStr.length || 1) * 0.6));
  const numLines    = Math.max(1, Math.floor(h / (fontSize * 1.25)));
  const evenH       = h / numLines;

  await psRect(x, y, w, h, tile.bgColor);

  for (let i = 0; i < numLines; i++) {
    const rowY      = y + i * evenH;
    const isAltRow  = (i % 2 === 1);
    if (isAltRow && tile.altBgColor) await psRect(x, rowY, w, evenH, tile.altBgColor);
    const textHex   = (isAltRow && tile.altTextColor) ? tile.altTextColor : tile.textColor;
    const lineText  = (isAltWords && isAltRow) ? content2 : content1;
    await psTextLine(x, rowY, w, evenH, lineText, tile.font, fontSize, textHex);
  }
}

export async function renderPhraseMultiline(x, y, w, h, tile) {
  await psRect(x, y, w, h, tile.bgColor);
  const content  = tile.text.toUpperCase();
  const scale    = (tile.textScale || 80) / 100;

  const words       = content.split(/\s+/);
  const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, "");
  const maxCharW    = w * scale, maxH = h * scale;
  const maxFsWord   = Math.floor(maxCharW / ((longestWord.length || 1) * 0.6));
  const fsArea      = Math.floor(Math.sqrt((maxCharW * maxH) / ((content.length || 1) * 0.72)));
  let fontSize      = Math.min(maxFsWord, fsArea, Math.floor(maxH));

  let lh, blockH;
  while (fontSize > 4) {
    lh = fontSize * 1.2;
    let charsPerLine = Math.floor(maxCharW / (fontSize * 0.6));
    if (charsPerLine < 1) charsPerLine = 1;
    let lines = 1, currLen = 0;
    for (let wi = 0; wi < words.length; wi++) {
      let wd = words[wi];
      if (currLen === 0) { currLen = wd.length; }
      else if (currLen + 1 + wd.length > charsPerLine) { lines++; currLen = wd.length; }
      else { currLen += 1 + wd.length; }
    }
    blockH = lines * lh;
    if (blockH <= maxH) break;
    fontSize--;
  }

  const top = y + (h - blockH) / 2;
  const pad = (w - maxCharW) / 2;
  await psTextBlock(x + pad, top, maxCharW, blockH + lh, content, tile.font, fontSize, tile.textColor);
}

// =========================================================
//  SHAPE / COLOR TILES
// =========================================================

export async function renderFramedTile(x, y, w, h, tile) {
  await psRect(x, y, w, h, tile.frameColor);
  const thickPct = (tile.frameThickness || 10) / 100;
  const thickX   = Math.round(w * thickPct);
  const thickY   = Math.round(h * thickPct);
  await psRect(x + thickX, y + thickY, w - thickX*2, h - thickY*2, tile.solidColor);
}

export async function psCheckerboard(x, y, w, h, colorA, colorB, divs) {
  await psRect(x, y, w, h, colorA);
  const cellW = w / divs, cellH = h / divs;
  for (let r = 0; r < divs; r++) {
    for (let c = 0; c < divs; c++) {
      if ((r + c) % 2 === 1) {
        let cx = Math.round(x + c * cellW), cy = Math.round(y + r * cellH);
        let cw = Math.round(x + (c + 1) * cellW) - cx;
        let ch = Math.round(y + (r + 1) * cellH) - cy;
        if (cw > 0 && ch > 0) await psRect(cx, cy, cw, ch, colorB);
      }
    }
  }
}

// =========================================================
//  ICON TILE
// =========================================================

export async function renderIconTile(x, y, w, h, iconUxpFile, bgHex, padding, targetDocId, gridDivs) {
  gridDivs = gridDivs || 1;
  await psRect(x, y, w, h, bgHex || "#ffffff");
  if (!iconUxpFile) return;

  const iconDoc      = await app.open(iconUxpFile);
  if (iconDoc.layers.length > 1)
    await action.batchPlay([{ _obj: "flattenImage" }], { synchronousExecution: true });

  const sourceLayerId = iconDoc.activeLayers[0].id;
  const sourceDocId   = iconDoc.id;
  const cellW         = w / gridDivs, cellH = h / gridDivs;

  for (let r = 0; r < gridDivs; r++) {
    for (let c = 0; c < gridDivs; c++) {
      await action.batchPlay([{
        _obj: "select", _target: [{ _ref: "document", _id: sourceDocId }],
      }], { synchronousExecution: true });
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _id: sourceLayerId }],
        to: { _ref: "document", _id: targetDocId },
        _options: { dialogOptions: "dontDisplay" },
      }], { synchronousExecution: true });
      await action.batchPlay([{
        _obj: "select", _target: [{ _ref: "document", _id: targetDocId }],
      }], { synchronousExecution: true });

      const bounds  = await getActiveLayerBounds();
      const layerW  = bounds.right - bounds.left;
      const layerH  = bounds.bottom - bounds.top;
      const fitW    = Math.max(1, cellW - padding * 2);
      const fitH    = Math.max(1, cellH - padding * 2);

      if (layerW > 0 && layerH > 0) {
        const scaleFactor = Math.min(fitW / layerW, fitH / layerH);
        await action.batchPlay([{
          _obj: "transform",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
          width:  { _unit: "percentUnit", _value: scaleFactor * 100 },
          height: { _unit: "percentUnit", _value: scaleFactor * 100 },
        }], { synchronousExecution: true });
      }

      const newBounds = await getActiveLayerBounds();
      const layerCX   = (newBounds.left + newBounds.right)  / 2;
      const layerCY   = (newBounds.top  + newBounds.bottom) / 2;
      const targetCX  = x + (c * cellW) + cellW / 2;
      const targetCY  = y + (r * cellH) + cellH / 2;
      const deltaX    = targetCX - layerCX, deltaY = targetCY - layerCY;
      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) await moveLayerBy(deltaX, deltaY);
    }
  }

  await action.batchPlay([{ _obj: "select", _target: [{ _ref: "document", _id: sourceDocId }] }], { synchronousExecution: true });
  await iconDoc.closeWithoutSaving();
  await action.batchPlay([{ _obj: "select", _target: [{ _ref: "document", _id: targetDocId }] }], { synchronousExecution: true });
}

// =========================================================
//  TILE DISPATCHER
// =========================================================

export async function renderTile(tileIdx, x, y, w, h, targetDocId) {
  const tile = tiles[tileIdx % tiles.length];
  switch (tile.type) {
    case "phrase-single":
      await renderPhraseSingle(x, y, w, h, tile); break;
    case "phrase-fill": case "phrase-fillcolor": case "phrase-altwords":
      await renderPhraseFill(x, y, w, h, tile); break;
    case "phrase-multiline":
      await renderPhraseMultiline(x, y, w, h, tile); break;
    case "icon":
      await renderIconTile(x, y, w, h, tile.iconFile, tile.iconBg, tile.iconPad||0, targetDocId, 1); break;
    case "icon-grid":
      await renderIconTile(x, y, w, h, tile.iconFile, tile.iconBg, tile.iconPad||0, targetDocId, tile.gridDivs||2); break;
    case "solid":
      await psRect(x, y, w, h, tile.solidColor); break;
    case "solid-framed":
      await renderFramedTile(x, y, w, h, tile); break;
    case "checkerboard":
      await psCheckerboard(x, y, w, h, tile.checkA, tile.checkB, tile.gridDivs||4); break;
  }
}
