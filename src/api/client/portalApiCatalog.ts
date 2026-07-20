/**
 * Portal dropdown etiketleri → API ID eşlemesi.
 * Kaynak: portal HTML + DevTools Network (GetClosedDate).
 */

export const APPLICATION_TYPE_IDS: Record<string, string> = {
  Bireysel: "1",
  Aile: "2",
};

/** Başvuru şekli — select[name='appointmentTypeId'] */
export const APPOINTMENT_STYLE_IDS: Record<string, string> = {
  Standart: "16",
  Vip: "18",
  "EEA AB Eşi": "2339",
  "Business Trip": "2472",
};

/**
 * GetClosedDate — dealerId (portal Network sekmesi).
 * Ankara EEA wizard: dealerId=1014, appointmentTypeId=2339
 */
export const API_DEALER_IDS: Record<string, string> = {
  Ankara: "1014",
};

/** Eski/alternatif endpoint — cityId=1 (Ankara) hâlâ yanıt verebilir ama EEA için dealerId kullanılmalı */
export const API_APPOINTMENT_CITY_IDS: Record<string, string> = {
  Ankara: "1",
};

export function normalizePortalLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function lookupId(
  catalog: Record<string, string>,
  label: string | undefined,
): string | undefined {
  if (!label?.trim()) {
    return undefined;
  }
  const normalized = normalizePortalLabel(label);
  if (catalog[normalized]) {
    return catalog[normalized];
  }
  const lower = normalized.toLowerCase();
  for (const [key, id] of Object.entries(catalog)) {
    if (key.toLowerCase() === lower) {
      return id;
    }
  }
  return undefined;
}

/** Doğrudan sayısal ID veya etiket kabul eder */
export function resolveCatalogId(
  catalog: Record<string, string>,
  raw: string | undefined,
  fallbackId?: string,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallbackId;
  }
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return lookupId(catalog, trimmed) ?? fallbackId;
}
