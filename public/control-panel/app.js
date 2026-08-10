const INTERVAL_OPTIONS = [
  { label: "1 dk", ms: 60_000 },
  { label: "3 dk", ms: 180_000 },
  { label: "5 dk", ms: 300_000 },
  { label: "10 dk", ms: 600_000 },
  { label: "15 dk", ms: 900_000 },
  { label: "30 dk", ms: 1_800_000 },
  { label: "60 dk", ms: 3_600_000 },
];

function formatIntervalLabel(ms) {
  const match = INTERVAL_OPTIONS.find((option) => option.ms === ms);
  if (match) return match.label;
  if (ms >= 60_000 && ms % 60_000 === 0) {
    return `${Math.round(ms / 60_000)} dk`;
  }
  return `${Math.round(ms / 1000)} sn`;
}

function buildIntervalSelectOptions(selectedMs, optionsMs) {
  const values = optionsMs?.length ? optionsMs : INTERVAL_OPTIONS.map((option) => option.ms);
  return values
    .map((ms) => {
      const label = formatIntervalLabel(ms);
      const selected = ms === selectedMs ? " selected" : "";
      return `<option value="${ms}"${selected}>${label}</option>`;
    })
    .join("");
}

function fillIntervalSelect(element, selectedMs, optionsMs) {
  if (!element) return;
  const values = optionsMs?.length ? optionsMs : INTERVAL_OPTIONS.map((option) => option.ms);
  element.innerHTML = values
    .map((ms) => `<option value="${ms}">${formatIntervalLabel(ms)}</option>`)
    .join("");
  element.value = String(selectedMs);
}

function readWorkerTimingFromForm() {
  return {
    pollIntervalMs: Number.parseInt($("workerPollInterval").value, 10),
    telegramReportIntervalMs: Number.parseInt($("workerTelegramInterval").value, 10),
  };
}

const $ = (id) => document.getElementById(id);

const state = {
  profileId: "profile-1",
  bootstrap: null,
  worker: null,
  profileStatus: null,
  chromeLaunchInProgress: false,
  editingChromeProfileId: null,
  profileSwitchToken: 0,
  bootstrapAbort: null,
};

function readCdpPortInput() {
  const raw = $("cdpPortInput")?.value?.trim();
  if (!raw) return null;
  const port = Number.parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 9222 || port > 9230) {
    throw new Error("CDP port 9222–9230 arasında olmalı veya boş bırakın.");
  }
  return port;
}

function readNetworkDraft() {
  const proxyMode = $("proxyMode").value;
  const proxySelection = $("proxyUrl").value;
  const isPoolId = state.bootstrap?.proxyPool?.some((p) => p.id === proxySelection);
  return {
    proxyMode,
    proxyId: proxyMode === "proxy" && isPoolId ? proxySelection : "",
    proxyUrl: proxyMode === "proxy" && !isPoolId && proxySelection ? proxySelection : "",
  };
}

function selectedProxyFromForm() {
  const proxyId = $("proxyUrl").value;
  if (!proxyId) {
    return null;
  }
  return state.bootstrap?.proxyPool?.find((p) => p.id === proxyId) ?? null;
}

function buildNetworkPreviewSnapshot(mode) {
  const worker = state.worker ?? {};
  const locked = worker.lockedIp || $("lockedIp").textContent.trim().replace("—", "") || "";
  if (mode === "proxy") {
    const selected = selectedProxyFromForm();
    return {
      mode: "proxy",
      displayIp: selected?.exitIp || "—",
      lockedIp: locked,
      homePublicIp: state.bootstrap?.homePublicIp ?? "unknown",
      proxyPool: state.bootstrap?.proxyPool ?? [],
      ipSource: selected?.exitIp ? "cached" : undefined,
      warning: selected?.exitIp
        ? "Kayıtlı proxy çıkış IP — değişiklikten sonra «Ağ taslağını kaydet»"
        : "Proxy seçildi — «Çıkış IP ölç» veya kaydedin",
    };
  }
  const homeIp = state.bootstrap?.homePublicIp ?? "unknown";
  return {
    mode: "direct",
    displayIp: homeIp,
    lockedIp: locked,
    homePublicIp: homeIp,
    measuredWanIp: state.bootstrap?.measuredWanIp,
    warning: state.bootstrap?.homeIpWarning,
    ipSource: homeIp !== "unknown" ? "env" : undefined,
  };
}

function validateChromeLaunchReady() {
  if (!state.profileId) {
    return "Chrome profili seçin.";
  }
  const chromeProfile = state.bootstrap?.chromeProfiles?.find((p) => p.id === state.profileId);
  if (!chromeProfile?.chromeEmail) {
    return "Seçili profilde Chrome email tanımlı değil — Profil yönet.";
  }
  if (!chromeProfile?.hasPassword) {
    return "Seçili profilde Chrome şifre tanımlı değil — Profil yönet.";
  }
  const network = readNetworkDraft();
  if (network.proxyMode === "proxy" && !network.proxyId && !network.proxyUrl) {
    return "Proxy modu seçili — proxy havuzundan bir IP seçin.";
  }
  return null;
}

function updateChromeLaunchButtonState() {
  const btnStart = $("btnStartChrome");
  const btnStop = $("btnStopChrome");
  const hint = $("chromeHint");
  if (!btnStart) return;

  if (state.chromeLaunchInProgress) {
    btnStart.disabled = true;
    btnStart.textContent = "Chrome açılıyor…";
    if (btnStop) btnStop.disabled = true;
    return;
  }

  const ready = Boolean(state.profileStatus?.chrome?.ready);
  const launchError = validateChromeLaunchReady();

  btnStart.disabled = ready || Boolean(launchError);
  btnStart.textContent = ready ? "Chrome açık" : "Chrome Aç";
  btnStart.title = ready
    ? "Chrome zaten açık — yeniden başlatmak için «Chrome Kapat»"
    : launchError ?? "Seçili profil ve ağ ayarı ile Chrome aç";

  if (btnStop) {
    btnStop.disabled = !ready;
    btnStop.title = ready ? "Panel Chrome'unu kapat" : "Chrome zaten kapalı";
  }
  if (hint) {
    hint.textContent = ready
      ? "Chrome açık — adres çubuğundan elle appointmentForm açın, giriş yapın, sonra watcher başlatın."
      : "Önerilen sıra: Chrome Aç → elle portala git → API İzlemeyi Başlat.";
  }
}

function toast(message, type = "success") {
  const stack = $("toastStack");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      ...options,
    });
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? body.message ?? `HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw error;
    }
    throw error;
  }
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR");
}

function statusClass(status) {
  return ["running", "starting", "failed", "exited"].includes(status) ? status : "";
}

function renderProfileMeta(profile) {
  if (!profile) {
    $("profileMeta").textContent = "Profil seçin";
    $("selectedProfileLabel").textContent = "Profil seçilmedi";
    return;
  }
  const chromeProfile = state.bootstrap?.chromeProfiles?.find((p) => p.id === profile.id);
  $("selectedProfileLabel").innerHTML = `<strong>${profile.name}</strong> · <code>${profile.id}</code>`;
  $("profileMeta").innerHTML = `
    Chrome email: <code>${chromeProfile?.chromeEmail ?? "—"}</code>
    · Klasör: <code>${chromeProfile?.userDataDir ?? `data/chrome/${profile.id}`}</code>
    · CDP: <code>${profile.assignedCdpPort ?? profile.cdpPort ?? "otomatik"}</code>
  `;
  updateChromeLaunchButtonState();
}

function renderChromeProfileCards() {
  const container = $("chromeProfileListInline");
  if (!container) return;
  const profiles = state.bootstrap?.chromeProfiles ?? [];
  if (profiles.length === 0) {
    container.innerHTML = `<p class="note">Henüz profil yok — «+ Yeni profil» ile ekleyin.</p>`;
    return;
  }

  container.innerHTML = profiles
    .map((p) => {
      const active = p.id === state.profileId;
      return `
        <div class="profile-list-row profile-card ${active ? "profile-list-row-active" : ""}" data-profile-id="${p.id}" role="button" tabindex="0" aria-pressed="${active}">
          <div class="profile-card-body">
            <strong>${p.name}</strong>
            <code>${p.id}</code>
            ${active ? '<span class="status-pill starting">Aktif</span>' : ""}
            <small>${p.chromeEmail || "email eksik"}</small>
          </div>
          <div class="inline-actions" data-profile-actions="${p.id}">
            <button type="button" class="btn btn-ghost btn-compact" data-edit-chrome-profile="${p.id}">Düzenle</button>
            <button type="button" class="btn btn-danger btn-compact" data-delete-chrome-profile="${p.id}" ${
              profiles.length <= 1 ? "disabled" : ""
            }>Sil</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function selectProfile(profileId, options = {}) {
  const { light = true, refreshWorkflow = true } = options;
  if (!profileId || profileId === state.profileId) {
    renderChromeProfileCards();
    return;
  }

  state.profileId = profileId;
  state.network = null;
  state.profileSwitchToken += 1;
  const switchToken = state.profileSwitchToken;

  renderChromeProfileCards();
  const cached = state.bootstrap?.profiles?.find((p) => p.id === profileId);
  if (cached) {
    renderProfileMeta(cached);
  }
  $("panelStatus").textContent = "Profil yükleniyor…";
  $("panelStatus").className = "badge";

  try {
    await loadBootstrap({ light, switchToken });
    if (switchToken !== state.profileSwitchToken) return;
    if (refreshWorkflow) {
      await refreshWorkflowUi();
    }
    $("panelStatus").textContent = "Panel bağlı";
    $("panelStatus").className = "badge online";
  } catch (error) {
    if (switchToken !== state.profileSwitchToken) return;
    if (error?.name === "AbortError") return;
    $("panelStatus").textContent = "Profil yüklenemedi";
    $("panelStatus").className = "badge error";
    toast(error.message, "error");
  }
}

function formatCountdown(iso) {
  if (!iso) return "—";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Süre doldu";
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} sa`);
  if (minutes > 0) parts.push(`${minutes} dk`);
  if (hours === 0) parts.push(`${seconds} sn`);
  return parts.join(" ");
}

function apiHealthLabel(status) {
  const map = {
    ok: "Aktif gün var",
    empty: "Boş — aktif gün yok",
    error: "Hata",
    unauthorized: "401 — token",
    rate_limited: "Rate limit (429)",
    banned: "Portal banı",
    idle: "Beklemede",
  };
  return map[status] ?? status ?? "—";
}

function apiHealthClass(status) {
  if (status === "ok") return "running";
  if (status === "empty") return "starting";
  if (status === "rate_limited" || status === "banned") return "failed";
  if (status === "error" || status === "unauthorized") return "exited";
  return "";
}

function displayBanIp(health, currentPublicIp) {
  if (health?.publicIp && health.publicIp !== "unknown") {
    return health.publicIp;
  }
  if (health?.lockedIp) {
    return `${health.lockedIp} (kilitli)`;
  }
  if (
    (health?.status === "banned" || health?.status === "rate_limited") &&
    currentPublicIp &&
    currentPublicIp !== "unknown"
  ) {
    return `${currentPublicIp} (tahmini — ban anında kayıt yok)`;
  }
  return "—";
}

function profileLabel(health) {
  const name = health?.profileName ?? health?.profileId ?? "?";
  const id = health?.profileId ?? "?";
  return `${name} · ${id}`;
}

function renderBanOverview(status) {
  const tbody = $("banOverviewBody");
  if (!tbody) return;

  const overview = status?.allApiHealth;
  const currentPublicIp = overview?.publicIp ?? state.bootstrap?.publicIp;
  const rows = overview?.profiles ?? [];
  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Profil yok</td></tr>`;
    return;
  }

  const blockedMap = new Map(
    (overview?.blocked ?? []).map((item) => [item.profileId, item]),
  );

  tbody.innerHTML = rows
    .map((row) => {
      const blocked = blockedMap.get(row.profileId);
      const banUntil =
        blocked?.blockedUntil ?? row.portalBanUntil ?? row.backoffUntil;
      const isBlocked = banUntil && Date.parse(banUntil) > Date.now();
      const statusLabel = isBlocked
        ? apiHealthLabel(row.status === "idle" ? "banned" : row.status)
        : apiHealthLabel(row.status ?? "idle");

      return `
        <tr class="${isBlocked ? "row-banned" : ""}">
          <td><strong>${row.profileName ?? row.profileId}</strong><br><code>${row.profileId}</code></td>
          <td><code>${row.cdpPort ?? "—"}</code></td>
          <td><code>${displayBanIp(row, currentPublicIp)}</code></td>
          <td><code>${row.lockedIp ?? "—"}</code></td>
          <td><span class="status-pill ${apiHealthClass(isBlocked ? "banned" : row.status)}">${statusLabel}</span></td>
          <td>${isBlocked ? formatCountdown(banUntil) : "—"}</td>
          <td>${row.dealerOffice ?? "—"}<br><small>${row.appointmentStyle ?? ""}</small></td>
        </tr>
      `;
    })
    .join("");
}

function renderBanBanner(status) {
  const banner = $("banBanner");
  if (!banner) return;

  const health = status?.apiHealth;
  const blocked = status?.rateLimit;
  const banUntil = health?.portalBanUntil ?? health?.backoffUntil ?? blocked?.until;
  const isBlocked = blocked?.blocked || (banUntil && Date.parse(banUntil) > Date.now());

  if (!isBlocked) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }

  banner.hidden = false;
  banner.innerHTML = `
    <strong>Portal banı — ${profileLabel(health)}</strong>
    <span>Ban IP: <code>${displayBanIp(health, status?.allApiHealth?.publicIp ?? state.bootstrap?.publicIp)}</code></span>
    <span>Kilitli IP: <code>${health?.lockedIp ?? "—"}</code></span>
    <span>CDP: <code>${health?.cdpPort ?? status?.cdpPort ?? "—"}</code></span>
    <span class="ban-banner-countdown">Kalan: ${formatCountdown(banUntil)}</span>
    <span class="ban-banner-until">${formatTime(banUntil)} kadar watcher başlatmayın</span>
  `;
}

function renderApiHealth(status) {
  const panel = $("apiHealthPanel");
  const badge = $("apiHealthBadge");
  const health = status?.apiHealth;
  const blocked = status?.rateLimit;

  if (!health && !blocked?.blocked) {
    badge.textContent = "Beklemede";
    badge.className = "status-pill";
    panel.innerHTML = `<p class="note">Watcher başlatıldığında son poll sonuçları burada görünür.</p>`;
    return;
  }

  const healthStatus = health?.status ?? (blocked?.blocked ? "banned" : "idle");
  badge.textContent = apiHealthLabel(healthStatus);
  badge.className = `status-pill ${apiHealthClass(healthStatus)}`;

  const banUntil = health?.portalBanUntil ?? health?.backoffUntil ?? blocked?.until;
  const isBlocked = blocked?.blocked || (banUntil && Date.parse(banUntil) > Date.now());

  panel.innerHTML = `
    <div class="api-health-identity">
      <span><strong>Profil:</strong> ${profileLabel(health)}</span>
      <span><strong>Ban IP:</strong> <code>${displayBanIp(health, status?.allApiHealth?.publicIp ?? state.bootstrap?.publicIp)}</code></span>
      <span><strong>Kilitli IP:</strong> <code>${health?.lockedIp ?? "—"}</code></span>
      <span><strong>CDP port:</strong> <code>${health?.cdpPort ?? status?.cdpPort ?? "—"}</code></span>
    </div>
    <div class="api-health-row ${isBlocked ? "api-health-alert" : ""}">
      <div>
        <span class="ip-label">Son poll</span>
        <strong>${formatTime(health?.lastPollAt)}</strong>
      </div>
      <div>
        <span class="ip-label">Son özet</span>
        <strong>${health?.lastSummary ?? "—"}</strong>
      </div>
      <div>
        <span class="ip-label">HTTP</span>
        <strong>${health?.lastHttpStatus ?? "—"}</strong>
      </div>
      <div>
        <span class="ip-label">Son 1 saat istek</span>
        <strong>${health?.requestsLastHour ?? 0}</strong>
      </div>
      <div>
        <span class="ip-label">Poll aralığı</span>
        <strong>${health?.pollIntervalMs ? `${Math.round(health.pollIntervalMs / 1000)} sn` : "—"}</strong>
      </div>
      ${
        isBlocked
          ? `<div class="api-health-ban">
              <span class="ip-label">Ban / backoff kalan</span>
              <strong class="ban-countdown">${formatCountdown(banUntil)}</strong>
              <small>${banUntil ? formatTime(banUntil) : ""} kadar</small>
            </div>`
          : ""
      }
    </div>
    ${
      health?.lastError
        ? `<div class="api-health-error">
            <span class="ip-label">Son hata mesajı</span>
            <pre>${health.lastError.replace(/</g, "&lt;")}</pre>
          </div>`
        : ""
    }
    <p class="note api-health-tip">
      2 dk poll tek başına ban yaratmaz. Ban genelde panelden sık watcher restart, aynı anda birden fazla watcher
      veya 401 sonrası aynı döngüde ekstra istekten kaynaklanır. Tek watcher çalıştırın; ban bitene kadar yeniden başlatmayın.
    </p>
  `;
}

function renderChromeStatus(status) {
  const el = $("chromeStatus");
  if (!el) {
    return;
  }
  if (!status) {
    el.textContent = "Chrome durumu yükleniyor…";
    el.className = "chrome-status";
    updateChromeLaunchButtonState();
    return;
  }
  el.className = `chrome-status ${status.chrome.ready ? "ready" : "down"}`;
  el.innerHTML = status.chrome.ready
    ? `Chrome CDP hazır — <code>${status.chrome.endpoint}</code>`
    : `Chrome CDP kapalı — port <code>${status.cdpPort}</code>`;
  updateChromeLaunchButtonState();
}

function renderChromeActions(_status) {
  updateChromeLaunchButtonState();
}

function readWorkerApiFromForm() {
  return {
    dealerOffice: $("dealerOffice").value,
    appointmentStyle: $("appointmentStyle").value,
    applicationType: $("applicationType").value,
    nationalityNumber: $("nationalityNumber").value.replace(/\D/g, ""),
  };
}

function maskTc(value) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length <= 3) return digits ? "***" : "—";
  return `${digits.slice(0, 3)}${"*".repeat(digits.length - 3)}`;
}

function renderApiPreview() {
  const api = readWorkerApiFromForm();
  const office = state.bootstrap?.dealerOffices?.find((o) => o.name === api.dealerOffice);
  const styleOpt = state.bootstrap?.appointmentStyles?.find((s) => s.label === api.appointmentStyle);
  const typeOpt = state.bootstrap?.applicationTypes?.find((t) => t.label === api.applicationType);

  $("apiPreview").innerHTML = office
    ? `
      <strong>GetClosedDate + wizard</strong><br>
      Adım 1 şube: <code>${office.name}</code> → dealerId <code>${office.dealerId}</code><br>
      Adım 2 tip: <code>${api.applicationType}</code> → applicationTypeId <code>${typeOpt?.applicationTypeId ?? "?"}</code><br>
      Adım 2 şekil: <code>${api.appointmentStyle}</code> → appointmentTypeId <code>${styleOpt?.appointmentTypeId ?? "?"}</code><br>
      TC: <code>${maskTc(api.nationalityNumber)}</code>
    `
    : "Ofis seçin";
  renderWorkerSummary();
  renderWorkflowTimingNote();
}

function renderWorkerSummary() {
  const el = $("workerSummary");
  if (!el) return;

  const worker = state.worker;
  const timing = readWorkerTimingFromForm();
  const lockedIp = worker?.lockedIp || $("lockedIp").textContent.trim().replace("—", "") || "—";
  const envDefaults = state.bootstrap?.envTimingDefaults;

  el.innerHTML = `
    <strong>Kayıtlı worker özeti</strong><br>
    Profil: <code>${state.profileId}</code> · Kilitli IP: <code>${lockedIp}</code><br>
    Poll: <strong>${formatIntervalLabel(timing.pollIntervalMs)}</strong> ·
    Telegram: <strong>${formatIntervalLabel(timing.telegramReportIntervalMs)}</strong>
    ${
      envDefaults
        ? `<br><small>.env varsayılan: poll ${formatIntervalLabel(envDefaults.pollIntervalMs)}, Telegram ${formatIntervalLabel(envDefaults.telegramReportIntervalMs)}</small>`
        : ""
    }
  `;
}

function renderWorkflowTimingNote() {
  const el = $("workflowTimingNote");
  if (!el) return;
  const timing = readWorkerTimingFromForm();
  el.textContent =
    `Once Chrome Ac (Profil karti), elle portala gidin, sonra watcher baslatin. ` +
    `Bu profil: poll ${formatIntervalLabel(timing.pollIntervalMs)}, Telegram ${formatIntervalLabel(timing.telegramReportIntervalMs)}.`;
}

function formatProxyOption(option) {
  if (!option.id) {
    return option.label;
  }
  const ipPart = option.exitIp ? `IP: ${option.exitIp}` : `${option.host}:${option.port}`;
  return `${option.label} — ${ipPart}`;
}

function listKnownProxyExitIps() {
  return [
    ...new Set(
      (state.bootstrap?.proxyPool ?? [])
        .map((proxy) => proxy.exitIp?.trim())
        .filter((ip) => ip && ip !== "0.0.0.0"),
    ),
  ];
}

/** Tarayıcıdan ipify — antivirüs Node/curl engelini aşar */
async function measureHomeIpInBrowser() {
  const endpoints = [
    "https://api.ipify.org?format=json",
    "https://api64.ipify.org?format=json",
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        continue;
      }
      const body = await response.json();
      const ip = body?.ip?.trim();
      if (ip) {
        return ip;
      }
    } catch {
      // antivirüs / ağ — sonraki endpoint
    }
  }

  return null;
}

async function applyBrowserHomeIp(profileId) {
  const browserIp = await measureHomeIpInBrowser();
  if (!browserIp) {
    return null;
  }

  return api("/api/network/ensure-home-ip", {
    method: "POST",
    body: JSON.stringify({ profileId, ip: browserIp }),
  });
}

function updateRefreshNetworkIpButton() {
  const btn = $("btnRefreshNetworkIp");
  if (!btn) return;
  btn.textContent =
    $("proxyMode").value === "proxy" ? "Chrome'dan IP ölç" : "Ev IP'yi yeniden ölç";
}

async function refreshNetworkIp() {
  const proxyMode = $("proxyMode").value;
  const proxyId = $("proxyUrl").value;

  if (proxyMode === "proxy" && proxyId) {
    renderNetworkFromSnapshot(buildNetworkPreviewSnapshot("proxy"));
  } else if (proxyMode === "direct") {
    renderNetworkFromSnapshot(buildNetworkPreviewSnapshot("direct"));
  }

  const params = new URLSearchParams({
    profileId: state.profileId,
    proxyMode,
    skipServerMeasure: proxyMode === "proxy" ? "false" : "true",
    measureViaChrome: proxyMode === "proxy" ? "true" : "false",
  });
  if (proxyMode === "proxy" && proxyId) {
    params.set("proxyId", proxyId);
  }

  let network = await api(`/api/network/ip?${params.toString()}`);

  if (
    proxyMode === "direct" &&
    (network.displayIp === "unknown" || network.displayIp === "unavailable" || !network.lockedIp)
  ) {
    try {
      const fromBrowser = await applyBrowserHomeIp(state.profileId);
      if (fromBrowser) {
        network = fromBrowser;
      }
    } catch (error) {
      toast(error.message, "error");
    }
  }

  state.network = network;

  const locked = network.lockedIp || "—";
  $("lockedIp").textContent = locked;

  renderNetworkFromSnapshot(network);
  renderNetworkHints();

  const manualField = $("manualHomeIpField");
  if (manualField) {
    const showManual =
      proxyMode === "direct" &&
      (network.displayIp === "unknown" || network.displayIp === "unavailable") &&
      !network.lockedIp;
    manualField.hidden = !showManual;
  }

  if (network.autoLocked && network.lockedIp) {
    toast(`Ev IP otomatik kilitlendi: ${network.lockedIp}`);
  }

  return network;
}

function renderNetworkFromSnapshot(network) {
  const label = $("currentIpLabel");
  const hint = $("currentIpHint");
  const mode = network.mode ?? $("proxyMode").value;

  if (mode === "proxy") {
    label.textContent = "Proxy çıkış IP";
    $("currentIp").textContent = network.displayIp ?? "—";
    const profileNote =
      network.measuredProfileId && network.measuredCdpPort
        ? ` (${network.measuredProfileId}, CDP :${network.measuredCdpPort})`
        : "";
    hint.textContent =
      network.warning ??
      (network.ipSource === "chrome"
        ? `Seçili profilin Chrome oturumundan ölçüldü${profileNote}`
        : network.ipSource === "proxy"
          ? "Sunucu curl ölçümü — havuz IP'si Chrome'dan farklı olabilir"
          : network.ipSource === "cached"
            ? "Proxy kaydındaki çıkış IP"
            : "Seçili proxy — Chrome bu IP üzerinden çıkar");
  } else {
    label.textContent = "Ev public IP";
    $("currentIp").textContent = network.displayIp ?? "—";
    if (network.displayIp === "unknown" || network.displayIp === "unavailable") {
      hint.textContent =
        network.warning ??
        (network.measuredWanIp
          ? `WAN ${network.measuredWanIp} — ProxyNet aktif; kapatıp "Ev IP'yi yeniden ölç" deyin`
          : "Ev IP alınamadı — ProxyNet kapatın veya manuel girin");
    } else {
      const sourceHint =
        network.ipSource === "browser"
          ? "Tarayıcı ile ölçüldü (antivirüs dostu)"
          : network.ipSource === "chrome"
            ? "Chrome (direct://) ile ölçüldü"
            : network.ipSource === "cached"
              ? "Kayıtlı ev IP"
              : network.ipSource === "env"
                ? ".env HOME_PUBLIC_IP"
                : "Doğrudan mod — proxy bypass (direct://)";
      hint.textContent = network.warning ?? sourceHint;
    }
  }
}

function fillSelect(select, options, getValue, getLabel, selected) {
  select.innerHTML = "";
  for (const option of options) {
    const opt = document.createElement("option");
    opt.value = getValue(option);
    opt.textContent = getLabel(option);
    if (opt.value === selected) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

function renderCurrentIpDisplay() {
  const formMode = $("proxyMode").value;
  if (state.network && (state.network.mode ?? formMode) === formMode) {
    renderNetworkFromSnapshot(state.network);
    return;
  }
  renderNetworkFromSnapshot(buildNetworkPreviewSnapshot(formMode));
}

function renderNetworkHints() {
  const mode = $("proxyMode").value;
  const hint = $("networkModeHint");
  const proxyHint = $("proxyExitHint");
  const selectedId = $("proxyUrl").value;
  const selected = state.bootstrap?.proxyPool?.find((p) => p.id === selectedId);

  if (mode === "direct") {
    hint.textContent =
      "Doğrudan mod: trafik ev interneti IP'sinden gider (Chrome: direct://). " +
      (state.network?.warning ?? state.bootstrap?.homeIpWarning
        ? `${state.network?.warning ?? state.bootstrap.homeIpWarning} `
        : "") +
      "Statik ProxyNet IP için → Bağlantı modu: Proxy.";
    proxyHint.textContent = "";
  } else {
    hint.textContent =
      "Proxy modu: trafik seçilen HTTP gate proxy üzerinden gider. WAN statik kayıtlar Chrome listesinde gösterilmez.";
    proxyHint.textContent = selected?.exitIp
      ? `Statik çıkış IP: ${selected.exitIp}`
      : selected
        ? "Proxy seçildi — kaydet ve kilitle"
        : "Listeden statik IP proxy seçin";
  }
}

function applyWorkerToForm(worker, options = {}) {
  const skipNetwork = options.skipNetwork === true;
  $("proxyMode").value = worker.proxyMode ?? "direct";
  $("lockedIp").textContent = worker.lockedIp || "—";
  $("proxyUrlField").hidden = worker.proxyMode !== "proxy";
  if (worker.proxyId) {
    $("proxyUrl").value = worker.proxyId;
  } else if (worker.proxyUrl) {
    $("proxyUrl").value = worker.proxyUrl;
  }
  if (worker.api?.dealerOffice) {
    $("dealerOffice").value = worker.api.dealerOffice;
  }
  if (worker.api?.appointmentStyle) {
    $("appointmentStyle").value = worker.api.appointmentStyle;
  }
  if (worker.api?.applicationType && $("applicationType")) {
    $("applicationType").value = worker.api.applicationType;
  }
  if ($("nationalityNumber")) {
    $("nationalityNumber").value = worker.api?.nationalityNumber ?? "";
  }
  const intervalOptions = state.bootstrap?.runtimeOptionsMs;
  const pollMs = worker.timing?.pollIntervalMs ?? INTERVAL_OPTIONS[2].ms;
  const telegramMs = worker.timing?.telegramReportIntervalMs ?? INTERVAL_OPTIONS[2].ms;
  fillIntervalSelect($("workerPollInterval"), pollMs, intervalOptions);
  fillIntervalSelect($("workerTelegramInterval"), telegramMs, intervalOptions);
  renderApiPreview();
  renderCurrentIpDisplay();
  updateRefreshNetworkIpButton();
  if (!skipNetwork) {
    void refreshNetworkIp().catch(() => {});
  } else if (state.worker?.lockedIp) {
    $("lockedIp").textContent = worker.lockedIp || "—";
  }
  updateChromeLaunchButtonState();
}

function renderWorkflowSteps(status, processes) {
  const apiWatcherRunning = (processes ?? []).some(
    (p) =>
      p.kind === "api-watcher" &&
      p.profileId === state.profileId &&
      (p.status === "running" || p.status === "starting"),
  );

  const stepProfile = $("stepProfile");
  const stepApi = $("stepApi");
  const stepChrome = $("stepChrome");
  const stepPortal = $("stepPortal");
  const stepWatcher = $("stepWatcher");
  const btnStop = $("btnStopApiWatcher");
  const btnStart = $("btnStartWorkflow");

  stepProfile.className = state.profileId ? "done" : "";
  const apiForm = readWorkerApiFromForm();
  const apiReady =
    apiForm.dealerOffice &&
    apiForm.appointmentStyle &&
    apiForm.applicationType &&
    (!apiForm.nationalityNumber || apiForm.nationalityNumber.length === 11);
  stepApi.className = apiReady ? "done" : "";
  stepChrome.className = status?.chrome?.ready ? "done" : "";
  if (stepPortal) {
    stepPortal.className = status?.chrome?.ready ? "active" : "";
    stepPortal.title = status?.chrome?.ready
      ? "Chrome acik — adres cubugundan appointmentForm acin (elle)"
      : "Once Chrome Ac";
  }
  stepWatcher.className = apiWatcherRunning ? "done active" : "";

  if (btnStop) {
    btnStop.hidden = !apiWatcherRunning;
  }
  if (btnStart) {
    btnStart.disabled = apiWatcherRunning || status?.rateLimit?.blocked || !status?.chrome?.ready;
    btnStart.title = !status?.chrome?.ready
      ? "Once Chrome oturumu kartindan Chrome Ac"
      : status?.rateLimit?.blocked
        ? "Ban / rate limit aktif — bekleyin"
        : apiWatcherRunning
          ? "Watcher zaten calisiyor"
          : "";
  }
}

function renderDiagnostics(title, bodyHtml, ok = true) {
  const el = $("diagnosticsOutput");
  if (!el) return;
  el.hidden = false;
  el.className = `diagnostics-output ${ok ? "ok" : "fail"}`;
  el.innerHTML = `<strong>${title}</strong>${bodyHtml}`;
}

function renderValidationReport(report) {
  const rows = (report.items ?? [])
    .map(
      (item) =>
        `<div class="diag-row ${item.ok ? "ok" : "fail"}">${item.ok ? "✓" : "✗"} ${item.name}<br><small>${item.detail}</small></div>`,
    )
    .join("");
  renderDiagnostics(
    `${report.summary}`,
    `<div class="diag-summary">${report.passed}/${report.total} geçti</div>${rows}`,
    report.ok,
  );
}

function renderProcesses(processes) {
  const tbody = $("processTableBody");
  tbody.innerHTML = "";

  const apiKinds = new Set(["api-watcher", "chrome"]);
  const active = (processes ?? []).filter(
    (p) =>
      apiKinds.has(p.kind) &&
      (p.status === "running" || p.status === "starting"),
  );
  if (active.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">Aktif süreç yok</td></tr>`;
    return;
  }

  for (const proc of active) {
    const tr = document.createElement("tr");
    const isWatcher = proc.kind === "api-watcher";
    const pollMs = proc.runtime?.pollIntervalMs ?? INTERVAL_OPTIONS[2].ms;
    const telegramMs = proc.runtime?.telegramReportIntervalMs ?? INTERVAL_OPTIONS[2].ms;
    const cdpCell = proc.cdpPort ? `<code>:${proc.cdpPort}</code>` : "—";

    tr.innerHTML = `
      <td>${proc.kind}</td>
      <td><code>${proc.profileId}</code></td>
      <td>${proc.label}</td>
      <td>${cdpCell}</td>
      <td><span class="status-pill ${statusClass(proc.status)}">${proc.status}</span></td>
      <td>${
        isWatcher
          ? `<select class="process-interval-select" data-poll="${proc.id}" aria-label="Poll aralığı">${buildIntervalSelectOptions(pollMs, proc.runtimeOptionsMs)}</select>`
          : "—"
      }</td>
      <td>${
        isWatcher
          ? `<select class="process-interval-select" data-telegram="${proc.id}" aria-label="Telegram aralığı">${buildIntervalSelectOptions(telegramMs, proc.runtimeOptionsMs)}</select>`
          : "—"
      }</td>
      <td>${proc.pid ?? "—"}</td>
      <td>${formatTime(proc.startedAt)}</td>
      <td>
        <div class="process-actions">
          ${
            isWatcher
              ? `<button type="button" class="btn btn-secondary btn-compact" data-update-runtime="${proc.id}">Güncelle</button>`
              : ""
          }
          <button type="button" class="btn btn-danger btn-compact" data-kill="${proc.id}">Kill</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("[data-update-runtime]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const processId = btn.dataset.updateRuntime;
      const pollSelect = tbody.querySelector(`[data-poll="${processId}"]`);
      const telegramSelect = tbody.querySelector(`[data-telegram="${processId}"]`);
      try {
        const result = await api("/api/process/runtime-config", {
          method: "POST",
          body: JSON.stringify({
            processId,
            pollIntervalMs: Number.parseInt(pollSelect?.value ?? "0", 10),
            telegramReportIntervalMs: Number.parseInt(telegramSelect?.value ?? "0", 10),
          }),
        });
        toast(
          `Canlı ayar uygulandı — poll: ${formatIntervalLabel(result.runtime.pollIntervalMs)}, Telegram: ${formatIntervalLabel(result.runtime.telegramReportIntervalMs)} (worker-config'e kaydedildi)`,
        );
        await refreshAll();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });

  tbody.querySelectorAll("[data-kill]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const result = await api("/api/process/kill", {
          method: "POST",
          body: JSON.stringify({ processId: btn.dataset.kill }),
        });
        toast(result.message ?? "Süreç listeden kaldırıldı");
        renderProcesses(result.processes);
      } catch (error) {
        toast(error.message, "error");
        await refreshProcesses();
      }
    });
  });
}

async function loadBootstrap(options = {}) {
  const { light = false, switchToken = state.profileSwitchToken } = options;

  if (state.bootstrapAbort) {
    state.bootstrapAbort.abort();
  }
  state.bootstrapAbort = new AbortController();
  const signal = state.bootstrapAbort.signal;

  const query = new URLSearchParams({
    profileId: state.profileId,
    ...(light ? { light: "true" } : {}),
  });
  const data = await api(`/api/bootstrap?${query.toString()}`, { signal });
  if (switchToken !== state.profileSwitchToken) {
    return data;
  }

  state.bootstrap = data;
  state.worker = data.worker;
  await loadPanelProxiesFull().catch(() => {
    state.panelProxies = [];
  });

  if (!light) {
    $("panelStatus").textContent = "Panel bağlı";
    $("panelStatus").className = "badge online";
  }

  fillSelect(
    $("dealerOffice"),
    data.dealerOffices,
    (o) => o.name,
    (o) => `${o.name} — dealerId ${o.dealerId}${o.kind === "sube" ? " (şube)" : ""}`,
    data.worker?.api?.dealerOffice ?? "Ankara",
  );

  fillSelect(
    $("appointmentStyle"),
    data.appointmentStyles,
    (s) => s.label,
    (s) => `${s.label} (${s.appointmentTypeId})`,
    data.worker?.api?.appointmentStyle ?? "Standart",
  );

  fillSelect(
    $("applicationType"),
    data.applicationTypes ?? [{ label: "Bireysel", applicationTypeId: "1" }],
    (t) => t.label,
    (t) => `${t.label} (${t.applicationTypeId})`,
    data.worker?.api?.applicationType ?? "Bireysel",
  );

  const proxyPool = (data.proxyPool ?? []).filter((p) => !p.ispStatic);
  fillSelect(
    $("proxyUrl"),
    [{ id: "", label: "— Seç —", host: "", port: 0, enabled: true }, ...proxyPool],
    (o) => o.id,
    (o) => formatProxyOption(o),
    data.worker?.proxyId ?? data.worker?.proxyUrl ?? "",
  );

  const profile = data.profiles.find((p) => p.id === state.profileId);
  renderProfileMeta(profile);
  applyWorkerToForm(data.worker, { skipNetwork: light });

  const assigned = profile?.assignedCdpPort ?? profile?.preferredCdpPort ?? "";
  if ($("cdpPortInput")) {
    $("cdpPortInput").value = assigned ? String(assigned) : "";
  }

  $("lastUpdated").textContent = `Son güncelleme: ${new Date().toLocaleString("tr-TR")}`;
  renderChromeProfileCards();
  renderProxyPoolCards();
  return data;
}

async function refreshStatus() {
  const status = await api(`/api/status?profileId=${encodeURIComponent(state.profileId)}`);
  state.profileStatus = status;
  renderChromeStatus(status);
  renderBanOverview(status);
  renderBanBanner(status);
  renderApiHealth(status);
  return status;
}

async function refreshProcesses() {
  const data = await api("/api/processes");
  renderProcesses(data.processes);
  return data.processes;
}

async function refreshWorkflowUi() {
  const [status, processes] = await Promise.all([refreshStatus(), refreshProcesses()]);
  renderWorkflowSteps(status, processes);
}

async function saveWorkerConfig(patch) {
  const body = await api("/api/worker-config", {
    method: "POST",
    body: JSON.stringify({ profileId: state.profileId, config: patch }),
  });
  state.worker = body.worker;
  applyWorkerToForm(body.worker);
  toast("Taslak kaydedildi");
}

async function refreshAll() {
  await loadBootstrap({ light: false });
  await refreshWorkflowUi();
}

function wireChromeProfileList() {
  const container = $("chromeProfileListInline");
  if (!container || container.dataset.wired === "1") return;
  container.dataset.wired = "1";

  container.addEventListener("click", (event) => {
    const editBtn = event.target.closest("[data-edit-chrome-profile]");
    if (editBtn) {
      event.stopPropagation();
      openChromeProfileEditor(editBtn.dataset.editChromeProfile);
      return;
    }
    const deleteBtn = event.target.closest("[data-delete-chrome-profile]");
    if (deleteBtn) {
      event.stopPropagation();
      void deleteChromeProfile(deleteBtn.dataset.deleteChromeProfile);
      return;
    }
    const card = event.target.closest(".profile-card[data-profile-id]");
    if (card) {
      void selectProfile(card.dataset.profileId);
    }
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".profile-card[data-profile-id]");
    if (!card) return;
    event.preventDefault();
    void selectProfile(card.dataset.profileId);
  });
}

wireChromeProfileList();

$("proxyMode").addEventListener("change", (event) => {
  $("proxyUrlField").hidden = event.target.value !== "proxy";
  updateRefreshNetworkIpButton();
  if (event.target.value === "direct" && $("proxyUrl").value) {
    toast("Doğrudan mod — proxy seçimi uygulanmaz (Chrome: ev interneti).", "info");
  }
  state.network = null;
  refreshNetworkIp().catch((e) => toast(e.message, "error"));
  updateChromeLaunchButtonState();
});

$("proxyUrl").addEventListener("change", () => {
  const proxyId = $("proxyUrl").value;
  if (proxyId && $("proxyMode").value !== "proxy") {
    $("proxyMode").value = "proxy";
    $("proxyUrlField").hidden = false;
    toast("Proxy seçildi — bağlantı modu «Proxy» olarak ayarlandı.");
  }
  state.network = null;
  refreshNetworkIp().catch((e) => toast(e.message, "error"));
  renderProxyPoolCards();
  updateChromeLaunchButtonState();
});

$("cdpPortInput")?.addEventListener("input", updateChromeLaunchButtonState);

$("dealerOffice").addEventListener("change", renderApiPreview);
$("appointmentStyle").addEventListener("change", renderApiPreview);
$("applicationType").addEventListener("change", renderApiPreview);
$("nationalityNumber").addEventListener("input", renderApiPreview);
$("workerPollInterval").addEventListener("change", () => {
  renderWorkerSummary();
  renderWorkflowTimingNote();
});
$("workerTelegramInterval").addEventListener("change", () => {
  renderWorkerSummary();
  renderWorkflowTimingNote();
});

$("btnClearLockedIp").addEventListener("click", async () => {
  await saveWorkerConfig({ lockedIp: "" });
  $("lockedIp").textContent = "—";
  toast("Kilitli IP sıfırlandı");
});

$("btnLockCurrentIp").addEventListener("click", async () => {
  const ip = $("currentIp").textContent.trim();
  if (!ip || ip === "unknown" || ip === "—" || ip === "unavailable") {
    toast("Geçerli IP yok — bağlantı modunu kontrol edin", "error");
    return;
  }
  await saveWorkerConfig({ lockedIp: ip });
  $("lockedIp").textContent = ip;
  toast(`IP kilitlendi: ${ip}`);
});

$("btnRefreshNetworkIp").addEventListener("click", async () => {
  $("btnRefreshNetworkIp").disabled = true;
  try {
    if ($("proxyMode").value === "proxy") {
      toast("Seçili profilin Chrome oturumundan IP ölçülüyor…");
      const network = await refreshNetworkIp();
      if (network.ipSource === "chrome") {
        toast(`Chrome çıkış IP: ${network.displayIp}`, "success");
      } else {
        toast(network.warning ?? "Chrome ölçemedi — curl yedek sonuç gösteriliyor", "error");
      }
      return;
    }

    toast("Tarayıcıdan ev IP ölçülüyor…");
    const fromBrowser = await applyBrowserHomeIp(state.profileId);
    if (fromBrowser) {
      state.network = fromBrowser;
      $("lockedIp").textContent = fromBrowser.lockedIp || "—";
      renderNetworkFromSnapshot(fromBrowser);
      $("manualHomeIpField").hidden = true;
      toast(`Ev IP ölçüldü ve kilitlendi: ${fromBrowser.displayIp}`);
    } else {
      await refreshNetworkIp();
      toast("Tarayıcı ölçemedi — manuel IP girin veya .env HOME_PUBLIC_IP", "error");
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    $("btnRefreshNetworkIp").disabled = false;
  }
});

$("btnSaveManualHomeIp").addEventListener("click", async () => {
  const ip = $("manualHomeIp").value.trim();
  if (!ip) {
    toast("Ev IP girin", "error");
    return;
  }
  try {
    const network = await api("/api/network/set-home-ip", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId, ip }),
    });
    state.network = network;
    $("lockedIp").textContent = network.lockedIp || "—";
    $("currentIp").textContent = network.displayIp ?? ip;
    $("manualHomeIpField").hidden = true;
    toast(`Ev IP kaydedildi ve kilitlendi: ${ip}`);
  } catch (error) {
    toast(error.message, "error");
  }
});

$("btnSaveNetwork").addEventListener("click", async () => {
  const proxyMode = $("proxyMode").value;
  const proxySelection = $("proxyUrl").value;
  const isPoolId = state.bootstrap?.proxyPool?.some((p) => p.id === proxySelection);
  await saveWorkerConfig({
    proxyMode,
    proxyId: proxyMode === "proxy" && isPoolId ? proxySelection : "",
    proxyUrl: proxyMode === "proxy" && !isPoolId && proxySelection ? proxySelection : "",
    lockedIp: "",
  });
  $("lockedIp").textContent = "—";
  await loadBootstrap();
  await refreshNetworkIp();
  toast("Ağ taslağı kaydedildi — IP'yi kilitleyin");
  updateChromeLaunchButtonState();
});

$("btnSaveApi").addEventListener("click", async () => {
  const api = readWorkerApiFromForm();
  if (api.nationalityNumber && api.nationalityNumber.length !== 11) {
    toast("TC Kimlik 11 hane olmalı veya boş bırakın", "error");
    return;
  }
  await saveWorkerConfig({
    api,
    timing: readWorkerTimingFromForm(),
  });
});

$("btnStartChrome").addEventListener("click", async () => {
  const btn = $("btnStartChrome");
  const launchError = validateChromeLaunchReady();
  if (launchError) {
    toast(launchError, "error");
    return;
  }
  if (state.profileStatus?.chrome?.ready) {
    toast("Chrome zaten açık — «Chrome Kapat» ile kapatın.", "info");
    updateChromeLaunchButtonState();
    return;
  }
  if (state.chromeLaunchInProgress) {
    return;
  }

  state.chromeLaunchInProgress = true;
  updateChromeLaunchButtonState();
  try {
    const network = readNetworkDraft();
    const cdpPort = readCdpPortInput();
    await saveWorkerConfig({
      proxyMode: network.proxyMode,
      proxyId: network.proxyId,
      proxyUrl: network.proxyUrl,
    });
    const lockedIp = $("lockedIp").textContent.trim().replace("—", "");
    const result = await api("/api/chrome/start", {
      method: "POST",
      body: JSON.stringify({
        profileId: state.profileId,
        proxyMode: network.proxyMode,
        proxyId: network.proxyId,
        proxyUrl: network.proxyUrl,
        cdpPort,
        lockedIp: lockedIp || undefined,
      }),
    });
    const launch = result.launch ?? result;
    const portNote = result.assignedCdpPort ? ` (port ${result.assignedCdpPort})` : "";
    if (launch.reusedExisting) {
      toast(
        "Chrome yeniden kullanıldı — proxy uygulanmadı. Tekrar «Chrome Aç» deneyin.",
        "error",
      );
    } else {
      const proxyNote = launch.proxyApplied ? ` Proxy: ${launch.proxyApplied}.` : "";
      toast((launch.message ?? "Chrome başlatıldı") + portNote + proxyNote, launch.ok ? "success" : "error");
    }
    if (result.googleLogin && !result.googleLogin.skipped) {
      toast(
        result.googleLogin.detail,
        result.googleLogin.ready ? "success" : "error",
      );
    } else if (result.googleLogin?.detail?.includes("zaten hazırdı")) {
      toast("Google zaten giriş yapmış — bu normal, proxy ile ilgili değil.", "info");
    }
    if (result.assignedCdpPort && $("cdpPortInput")) {
      $("cdpPortInput").value = String(result.assignedCdpPort);
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.chromeLaunchInProgress = false;
    await refreshWorkflowUi();
  }
});

$("btnStopChrome").addEventListener("click", async () => {
  const btn = $("btnStopChrome");
  btn.disabled = true;
  try {
    const result = await api("/api/chrome/stop", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId }),
    });
    toast(
      result.stopped > 0
        ? `Chrome kapatildi (${result.stopped} surec)`
        : result.killedPortPids?.length
          ? `Port dinleyici kapatildi (PID: ${result.killedPortPids.join(", ")})`
          : "Panel Chrome sureci bulunamadi — debug penceresini elle kapatip tekrar deneyin",
    );
  } catch (error) {
    toast(error.message, "error");
  } finally {
    await refreshWorkflowUi();
  }
});

$("btnStartWorkflow").addEventListener("click", async () => {
  const btn = $("btnStartWorkflow");
  btn.disabled = true;
  try {
    if ($("proxyMode").value === "direct" && !$("lockedIp").textContent.trim().replace("—", "")) {
      await refreshNetworkIp();
    }
    const status = await api(`/api/status?profileId=${encodeURIComponent(state.profileId)}`);
    if (!status?.chrome?.ready) {
      throw new Error(
        "Chrome CDP hazır değil. Önce «Chrome Aç», ardından API İzlemeyi Başlatın (portal akışı otomatik).",
      );
    }
    const apiParams = readWorkerApiFromForm();
    if (apiParams.nationalityNumber && apiParams.nationalityNumber.length !== 11) {
      throw new Error("TC Kimlik 11 hane olmalı — Worker ayarlarını kontrol edin");
    }
    const timing = readWorkerTimingFromForm();
    const result = await api("/api/run/api-watcher-workflow", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId, api: apiParams, timing }),
    });
    const steps = (result.steps ?? []).join(" → ");
    toast(`API izleme başladı${steps ? `: ${steps}` : ""}`);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    await refreshWorkflowUi();
  }
});

$("btnStopApiWatcher").addEventListener("click", async () => {
  try {
    const result = await api("/api/run/api-watcher/stop", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId }),
    });
    toast(
      result.stopped > 0
        ? `API Watcher durduruldu (${result.stopped} süreç) — watcher oturumu silindi`
        : "Çalışan API Watcher yok",
    );
    await refreshWorkflowUi();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("btnValidateApiDates").addEventListener("click", async () => {
  $("btnValidateApiDates").disabled = true;
  try {
    const report = await api("/api/diagnostics/validate-api-dates");
    renderValidationReport(report);
    toast(report.ok ? "Tarih mantığı OK" : "Bazı testler başarısız", report.ok ? "success" : "error");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    $("btnValidateApiDates").disabled = false;
  }
});

$("btnRefreshAll").addEventListener("click", () => refreshAll().catch((e) => toast(e.message, "error")));
$("btnRefreshProcesses").addEventListener("click", () =>
  refreshProcesses().catch((e) => toast(e.message, "error")),
);

function openChromeProfileEditor(profileId = null) {
  state.editingChromeProfileId = profileId;
  const dialog = $("chromeProfileDialog");
  const profile = profileId
    ? state.bootstrap?.chromeProfiles?.find((p) => p.id === profileId)
    : null;
  $("chromeProfileDialogTitle").textContent = profile ? "Chrome profili düzenle" : "Yeni Chrome profili";
  $("chromeProfileName").value = profile?.name ?? "";
  $("chromeProfileId").value = profile?.id ?? "";
  $("chromeProfileId").disabled = Boolean(profile);
  $("chromeProfileEmail").value = profile?.chromeEmail ?? "";
  $("chromeProfilePassword").value = "";
  $("chromeProfilePreferredPort").value = profile?.preferredCdpPort ?? "";
  dialog?.showModal();
}

async function saveChromeProfileFromDialog(event) {
  event.preventDefault();
  const name = $("chromeProfileName").value.trim();
  const chromeEmail = $("chromeProfileEmail").value.trim();
  const chromePassword = $("chromeProfilePassword").value;
  const preferredRaw = $("chromeProfilePreferredPort").value.trim();
  const preferredCdpPort = preferredRaw ? Number.parseInt(preferredRaw, 10) : null;
  const saveBtn = $("btnSaveChromeProfile");

  if (!name || !chromeEmail) {
    toast("Ad ve Chrome email zorunlu", "error");
    return;
  }
  if (!state.editingChromeProfileId && !chromePassword.trim()) {
    toast("Yeni profil için Chrome şifre zorunlu", "error");
    return;
  }
  if (state.editingChromeProfileId && !chromePassword.trim()) {
    toast("Şifre değiştirmek için yeni şifreyi yazın (boş bırakırsanız eski şifre kalır)", "error");
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Kaydediliyor…";
  }

  try {
    if (state.editingChromeProfileId) {
      const result = await api("/api/chrome-profiles/update", {
        method: "POST",
        body: JSON.stringify({
          profileId: state.editingChromeProfileId,
          name,
          chromeEmail,
          chromePassword: chromePassword.trim(),
          preferredCdpPort,
        }),
      });
      const profile = result.profile ?? result;
      if (state.bootstrap?.chromeProfiles && profile) {
        state.bootstrap.chromeProfiles = state.bootstrap.chromeProfiles.map((p) =>
          p.id === profile.id ? profile : p,
        );
      }
      if (result.passwordUpdated) {
        toast("Şifre kaydedildi — Chrome'u kapatıp yeniden açın", "success");
      } else {
        toast("Profil güncellendi (şifre değişmedi)", "success");
      }
      $("chromeProfileDialog")?.close();
      renderChromeProfileCards();
      await loadBootstrap({ light: true });
    } else {
      const id = $("chromeProfileId").value.trim() || undefined;
      const result = await api("/api/chrome-profiles/create", {
        method: "POST",
        body: JSON.stringify({
          name,
          id,
          chromeEmail,
          chromePassword,
          preferredCdpPort,
        }),
      });
      toast("Chrome profili oluşturuldu");
      $("chromeProfileDialog")?.close();

      if (result.profile) {
        const profiles = state.bootstrap?.chromeProfiles ?? [];
        state.bootstrap = state.bootstrap ?? {};
        state.bootstrap.chromeProfiles = [...profiles.filter((p) => p.id !== result.profile.id), result.profile];
        state.profileId = result.profile.id;
        renderChromeProfileCards();
        renderProfileMeta({ id: result.profile.id, name: result.profile.name });
        void selectProfile(result.profile.id, { light: true });
      }
      void refreshAll().catch((error) => toast(error.message, "error"));
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Kaydet";
    }
  }
}

async function deleteChromeProfile(profileId) {
  if (!profileId) return;
  const profile = state.bootstrap?.chromeProfiles?.find((p) => p.id === profileId);
  const label = profile?.name ?? profileId;
  if (!window.confirm(`«${label}» Chrome profilini silmek istediğinize emin misiniz?`)) {
    return;
  }
  try {
    await api("/api/chrome-profiles/delete", {
      method: "POST",
      body: JSON.stringify({ profileId }),
    });
    if (state.bootstrap?.chromeProfiles) {
      state.bootstrap.chromeProfiles = state.bootstrap.chromeProfiles.filter((p) => p.id !== profileId);
    }
    if (state.profileId === profileId) {
      const nextId = state.bootstrap?.chromeProfiles?.[0]?.id ?? "profile-1";
      state.profileId = nextId;
      renderChromeProfileCards();
      await selectProfile(nextId, { light: true });
    } else {
      renderChromeProfileCards();
    }
    toast("Chrome profili silindi");
    void refreshAll().catch((error) => toast(error.message, "error"));
  } catch (error) {
    toast(error.message, "error");
  }
}

function parseProxyProfilesField(raw) {
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function renderProxyPoolCards() {
  const container = $("proxyPoolList");
  if (!container) {
    return;
  }

  const proxies = (state.bootstrap?.proxyPool ?? []).filter((p) => p.id);
  if (proxies.length === 0) {
    container.innerHTML =
      `<p class="note">Kayıtlı proxy yok — «+ Proxy ekle» veya bağlantı modunda «Doğrudan (ev interneti)» kullanın.</p>`;
    return;
  }

  container.innerHTML = proxies
    .map(
      (proxy) => `
      <div class="profile-list-row ${$("proxyUrl").value === proxy.id ? "profile-list-row-active" : ""}">
        <div>
          <strong>${proxy.label}</strong>
          <small>${proxy.host}:${proxy.port}${proxy.ispStatic ? " · WAN statik" : ""}${proxy.exitIp ? ` · IP ${proxy.exitIp}` : ""}</small>
        </div>
        <div class="inline-actions">
          <button type="button" class="btn btn-ghost btn-compact" data-proxy-edit="${proxy.id}">Düzenle</button>
          <button type="button" class="btn btn-ghost btn-compact" data-proxy-delete="${proxy.id}">Sil</button>
        </div>
      </div>`,
    )
    .join("");

  container.querySelectorAll("[data-proxy-edit]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await loadPanelProxiesFull().catch(() => {});
      openProxyEditor(btn.getAttribute("data-proxy-edit"));
    });
  });
  container.querySelectorAll("[data-proxy-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteProxyRecord(btn.getAttribute("data-proxy-delete")));
  });
}

function openProxyEditor(proxyId) {
  const dialog = $("proxyDialog");
  const pool = state.bootstrap?.proxyPool ?? [];
  const proxy = proxyId ? pool.find((p) => p.id === proxyId) : null;
  const full = proxyId ? state.panelProxies?.find((p) => p.id === proxyId) ?? proxy : null;

  $("proxyDialogTitle").textContent = proxy ? "Proxy düzenle" : "Yeni proxy";
  $("proxyEditId").value = proxy?.id ?? "";
  $("proxyRecordId").value = proxy?.id ?? "";
  $("proxyRecordId").disabled = Boolean(proxy);
  $("proxyLabel").value = proxy?.label ?? "";
  $("proxyHost").value = proxy?.host ?? "gate-isp.proxynet.io";
  $("proxyPort").value = proxy?.port ? String(proxy.port) : "8036";
  $("proxyUsername").value = full?.username ?? "";
  $("proxyUsername").placeholder = "ProxyNet kullanıcı adı";
  $("proxyPassword").value = "";
  $("proxyPassword").placeholder = full?.hasPassword
    ? "Kayıtlı — değiştirmek için yeni parola"
    : "Parola";
  $("proxyProtocol").value = proxy?.protocol ?? "http";
  $("proxyExitIp").value = proxy?.exitIp ?? "";
  $("proxyIspStatic").checked = proxy?.ispStatic === true;
  $("proxyEnabled").checked = proxy?.enabled !== false;
  $("proxyProfiles").value = (proxy?.profiles ?? []).join(", ");

  dialog?.showModal();
}

async function loadPanelProxiesFull() {
  const data = await api("/api/proxy-pool");
  state.panelProxies = data.proxies ?? [];
  return state.panelProxies;
}

async function saveProxyFromDialog(event) {
  event.preventDefault();
  const editId = $("proxyEditId").value.trim();
  const username = $("proxyUsername").value.trim();
  const password = $("proxyPassword").value;
  const payload = {
    label: $("proxyLabel").value.trim(),
    host: $("proxyHost").value.trim(),
    port: Number.parseInt($("proxyPort").value, 10),
    protocol: $("proxyProtocol").value,
    exitIp: $("proxyExitIp").value.trim() || undefined,
    ispStatic: $("proxyIspStatic").checked,
    enabled: $("proxyEnabled").checked,
    profiles: parseProxyProfilesField($("proxyProfiles").value),
  };
  if (username) {
    payload.username = username;
  }
  if (password.trim()) {
    payload.password = password.trim();
  }

  try {
    if (editId) {
      await api("/api/proxy-pool/update", {
        method: "POST",
        body: JSON.stringify({ id: editId, ...payload }),
      });
      toast("Proxy güncellendi");
    } else {
      if (!payload.label || !payload.host || !payload.port) {
        throw new Error("Etiket, host ve port zorunlu.");
      }
      if (
        (payload.username && !payload.password) ||
        (!payload.username && payload.password)
      ) {
        throw new Error("Kullanıcı adı ve parola birlikte girilmeli.");
      }
      const id = $("proxyRecordId").value.trim();
      await api("/api/proxy-pool/create", {
        method: "POST",
        body: JSON.stringify({ ...payload, id: id || undefined }),
      });
      toast("Proxy eklendi");
    }
    $("proxyDialog")?.close();
    await refreshAll();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteProxyRecord(proxyId) {
  const proxy = state.bootstrap?.proxyPool?.find((p) => p.id === proxyId);
  if (!proxy) {
    return;
  }
  if (!window.confirm(`«${proxy.label}» proxy kaydı silinsin mi?`)) {
    return;
  }
  try {
    await api("/api/proxy-pool/delete", { method: "POST", body: JSON.stringify({ id: proxyId }) });
    if ($("proxyUrl").value === proxyId) {
      $("proxyUrl").value = "";
    }
    toast("Proxy silindi");
    await refreshAll();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function testProxyIpFromDialog() {
  const editId = $("proxyEditId").value.trim();
  try {
    if (!editId) {
      toast("Önce kaydedin, sonra IP ölçün.", "error");
      return;
    }
    const result = await api("/api/proxy-pool/test-ip", {
      method: "POST",
      body: JSON.stringify({ id: editId }),
    });
    $("proxyExitIp").value = result.exitIp ?? "";
    if (result.warning) {
      toast(result.warning, "error");
    } else {
      toast(result.updated ? `Çıkış IP kaydedildi: ${result.exitIp}` : `Çıkış IP: ${result.exitIp}`);
    }
    await refreshAll();
  } catch (error) {
    toast(error.message, "error");
  }
}

$("btnAddProxy")?.addEventListener("click", async () => {
  await loadPanelProxiesFull().catch(() => {});
  openProxyEditor(null);
});
$("proxyForm")?.addEventListener("submit", saveProxyFromDialog);
$("btnCancelProxy")?.addEventListener("click", () => $("proxyDialog")?.close());
$("btnTestProxyIp")?.addEventListener("click", () => {
  void testProxyIpFromDialog();
});

$("btnManageChromeProfiles")?.addEventListener("click", () => openChromeProfileEditor(null));
$("btnAddChromeProfile")?.addEventListener("click", () => openChromeProfileEditor(null));
$("chromeProfileForm")?.addEventListener("submit", saveChromeProfileFromDialog);
$("btnCancelChromeProfile")?.addEventListener("click", () => $("chromeProfileDialog")?.close());

refreshAll().catch((error) => {
  $("panelStatus").textContent = "Panel bağlantı hatası";
  $("panelStatus").className = "badge error";
  toast(error.message, "error");
});

setInterval(() => {
  refreshWorkflowUi().catch(() => {});
}, 8000);
