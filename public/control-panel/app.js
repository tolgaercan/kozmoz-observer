const INTERVAL_OPTIONS = [
  { label: "1 dk", ms: 60_000 },
  { label: "3 dk", ms: 180_000 },
  { label: "5 dk", ms: 300_000 },
  { label: "10 dk", ms: 600_000 },
  { label: "15 dk", ms: 900_000 },
];

function formatIntervalLabel(ms) {
  const match = INTERVAL_OPTIONS.find((option) => option.ms === ms);
  if (match) return match.label;
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
};

function toast(message, type = "success") {
  const stack = $("toastStack");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? body.message ?? `HTTP ${response.status}`);
  }
  return body;
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
    return;
  }
  $("profileMeta").innerHTML = `
    <strong>${profile.name}</strong> · <code>${profile.id}</code><br>
    CDP port: <code>${profile.cdpPort}</code> · Mod: ${profile.mode}
    ${profile.lifecycleState ? ` · Durum: ${profile.lifecycleState}` : ""}
  `;
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
  if (!status) {
    el.textContent = "Chrome durumu yükleniyor…";
    el.className = "chrome-status";
    return;
  }
  el.className = `chrome-status ${status.chrome.ready ? "ready" : "down"}`;
  el.innerHTML = status.chrome.ready
    ? `Chrome CDP hazır — <code>${status.chrome.endpoint}</code>`
    : `Chrome CDP kapalı — port <code>${status.cdpPort}</code> (debug modda başlatın)`;
}

function renderApiPreview() {
  const dealer = $("dealerOffice").value;
  const style = $("appointmentStyle").value;
  const office = state.bootstrap?.dealerOffices?.find((o) => o.name === dealer);
  const styleOpt = state.bootstrap?.appointmentStyles?.find((s) => s.label === style);

  $("apiPreview").innerHTML = office
    ? `
      <strong>GetClosedDate</strong><br>
      dealerOffice: <code>${office.name}</code> → dealerId <code>${office.dealerId}</code><br>
      appointmentStyle: <code>${style}</code> → appointmentTypeId <code>${styleOpt?.appointmentTypeId ?? "?"}</code>
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
    `Chrome CDP kapalıysa otomatik başlatılır. Portal oturumu yoksa JWT için appointmentForm sayfasına gider. ` +
    `Watcher öncesi doğru IP'yi kilitleyin. Bu profil: poll ${formatIntervalLabel(timing.pollIntervalMs)}, Telegram ${formatIntervalLabel(timing.telegramReportIntervalMs)}.`;
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

async function refreshNetworkIp() {
  const proxyMode = $("proxyMode").value;
  const proxyId = $("proxyUrl").value;
  const params = new URLSearchParams({
    profileId: state.profileId,
    proxyMode,
    skipServerMeasure: "true",
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
    hint.textContent = network.warning ?? "Seçili proxy statik çıkış IP";
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

  renderNetworkHints();
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
  if (state.network) {
    renderNetworkFromSnapshot(state.network);
    return;
  }
  const savedMode = state.bootstrap?.connectionMode ?? state.worker?.proxyMode ?? "direct";
  const formMode = $("proxyMode").value;
  const homeIp = state.bootstrap?.homePublicIp ?? "unknown";
  const proxyIp = state.bootstrap?.publicIp ?? "unknown";
  const homeWarning = state.bootstrap?.homeIpWarning;
  const measuredWan = state.bootstrap?.measuredWanIp;
  const label = $("currentIpLabel");
  const hint = $("currentIpHint");
  const selectedId = $("proxyUrl").value;
  const selected = state.bootstrap?.proxyPool?.find((p) => p.id === selectedId);

  if (formMode === "proxy") {
    label.textContent = "Proxy çıkış IP";
    if (savedMode === "proxy" && formMode === "proxy") {
      $("currentIp").textContent = proxyIp;
      hint.textContent =
        selected?.ispStatic ? "ProxyNet ISP statik IP (WAN)" : "Proxy modu — ölçülen çıkış IP";
    } else if (selected?.exitIp) {
      $("currentIp").textContent = selected.exitIp;
      hint.textContent = "Kaydet — proxy IP doğrulanır";
    } else {
      $("currentIp").textContent = "—";
      hint.textContent = "Proxy seçin, kaydedin ve yenileyin";
    }
  } else {
    label.textContent = "Ev public IP";
    if (homeIp === "unknown" && measuredWan) {
      $("currentIp").textContent = "—";
      hint.textContent = homeWarning ?? `WAN ${measuredWan} — ProxyNet IP, ev interneti değil`;
    } else {
      $("currentIp").textContent = homeIp;
      hint.textContent = homeWarning ?? "Doğrudan mod — proxy bypass (direct://)";
    }
  }
}

function renderNetworkHints() {
  const mode = $("proxyMode").value;
  const hint = $("networkModeHint");
  const proxyHint = $("proxyExitHint");
  const selectedId = $("proxyUrl").value;
  const selected = state.bootstrap?.proxyPool?.find((p) => p.id === selectedId);

  renderCurrentIpDisplay();

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
      "Proxy modu: trafik seçilen statik çıkış IP'sinden gider. Kaydettikten sonra IP'yi kilitleyin.";
    proxyHint.textContent = selected?.exitIp
      ? `Statik çıkış IP: ${selected.exitIp}`
      : selected
        ? "Proxy seçildi — kaydet ve kilitle"
        : "Listeden statik IP proxy seçin";
  }
}

function applyWorkerToForm(worker) {
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
  const intervalOptions = state.bootstrap?.runtimeOptionsMs;
  const pollMs = worker.timing?.pollIntervalMs ?? INTERVAL_OPTIONS[2].ms;
  const telegramMs = worker.timing?.telegramReportIntervalMs ?? INTERVAL_OPTIONS[2].ms;
  fillIntervalSelect($("workerPollInterval"), pollMs, intervalOptions);
  fillIntervalSelect($("workerTelegramInterval"), telegramMs, intervalOptions);
  renderApiPreview();
  renderNetworkHints();
  void refreshNetworkIp().catch(() => {});
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
  const stepWatcher = $("stepWatcher");
  const btnStop = $("btnStopApiWatcher");
  const btnStart = $("btnStartWorkflow");

  stepProfile.className = state.profileId ? "done" : "";
  stepApi.className = $("dealerOffice").value && $("appointmentStyle").value ? "done" : "";
  stepChrome.className = status?.chrome?.ready ? "done" : "";
  stepWatcher.className = apiWatcherRunning ? "done active" : "";

  if (btnStop) {
    btnStop.hidden = !apiWatcherRunning;
  }
  if (btnStart) {
    btnStart.disabled = apiWatcherRunning || status?.rateLimit?.blocked;
    btnStart.title = status?.rateLimit?.blocked
      ? "Ban / rate limit aktif — bekleyin"
      : apiWatcherRunning
        ? "Watcher zaten çalışıyor"
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">Aktif süreç yok</td></tr>`;
    return;
  }

  for (const proc of active) {
    const tr = document.createElement("tr");
    const isWatcher = proc.kind === "api-watcher";
    const pollMs = proc.runtime?.pollIntervalMs ?? INTERVAL_OPTIONS[2].ms;
    const telegramMs = proc.runtime?.telegramReportIntervalMs ?? INTERVAL_OPTIONS[2].ms;

    tr.innerHTML = `
      <td>${proc.kind}</td>
      <td><code>${proc.profileId}</code></td>
      <td>${proc.label}</td>
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
        await api("/api/process/kill", {
          method: "POST",
          body: JSON.stringify({ processId: btn.dataset.kill }),
        });
        toast("Süreç sonlandırıldı");
        await refreshProcesses();
      } catch (error) {
        toast(error.message, "error");
      }
    });
  });
}

async function loadBootstrap() {
  const data = await api(`/api/bootstrap?profileId=${encodeURIComponent(state.profileId)}`);
  state.bootstrap = data;
  state.worker = data.worker;

  renderCurrentIpDisplay();
  $("panelStatus").textContent = "Panel bağlı";
  $("panelStatus").className = "badge online";

  fillSelect(
    $("profileSelect"),
    data.profiles.filter((p) => p.enabled),
    (p) => p.id,
    (p) => `${p.name} (${p.id})`,
    state.profileId,
  );

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

  const proxyPool = data.proxyPool ?? [];
  fillSelect(
    $("proxyUrl"),
    [{ id: "", label: "— Seç —", host: "", port: 0, enabled: true }, ...proxyPool],
    (o) => o.id,
    (o) => formatProxyOption(o),
    data.worker?.proxyId ?? data.worker?.proxyUrl ?? "",
  );

  const profile = data.profiles.find((p) => p.id === state.profileId);
  renderProfileMeta(profile);
  applyWorkerToForm(data.worker);
  $("lastUpdated").textContent = `Son güncelleme: ${new Date().toLocaleString("tr-TR")}`;
}

async function refreshStatus() {
  const status = await api(`/api/status?profileId=${encodeURIComponent(state.profileId)}`);
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
  toast("Ayarlar kaydedildi");
}

async function refreshAll() {
  await loadBootstrap();
  await refreshWorkflowUi();
}

$("profileSelect").addEventListener("change", async (event) => {
  state.profileId = event.target.value;
  await refreshAll();
});

$("proxyMode").addEventListener("change", (event) => {
  $("proxyUrlField").hidden = event.target.value !== "proxy";
  refreshNetworkIp().catch((e) => toast(e.message, "error"));
});

$("proxyUrl").addEventListener("change", () => {
  refreshNetworkIp().catch((e) => toast(e.message, "error"));
});

$("dealerOffice").addEventListener("change", renderApiPreview);
$("appointmentStyle").addEventListener("change", renderApiPreview);
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
  toast("Ağ ayarı kaydedildi — IP'yi yeniden kilitleyin");
});

$("btnSaveApi").addEventListener("click", async () => {
  await saveWorkerConfig({
    api: {
      dealerOffice: $("dealerOffice").value,
      appointmentStyle: $("appointmentStyle").value,
    },
    timing: readWorkerTimingFromForm(),
  });
});

$("btnStartWorkflow").addEventListener("click", async () => {
  const btn = $("btnStartWorkflow");
  btn.disabled = true;
  try {
    if ($("proxyMode").value === "direct" && !$("lockedIp").textContent.trim().replace("—", "")) {
      await refreshNetworkIp();
    }
    const apiParams = {
      dealerOffice: $("dealerOffice").value,
      appointmentStyle: $("appointmentStyle").value,
    };
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
        ? `API Watcher durduruldu (${result.stopped} süreç)`
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

refreshAll().catch((error) => {
  $("panelStatus").textContent = "Panel bağlantı hatası";
  $("panelStatus").className = "badge error";
  toast(error.message, "error");
});

setInterval(() => {
  refreshWorkflowUi().catch(() => {});
}, 8000);
