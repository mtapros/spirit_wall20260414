import { storage }                            from "uxp";
import { tiles, appState }                    from './state.js';
import { getVal, getStr }                     from './dom-helpers.js';
import {
  setColorFieldValue, getColorFieldValue,
  refreshAllColorFields,
}                                             from './color-field.js';
import { resetLivePreviewState }              from './live-preview.js';
import { getLicenseState, getAllowedTileTypes } from './licensing.js';

// Callback wired from main.js to avoid tile-editor ↔ tile-io circular dep.
let _onExportTile = (_idx) => {};
export function setOnExportTile(fn) { _onExportTile = fn; }

const localFS = storage.localFileSystem;

export function tileLabel(t) {
  switch (t.type) {
    case "phrase-single":    return `"${t.text}" (single)`;
    case "phrase-fill":      return `"${t.text}" (repeat)`;
    case "phrase-fillcolor": return `"${t.text}" (repeat/color)`;
    case "phrase-altwords":  return `"${t.text}/${t.text2}" (alt)`;
    case "phrase-multiline": return `"${t.text}" (multi-line)`;
    case "icon":             return t.iconName || "Image";
    case "icon-grid":        return (t.iconName || "Image") + ` (${t.gridDivs||2}x${t.gridDivs||2})`;
    case "solid":            return "Solid";
    case "solid-framed":     return "Framed Solid";
    case "checkerboard":     return "Checkerboard";
    default:                 return t.type;
  }
}

export function tileBgColor(t) {
  switch (t.type) {
    case "phrase-single": case "phrase-fill": case "phrase-fillcolor":
    case "phrase-altwords": case "phrase-multiline": return t.bgColor;
    case "icon": case "icon-grid": return t.iconBg;
    case "solid":          return t.solidColor;
    case "solid-framed":   return t.frameColor;
    case "checkerboard":   return t.checkA;
    default:               return "#555";
  }
}

export function renderTileList() {
  const el = document.getElementById("tileList");
  el.innerHTML = "";
  if (tiles.length === 0) {
    el.innerHTML = '<p class="hint">No tiles yet - click "+ Add Tile"</p>';
    return;
  }
  tiles.forEach((t, i) => {
    const pill = document.createElement("div");
    pill.className = "tile-pill";

    const preview = document.createElement("div");
    preview.className        = "pill-preview";
    preview.style.background = tileBgColor(t);

    const label = document.createElement("span");
    label.className   = "pill-label";
    label.textContent = `${i + 1}. ${tileLabel(t)}`;

    const editBtn = document.createElement("button");
    editBtn.className   = "pill-btn edit";
    editBtn.title       = "Edit";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", e => { e.stopPropagation(); openEditor(i); });

    const delBtn = document.createElement("button");
    delBtn.className   = "pill-btn del";
    delBtn.title       = "Delete";
    delBtn.textContent = "X";
    delBtn.addEventListener("click", e => { e.stopPropagation(); tiles.splice(i, 1); renderTileList(); });

    const exportBtn = document.createElement("button");
    exportBtn.className   = "pill-btn";
    exportBtn.title       = "Export tile (with all assets)";
    exportBtn.textContent = "⬇";
    exportBtn.addEventListener("click", e => { e.stopPropagation(); _onExportTile(i); });

    const actions = document.createElement("span");
    actions.className = "pill-actions";
    actions.appendChild(editBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(delBtn);

    pill.appendChild(preview);
    pill.appendChild(label);
    pill.appendChild(actions);
    el.appendChild(pill);
  });
}

export function showEditorSection(type) {
  ["teTextOpts","teAltWordOpts","teAltColorOpts","teIconOpts","teGridDivOpts","teSolidOpts","teFrameOpts","teCheckOpts"]
    .forEach(id => document.getElementById(id).classList.add("hidden"));

  switch (type) {
    case "phrase-single": case "phrase-fill": case "phrase-multiline":
      document.getElementById("teTextOpts").classList.remove("hidden"); break;
    case "phrase-fillcolor":
      document.getElementById("teTextOpts").classList.remove("hidden");
      document.getElementById("teAltColorOpts").classList.remove("hidden"); break;
    case "phrase-altwords":
      document.getElementById("teTextOpts").classList.remove("hidden");
      document.getElementById("teAltWordOpts").classList.remove("hidden");
      document.getElementById("teAltColorOpts").classList.remove("hidden"); break;
    case "icon":
      document.getElementById("teIconOpts").classList.remove("hidden"); break;
    case "icon-grid":
      document.getElementById("teIconOpts").classList.remove("hidden");
      document.getElementById("teGridDivOpts").classList.remove("hidden"); break;
    case "solid":
      document.getElementById("teSolidOpts").classList.remove("hidden"); break;
    case "solid-framed":
      document.getElementById("teSolidOpts").classList.remove("hidden");
      document.getElementById("teFrameOpts").classList.remove("hidden"); break;
    case "checkerboard":
      document.getElementById("teCheckOpts").classList.remove("hidden");
      document.getElementById("teGridDivOpts").classList.remove("hidden"); break;
  }
}

export async function cacheIconImage(file) {
  if (!file) { appState.cachedIconImage = null; return; }
  try {
    const data  = await file.read({ format: storage.formats.binary });
    const bytes = new Uint8Array((data instanceof ArrayBuffer) ? data : data.buffer || data);
    let binary  = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const ext    = file.name.toLowerCase().split(".").pop();
    let mime     = "image/png";
    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
    const dataUri = "data:" + mime + ";base64," + base64;

    return new Promise(resolve => {
      const img    = new Image();
      img.onload   = () => { appState.cachedIconImage = img; resolve(); };
      img.onerror  = () => { appState.cachedIconImage = null; resolve(); };
      img.src      = dataUri;
    });
  } catch (e) { appState.cachedIconImage = null; }
}

export function loadCachedIconFromDataUri(dataUri) {
  if (!dataUri) { appState.cachedIconImage = null; return Promise.resolve(); }
  return new Promise(resolve => {
    const img    = new Image();
    img.onload   = () => { appState.cachedIconImage = img; resolve(); };
    img.onerror  = () => { appState.cachedIconImage = null; resolve(); };
    img.src      = dataUri;
  });
}

export async function openEditor(idx) {
  appState.editingIdx = idx;
  document.getElementById("tileEditor").classList.remove("hidden");
  refreshAllColorFields();

  if (idx >= 0) {
    const t = tiles[idx];
    document.getElementById("teType").value            = t.type;
    showEditorSection(t.type);
    document.getElementById("tileEditorTitle").textContent = "Edit Tile " + (idx + 1);

    if (t.type.startsWith("phrase")) {
      document.getElementById("teText").value       = t.text  || "TEXT";
      document.getElementById("teFont").value       = t.font  || "Arial Black";
      document.getElementById("teTextScale").value  = t.textScale || 80;
      setColorFieldValue("teTextColor", t.textColor || "#000000");
      setColorFieldValue("teBgColor",   t.bgColor   || "#ffffff");

      if (t.type === "phrase-altwords")
        document.getElementById("teText2").value = t.text2 || "TEXT 2";

      if (t.type === "phrase-fillcolor" || t.type === "phrase-altwords") {
        setColorFieldValue("teAltTextColor", t.altTextColor || "#ffffff");
        setColorFieldValue("teAltBgColor",   t.altBgColor   || "#000000");
      }
    } else if (t.type.startsWith("icon")) {
      setColorFieldValue("teIconBg", t.iconBg || "#ffffff");
      document.getElementById("teIconPad").value = t.iconPad || 20;
      if (t.type === "icon-grid") document.getElementById("teGridDivs").value = t.gridDivs || 2;
      document.getElementById("teIconName").textContent = t.iconName || "No file";
      appState.iconFile = t.iconFile || null;
      if (t.iconFile) {
        await cacheIconImage(t.iconFile);
      } else if (t.iconDataUri) {
        await loadCachedIconFromDataUri(t.iconDataUri);
      } else {
        appState.cachedIconImage = null;
      }
    } else if (t.type.startsWith("solid")) {
      setColorFieldValue("teSolidColor", t.solidColor || "#000000");
      if (t.type === "solid-framed") {
        setColorFieldValue("teFrameColor", t.frameColor || "#000000");
        document.getElementById("teFrameThick").value = t.frameThickness || 10;
      }
    } else if (t.type === "checkerboard") {
      setColorFieldValue("teCheckA", t.checkA || "#ffffff");
      setColorFieldValue("teCheckB", t.checkB || "#000000");
      document.getElementById("teGridDivs").value = t.gridDivs || 4;
    }
  } else {
    document.getElementById("tileEditorTitle").textContent = "New Tile";
    document.getElementById("teType").value                = "phrase-single";
    showEditorSection("phrase-single");
    appState.iconFile = null; appState.cachedIconImage = null;
    document.getElementById("teIconName").textContent  = "No file chosen";
    document.getElementById("teText").value            = "TEXT";
    document.getElementById("teText2").value           = "TEXT 2";
    document.getElementById("teTextScale").value       = 80;
    document.getElementById("teGridDivs").value        = 2;
    setColorFieldValue("teTextColor",    "#000000"); setColorFieldValue("teBgColor",     "#ffffff");
    setColorFieldValue("teAltTextColor", "#ffffff"); setColorFieldValue("teAltBgColor",  "#000000");
    setColorFieldValue("teSolidColor",   "#000000"); setColorFieldValue("teFrameColor",  "#000000");
  }

  document.getElementById("tileEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  resetLivePreviewState();
}

export async function saveTileFromEditor() {
  const type = getStr("teType");
  const licenseState = await getLicenseState();
  const allowed = new Set(getAllowedTileTypes(licenseState));
  if (!allowed.has(type)) {
    alert("This tile type is not available in your current tier.");
    return;
  }
  const tile = { type };

  switch (type) {
    case "phrase-single": case "phrase-fill": case "phrase-multiline":
      tile.text      = getStr("teText");  tile.font      = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor = getColorFieldValue("teBgColor"); break;
    case "phrase-fillcolor":
      tile.text      = getStr("teText");  tile.font      = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor        = getColorFieldValue("teBgColor");
      tile.altTextColor = getColorFieldValue("teAltTextColor"); tile.altBgColor = getColorFieldValue("teAltBgColor"); break;
    case "phrase-altwords":
      tile.text      = getStr("teText");  tile.text2     = getStr("teText2"); tile.font = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor        = getColorFieldValue("teBgColor");
      tile.altTextColor = getColorFieldValue("teAltTextColor"); tile.altBgColor = getColorFieldValue("teAltBgColor"); break;
    case "icon": case "icon-grid":
      tile.iconFile  = appState.iconFile;
      tile.iconName  = document.getElementById("teIconName").textContent;
      tile.iconBg    = getColorFieldValue("teIconBg"); tile.iconPad = getVal("teIconPad");
      if (type === "icon-grid") tile.gridDivs = getVal("teGridDivs"); break;
    case "solid":
      tile.solidColor = getColorFieldValue("teSolidColor"); break;
    case "solid-framed":
      tile.solidColor    = getColorFieldValue("teSolidColor");
      tile.frameColor    = getColorFieldValue("teFrameColor");
      tile.frameThickness = getVal("teFrameThick"); break;
    case "checkerboard":
      tile.checkA   = getColorFieldValue("teCheckA"); tile.checkB = getColorFieldValue("teCheckB");
      tile.gridDivs = getVal("teGridDivs"); break;
  }

  if (appState.editingIdx >= 0) tiles[appState.editingIdx] = tile; else tiles.push(tile);
  document.getElementById("tileEditor").classList.add("hidden");
  appState.editingIdx = -1;
  renderTileList();
}

// =========================================================
//  BUILD TILE FROM EDITOR (without saving)
//  Returns the current editor state as a plain tile object.
// =========================================================

export function buildTileFromEditor() {
  const type = getStr("teType");
  if (!type) return null;
  const tile = { type };

  switch (type) {
    case "phrase-single": case "phrase-fill": case "phrase-multiline":
      tile.text      = getStr("teText");  tile.font      = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor = getColorFieldValue("teBgColor"); break;
    case "phrase-fillcolor":
      tile.text      = getStr("teText");  tile.font      = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor = getColorFieldValue("teBgColor");
      tile.altTextColor = getColorFieldValue("teAltTextColor"); tile.altBgColor = getColorFieldValue("teAltBgColor"); break;
    case "phrase-altwords":
      tile.text      = getStr("teText");  tile.text2     = getStr("teText2"); tile.font = getStr("teFont");
      tile.textScale = getVal("teTextScale");
      tile.textColor = getColorFieldValue("teTextColor"); tile.bgColor = getColorFieldValue("teBgColor");
      tile.altTextColor = getColorFieldValue("teAltTextColor"); tile.altBgColor = getColorFieldValue("teAltBgColor"); break;
    case "icon": case "icon-grid":
      tile.iconFile = appState.iconFile;
      tile.iconName = document.getElementById("teIconName").textContent;
      tile.iconBg   = getColorFieldValue("teIconBg"); tile.iconPad = getVal("teIconPad");
      if (type === "icon-grid") tile.gridDivs = getVal("teGridDivs"); break;
    case "solid":
      tile.solidColor = getColorFieldValue("teSolidColor"); break;
    case "solid-framed":
      tile.solidColor     = getColorFieldValue("teSolidColor");
      tile.frameColor     = getColorFieldValue("teFrameColor");
      tile.frameThickness = getVal("teFrameThick"); break;
    case "checkerboard":
      tile.checkA   = getColorFieldValue("teCheckA"); tile.checkB = getColorFieldValue("teCheckB");
      tile.gridDivs = getVal("teGridDivs"); break;
  }

  return tile;
}

// =========================================================
//  OPEN EDITOR FROM SPEC
//  Populates the editor with the given tile-like spec object
//  and opens it as a new tile (not yet in tiles[]).
// =========================================================

export async function openEditorFromSpec(spec) {
  if (!spec || !spec.type) return;
  appState.editingIdx = -1;
  document.getElementById("tileEditor").classList.remove("hidden");
  refreshAllColorFields();
  document.getElementById("tileEditorTitle").textContent = "New Tile (from spec)";

  document.getElementById("teType").value = spec.type;
  showEditorSection(spec.type);

  if (spec.type.startsWith("phrase")) {
    document.getElementById("teText").value       = spec.text       || "TEXT";
    document.getElementById("teFont").value       = spec.font       || "Arial Black";
    document.getElementById("teTextScale").value  = spec.textScale  || 80;
    setColorFieldValue("teTextColor", spec.textColor || "#000000");
    setColorFieldValue("teBgColor",   spec.bgColor   || "#ffffff");
    if (spec.type === "phrase-altwords")
      document.getElementById("teText2").value = spec.text2 || "TEXT 2";
    if (spec.type === "phrase-fillcolor" || spec.type === "phrase-altwords") {
      setColorFieldValue("teAltTextColor", spec.altTextColor || "#ffffff");
      setColorFieldValue("teAltBgColor",   spec.altBgColor   || "#000000");
    }
  } else if (spec.type.startsWith("icon")) {
    setColorFieldValue("teIconBg", spec.iconBg || "#ffffff");
    document.getElementById("teIconPad").value = spec.iconPad || 20;
    if (spec.type === "icon-grid") document.getElementById("teGridDivs").value = spec.gridDivs || 2;
    document.getElementById("teIconName").textContent = spec.iconName || "No file";
    appState.iconFile = null;
    if (spec.iconDataUri) {
      await loadCachedIconFromDataUri(spec.iconDataUri);
    } else {
      appState.cachedIconImage = null;
    }
  } else if (spec.type.startsWith("solid")) {
    setColorFieldValue("teSolidColor", spec.solidColor || "#000000");
    if (spec.type === "solid-framed") {
      setColorFieldValue("teFrameColor", spec.frameColor || "#000000");
      document.getElementById("teFrameThick").value = spec.frameThickness || 10;
    }
  } else if (spec.type === "checkerboard") {
    setColorFieldValue("teCheckA", spec.checkA || "#ffffff");
    setColorFieldValue("teCheckB", spec.checkB || "#000000");
    document.getElementById("teGridDivs").value = spec.gridDivs || 4;
  }

  document.getElementById("tileEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  resetLivePreviewState();
}
