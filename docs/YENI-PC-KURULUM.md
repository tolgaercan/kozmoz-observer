# Kozmoz Observer — Yeni PC Kurulum ve Taşıma Rehberi

Bu dosya, uygulamayı **başka bir bilgisayarda** çalıştırmak için güncel (panel odaklı) adımları içerir.

> **GİZLİ:** `.env` ve taşınan `data/` dosyaları gerçek token/şifre içerebilir. **GitHub'a commit/push etmeyin.** Bu dosya `.gitignore` içindedir.

---

## Özet — artık ne gerekli?

Çoğu ayar **panelden** yönetilir (`http://127.0.0.1:8787`). Eski rehberdeki manuel JSON düzenleme, `npm run chrome:debug` ve `proxy-pool.local.json` elle yazma **artık zorunlu değil**.

| Ne | Nereden? |
|----|----------|
| Chrome profili (email/şifre) | Panel → Chrome profil yönetimi |
| Proxy kayıtları | Panel → Proxy ekle/düzenle → `data/control-panel/proxy-pool.json` |
| Ağ modu (Doğrudan / Proxy), IP kilidi | Panel → Ağ bölümü |
| Worker (ofis, şekil, TC, poll aralığı) | Panel → Worker ayarları |
| Chrome aç/kapat (CDP) | Panel → **Chrome Aç** / **Chrome Kapat** |
| Telegram bildirimleri | **`.env`** (tek zorunlu dosya çoğu kurulumda) |

---

## İki senaryo

### A) Sıfırdan kurulum (önerilen — daha az taşıma)

Yeni PC'de sadece repo + minimal `.env` yeterli. Portal oturumu ve Chrome profili panelden yeniden kurulur.

**Gerekli:**

1. Git clone + `npm install` + `npm run build`
2. `.env` — en azından `TELEGRAM_*` (`.env.example` şablonuna bakın)
3. `npm start` → panel açılır
4. Panelde: Chrome profili oluştur (email/şifre) → Proxy ekle (ProxyNet kullanıyorsanız) → Ağ kaydet → **Chrome Aç** → portala elle giriş → IP kilitle → Watcher başlat

**Taşımanız gerekmeyenler (panel oluşturur):**

- `data/control-panel/worker-config.json`
- `data/control-panel/chrome-sessions.json`
- `data/control-panel/proxy-pool.json`
- `data/config/proxy-pool.local.json` (panel ilk proxy eklerken legacy'den import edebilir)

---

### B) Eski oturumu taşıma (portal girişi / Google oturumu korunsun)

Mevcut Chrome profilinde portal ve Google oturumu varsa **fiziksel kopya** hızlandırır.

**Minimum taşıma paketi:**

| Kaynak (eski PC) | Hedef (yeni PC) |
|------------------|-----------------|
| `.env` | `<REPO>\.env` |
| `data\chrome\profile-1\` (tüm klasör) | `<REPO>\data\chrome\profile-1\` |
| `data\control-panel\` *(opsiyonel — ayarları aynen istiyorsanız)* | `<REPO>\data\control-panel\` |
| `data\sessions\profile-1\` *(opsiyonel)* | `<REPO>\data\sessions\profile-1\` |

> Chrome profili büyük olabilir. Chrome **tamamen kapalıyken** zip'leyip taşıyın.

**Sonra:** `npm start` → panel → profil seç → **Chrome Aç** (proxy ayarlarınız panelde kayıtlıysa otomatik uygulanır).

---

## Kurulum adımları

### 1. Ön koşullar

| Yazılım | Not |
|---------|-----|
| Node.js 20+ | |
| Google Chrome | Varsayılan: `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Git | |

### 2. Repoyu kur

```powershell
git clone <GITHUB_REPO_URL> kozmoz-observer
cd kozmoz-observer
npm install
npm run build
```

### 3. `.env` oluştur

```powershell
Copy-Item .env.example .env
# .env içinde en az TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID doldurun
```

Portal email/şifre artık **panelde Chrome profiline** yazılır; `.env` içindeki `EMAIL_PROFILE_1` / `PASSWORD_PROFILE_1` çoğu akış için opsiyoneldir.

### 4. Paneli başlat

```powershell
npm start
```

Panel: `http://127.0.0.1:8787`

### 5. Panel akışı (ilk kurulum)

1. **Chrome profili** — email + şifre tanımla (veya taşınan profili seç)
2. **Proxy** (kullanıyorsanız) — «+ Proxy ekle» → HTTP gate (`gate-isp.proxynet.io:8036` vb.)  
   - «WAN statik» (`ispStatic`) kayıtları Chrome listesinde **gösterilmez**; watcher için **HTTP gate** (`test` gibi) seçin
3. **Ağ** — Proxy modu → proxy seç → **Ağ taslağını kaydet**
4. **Chrome Aç** — buton «Chrome açık» olunca hazır (CDP portu aktif süreçler tablosunda görünür)
5. Debug Chrome'da portala git, giriş yap
6. **Chrome'dan IP ölç** → **Mevcut IP'yi kilitle**
7. **API İzlemeyi Başlat**

> **`npm run chrome:debug` artık gerekmez** — panel Chrome'u proxy ve CDP portu ile kendisi başlatır.

---

## Proxy notları

- Panel «Çıkış IP ölç» (proxy dialog) = sunucu curl testi (havuz IP'si dönebilir)
- **«Chrome'dan IP ölç»** = gerçek watcher çıkış IP'si (whatismyip ile aynı olmalı)
- IP kilitlemede **Chrome'dan ölçülen** değeri kullanın
- Birden fazla panel profili = her birinin kendi CDP portu ve Chrome oturumu

---

## Taşınmayacaklar

| Dosya / klasör | Neden |
|----------------|-------|
| `node_modules\` | `npm install` |
| `dist\` | `npm run build` |
| `.git\` | clone ile gelir |
| Chrome `lockfile` | Chrome kapalıyken kopyalayın |

---

## Eski PC'de taşıma paketi (senaryo B)

```powershell
$repo = "C:\Users\PC\Desktop\kozmoz-observer"
$dest = "D:\migration-kozmoz"

New-Item -ItemType Directory -Force -Path $dest, "$dest\data\control-panel" | Out-Null

Copy-Item "$repo\.env" "$dest\" -Force
Copy-Item "$repo\data\control-panel\*" "$dest\data\control-panel\" -Recurse -Force -ErrorAction SilentlyContinue

# Chrome profili — zip önerilir
Compress-Archive -Path "$repo\data\chrome\profile-1" -DestinationPath "$dest\chrome-profile-1.zip" -Force
```

Yeni PC'de zip'i `data\chrome\` altına açın.

---

## Git'te olan vs olmayan

| GitHub'da var | GitHub'da yok (yerel / taşınır) |
|---------------|----------------------------------|
| `src/`, `scripts/`, `package.json` | `.env` |
| `.env.example` | `data/control-panel/` |
| `data/profiles/manifest.json` | `data/chrome/` |
| | `data/sessions/` |

---

## Doğrulama checklist

- [ ] `npm run build` hatasız
- [ ] `.env` içinde Telegram ayarları dolu
- [ ] `npm start` → panel `8787` açılıyor
- [ ] Panelde Chrome profili tanımlı
- [ ] **Chrome Aç** → «Chrome açık», CDP portu aktif süreçlerde görünüyor
- [ ] Proxy modunda whatismyip / «Chrome'dan IP ölç» ev IP'si değil
- [ ] IP kilitli, watcher başlıyor, Telegram test mesajı geliyor

---

## Sorun giderme

| Belirti | Çözüm |
|---------|--------|
| Chrome açık ama buton «açılıyor…» | Panel sayfasını F5 yenile (eski sürümde UI bug — güncel kodda «Chrome açık») |
| whatismyip ev IP gösteriyor | Proxy modu + gate proxy seç → Chrome Kapat → Chrome Aç |
| SSL / boş sayfa whatismyip | Panel sunucusunu yeniden başlat (`npm start`) — relay düzeltmesi gerekir |
| IP kilidi uyuşmuyor | «Chrome'dan IP ölç» ile kilitle, panel curl IP'sini değil |
| Proxy seçimi kayboluyor | «Ağ taslağını kaydet» → panel yeniden başlat |
| Telegram gitmiyor | `.env` → `TELEGRAM_*` |
| Portal login istiyor | `data/chrome/profile-1` taşı veya panelden elle giriş |

---

## § Cursor agent — kısa görev listesi

1. Node 20+, Chrome, Git doğrula
2. `git clone` → `npm install` → `npm run build`
3. `.env.example` → `.env` (Telegram doldur); taşınan paket varsa `.env` + `data/chrome/profile-1` kopyala
4. `npm start`
5. Panel akışını (§5) kullanıcıya doğrula veya adımları uygula
6. Sorun → [Sorun giderme](#sorun-giderme)

---

## npm komutları

| Komut | Ne yapar |
|-------|----------|
| `npm install` | Bağımlılıklar |
| `npm run build` | TypeScript derleme |
| `npm start` | Build + panel (`8787`) — **ana giriş** |
| `npm run chrome:debug` | *(Legacy)* Elle CDP — panel **Chrome Aç** tercih edilir |
| `npm run telegram:discover-chats` | Telegram chat id keşfi |

---

*Son güncelleme: 2026-08-10 — panel proxy CRUD, Chrome Aç/Kapat, Chrome'dan IP ölçümü.*
