// Shared arrays/objects – mutated in-place throughout the app.
export const palette  = [];
export const tiles    = [];
export const fontMap  = {};

// Primitive state wrapped in an object so any module can read and write it.
export const appState = {
  editingIdx:       -1,
  iconFile:         null,
  cachedIconImage:  null,
  refImageData:     null,
};
