import { storage } from "uxp";
import { app } from "photoshop";
import { loadLicenseData, computeOfflineGraceRemaining } from "./license.js";

const TRIAL_FILE_NAME = "trial.json";
const TRIAL_DAYS = 7;
const PURCHASE_URL = "https://hanleyai.com/vtk-spirit-wall-builder";

const TIER_RANKS = { basic: 1, pro: 2, advanced: 3 };

const MODE = {
  TRIAL_ACTIVE: "TRIAL_ACTIVE",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  PAID_BASIC: "PAID_BASIC",
  PAID_PRO: "PAID_PRO",
  PAID_ADVANCED: "PAID_ADVANCED",
  OFFLINE_GRACE: "OFFLINE_GRACE",
  UNLICENSED: "UNLICENSED",
};

const TILE_TYPES_BY_VERSION = {
  basic: ["phrase-single", "solid", "checkerboard"],
  pro: [
    "phrase-single", "phrase-multiline", "phrase-fill", "phrase-fillcolor", "phrase-altwords",
    "icon", "icon-grid",
    "solid", "solid-framed", "checkerboard",
  ],
  advanced: [
    "phrase-single", "phrase-multiline", "phrase-fill", "phrase-fillcolor", "phrase-altwords",
    "icon", "icon-grid",
    "solid", "solid-framed", "checkerboard",
  ],
  trial: [
    "phrase-single", "phrase-multiline", "phrase-fill", "phrase-fillcolor", "phrase-altwords",
    "icon", "icon-grid",
    "solid", "solid-framed", "checkerboard",
  ],
};

async function loadTrialData() {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    const entries = await folder.getEntries();
    const file = entries.find(e => e.name === TRIAL_FILE_NAME);
    if (!file) return null;
    const content = await file.read({ format: storage.formats.utf8 });
    return JSON.parse(content);
  } catch (e) {
    console.error("Trial load error:", e);
    return null;
  }
}

async function saveTrialData(data) {
  try {
    const folder = await storage.localFileSystem.getDataFolder();
    const file = await folder.createEntry(TRIAL_FILE_NAME, {
      type: storage.types.file,
      overwrite: true,
    });
    await file.write(JSON.stringify(data), { format: storage.formats.utf8 });
  } catch (e) {
    console.error("Trial save error:", e);
  }
}

function normalizeTierFromData(licData) {
  if (!licData) return null;
  const rawTier = licData.tier === null || licData.tier === undefined
    ? ""
    : String(licData.tier).trim().toLowerCase();
  if (rawTier === "basic" || rawTier === "pro" || rawTier === "advanced") return rawTier;
  const rank = Number(licData.tierRank);
  if (rank >= 3) return "advanced";
  if (rank >= 2) return "pro";
  if (rank >= 1) return "basic";
  return null;
}

function hasRequiredTier(currentTier, requiredTier) {
  const curr = TIER_RANKS[currentTier] || 0;
  const req = TIER_RANKS[requiredTier] || 0;
  return curr >= req;
}

function getModeFromParts({ trialActive, trialExpired, paidTier, graceRemaining, offlineValidationFailed, hasValidation, hasLicenseKey }) {
  // Any stored, validated license key exits trial mode — even if tier extraction failed.
  // If tier is unknown we default to PAID_BASIC so the user isn't blocked.
  const hasActiveLicense = hasLicenseKey || !!paidTier;
  const hasGrace = !!hasValidation && (graceRemaining === null || graceRemaining > 0);

  if (hasActiveLicense && hasGrace) {
    if (offlineValidationFailed) return MODE.OFFLINE_GRACE;
    if (paidTier === "advanced") return MODE.PAID_ADVANCED;
    if (paidTier === "pro") return MODE.PAID_PRO;
    return MODE.PAID_BASIC;
  }
  if (trialActive) return MODE.TRIAL_ACTIVE;
  if (trialExpired) return MODE.TRIAL_EXPIRED;
  return MODE.UNLICENSED;
}

export async function initLicensing() {
  let trial = await loadTrialData();
  if (!trial || !trial.trialStartedAt) {
    trial = { trialStartedAt: Date.now() };
    await saveTrialData(trial);
  }
  return getLicenseState(trial);
}

export async function getLicenseState(trialData) {
  let trial = trialData || (await loadTrialData());
  if (!trial || !trial.trialStartedAt) {
    trial = { trialStartedAt: Date.now() };
    await saveTrialData(trial);
  }
  const licData = await loadLicenseData();

  const elapsedMs = Date.now() - trial.trialStartedAt;
  const trialDaysMs = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const trialActive = elapsedMs < trialDaysMs;
  const trialExpired = !trialActive;
  const daysLeft = trialActive ? Math.ceil((trialDaysMs - elapsedMs) / (24 * 60 * 60 * 1000)) : 0;

  const paidTier = normalizeTierFromData(licData);
  const graceRemaining = computeOfflineGraceRemaining(licData);
  const offlineValidationFailed = !!(licData && licData.lastValidationFailedAt);
  const hasValidation = !!(licData && licData.validatedAt);
  const hasLicenseKey = !!(licData && licData.licenseKey && licData.validatedAt);
  const mode = getModeFromParts({ trialActive, trialExpired, paidTier, graceRemaining, offlineValidationFailed, hasValidation, hasLicenseKey });
  const licensed = mode === MODE.PAID_BASIC || mode === MODE.PAID_PRO || mode === MODE.PAID_ADVANCED || mode === MODE.OFFLINE_GRACE;

  return {
    mode,
    status: mode,
    trialActive,
    trialExpired,
    trialStartedAt: trial.trialStartedAt,
    daysLeft,
    licensed,
    paidTier,
    graceRemaining,
    purchaseUrl: PURCHASE_URL,
    licData,
  };
}

export function getLicenseVersionFromData(licData) {
  const tier = normalizeTierFromData(licData);
  return tier || "unknown";
}

export function getLicenseVersion(state) {
  if (!state) return "trial";
  if (state.mode === MODE.TRIAL_ACTIVE) return "trial";
  if (state.mode === MODE.PAID_ADVANCED) return "advanced";
  if (state.mode === MODE.PAID_PRO) return "pro";
  if (state.mode === MODE.PAID_BASIC || state.mode === MODE.OFFLINE_GRACE) {
    return state.paidTier || getLicenseVersionFromData(state.licData) || "unknown";
  }
  return "none";
}

export function getAllowedTileTypes(state) {
  const version = getLicenseVersion(state);
  if (version === "advanced") return TILE_TYPES_BY_VERSION.advanced.slice();
  if (version === "pro") return TILE_TYPES_BY_VERSION.pro.slice();
  if (version === "basic") return TILE_TYPES_BY_VERSION.basic.slice();
  if (version === "trial") return TILE_TYPES_BY_VERSION.trial.slice();
  return [];
}

export function getCapabilities(state) {
  const version = getLicenseVersion(state);
  const trial = version === "trial";
  const proOrHigher = trial || version === "pro" || version === "advanced";
  const advancedOrTrial = trial || version === "advanced";

  return {
    version,
    canGenerate: state.mode !== MODE.TRIAL_EXPIRED && state.mode !== MODE.UNLICENSED,
    requiresWatermark: state.mode === MODE.TRIAL_ACTIVE,
    canUse3D: proOrHigher,
    canUseReflection: proOrHigher,
    canUsePaper: advancedOrTrial,
    canUseHiResExport: advancedOrTrial,
    canUseExportTab: true,
    allowedTileTypes: getAllowedTileTypes(state),
  };
}

export async function isFeatureAllowed(featureName, state, requiredTier = "basic") {
  const s = state || (await getLicenseState());
  const version = getLicenseVersion(s);

  if (s.mode === MODE.TRIAL_ACTIVE) return true;
  if (s.mode === MODE.TRIAL_EXPIRED || s.mode === MODE.UNLICENSED) {
    const msg = "⛔ Demo expired — purchase to continue:\n" + PURCHASE_URL;
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = msg;
    try { await app.showAlert(msg); } catch (_) { alert(msg); }
    return false;
  }

  if (s.licensed && hasRequiredTier(version, requiredTier)) return true;
  const msg =
    "🔒 " + featureName + " requires a " + requiredTier.toUpperCase() + " license.\n\n" +
    "Current version: " + String(version).toUpperCase() + "\n" +
    "Upgrade at:\n" + PURCHASE_URL;
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent =
      featureName + " requires " + requiredTier.toUpperCase() +
      ". Current version: " + String(version).toUpperCase() + ".";
  }
  try { await app.showAlert(msg); } catch (_) { alert(msg); }
  return false;
}

function _setGatedButtonsDisabled(disabled) {
  const ids = ["btnGenerate", "btn3DWall", "btnSelectExportFolder", "btnExportTiles"];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

function isBrickedMode(state) {
  return state.mode === MODE.TRIAL_EXPIRED || state.mode === MODE.UNLICENSED;
}

function _applyTileTypeGate(allowedTileTypes) {
  const select = document.getElementById("teType");
  if (!select) return;
  const allowed = new Set(allowedTileTypes);
  let firstAllowed = null;
  [...select.options].forEach(opt => {
    const ok = allowed.has(opt.value);
    opt.disabled = !ok;
    opt.hidden = !ok;
    if (ok && !firstAllowed) firstAllowed = opt.value;
  });
  if (!allowed.has(select.value) && firstAllowed) select.value = firstAllowed;
}

function _setPurchaseBanner(state) {
  const banner = document.getElementById("trialBanner");
  if (!banner) return;

  banner.classList.remove("hidden", "state-active", "state-trial", "state-inactive");
  banner.innerHTML = "";

  const msg = document.createElement("span");

  if (isBrickedMode(state)) {
    banner.classList.add("state-inactive");
    msg.textContent = "⛔ License inactive/expired — purchase to continue.";
    const btn = document.createElement("button");
    btn.textContent = "Get a License";
    btn.style.padding = "4px 8px";
    btn.style.border = "1px solid #fff";
    btn.style.background = "#222";
    btn.style.color = "#fff";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => {
      try { window.open(PURCHASE_URL); } catch (_) {}
    });
    banner.appendChild(msg);
    banner.appendChild(btn);
    return;
  }

  if (state.mode === MODE.TRIAL_ACTIVE) {
    banner.classList.add("state-trial");
    msg.textContent = "⚠ Trial active — " + state.daysLeft + " day(s) remaining.";
    banner.appendChild(msg);
    return;
  }

  if (state.licensed || state.mode === MODE.OFFLINE_GRACE) {
    banner.classList.add("state-active");
    msg.textContent = "✅ License active";
    const tier = document.createElement("span");
    tier.className = "tier-pill";
    tier.textContent = String(state.paidTier || "unknown").toUpperCase();
    banner.appendChild(msg);
    banner.appendChild(tier);
    return;
  }

  banner.classList.add("state-inactive");
  msg.textContent = "⛔ License inactive/expired.";
  banner.appendChild(msg);
}

function _setTierFeatureAvailability(state) {
  const capabilities = getCapabilities(state);
  const btn3DWall = document.getElementById("btn3DWall");
  const btnSelectExportFolder = document.getElementById("btnSelectExportFolder");
  const btnExportTiles = document.getElementById("btnExportTiles");
  const tabBtnExport = document.getElementById("tabBtnExport");
  const applyPaper = document.getElementById("applyPaper");
  const paperOpacity = document.getElementById("paperOpacity");
  const genReflGrid = document.getElementById("genReflGrid");
  const camAdjRefl = document.getElementById("camAdjRefl");
  const reflectionOpts = document.getElementById("reflectionOpts");

  if (btn3DWall && !isBrickedMode(state)) {
    btn3DWall.disabled = !capabilities.canUse3D;
  }
  if (btnSelectExportFolder && !isBrickedMode(state)) {
    btnSelectExportFolder.disabled = !capabilities.canUseHiResExport;
  }
  if (btnExportTiles && !isBrickedMode(state)) {
    btnExportTiles.disabled = !capabilities.canUseHiResExport;
  }

  if (tabBtnExport) {
    tabBtnExport.style.display = "";
    const exportLocked = !capabilities.canUseHiResExport;
    tabBtnExport.textContent = exportLocked ? "Hi-Res Export 🔒" : "Hi-Res Export";
    tabBtnExport.title = exportLocked ? "Advanced license required for Hi-Res export." : "";
  }

  if (genReflGrid) {
    genReflGrid.disabled = !capabilities.canUseReflection;
    if (!capabilities.canUseReflection) genReflGrid.checked = false;
  }
  if (camAdjRefl) {
    camAdjRefl.disabled = !capabilities.canUseReflection;
    if (!capabilities.canUseReflection) camAdjRefl.checked = false;
  }
  if (reflectionOpts) reflectionOpts.style.display = capabilities.canUseReflection ? "" : "none";

  if (applyPaper) {
    applyPaper.disabled = !capabilities.canUsePaper;
    if (!capabilities.canUsePaper) applyPaper.checked = false;
  }
  if (paperOpacity) paperOpacity.disabled = !capabilities.canUsePaper;

  _applyTileTypeGate(capabilities.allowedTileTypes);
}

export function applyLicenseStateToUI(state) {
  const statusEl = document.getElementById("status");
  const licenseStatusEl = document.getElementById("licCurrentStatus");
  const capabilities = getCapabilities(state);
  const bricked = isBrickedMode(state);

  _setPurchaseBanner(state);
  _setGatedButtonsDisabled(bricked);
  _setTierFeatureAvailability(state);

  const setStatusText = (msg) => {
    if (statusEl) statusEl.textContent = msg;
    if (licenseStatusEl) licenseStatusEl.textContent = msg;
  };
  const setStatusTone = (tone) => {
    if (!statusEl) return;
    statusEl.classList.remove("status-active", "status-trial", "status-inactive");
    if (tone) statusEl.classList.add(tone);
  };

  if (bricked) {
    setStatusTone("status-inactive");
    setStatusText("Trial expired — purchase to continue: " + PURCHASE_URL);
    return;
  }
  if (state.mode === MODE.TRIAL_ACTIVE) {
    setStatusTone("status-trial");
    setStatusText("Trial active — " + state.daysLeft + " day(s) remaining. Output will be watermarked until you purchase.");
    return;
  }
  if (state.mode === MODE.OFFLINE_GRACE) {
    setStatusTone("status-active");
    setStatusText("License active (offline grace). Features available for " + (state.paidTier || "unknown").toUpperCase() + ".");
    return;
  }
  if (state.licensed) {
    setStatusTone("status-active");
    setStatusText("License active — " + String(capabilities.version).toUpperCase() + " (unwatermarked output).");
    return;
  }
  setStatusTone("status-inactive");
  setStatusText("No active license. Trial status shown in banner.");
}

export { MODE, PURCHASE_URL };
