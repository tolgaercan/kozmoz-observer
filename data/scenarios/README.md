# Senaryolar

Her JSON dosyası bir **tarif**: hangi adımlar sırayla çalışacak.

## Senaryo sırası (plan)

| # | id | Durum | Açıklama |
|---|-----|--------|----------|
| 1 | `fresh-chrome-login` | active | Temiz Chrome + Google girişi |
| 2 | `fresh-chrome-login-register` | active | + kayıt wizard Adım 1–9 |
| 3 | `fresh-chrome-login-register-observe` | experimental | + observer — **OTP yok, şu an çalışmaz** |
| 4 | `url-login-observe` | **active (ana)** | Davet URL → OTP stub → **Randevu İşlemleri** → observer (**banSafe**, kayıt YOK) |

Mimari (supervisor, paralel, lifecycle) bitince **3. senaryo** da devreye alınacak.

## Ne nerede?

| Yer | Rol |
|-----|-----|
| `data/scenarios/*.json` | Tarif (adım listesi) |
| `src/scenarios/phases/` | Her adımın kodu |
| `src/scenarios/scenarioRunner.ts` | Adımları sırayla çalıştırır |
| `src/scenarios/runScenario.ts` | CLI: `npm run scenario` |
| `data/portal-urls/urls.json` | Profil başına portal/davet URL'leri (UI ile eklenecek) |
| `data/profiles/manifest.json` + `.env` | Kullanıcı (user) verisi |

## Portal URL dosyası (`data/portal-urls/urls.json`)

Senaryo 4 bu dosyadan profil için `active` kaydı okur.

```json
{
  "version": 1,
  "urls": [
    {
      "id": "profile-1-register-001",
      "profileId": "profile-1",
      "type": "register-form",
      "trackingUrl": "https://…awstrack.me/L0/https:%2F%2Fbasvuru…",
      "portalUrl": "https://basvuru.kosmosvize.com.tr/registerform?guid=…",
      "guid": "42d9a7c6-4e30-4e6f-99b6-5b13063c883b",
      "status": "active"
    }
  ]
}
```

| Alan | Açıklama |
|------|----------|
| `id` | Benzersiz kayıt |
| `profileId` | Manifest profil id |
| `type` | `register-form` \| `portal-home` \| `appointment` \| `other` |
| `portalUrl` | Doğrudan portal adresi (tercih edilen) |
| `trackingUrl` | Email redirect linki (yedek) |
| `status` | `active` \| `used` \| `expired` |

## banSafe (senaryo 4)

`url-login-observe.json` icinde `"banSafe": true` — observe-attach ile ayni mantik:

| Adim | banSafe davranisi |
|------|-------------------|
| chrome-connect | CDP aciksa Chrome **kill etmez** |
| chrome-login | Google'a **gitmez**, stealth/session enjekte etmez |
| portal-url-login | Portal zaten aciksa **goto atlar**; tracking URL yerine dogrudan portalUrl |
| randevu-navigate | Wizard aciksa **nav atlar** |
| observe | attachOnly — mudahale dongusu yok |

**Onerilen akis:**
1. `$env:CHROME_USE_SYSTEM_PROFILE="true"; npm run chrome:debug -- -Profile profile-1`
2. Elle: davet URL / dogrulama / Randevu Al (gerekirse)
3. `npm run scenario:url-observe` — eksik adimlari tamamlar, observer baslar

Zaten Randevu Al'daysaniz: `npm run scenario:observe-attach`

## Çalıştırma

```powershell
# Senaryo 4 — ana geliştirme yolu
npm run scenario:url-observe

# Senaryo 2 — fresh kayıt
npm run scenario:fresh-register

# Liste
npm run scenario -- --list
```

## Bilinen phase'ler

| Phase | Ne yapar |
|-------|----------|
| `chrome-fresh` | Temiz Chrome profili açar |
| `chrome-connect` | Mevcut Chrome profili açar (oturum reuse) |
| `chrome-login` | Google email/şifre ile giriş |
| `portal-url-login` | Portal / davet URL aç |
| `portal-invite-gate` | Davet sayfasında OTP stub (kayıt doldurulmaz) |
| `randevu-navigate` | Randevu İşlemleri → Randevu Al |
| `register-wizard` | Portal + kayıt formu Adım 1–9 (senaryo 2–3) |
| `observe` | Wizard kurulum + slot watcher + Telegram |

## Yeni senaryo eklemek

1. `data/scenarios/yeni-ad.json` oluştur
2. `steps` içine bilinen phase'leri yaz
3. Gerekirse `src/scenarios/phases/` altına yeni phase ekle + `types.ts` + runner switch
