import { palette }   from './state.js';
import { openPicker } from './color-picker.js';

export const colorFields = {};

// Callback invoked whenever a color field value changes
// (wired by main.js to updateLivePreview so this module
//  doesn't need to import live-preview and create a circular dep).
let _onColorChangeCallback = null;
export function setColorChangeCallback(fn) { _onColorChangeCallback = fn; }

export function registerColorField(fieldId, containerElId, defaultColor) {
  const el = document.getElementById(containerElId);
  colorFields[fieldId] = { value: defaultColor, containerEl: el };

  const sd = document.createElement("div");
  sd.className          = "cf-swatches";
  sd.dataset.fieldId    = fieldId;

  const cd = document.createElement("div");
  cd.className = "cf-current";
  cd.innerHTML =
    `<div class="cf-current-swatch" id="${fieldId}Cur" style="background:${defaultColor}"></div>` +
    `<span class="cf-current-label" id="${fieldId}Label">${defaultColor}</span>`;

  el.appendChild(sd);
  el.appendChild(cd);
  setColorFieldValue(fieldId, defaultColor);
}

export function setColorFieldValue(fieldId, hex) {
  const f = colorFields[fieldId];
  if (!f) return;
  f.value = hex;

  const cur = document.getElementById(fieldId + "Cur");
  const lbl = document.getElementById(fieldId + "Label");
  if (cur) cur.style.background = hex;
  if (lbl) lbl.textContent      = hex;

  refreshColorFieldSwatches(fieldId);

  if (!document.getElementById("tileEditor").classList.contains("hidden") &&
      _onColorChangeCallback) {
    _onColorChangeCallback();
  }
}

export function getColorFieldValue(fieldId) {
  return colorFields[fieldId] ? colorFields[fieldId].value : "#000000";
}

export function refreshColorFieldSwatches(fieldId) {
  const f = colorFields[fieldId];
  if (!f) return;
  const c = f.containerEl.querySelector(".cf-swatches");
  if (!c) return;
  c.innerHTML = "";

  const uniqueColors = [];
  const seen = {};
  ["#ffffff", "#000000"].concat(palette).forEach(hex => {
    if (!seen[hex]) { seen[hex] = true; uniqueColors.push(hex); }
  });

  uniqueColors.forEach(hex => {
    const d = document.createElement("div");
    d.className        = "cf-swatch" + (hex === f.value ? " selected" : "");
    d.style.background = hex;
    d.title            = hex;
    d.addEventListener("click", () => setColorFieldValue(fieldId, hex));
    c.appendChild(d);
  });

  const cu = document.createElement("div");
  cu.className = "cf-swatch custom-btn";
  cu.title     = "Pick custom color";
  cu.textContent = "...";
  cu.addEventListener("click", () =>
    openPicker(f.value, hex => setColorFieldValue(fieldId, hex))
  );
  c.appendChild(cu);
}

export function refreshAllColorFields() {
  Object.keys(colorFields).forEach(id => refreshColorFieldSwatches(id));
}
