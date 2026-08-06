/** Türkiye şehirleri — applicantCityId (portal HTML, tam liste) */
export const APPLICANT_CITY_OPTIONS = [
  { value: "47", label: "Adana" },
  { value: "48", label: "Adıyaman" },
  { value: "29", label: "Afyon" },
  { value: "49", label: "Agrı" },
  { value: "50", label: "Aksaray" },
  { value: "51", label: "Amasya" },
  { value: "44", label: "Ankara" },
  { value: "30", label: "Antalya" },
  { value: "52", label: "Ardahan" },
  { value: "7", label: "Artvin" },
  { value: "31", label: "Aydın" },
  { value: "32", label: "Balıkesir" },
  { value: "8", label: "Bartin" },
  { value: "53", label: "Batman" },
  { value: "9", label: "Bayburt" },
  { value: "54", label: "Bilecik" },
  { value: "55", label: "Bingöl" },
  { value: "56", label: "Bitlis" },
  { value: "10", label: "Bolu" },
  { value: "33", label: "Burdur" },
  { value: "28", label: "Bursa" },
  { value: "11", label: "Canakkale" },
  { value: "57", label: "Cankiri" },
  { value: "58", label: "Corum" },
  { value: "34", label: "Denizli" },
  { value: "27", label: "Diğer" },
  { value: "45", label: "Diğer" },
  { value: "46", label: "Diğer" },
  { value: "98", label: "Diğer" },
  { value: "59", label: "Diyarbakir" },
  { value: "12", label: "Duzce" },
  { value: "95", label: "Edirne" },
  { value: "61", label: "Elazig" },
  { value: "62", label: "Erzincan" },
  { value: "63", label: "Erzurum" },
  { value: "64", label: "Eskisehir" },
  { value: "65", label: "Gaziantep" },
  { value: "13", label: "Giresun" },
  { value: "67", label: "Gümüshane" },
  { value: "68", label: "Hakkari" },
  { value: "69", label: "Hatay" },
  { value: "70", label: "Igdir" },
  { value: "35", label: "Isparta" },
  { value: "2", label: "Istanbul" },
  { value: "43", label: "Izmir" },
  { value: "71", label: "Kahramanmaras" },
  { value: "16", label: "Karabuk" },
  { value: "72", label: "Karaman" },
  { value: "73", label: "Kars" },
  { value: "17", label: "Kastamonu" },
  { value: "74", label: "Kayseri" },
  { value: "96", label: "Kırklareli" },
  { value: "77", label: "Kilis" },
  { value: "75", label: "Kirikkale" },
  { value: "76", label: "Kirsehir" },
  { value: "18", label: "Kocaeli" },
  { value: "78", label: "Konya" },
  { value: "36", label: "Kutahya" },
  { value: "79", label: "Malatya" },
  { value: "37", label: "Manisa" },
  { value: "80", label: "Mardin" },
  { value: "81", label: "Mersin" },
  { value: "38", label: "Mugla" },
  { value: "82", label: "Mus" },
  { value: "83", label: "Nevsehir" },
  { value: "84", label: "Nigde" },
  { value: "19", label: "Ordu" },
  { value: "85", label: "Osmaniye" },
  { value: "20", label: "Rize" },
  { value: "21", label: "Sakarya" },
  { value: "22", label: "Samsun" },
  { value: "88", label: "Sanliurfa" },
  { value: "86", label: "Siirt" },
  { value: "23", label: "Sinop" },
  { value: "89", label: "Sirnak" },
  { value: "87", label: "Sivas" },
  { value: "97", label: "Tekirdag" },
  { value: "90", label: "Tokat" },
  { value: "24", label: "Trabzon" },
  { value: "91", label: "Tunceli" },
  { value: "39", label: "Usak" },
  { value: "92", label: "Van" },
  { value: "25", label: "Yalova" },
  { value: "93", label: "Yozgat" },
  { value: "26", label: "Zonguldak" },
] as const;

export type ResidenceAbroadChoice = "hayir" | "evet";

export function parseResidenceAbroadEnv(raw: string): ResidenceAbroadChoice {
  const normalized = raw.trim().toLocaleLowerCase("tr-TR");
  if (
    ["evet", "yes", "true", "1", "var"].includes(normalized) ||
    normalized.startsWith("evet")
  ) {
    return "evet";
  }
  return "hayir";
}

/** Başında 0 olmadan — yalnızca rakamlar */
export function normalizeRegisterPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

/** Çiftçi — ek firma alanı gerektirmez (şimdilik varsayılan meslek) */
export const DEFAULT_REGISTER_JOB_VALUE = "375";
export const DEFAULT_REGISTER_JOB_LABEL = "Ciftci";

/** Şu Anki Mesleğiniz — jobId (portal HTML, tam liste) */
export const JOB_OPTIONS = [
  { value: "375", label: "Ciftci" },
  { value: "376", label: "Mimar, ic Mimar" },
  { value: "377", label: "Zanaatkar" },
  { value: "378", label: "Avukat, Hakim, Hukuk Danışmanı" },
  { value: "379", label: "Sanatci" },
  { value: "380", label: "Bankacı" },
  { value: "381", label: "Esnaf" },
  { value: "382", label: "Menajer" },
  { value: "383", label: "Dini lider" },
  { value: "384", label: "Sofor, Kamyon surucusu" },
  { value: "385", label: "Bilimsel Arastirmaci" },
  { value: "386", label: "Ogretmen" },
  { value: "387", label: "Beyaz Yakali Calisan" },
  { value: "388", label: "Memur" },
  { value: "389", label: "Politikacı" },
  { value: "390", label: "Bilgisayar Uzmanı, Muhendisi" },
  { value: "391", label: "Elektronik Uzmani, Muhendisi" },
  { value: "392", label: "Kimyager, Kimya Muhendisi" },
  { value: "393", label: "Diger, Teknisyen" },
  { value: "394", label: "Gazeteci" },
  {
    value: "395",
    label: "Medikal ve Paramedikal meslek (doktor, cerrah, hemsire, veteriner)",
  },
  { value: "396", label: "Denizci" },
  { value: "397", label: "Mavi Yakali calisan" },
  { value: "398", label: "Serbest Meslek" },
  { value: "399", label: "Modaci, Kozmetikci" },
  { value: "400", label: "Polis, Asker" },
  { value: "401", label: "Emekli" },
  { value: "402", label: "Profesyonel Sporcu" },
  { value: "403", label: "Issiz" },
  { value: "404", label: "Ogrenci, Stajyer" },
  { value: "405", label: "Diplomat" },
  {
    value: "406",
    label: "Idari, teknik ve hizmet personeli (dipl.and konsolosluk)",
  },
  { value: "407", label: "Diplomat ozel hizmetkari" },
  { value: "408", label: "Yargic" },
  { value: "409", label: "Sirket yoneticisi" },
  { value: "410", label: "Diger" },
  { value: "411", label: "Uygulanamaz (0-6 yaş bebek)" },
] as const;

/** Seyahat amacı — traveltype (option value = etiket metni) */
export const TRAVEL_TYPE_OPTIONS = [
  { value: "Turistik", label: "Turistik" },
  { value: "İş", label: "İş" },
  { value: "Aile Veya Arkadaş Ziyareti", label: "Aile Veya Arkadaş Ziyareti" },
  { value: "Kültürel", label: "Kültürel" },
  { value: "Resmi Ziyaret", label: "Resmi Ziyaret" },
  { value: "Sportif", label: "Sportif" },
  { value: "Sağlık", label: "Sağlık" },
  { value: "Eğitim", label: "Eğitim" },
  { value: "Transit", label: "Transit" },
  { value: "Diğer", label: "Diğer" },
] as const;

/** Schengen üye ülkeleri — schDestinationCountryId / schFirstEntryCountryId */
export const SCHENGEN_COUNTRY_OPTIONS = [
  { value: "537", label: "Greece" },
  { value: "447", label: "Austria" },
  { value: "450", label: "Belgium" },
  { value: "475", label: "Switzerland" },
  { value: "496", label: "Czech Republic" },
  { value: "498", label: "Germany" },
  { value: "503", label: "Denmark" },
  { value: "510", label: "Spain" },
  { value: "511", label: "Estonia" },
  { value: "513", label: "Finland" },
  { value: "516", label: "France" },
  { value: "549", label: "Hungary" },
  { value: "558", label: "Iceland" },
  { value: "560", label: "Italy" },
  { value: "578", label: "Liechtenstein" },
  { value: "581", label: "Lithuani" },
  { value: "582", label: "Luxembourg" },
  { value: "583", label: "Latvia" },
  { value: "595", label: "Malta" },
  { value: "617", label: "Netherlands" },
  { value: "618", label: "Norway" },
  { value: "633", label: "Poland" },
  { value: "636", label: "Portugal" },
  { value: "666", label: "Slovakia" },
  { value: "667", label: "Slovenia" },
  { value: "668", label: "Sweden" },
] as const;

/** Talep edilen giriş sayısı — visaEntryTypeId */
export const VISA_ENTRY_TYPE_OPTIONS = [
  { value: "56", label: "Tek Giriş" },
  { value: "57", label: "Çift Giriş" },
  { value: "58", label: "Çoklu Giriş" },
] as const;

export type SchengenFingerprintValue = "ParmakiziAlinmadi" | "ParmakiziAlindi";

export function parseSchengenFingerprintEnv(raw: string): SchengenFingerprintValue {
  const normalized = raw.trim().toLocaleLowerCase("tr-TR");
  if (
    ["evet", "yes", "true", "1", "parmakizialindi", "parmakizi alindi"].includes(normalized) ||
    normalized.startsWith("evet")
  ) {
    return "ParmakiziAlindi";
  }
  return "ParmakiziAlinmadi";
}

export type ExpensesCoveredByValue = "gecimMasraflariHayir" | "gecimMasraflariEvet";
export type SponsorInfoValue = "3132" | "baskasiTarafindan";

export function parseExpensesCoveredByEnv(raw: string): ExpensesCoveredByValue {
  const trimmed = raw.trim();
  if (trimmed === "gecimMasraflariEvet" || trimmed === "gecimMasraflariHayir") {
    return trimmed;
  }
  const normalized = trimmed.toLocaleLowerCase("tr-TR");
  if (
    [
      "sponsor",
      "evet",
      "gecimmasraflarievet",
      "true",
      "1",
    ].includes(normalized) ||
    normalized.includes("sponsor")
  ) {
    return "gecimMasraflariEvet";
  }
  return "gecimMasraflariHayir";
}

export function parseSponsorInfoEnv(raw: string): SponsorInfoValue {
  const normalized = raw.trim().toLocaleLowerCase("tr-TR");
  if (
    ["baskasi", "baskasitarafindan", "other", "3132-degil"].includes(normalized) ||
    normalized.includes("başka") ||
    normalized.includes("baska")
  ) {
    return "baskasiTarafindan";
  }
  return "3132";
}

/** Masraflarının karşılanma şekli — checkbox value listesi */
export const LIVING_COST_OPTIONS = [
  "Nakit",
  "Seyahat Çeki",
  "Kredi Kartı",
  "Önceden Ödenmiş Konaklama",
  "Önceden Ödenmiş Ulaşım",
  "Diğer Belirtilmelidir",
] as const;

export function parseLivingCostsEnv(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
