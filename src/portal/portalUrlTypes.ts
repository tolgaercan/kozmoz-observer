/**
 * Portal URL deposu — profil başına email/ davet linkleri.
 * İleride UI bu dosyayı okuyup yazar (format: data/portal-urls/urls.json).
 */

export type PortalUrlType = "register-form" | "portal-home" | "appointment" | "other";

export type PortalUrlStatus = "active" | "used" | "expired";

export interface PortalUrlEntry {
  /** Benzersiz kayıt id — örn. profile-1-register-001 */
  id: string;
  /** Manifest profil id — örn. profile-1 */
  profileId: string;
  type: PortalUrlType;
  label?: string;
  /** Email tracking / redirect linki (AWS awstrack vb.) */
  trackingUrl?: string;
  /** Doğrudan portal adresi — tercih edilen */
  portalUrl?: string;
  /** registerform?guid=… değeri */
  guid?: string;
  status: PortalUrlStatus;
  note?: string;
  createdAt?: string;
  expiresAt?: string | null;
  usedAt?: string | null;
}

export interface PortalUrlStore {
  version: number;
  urls: PortalUrlEntry[];
}

export interface ResolvePortalUrlOptions {
  profileId: string;
  /** Belirli kayıt; yoksa profileId için active olan son kayıt */
  urlId?: string;
  /** goto için hangi URL kullanılsın */
  prefer?: "portal" | "tracking";
  type?: PortalUrlType;
}

export interface ResolvedPortalUrl {
  entry: PortalUrlEntry;
  /** Playwright page.goto hedefi */
  gotoUrl: string;
  source: "portalUrl" | "trackingUrl" | "tracking-decoded";
}
