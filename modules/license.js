// =========================================================
//  LICENSE MODULE
//  Integrates Polar license activation/validation
//  via the Cloudflare Worker proxy.
// =========================================================

import { storage } from "uxp";
import os from "os";

const WORKER_BASE_URL       = "https://falling-river-a687.will-311.workers.dev";
// NOTE: This secret is intentionally embedded as a build-time constant.
// UXP plugins run entirely client-side with no runtime environment variables.
// Rotate it via the Cloudflare Worker config if it is ever compromised.
const APP_SHARED_SECRET     = "Qm8e3yVwN2pK6HkR7sG4cL1zX9tJ5aF0uD3bP8nS6rE2vY4q";
const FALLBACK_GRACE_SECONDS = 3 * 24 * 60 * 60; // 3 days
const LICENSE_FILE_NAME     = "license.json";
const LICENSE_DEBUG_LOGGING = true; // TEMPORARY (TODO: remove after tier mismatch investigation is complete)

function maskLicenseKeyForDebug(key) {
  if (!key) return null;
  const clean = String(key).trim();
  if (!clean) return null;
  const parts = clean.split("-");
  const tail = parts[parts.length - 1] || clean.slice(-4);
  return "XXXX-XXXX-XXXX-" + tail;
}

function summarizeLicenseResultForDebug(result) {
  if (!result || typeof result !== "object") return { type: typeof result };
  const interesting = [
    "ok", "activated", "valid", "status", "error", "message",
    "tier", "tierRank", "variant_name", "variantName", "plan", "plan_name", "title", "name",
  ];
  const summary = { keys: Object.keys(result).sort() };
  for (const k of interesting) {
    if (Object.prototype.hasOwnProperty.call(result, k)) summary[k] = result[k];
  }
  return summary;
}

function logLicenseDebug(stage, data) {
  if (!LICENSE_DEBUG_LOGGING) return;
  try {
    console.log("[license-debug] " + stage, JSON.stringify(data, null, 2));
  } catch (_) {
    console.log("[license-debug] " + stage, data);
  }
}

function normalizeTierRank(tier, tierRank) {
  const n = Number(tierRank);
  if (!Number.isNaN(n) && n >= 1) return n;
  const t = String(tier || "").trim().toLowerCase();
  if (t === "advanced") return 3;
  if (t === "pro") return 2;
  if (t === "basic") return 1;
  return null;
}

function normalizeTierName(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return null;
  if (t === "3") return "advanced";
  if (t === "2") return "pro";
  if (t === "1") return "basic";
  if (/\badvanced\b/.test(t) || t.includes("tier3") || t.includes("tier 3")) return "advanced";
  if (/\bpro\b/.test(t) || t.includes("tier2") || t.includes("tier 2")) return "pro";
  if (/\bbasic\b/.test(t) || t.includes("tier1") || t.includes("tier 1")) return "basic";
  return null;
}

function parseRank(raw) {
  const n = Number(raw);
  return !Number.isNaN(n) && n >= 1 ? n : null;
}

function tierToRank(tier) {
  if (tier === "advanced") return 3;
  if (tier === "pro") return 2;
  if (tier === "basic") return 1;
  return null;
}

function findValueByExactKeys(root, keys) {
  const wanted = new Set((keys || []).map(k => String(k || "").toLowerCase()));
  if (!wanted.size) return null;
  const seen = new Set();
  const queue = [root];

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(v => queue.push(v));
      continue;
    }

    for (const [k, v] of Object.entries(node)) {
      const key = String(k || "").toLowerCase();
      if (wanted.has(key) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        return String(v);
      }
      if (v !== null && v !== undefined) {
        if (typeof v === "object") {
          queue.push(v);
        }
      }
    }
  }

  return null;
}

function extractTierInfo(result, fallbackTier = null, fallbackTierRank = null) {
  const root = result || {};
  const rawTier        = findValueByExactKeys(root, ["tier"]);
  const rawTierRank    = findValueByExactKeys(root, ["tierRank", "tier_rank"]);
  const rawVariantName = findValueByExactKeys(root, [
    "variant_name", "variantName", "benefitName", "benefit_name",
  ]);

  let tier = normalizeTierName(rawTier);
  let tierRank = parseRank(rawTierRank);

  // Tier is primary; variant name is the explicit fallback when tier is absent.
  if (!tier) tier = normalizeTierName(rawVariantName);

  if (!tier && tierRank) {
    if (tierRank >= 3) tier = "advanced";
    else if (tierRank >= 2) tier = "pro";
    else if (tierRank >= 1) tier = "basic";
  }
  if (!tier && fallbackTier) tier = normalizeTierName(fallbackTier);
  if (!tierRank) tierRank = parseRank(fallbackTierRank);
  if (!tierRank) tierRank = normalizeTierRank(tier, null);

  return { tier, tierRank };
}

// =========================================================
//  STORAGE HELPERS  (plugin private data folder)
// =========================================================

export async function loadLicenseData() {
  try {
    const folder  = await storage.localFileSystem.getDataFolder();
    const entries = await folder.getEntries();
    const file    = entries.find(e => e.name === LICENSE_FILE_NAME);
    if (!file) return null;
    const content = await file.read({ format: storage.formats.utf8 });
    return JSON.parse(content);
  } catch (e) {
    console.error("License load error:", e);
    return null;
  }
}

async function saveLicenseData(data) {
  const folder = await storage.localFileSystem.getDataFolder();
  const file   = await folder.createEntry(LICENSE_FILE_NAME, {
    type: storage.types.file,
    overwrite: true,
  });
  await file.write(JSON.stringify(data), { format: storage.formats.utf8 });
}

async function clearLicenseData() {
  try {
    const folder  = await storage.localFileSystem.getDataFolder();
    const entries = await folder.getEntries();
    const file    = entries.find(e => e.name === LICENSE_FILE_NAME);
    if (file) await file.delete();
  } catch (e) {
    console.error("License clear error:", e);
  }
}

// =========================================================
//  INSTANCE NAME
// =========================================================

function computeInstanceName() {
  try {
    return "Photoshop on " + os.hostname();
  } catch (e) {
    return "Photoshop on Unknown";
  }
}

// =========================================================
//  MACHINE FINGERPRINT (for trial anti-abuse)
// =========================================================

export function computeMachineFingerprint() {
  try {
    const hn = os.hostname() || "unknown";
    // Simple stable hash of the hostname
    let h = 0x811c9dc5;
    for (let i = 0; i < hn.length; i++) {
      h ^= hn.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return hn.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "_") + "_" + h.toString(16).padStart(8, "0");
  } catch (_) {
    return "unknown_00000000";
  }
}

// Ask the CF Worker for the canonical trial start date for this machine.
// Returns { trialStartedAt: number } or null (e.g. network error / not yet registered).
export async function fetchTrialAnchor(fingerprint) {
  try {
    const result = await workerPost("/v1/trial/anchor", { fingerprint });
    if (result && typeof result.trialStartedAt === "number") {
      return { trialStartedAt: result.trialStartedAt };
    }
    return null;
  } catch (_) {
    return null; // offline or server error — fall back to local data
  }
}

// Register a new trial start date with the server (only called once per machine).
// Returns { trialStartedAt: number } with the server-canonical value.
export async function registerTrialAnchor(fingerprint, trialStartedAt) {
  try {
    const result = await workerPost("/v1/trial/register", { fingerprint, trialStartedAt });
    if (result && typeof result.trialStartedAt === "number") {
      return { trialStartedAt: result.trialStartedAt };
    }
    return null;
  } catch (_) {
    return null;
  }
}


// =========================================================
//  WORKER FETCH HELPER
// =========================================================

async function workerPost(path, body) {
  const payload = body && typeof body === "object" ? body : {};
  const resp = await fetch(WORKER_BASE_URL + path, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-app-secret": APP_SHARED_SECRET,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Worker HTTP " + resp.status + ": " + text);
  }
  return resp.json();
}

// =========================================================
//  OFFLINE GRACE
// =========================================================

export function computeOfflineGraceRemaining(data) {
  if (!data || !data.validatedAt) return null;
  const graceSeconds = data.offlineGraceSeconds || FALLBACK_GRACE_SECONDS;
  const elapsed      = (Date.now() - data.validatedAt) / 1000;
  return Math.max(0, graceSeconds - elapsed);
}

// =========================================================
//  ACTIVATE
// =========================================================

export async function activateLicense(licenseKey) {
  if (!licenseKey || !licenseKey.trim()) {
    return { ok: false, error: "Please enter a license key." };
  }
  try {
    const instanceName = computeInstanceName();
    logLicenseDebug("activate:request", {
      instanceName,
      licenseKey: maskLicenseKeyForDebug(licenseKey),
    });
    const result = await workerPost("/v1/license/activate", {
      licenseKey: licenseKey.trim(),
      instanceName,
    });
    const ok = result.activated === true || result.ok === true;
    const tierInfo = extractTierInfo(result);
    logLicenseDebug("activate:response", {
      ok,
      result: summarizeLicenseResultForDebug(result),
      extractedTier: tierInfo,
    });
    if (ok) {
      const data = {
        licenseKey:           licenseKey.trim(),
        instanceId:           result.instanceId || (result.instance && result.instance.id) || null,
        tier:                 tierInfo.tier || null,
        tierRank:             tierInfo.tierRank,
        benefitId:            result.benefitId   || null,
        benefitName:          result.benefitName  || null,
        status:               result.status      || "active",
        validatedAt:          Date.now(),
        offlineGraceSeconds:  result.offlineGraceSeconds || FALLBACK_GRACE_SECONDS,
        lastValidationFailedAt: null,
      };
      await saveLicenseData(data);
      logLicenseDebug("activate:saved-license-data", {
        tier: data.tier,
        tierRank: data.tierRank,
        status: data.status,
        instanceId: data.instanceId,
      });
      return { ok: true, data };
    }
    const existing = await loadLicenseData();
    logLicenseDebug("activate:failed-no-save", {
      error: result.error || result.message || "Activation failed.",
      existingStoredTier: existing ? existing.tier : null,
      existingStoredTierRank: existing ? existing.tierRank : null,
      existingStoredStatus: existing ? existing.status : null,
    });
    return { ok: false, error: result.error || result.message || "Activation failed." };
  } catch (e) {
    logLicenseDebug("activate:exception", { error: e.message });
    return { ok: false, error: e.message };
  }
}

// =========================================================
//  VALIDATE
// =========================================================

export async function validateLicense() {
  const data = await loadLicenseData();
  if (!data || !data.licenseKey) {
    return { ok: false, error: "No license stored. Please activate first." };
  }
  try {
    logLicenseDebug("validate:request", {
      licenseKey: maskLicenseKeyForDebug(data.licenseKey),
      instanceId: data.instanceId || null,
      existingTier: data.tier || null,
      existingTierRank: data.tierRank || null,
      existingStatus: data.status || null,
    });
    const body = { licenseKey: data.licenseKey };
    if (data.instanceId) body.instanceId = data.instanceId;
    const result = await workerPost("/v1/license/validate", body);
    const ok = result.valid === true || result.ok === true;
    const tierInfo = extractTierInfo(
      result,
      data.tier !== undefined ? data.tier : null,
      data.tierRank !== undefined ? data.tierRank : null
    );
    logLicenseDebug("validate:response", {
      ok,
      result: summarizeLicenseResultForDebug(result),
      extractedTier: tierInfo,
    });
    if (ok) {
      const updated = {
        ...data,
        tier:                tierInfo.tier !== null ? tierInfo.tier : data.tier,
        tierRank:            tierInfo.tierRank,
        benefitId:           result.benefitId   || data.benefitId   || null,
        benefitName:         result.benefitName  || data.benefitName  || null,
        status:              result.status   || data.status,
        validatedAt:         Date.now(),
        offlineGraceSeconds: result.offlineGraceSeconds || data.offlineGraceSeconds,
        lastValidationFailedAt: null,
      };
      await saveLicenseData(updated);
      logLicenseDebug("validate:saved-license-data", {
        tier: updated.tier,
        tierRank: updated.tierRank,
        status: updated.status,
        lastValidationFailedAt: updated.lastValidationFailedAt,
      });
      return { ok: true, data: updated };
    }
    logLicenseDebug("validate:failed-no-save", {
      error: result.error || result.message || "Validation failed.",
      existingTier: data.tier || null,
      existingTierRank: data.tierRank || null,
      existingStatus: data.status || null,
    });
    return { ok: false, error: result.error || result.message || "Validation failed." };
  } catch (e) {
    try {
      const updated = { ...data, lastValidationFailedAt: Date.now() };
      await saveLicenseData(updated);
      logLicenseDebug("validate:offline-grace-updated", {
        tier: updated.tier || null,
        tierRank: updated.tierRank || null,
        status: updated.status || null,
        lastValidationFailedAt: updated.lastValidationFailedAt,
      });
    } catch (_) {}
    logLicenseDebug("validate:exception", { error: e.message });
    return { ok: false, error: e.message, offline: true };
  }
}

// =========================================================
//  DEACTIVATE
// =========================================================

export async function deactivateLicense() {
  const data = await loadLicenseData();
  if (!data || !data.licenseKey) {
    return { ok: false, error: "No license active." };
  }
  try {
    const body = { licenseKey: data.licenseKey };
    if (data.instanceId) body.instanceId = data.instanceId;
    const result = await workerPost("/v1/license/deactivate", body);
    const ok = result.deactivated === true || result.ok === true;
    if (ok) {
      await clearLicenseData();
      return { ok: true };
    }
    return { ok: false, error: result.error || result.message || "Deactivation failed." };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
