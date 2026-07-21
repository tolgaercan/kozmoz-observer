/**
 * Portal dropdown etiketleri → API ID eşlemesi.
 * Kaynak: portal HTML + DevTools Network (GetClosedDate, il listesi API).
 */

export const APPLICATION_TYPE_IDS: Record<string, string> = {
  Bireysel: "1",
  Aile: "2",
};

/**
 * Başvuru şekli — select[name='appointmentTypeId']
 * GetClosedDate için zorunlu; 4 tipin tamamı portal HTML'den doğrulandı.
 */
export const APPOINTMENT_STYLE_IDS: Record<string, string> = {
  Standart: "16",
  Vip: "18",
  "EEA AB Eşi": "2339",
  "Business Trip": "2472",
};

export const APPOINTMENT_STYLE_OPTIONS = [
  { label: "Standart", appointmentTypeId: "16" },
  { label: "Vip", appointmentTypeId: "18" },
  { label: "EEA AB Eşi", appointmentTypeId: "2339" },
  { label: "Business Trip", appointmentTypeId: "2472" },
] as const;

/** applicationTypeId yalnızca GetAppointmentHourQoutaInfo için — GetClosedDate kullanmaz */
export const APPLICATION_TYPE_OPTIONS = [
  { label: "Bireysel", applicationTypeId: "1" },
  { label: "Aile", applicationTypeId: "2" },
] as const;

export type DealerOfficeKind = "merkez" | "sube";

export interface DealerOffice {
  name: string;
  dealerId: string;
  centerDealerId: string;
  kind: DealerOfficeKind;
}

/**
 * 16 fiziksel başvuru noktası — GetClosedDate dealerId.
 * İl dropdown'ı (~80 il) değil; harita pini / Merkez-Şube butonu.
 */
export const DEALER_OFFICES: readonly DealerOffice[] = [
  { name: "İstanbul", dealerId: "1", centerDealerId: "1", kind: "merkez" },
  { name: "Trabzon", dealerId: "3", centerDealerId: "1", kind: "merkez" },
  { name: "Bursa", dealerId: "4", centerDealerId: "1", kind: "merkez" },
  { name: "Çanakkale", dealerId: "1021", centerDealerId: "1", kind: "merkez" },
  { name: "İzmir", dealerId: "5", centerDealerId: "5", kind: "merkez" },
  { name: "Ayvalık", dealerId: "6", centerDealerId: "5", kind: "sube" },
  { name: "Bodrum", dealerId: "8", centerDealerId: "5", kind: "sube" },
  { name: "Marmaris", dealerId: "9", centerDealerId: "5", kind: "sube" },
  { name: "Antalya", dealerId: "10", centerDealerId: "5", kind: "sube" },
  { name: "Kuşadası", dealerId: "1013", centerDealerId: "5", kind: "sube" },
  { name: "Fethiye", dealerId: "1019", centerDealerId: "5", kind: "sube" },
  { name: "Ankara", dealerId: "1014", centerDealerId: "1014", kind: "merkez" },
  { name: "Gaziantep", dealerId: "1015", centerDealerId: "1014", kind: "sube" },
  { name: "Edirne", dealerId: "1017", centerDealerId: "1017", kind: "merkez" },
  { name: "Çorlu", dealerId: "1018", centerDealerId: "1017", kind: "sube" },
  { name: "Kırklareli", dealerId: "1020", centerDealerId: "1017", kind: "merkez" },
] as const;

/** Ofis adı → dealerId (GetClosedDate) */
export const API_DEALER_IDS: Record<string, string> = Object.fromEntries(
  DEALER_OFFICES.map((office) => [office.name, office.dealerId]),
);

/** Geriye dönük alias — İstanbul */
API_DEALER_IDS.Istanbul = "1";

export interface AppointmentProvince {
  id: string;
  name: string;
  centerDealerId: string;
}

/**
 * İkamet ili listesi — wizard #cities / il API yanıtı.
 * centerDealerId: yetki alanı (frontend Merkez/Şube butonlarını filtreler).
 */
export const APPOINTMENT_PROVINCES: readonly AppointmentProvince[] = [
  { id: "47", name: "Adana", centerDealerId: "1014" },
  { id: "48", name: "Adıyaman", centerDealerId: "1014" },
  { id: "29", name: "Afyon", centerDealerId: "5" },
  { id: "49", name: "Agrı", centerDealerId: "1014" },
  { id: "50", name: "Aksaray", centerDealerId: "1014" },
  { id: "51", name: "Amasya", centerDealerId: "1014" },
  { id: "44", name: "Ankara", centerDealerId: "1014" },
  { id: "30", name: "Antalya", centerDealerId: "5" },
  { id: "52", name: "Ardahan", centerDealerId: "1014" },
  { id: "7", name: "Artvin", centerDealerId: "1" },
  { id: "31", name: "Aydın", centerDealerId: "5" },
  { id: "32", name: "Balıkesir", centerDealerId: "5" },
  { id: "8", name: "Bartin", centerDealerId: "1" },
  { id: "53", name: "Batman", centerDealerId: "1014" },
  { id: "9", name: "Bayburt", centerDealerId: "1" },
  { id: "54", name: "Bilecik", centerDealerId: "1014" },
  { id: "55", name: "Bingöl", centerDealerId: "1014" },
  { id: "56", name: "Bitlis", centerDealerId: "1014" },
  { id: "10", name: "Bolu", centerDealerId: "1" },
  { id: "33", name: "Burdur", centerDealerId: "5" },
  { id: "28", name: "Bursa", centerDealerId: "1" },
  { id: "11", name: "Canakkale", centerDealerId: "1" },
  { id: "57", name: "Cankiri", centerDealerId: "1014" },
  { id: "58", name: "Corum", centerDealerId: "1014" },
  { id: "34", name: "Denizli", centerDealerId: "5" },
  { id: "27", name: "Diğer", centerDealerId: "1" },
  { id: "45", name: "Diğer", centerDealerId: "5" },
  { id: "46", name: "Diğer", centerDealerId: "1014" },
  { id: "98", name: "Diğer", centerDealerId: "1017" },
  { id: "59", name: "Diyarbakir", centerDealerId: "1014" },
  { id: "12", name: "Duzce", centerDealerId: "1" },
  { id: "95", name: "Edirne", centerDealerId: "1017" },
  { id: "61", name: "Elazig", centerDealerId: "1014" },
  { id: "62", name: "Erzincan", centerDealerId: "1014" },
  { id: "63", name: "Erzurum", centerDealerId: "1014" },
  { id: "64", name: "Eskisehir", centerDealerId: "1014" },
  { id: "65", name: "Gaziantep", centerDealerId: "1014" },
  { id: "13", name: "Giresun", centerDealerId: "1" },
  { id: "67", name: "Gümüshane", centerDealerId: "1" },
  { id: "68", name: "Hakkari", centerDealerId: "1014" },
  { id: "69", name: "Hatay", centerDealerId: "1014" },
  { id: "70", name: "Igdir", centerDealerId: "1014" },
  { id: "35", name: "Isparta", centerDealerId: "5" },
  { id: "2", name: "Istanbul", centerDealerId: "1" },
  { id: "43", name: "Izmir", centerDealerId: "5" },
  { id: "71", name: "Kahramanmaras", centerDealerId: "1014" },
  { id: "16", name: "Karabuk", centerDealerId: "1" },
  { id: "72", name: "Karaman", centerDealerId: "1014" },
  { id: "73", name: "Kars", centerDealerId: "1014" },
  { id: "17", name: "Kastamonu", centerDealerId: "1" },
  { id: "74", name: "Kayseri", centerDealerId: "1014" },
  { id: "96", name: "Kırklareli", centerDealerId: "1017" },
  { id: "77", name: "Kilis", centerDealerId: "1014" },
  { id: "75", name: "Kirikkale", centerDealerId: "1014" },
  { id: "76", name: "Kirsehir", centerDealerId: "1014" },
  { id: "18", name: "Kocaeli", centerDealerId: "1" },
  { id: "78", name: "Konya", centerDealerId: "1014" },
  { id: "36", name: "Kutahya", centerDealerId: "5" },
  { id: "79", name: "Malatya", centerDealerId: "1014" },
  { id: "37", name: "Manisa", centerDealerId: "5" },
  { id: "80", name: "Mardin", centerDealerId: "1014" },
  { id: "81", name: "Mersin", centerDealerId: "1014" },
  { id: "38", name: "Mugla", centerDealerId: "5" },
  { id: "82", name: "Mus", centerDealerId: "1014" },
  { id: "83", name: "Nevsehir", centerDealerId: "1014" },
  { id: "84", name: "Nigde", centerDealerId: "1014" },
  { id: "19", name: "Ordu", centerDealerId: "1" },
  { id: "85", name: "Osmaniye", centerDealerId: "1014" },
  { id: "20", name: "Rize", centerDealerId: "1" },
  { id: "21", name: "Sakarya", centerDealerId: "1" },
  { id: "22", name: "Samsun", centerDealerId: "1" },
  { id: "88", name: "Sanliurfa", centerDealerId: "1014" },
  { id: "86", name: "Siirt", centerDealerId: "1014" },
  { id: "23", name: "Sinop", centerDealerId: "1" },
  { id: "89", name: "Sirnak", centerDealerId: "1014" },
  { id: "87", name: "Sivas", centerDealerId: "1014" },
  { id: "97", name: "Tekirdag", centerDealerId: "1017" },
  { id: "90", name: "Tokat", centerDealerId: "1014" },
  { id: "24", name: "Trabzon", centerDealerId: "1" },
  { id: "91", name: "Tunceli", centerDealerId: "1014" },
  { id: "39", name: "Usak", centerDealerId: "5" },
  { id: "92", name: "Van", centerDealerId: "1014" },
  { id: "25", name: "Yalova", centerDealerId: "1" },
  { id: "93", name: "Yozgat", centerDealerId: "1014" },
  { id: "26", name: "Zonguldak", centerDealerId: "1" },
] as const;

/** İkamet ili adı → appointment cityId (HourQuota / eski endpoint) */
export const API_APPOINTMENT_CITY_IDS: Record<string, string> = Object.fromEntries(
  APPOINTMENT_PROVINCES.map((province) => [province.name, province.id]),
);
API_APPOINTMENT_CITY_IDS.Istanbul = "2";
API_APPOINTMENT_CITY_IDS.İstanbul = "2";

export function normalizePortalLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\r/g, "");
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
  const lower = normalized.toLocaleLowerCase("tr-TR");
  for (const [key, id] of Object.entries(catalog)) {
    if (key.toLocaleLowerCase("tr-TR") === lower) {
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

export function listDealerOffices(centerDealerId?: string): DealerOffice[] {
  if (!centerDealerId?.trim()) {
    return [...DEALER_OFFICES];
  }
  return DEALER_OFFICES.filter((office) => office.centerDealerId === centerDealerId.trim());
}

export function findDealerOfficeById(dealerId: string): DealerOffice | undefined {
  return DEALER_OFFICES.find((office) => office.dealerId === dealerId.trim());
}

/** appointmentTypeId → başvuru şekli etiketi (örn. 2339 → EEA AB Eşi) */
export function findAppointmentStyleByTypeId(typeId: string): string | undefined {
  const normalized = typeId.trim();
  for (const [label, id] of Object.entries(APPOINTMENT_STYLE_IDS)) {
    if (id === normalized) {
      return label;
    }
  }
  return undefined;
}

/** Panel / env etiketinden appointmentTypeId — lookup başarısız olursa undefined */
export function resolveAppointmentTypeIdFromLabel(label: string | undefined): string | undefined {
  return lookupId(APPOINTMENT_STYLE_IDS, label);
}

export function findDealerOfficeByName(name: string): DealerOffice | undefined {
  const id = lookupId(API_DEALER_IDS, name);
  if (!id) {
    return undefined;
  }
  return findDealerOfficeById(id);
}

export function findAppointmentProvince(label: string): AppointmentProvince | undefined {
  const normalized = normalizePortalLabel(label).toLocaleLowerCase("tr-TR");
  return APPOINTMENT_PROVINCES.find(
    (province) => province.name.toLocaleLowerCase("tr-TR") === normalized,
  );
}

export function resolveProvinceCenterDealerId(provinceLabel: string): string | undefined {
  return findAppointmentProvince(provinceLabel)?.centerDealerId;
}
