// =========================================================
//  TILE IMPORT / EXPORT
//  Handles JSON-based import and export of tile specs,
//  individual tiles (with embedded icon data), and tile packs.
// =========================================================

import { storage }       from "uxp";
import { tiles }         from './state.js';
import { setStatus }     from './dom-helpers.js';
import {
  renderTileList,
  openEditorFromSpec,
} from './tile-editor.js';

const localFS = storage.localFileSystem;

// =========================================================
//  HELPERS
// =========================================================

async function fileToDataUri(file) {
  if (!file) return null;
  try {
    const data  = await file.read({ format: storage.formats.binary });
    const bytes = new Uint8Array((data instanceof ArrayBuffer) ? data : data.buffer || data);
    let binary  = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const ext    = (file.name || "").toLowerCase().split(".").pop();
    const mime   = (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : "image/png";
    return "data:" + mime + ";base64," + base64;
  } catch (e) {
    console.error("fileToDataUri failed:", e);
    return null;
  }
}

async function serializeTile(tile, embedIcon) {
  const t = Object.assign({}, tile);
  delete t.iconFile; // UXP file reference — not JSON-serializable
  if (embedIcon && tile.iconFile) {
    t.iconDataUri = await fileToDataUri(tile.iconFile);
  }
  return t;
}

async function writeJsonFile(defaultName, data) {
  const json = JSON.stringify(data, null, 2);
  const file = await localFS.getFileForSaving(defaultName, { types: ["json"] });
  if (!file) return false;
  await file.write(json, { format: storage.formats.utf8 });
  return true;
}

async function readJsonFile() {
  const file = await localFS.getFileForOpening({ types: ["json"] });
  if (!file) return null;
  const text = await file.read({ format: storage.formats.utf8 });
  return JSON.parse(text);
}

// =========================================================
//  EXPORT — SPEC (no embedded binary)
// =========================================================

export async function exportTileSpec(idx) {
  const tile = tiles[idx];
  if (!tile) return;
  try {
    const spec = await serializeTile(tile, false);
    const ok   = await writeJsonFile(
      "tile-spec-" + tile.type + ".json",
      { version: 1, type: "tilespec", spec }
    );
    if (ok) setStatus("Spec exported.");
  } catch (e) {
    setStatus("Export failed: " + e.message);
  }
}

// =========================================================
//  EXPORT — CURRENT EDITOR STATE AS SPEC
// =========================================================

export async function exportEditorSpec(buildFn) {
  try {
    const tile = buildFn();
    if (!tile) return;
    const spec = await serializeTile(tile, false);
    const ok   = await writeJsonFile(
      "tile-spec-" + tile.type + ".json",
      { version: 1, type: "tilespec", spec }
    );
    if (ok) setStatus("Spec exported.");
  } catch (e) {
    setStatus("Export failed: " + e.message);
  }
}

// =========================================================
//  EXPORT — FULL TILE (with embedded icon)
// =========================================================

export async function exportTile(idx) {
  const tile = tiles[idx];
  if (!tile) return;
  try {
    const tileData = await serializeTile(tile, true);
    const ok       = await writeJsonFile(
      "tile-" + (idx + 1) + "-" + tile.type + ".json",
      { version: 1, type: "tile", tile: tileData }
    );
    if (ok) setStatus("Tile exported.");
  } catch (e) {
    setStatus("Export failed: " + e.message);
  }
}

// =========================================================
//  EXPORT — ALL TILES (tile pack)
// =========================================================

export async function exportAllTiles() {
  if (tiles.length === 0) { setStatus("No tiles to export."); return; }
  try {
    const serialized = await Promise.all(tiles.map(t => serializeTile(t, true)));
    const ok = await writeJsonFile(
      "tiles-pack.json",
      { version: 1, type: "tilepack", tiles: serialized }
    );
    if (ok) setStatus("Tile pack exported (" + tiles.length + " tile(s)).");
  } catch (e) {
    setStatus("Export failed: " + e.message);
  }
}

// =========================================================
//  IMPORT — SINGLE TILE OR PACK
// =========================================================

export async function importTile() {
  try {
    const data = await readJsonFile();
    if (!data) return;
    if (data.type === "tilespec" && data.spec) {
      await openEditorFromSpec(data.spec);
      setStatus("Spec loaded into editor.");
    } else if (data.type === "tile" && data.tile) {
      tiles.push(data.tile);
      renderTileList();
      setStatus("Tile imported.");
    } else if (data.type === "tilepack" && Array.isArray(data.tiles)) {
      tiles.push(...data.tiles);
      renderTileList();
      setStatus("Tile pack imported (" + data.tiles.length + " tile(s)).");
    } else {
      setStatus("Unrecognised tile format.");
    }
  } catch (e) {
    setStatus("Import failed: " + e.message);
  }
}

// =========================================================
//  IMPORT — TILE PACK
// =========================================================

export async function importTilePack() {
  try {
    const data = await readJsonFile();
    if (!data) return;
    if (data.type === "tilepack" && Array.isArray(data.tiles)) {
      tiles.push(...data.tiles);
      renderTileList();
      setStatus("Tile pack imported (" + data.tiles.length + " tile(s)).");
    } else if (data.type === "tile" && data.tile) {
      tiles.push(data.tile);
      renderTileList();
      setStatus("Tile imported.");
    } else {
      setStatus("Unrecognised tile pack format.");
    }
  } catch (e) {
    setStatus("Import failed: " + e.message);
  }
}

// =========================================================
//  IMPORT — SPEC INTO EDITOR
// =========================================================

export async function importSpec() {
  try {
    const data = await readJsonFile();
    if (!data) return;
    const spec = data.spec || (data.type === "tile" ? data.tile : null);
    if (!spec) { setStatus("No spec data found in file."); return; }
    await openEditorFromSpec(spec);
    setStatus("Spec loaded into editor.");
  } catch (e) {
    setStatus("Import failed: " + e.message);
  }
}
