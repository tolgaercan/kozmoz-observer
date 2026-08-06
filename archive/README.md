# Arşiv — UI Observer & Register

Bu klasör **aktif API observer akışında kullanılmaz**. Günlük kullanım: `npm start` → panel → **API İzlemeyi Başlat**.

## İçerik

| Yol | Açıklama |
|-----|----------|
| `env/ui-observer.env.template` | DOM observer env (nav, wizard, slot) |
| `env/register-wizard-profile-1.*` | Kayıt formu şablon + yerel yedek |
| `legacy-src/register/` | Kayıt wizard kodu |
| `legacy-src/appointment/` | Takvim slot / wizard UI kodu |
| `legacy-src/pages/` | Page Object Model |
| `legacy-src/flows/` | UI flow executor |
| `legacy-src/observer/` | Eski monolithic CLI observer |
| `legacy-src/index.ts` | Eski `npm run observer` girişi |
| `legacy-src/scenarios/` | observe, register, url-login fazları + JSON |

## Aktif kod (src/)

```
src/api/           GetClosedDate poll, token, Telegram
src/control-panel/ Panel sunucusu
src/scenarios/     api-watcher-attach senaryosu
src/portal/        JWT bootstrap yardımcıları (wizard detect, reCAPTCHA)
src/auth/          Portal / Google giriş
src/browser/       CDP Chrome
```

## Geri yükleme

1. `legacy-src/` altındaki klasörü `src/` içine kopyalayın
2. `archive/legacy-src/scenarios/data/*.json` → `data/scenarios/`
3. `archive/env/` şablon satırlarını `.env`'e ekleyin
4. Eski npm scriptleri `package.json` geçmişinden veya git geçmişinden
