import { storage }  from "uxp";
import UPNG         from "upng-js";
import jpeg         from "jpeg-js";
import { appState } from './state.js';
import { rgbToHex } from './color-utils.js';
import { addColor } from './palette-ui.js';
import { setStatus } from './dom-helpers.js';

const localFS = storage.localFileSystem;
const READ_TIMEOUT_MS = 12000;
const REF_IMG_DEBUG = true;
let refImageLoadInFlight = false;

function refLog(stage, details) {
  if (!REF_IMG_DEBUG) return;
  try {
    if (details !== undefined) console.log("[ref-image]", stage, details);
    else console.log("[ref-image]", stage);
  } catch (_) {}
}

function errorMsg(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

async function readBinaryWithTimeout(file, timeoutMs) {
  let timeoutId = null;
  try {
    return await Promise.race([
      file.read({ format: storage.formats.binary }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("Timed out while reading image file."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function decodePixels(bytes, mime) {
  if (mime === "image/jpeg") {
    const result = jpeg.decode(bytes, { useTArray: true });
    return { width: result.width, height: result.height, rgba: result.data };
  }
  const pngBuffer = (bytes instanceof Uint8Array)
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : bytes;
  const img = UPNG.decode(pngBuffer);
  const rgba = UPNG.toRGBA8(img)[0];
  return { width: img.width, height: img.height, rgba: new Uint8ClampedArray(rgba) };
}

function drawPixelsToCanvas(width, height, rgba) {
  // In UXP, document.createElement("canvas") does not return a context with
  // createImageData, so we avoid offscreen canvases entirely.
  // Instead, draw at full resolution onto #refCanvas and let CSS max-width
  // handle display scaling.
  const canvas = document.getElementById("refCanvas");
  canvas.width  = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const clamped = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer || rgba);

  let imgData;
  try {
    // Modern UXP supports the ImageData constructor; try it first for performance.
    imgData = new ImageData(clamped, width, height);
  } catch (_) {
    // Fallback: UXP does not implement ctx.createImageData, so get a writable
    // ImageData by reading the freshly-sized blank canvas.
    imgData = ctx.getImageData(0, 0, width, height);
    // imgData.data.set() can throw silently in some UXP versions; use a loop as
    // the guaranteed-safe fallback.
    if (typeof imgData.data.set === "function") {
      try {
        imgData.data.set(clamped);
      } catch (_2) {
        for (let i = 0; i < clamped.length; i++) imgData.data[i] = clamped[i];
      }
    } else {
      for (let i = 0; i < clamped.length; i++) imgData.data[i] = clamped[i];
    }
  }

  ctx.putImageData(imgData, 0, 0);
  appState.refImageData = imgData;
  document.getElementById("refContainer").classList.remove("hidden");
}

export async function loadReferenceImage() {
  if (refImageLoadInFlight) {
    setStatus("Still loading reference image...");
    refLog("blocked:in-flight");
    return;
  }
  refImageLoadInFlight = true;
  refLog("start");
  try {
    const file = await localFS.getFileForOpening({
      types: ["png", "jpg", "jpeg"],
    });
    if (!file) {
      refLog("cancelled:file-picker");
      return;
    }
    refLog("file:selected", { name: file.name });
    setStatus("Loading reference image...");

    const data = await readBinaryWithTimeout(file, READ_TIMEOUT_MS);
    let bytes;
    if (data instanceof Uint8Array) {
      bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else if (data && data.buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(data.buffer);
    } else {
      throw new Error("Unsupported image data format.");
    }
    refLog("file:read-complete", { bytes: bytes.length });

    const ext = file.name.toLowerCase().split(".").pop();
    const mime = (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : "image/png";

    refLog("decode:start", { mime });
    const { width, height, rgba } = decodePixels(bytes, mime);
    refLog("decode:complete", { width, height });

    drawPixelsToCanvas(width, height, rgba);
    setStatus("Image loaded. Click on it to sample colors.");
    refLog("success", { width, height });
  } catch (e) {
    setStatus("Image load failed: " + errorMsg(e));
    refLog("fatal", errorMsg(e));
  } finally {
    refImageLoadInFlight = false;
  }
}

export function handleRefCanvasClick(e) {
  const canvas = document.getElementById("refCanvas");

  if (!appState.refImageData) {
    try {
      const ctx  = canvas.getContext("2d");
      const rect = canvas.getBoundingClientRect();
      const x    = Math.round((e.clientX - rect.left) * (canvas.width  / rect.width));
      const y    = Math.round((e.clientY - rect.top)  * (canvas.height / rect.height));
      const px   = ctx.getImageData(x, y, 1, 1).data;
      addColor(rgbToHex(px[0], px[1], px[2]));
    } catch (err) {
      setStatus("Cannot sample – reload the image.");
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x    = Math.max(0, Math.min(canvas.width  - 1, Math.round((e.clientX - rect.left) * (canvas.width  / rect.width))));
  const y    = Math.max(0, Math.min(canvas.height - 1, Math.round((e.clientY - rect.top)  * (canvas.height / rect.height))));

  const idx = (y * appState.refImageData.width + x) * 4;
  const r   = appState.refImageData.data[idx];
  const g   = appState.refImageData.data[idx + 1];
  const b   = appState.refImageData.data[idx + 2];

  addColor(rgbToHex(r, g, b));
  setStatus("Sampled: " + rgbToHex(r, g, b));
}
