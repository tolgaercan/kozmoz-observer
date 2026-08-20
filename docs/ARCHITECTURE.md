# Kozmoz Observer — Mimari Tasarım

> **v1 hedef:** Observer modu — login → kayıt/wizard → takvim taraması → Telegram bildirimi  
> **v2 hedef:** Processor modu — slot tıkla → ödeme OTP (DB) → kart → randevu al → temizlik + cooldown

---

## 1. Temel fikir

Her çalıştırma **tek bir profil** ile başlar:

```
Profil seç (kuyruk) → Chrome aç (CDP) → Bootstrap (mail/şifre, kayıt) → Wizard → Gözlem/İşlem
```

**Observer** ve **Processor** aynı bootstrap + wizard mantığını paylaşır; sadece takvim sonrası akış farklıdır.

| Mod | Takvim sonrası |
|-----|----------------|
| `observer` | Taramaya devam, slot bulunca **Telegram** |
| `processor` | (v2) İlk slota tıkla, OTP DB, ödeme, randevu al |

---

## 2. Katmanlar (test otomasyon modeli)

```
┌─────────────────────────────────────────────────────────┐
│  CLI / Supervisor     npm run observer -- --profile …   │
│  Kuyruk               data/profile-queue.json           │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Profil fixture         data/profiles/manifest.json     │
│  Profil havuzu (ileri)  data/profile-pool.json          │
│  Secrets                .env (${EMAIL_PROFILE_1} …)     │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Flow spec              src/flows/*.flow.ts           │
│    kosmos-portal-bootstrap   → login + kayıt (adım adım)│
│    kosmos-observe-v1         → wizard + slot watcher    │
│    kosmos-processor-v2       → (v2) booking + ödeme   │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  Page Objects           src/pages/*.ts                  │
│  Session                cookies.json + storage.json     │
│  Chrome                 CDP + user-data (profil başına) │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Dosya yapısı (minimal)

```
data/
  profiles/manifest.json      ← Aktif profil(ler) — şimdilik profile-1
  profile-pool.json           ← İleride eklenecek profiller (şablon)
  profile-queue.json          ← Sıra + runtime state
  sessions/profile-N/         ← cookies.json, storage.json
  chrome/profile-N/           ← Chrome user-data (CDP, ileride)

src/
  flows/                      ← Senaryo spec'leri
  pages/                      ← Page Objects
  profiles/
    profileManager.ts
    profileContext.ts
    profileCredentials.ts
    profileQueue.ts
  supervisor/                 ← (v1.1) Otomatik sıra

docs/
  ARCHITECTURE.md             ← Bu dosya
```

Gereksiz klasör yok: her profil için sadece `sessions/` + `chrome/` alt klasörü.

---

## 4. Profil şeması (`manifest.json`)

Kimlik bilgileri (email/şifre) **manifest'e yazılmaz** — kaynak: panel (`data/control-panel/chrome-profiles.json`, gitignore).

`manifest.json` yerel çalışma dosyasıdır (gitignore). İlk kurulumda `manifest.example.json` kopyalanır veya boş liste oluşturulur.

```json
{
  "id": "profile-1",
  "name": "Profile 1",
  "enabled": true,
  "mode": "observer",
  "flowId": "kosmos-observe-v1",
  "bootstrapFlowId": "kosmos-portal-bootstrap",
  "credentials": {
    "email": "",
    "password": ""
  },
  "form": { "appointmentCity": "Ankara", "..." },
  "browser": {
    "cdpPort": 9222,
    "userDataDir": "data/chrome/profile-1"
  },
  "session": {
    "cookiesFile": "data/sessions/profile-1/cookies.json",
    "storageFile": "data/sessions/profile-1/storage.json",
    "maxAgeHours": 72
  },
  "lifecycle": {
    "state": "ready",
    "cooldownUntil": null
  }
}
```

| Alan | Açıklama |
|------|----------|
| `mode` | `observer` \| `processor` |
| `bootstrapFlowId` | Mail/şifre + kayıt akışı (her modda ortak) |
| `flowId` | Wizard + gözlem/işlem akışı |
| `session.maxAgeHours` | 72 — süre dolunca login bootstrap |
| `lifecycle.state` | `ready` \| `observing` \| `booking` \| `cooldown` \| `banned` |

---

## 5. Kuyruk (`profile-queue.json`)

```json
{
  "strategy": "sequential",
  "activeProfileId": "profile-1",
  "queue": ["profile-1"]
}
```

- **Şimdilik:** Tek profil (`profile-1`), CLI `--profile` ile aynı.
- **İleride:** Supervisor `queue` dizisinden `state=ready` olanı seçer, iş bitince sonrakine geçer.

---

## 6. Profil yaşam döngüsü

```
ready
  → observing     (72s session, slot tarama)
  → slot_found    (Telegram — v1)
  → booking       (v2: tıkla, OTP, ödeme)
  → success
  → cleanup       (cookie + storage sil)
  → cooldown      (örn. 7 gün)
  → ready

session_expired → bootstrap (login) → observing
banned          → manuel (IP/proxy) → ready
```

---

## 7. Flow listesi

| Flow ID | Faz | Durum |
|---------|-----|--------|
| `kosmos-portal-bootstrap` | Mail/şifre → oturum → kayıt girişi | **Sırada (Adım 1)** |
| `kosmos-observe-v1` | Wizard 1–2–3 + slot watcher + Telegram | **Mevcut / tamamlanacak** |
| `kosmos-processor-v2` | Slot tık + ödeme OTP + kart | v2 |
| `kosmos-post-booking-reset` | Logout + session temizlik + cooldown | v2 |

`kosmos-bireysel-standart` = `kosmos-observe-v1` alias (geriye dönük uyumluluk).

---

## 8. v1 Observer — tamamlanacaklar

- [x] Wizard adım 1–3 otomasyonu
- [x] Takvim taraması (60s döngü, captcha, ay ileri/geri)
- [x] Telegram (slot bulunca / değişince)
- [ ] **Bootstrap:** mail + şifre ile giriş (session yoksa)
- [ ] **Bootstrap:** kayıt bölümüne ulaşma
- [ ] CDP + profil başına session inject (opsiyonel)
- [ ] Kuyruk supervisor (tek profil yeterli şimdilik)

---

## 9. v2 Processor — sonra

- Slot tıkla (single-only verify genişlet)
- Ödeme OTP ← ortak DB (`otp_queue`)
- Kredi kartı (vault / .env)
- Randevu onayı
- Session temizlik + 7 gün cooldown
- Profil havuzundan sıradaki profile geç

---

## 10. OTP veritabanı (v2 taslağı)

```sql
otp_queue (
  id, profile_id, type,  -- 'payment' | 'login_recovery'
  code, created_at, expires_at, consumed
)
```

Mail OTP gözlem fazında **gerekmez** (72s session). Sadece ödeme (ve acil login recovery).

---

## 11. IP / ban

- Varsayılan: profil başına aynı IP (mevcut ağ)
- Ban: `manifest.browser.proxy` manuel override
- Cooldown: `lifecycle.cooldownUntil` dolmadan kuyruğa alınmaz

---

## 12. Uygulama yol haritası

| Adım | İş | Çıktı |
|------|-----|--------|
| **A** | Tasarım + proje iskeleti | Bu doküman, queue, pool, manifest şeması |
| **B** | Bootstrap: login PO + flow | Mail/şifre, session kontrolü |
| **C** | Bootstrap: kayıt bölümü | Kozmos anasayfa / randevu girişi |
| **D** | Observer v1 polish | Telegram, preflight, dokümantasyon |
| **E** | Çoklu profil + supervisor | pool + sıralı CDP |
| **F** | Processor v2 | OTP DB, ödeme, reset |

**Şu an:** Adım A tamamlandıktan sonra **Adım B** (login akışı) ile devam.

---

## 13. Çalıştırma (v1)

```powershell
# Terminal 1
npm run chrome:debug

# Terminal 2
npm run observer -- --profile profile-1 --pause
```

Kuyruk aktif profili `data/profile-queue.json` → `activeProfileId` ile belirler (`--profile` verilmezse).
