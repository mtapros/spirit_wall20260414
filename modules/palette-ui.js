import { palette }              from './state.js';
import { MAX_COLORS }           from './constants.js';
import { setStatus }            from './dom-helpers.js';
import { refreshAllColorFields } from './color-field.js';

export function renderSwatches() {
  const el = document.getElementById("swatches");
  el.innerHTML = "";
  palette.forEach((hex, i) => {
    const d = document.createElement("div");
    d.className        = "swatch";
    d.style.background = hex;
    d.title            = hex + "\nClick to remove";
    d.addEventListener("click", () => {
      palette.splice(i, 1);
      renderSwatches();
      refreshAllColorFields();
    });
    el.appendChild(d);
  });
  refreshAllColorFields();
}

export function addColor(hex) {
  const n = hex.toLowerCase();
  if (palette.includes(n)) return;
  if (palette.length >= MAX_COLORS) { setStatus("Max " + MAX_COLORS + " colors."); return; }
  palette.push(n);
  renderSwatches();
}
