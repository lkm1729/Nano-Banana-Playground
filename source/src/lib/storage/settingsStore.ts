import type { ConnectionSettings } from "../../domain/generation";

const SETTINGS_KEY = "nano-banana.settings.v2";

export const DEFAULT_SETTINGS: ConnectionSettings = {
  protocol: "gemini-native",
  baseUrl: "",
  apiKey: "",
  model: "gemini-3.1-flash-image",
};

const normalizeSettings = (stored?: Partial<ConnectionSettings> | null, migrateLegacyBaseUrl = false): ConnectionSettings => {
  const storedBaseUrl = String(stored?.baseUrl || "").trim();
    const migratedBaseUrl = migrateLegacyBaseUrl && /(?:^|\.)a6api\.com(?:$|\/)/i.test(storedBaseUrl) ? "" : storedBaseUrl;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    baseUrl: migratedBaseUrl,
    apiKey: String(stored?.apiKey || ""),
  };
};

const loadLegacySettings = (): ConnectionSettings | null => {
  const serialized = window.localStorage.getItem(SETTINGS_KEY);
  if (!serialized) return null;
  try {
    return normalizeSettings(JSON.parse(serialized) as Partial<ConnectionSettings>, true);
  } catch {
    return null;
  }
};

export const loadSettings = async (): Promise<ConnectionSettings> => {
  try {
    const stored = await window.nanoBanana?.loadSettings();
    if (stored) return normalizeSettings(stored);
  } catch {
    // Fall back to browser storage during local web development.
  }

  return loadLegacySettings() || DEFAULT_SETTINGS;
};

export const saveSettings = async (settings: ConnectionSettings): Promise<void> => {
  const normalized = normalizeSettings(settings);
  if (window.nanoBanana?.saveSettings) {
    await window.nanoBanana.saveSettings(normalized);
    return;
  }

  // Browser-only fallback; Electron persists the API key through safeStorage.
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
};