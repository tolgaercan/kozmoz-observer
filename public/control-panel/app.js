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

function applyWorkerToForm(worker) {
  $("proxyMode").value = worker.proxyMode ?? "direct";
  $("lockedIp").textContent = worker.lockedIp || "—";
  $("proxyUrlField").hidden = worker.proxyMode !== "proxy";
  if (worker.proxyUrl) {
    $("proxyUrl").value = worker.proxyUrl;
  }
  if (worker.api?.dealerOffice) {
    $("dealerOffice").value = worker.api.dealerOffice;
  }
  if (worker.api?.appointmentStyle) {
    $("appointmentStyle").value = worker.api.appointmentStyle;
  }
  renderApiPreview();
}

function renderProcesses(processes) {
  const tbody = $("processTableBody");
  tbody.innerHTML = "";

  const active = (processes ?? []).filter((p) => p.status === "running" || p.status === "starting");
  if (active.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Aktif süreç yok</td></tr>`;
    return;
  }

  for (const proc of active) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${proc.kind}</td>
      <td><code>${proc.profileId}</code></td>
      <td>${proc.label}</td>
      <td><span class="status-pill ${statusClass(proc.status)}">${proc.status}</span></td>
      <td>${proc.pid ?? "—"}</td>
      <td>${formatTime(proc.startedAt)}</td>
      <td><button type="button" class="btn btn-danger" data-kill="${proc.id}">Kill</button></td>
    `;
    tbody.appendChild(tr);
  }

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

  $("currentIp").textContent = data.publicIp ?? "unknown";
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
    [{ value: "", label: "— Seç —" }, ...proxyPool.map((url) => ({ value: url, label: url }))],
    (o) => o.value,
    (o) => o.label,
    data.worker?.proxyUrl ?? "",
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
}

async function refreshProcesses() {
  const data = await api("/api/processes");
  renderProcesses(data.processes);
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
  await refreshStatus();
  await refreshProcesses();
}

$("profileSelect").addEventListener("change", async (event) => {
  state.profileId = event.target.value;
  await refreshAll();
});

$("proxyMode").addEventListener("change", (event) => {
  $("proxyUrlField").hidden = event.target.value !== "proxy";
});

$("dealerOffice").addEventListener("change", renderApiPreview);
$("appointmentStyle").addEventListener("change", renderApiPreview);

$("btnLockCurrentIp").addEventListener("click", async () => {
  const ip = $("currentIp").textContent.trim();
  if (!ip || ip === "unknown") {
    toast("Public IP alınamadı", "error");
    return;
  }
  await saveWorkerConfig({ lockedIp: ip });
  $("lockedIp").textContent = ip;
});

$("btnSaveNetwork").addEventListener("click", async () => {
  await saveWorkerConfig({
    proxyMode: $("proxyMode").value,
    proxyUrl: $("proxyMode").value === "proxy" ? $("proxyUrl").value : undefined,
    lockedIp: $("lockedIp").textContent.trim() === "—" ? undefined : $("lockedIp").textContent.trim(),
  });
});

$("btnSaveApi").addEventListener("click", async () => {
  await saveWorkerConfig({
    api: {
      dealerOffice: $("dealerOffice").value,
      appointmentStyle: $("appointmentStyle").value,
    },
  });
});

$("btnStartChrome").addEventListener("click", async () => {
  $("btnStartChrome").disabled = true;
  try {
    const result = await api("/api/chrome/start", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId }),
    });
    toast(result.launch?.message ?? "Chrome başlatıldı");
    await refreshStatus();
    await refreshProcesses();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    $("btnStartChrome").disabled = false;
  }
});

$("btnRunApiWatcher").addEventListener("click", async () => {
  try {
    const apiParams = {
      dealerOffice: $("dealerOffice").value,
      appointmentStyle: $("appointmentStyle").value,
    };
    const result = await api("/api/run/api-watcher", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId, api: apiParams }),
    });
    toast(`API Watcher başlatıldı (${result.process?.id?.slice(0, 8)}…)`);
    await refreshProcesses();
  } catch (error) {
    toast(error.message, "error");
  }
});

$("btnRunDomObserver").addEventListener("click", async () => {
  try {
    const result = await api("/api/run/dom-observer", {
      method: "POST",
      body: JSON.stringify({ profileId: state.profileId }),
    });
    toast(`DOM Observer başlatıldı (${result.process?.id?.slice(0, 8)}…)`);
    await refreshProcesses();
  } catch (error) {
    toast(error.message, "error");
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
  refreshStatus().catch(() => {});
  refreshProcesses().catch(() => {});
}, 8000);
