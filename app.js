const STORAGE_KEY = "customer-tracker.records.v1";
const REALTIME_API = "/api/customers";
const REALTIME_EVENTS = "/api/events";

const stageLabels = {
  lead: "Lead",
  prospect: "Prospect",
  active: "Active",
  "at-risk": "At risk",
  won: "Won",
};

const twoFactorMethodLabels = {
  authenticator: "Authenticator app",
  sms: "SMS",
  email: "Email",
};

const seedCustomers = [
  {
    id: createId(),
    name: "Amina Johnson",
    company: "Northline Retail",
    email: "amina@northline.example",
    phone: "+1 555 0198",
    stage: "prospect",
    value: 12800,
    followUp: offsetDate(1),
    owner: "Sales",
    twoFactor: {
      enabled: true,
      method: "authenticator",
      status: "pending",
      code: generateTwoFactorCode(),
      verifiedAt: "",
    },
    notes: "Interested in a quarterly support package. Send pricing options and implementation timeline.",
    updatedAt: new Date().toISOString(),
  },
  {
    id: createId(),
    name: "Marcus Chen",
    company: "Harbor Analytics",
    email: "marcus@harbor.example",
    phone: "+1 555 0144",
    stage: "active",
    value: 34000,
    followUp: offsetDate(5),
    owner: "Success",
    twoFactor: {
      enabled: true,
      method: "authenticator",
      status: "verified",
      code: "438912",
      verifiedAt: new Date(Date.now() - 172800000).toISOString(),
    },
    notes: "Current customer. Wants a check-in about reporting exports and team onboarding.",
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: createId(),
    name: "Priya Shah",
    company: "Cobalt Studio",
    email: "priya@cobalt.example",
    phone: "+1 555 0162",
    stage: "at-risk",
    value: 9100,
    followUp: offsetDate(-1),
    owner: "Success",
    twoFactor: {
      enabled: false,
      method: "authenticator",
      status: "pending",
      code: "",
      verifiedAt: "",
    },
    notes: "Renewal concern after delayed support response. Follow up with recovery plan.",
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
  },
];

let customers = loadCustomers();
let selectedCustomerId = customers[0]?.id ?? null;
let activeView = "dashboard";
let activeFilter = "all";
let realtimeEnabled = false;
let remoteSaveTimer = null;
let eventSource = null;

const elements = {
  title: document.querySelector("#view-title"),
  views: document.querySelectorAll(".view"),
  navItems: document.querySelectorAll(".nav-item"),
  search: document.querySelector("#global-search"),
  newCustomer: document.querySelector("#new-customer-btn"),
  export: document.querySelector("#export-btn"),
  liveStatus: document.querySelector("#live-status"),
  metricGrid: document.querySelector("#metric-grid"),
  pipeline: document.querySelector("#pipeline"),
  priorityTasks: document.querySelector("#priority-tasks"),
  allTasks: document.querySelector("#all-tasks"),
  customerList: document.querySelector("#customer-list"),
  customerDetail: document.querySelector("#customer-detail"),
  sort: document.querySelector("#sort-select"),
  segments: document.querySelectorAll(".segment"),
  dialog: document.querySelector("#customer-dialog"),
  form: document.querySelector("#customer-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  closeDialog: document.querySelector("#close-dialog-btn"),
  cancelDialog: document.querySelector("#cancel-dialog-btn"),
  deleteCustomer: document.querySelector("#delete-customer-btn"),
  generateTwoFactorCode: document.querySelector("#generate-2fa-code-btn"),
};

const fields = {
  id: document.querySelector("#customer-id"),
  name: document.querySelector("#customer-name"),
  company: document.querySelector("#customer-company"),
  email: document.querySelector("#customer-email"),
  phone: document.querySelector("#customer-phone"),
  stage: document.querySelector("#customer-stage"),
  value: document.querySelector("#customer-value"),
  followUp: document.querySelector("#customer-follow-up"),
  owner: document.querySelector("#customer-owner"),
  twoFactorEnabled: document.querySelector("#customer-2fa-enabled"),
  twoFactorMethod: document.querySelector("#customer-2fa-method"),
  twoFactorStatus: document.querySelector("#customer-2fa-status"),
  twoFactorCode: document.querySelector("#customer-2fa-code"),
  notes: document.querySelector("#customer-notes"),
};

bindEvents();
render();
initializeRealtime();

function bindEvents() {
  elements.navItems.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.search.addEventListener("input", render);
  elements.sort.addEventListener("change", renderCustomers);
  elements.newCustomer.addEventListener("click", () => openCustomerDialog());
  elements.closeDialog.addEventListener("click", closeDialog);
  elements.cancelDialog.addEventListener("click", closeDialog);
  elements.export.addEventListener("click", exportCustomers);
  elements.generateTwoFactorCode.addEventListener("click", () => {
    fields.twoFactorCode.value = generateTwoFactorCode();
    fields.twoFactorStatus.value = "pending";
  });
  fields.twoFactorEnabled.addEventListener("change", syncTwoFactorControls);

  elements.segments.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      elements.segments.forEach((segment) => segment.classList.toggle("active", segment === button));
      renderCustomers();
    });
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCustomer();
  });

  elements.deleteCustomer.addEventListener("click", deleteSelectedCustomer);
}

function setView(view) {
  activeView = view;
  elements.title.textContent = view === "customers" ? "Customers" : view === "tasks" ? "Follow-ups" : "Dashboard";
  elements.views.forEach((section) => section.classList.toggle("active", section.id === `${view}-view`));
  elements.navItems.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  render();
}

function loadCustomers() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCustomers(seedCustomers)));
    return normalizeCustomers(seedCustomers);
  }

  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? normalizeCustomers(parsed) : normalizeCustomers(seedCustomers);
  } catch {
    return normalizeCustomers(seedCustomers);
  }
}

function persist() {
  writeLocalCustomers(customers);
  broadcastLocalCustomers();

  if (realtimeEnabled) {
    queueRemoteSave();
  }
}

async function initializeRealtime() {
  bindLocalRealtime();

  if (!canUseRealtimeServer()) {
    setLiveStatus("Local mode", "local");
    return;
  }

  try {
    const remoteCustomers = normalizeCustomers(await fetchCustomers());
    if (remoteCustomers.length) {
      customers = remoteCustomers;
      selectedCustomerId = customers[0]?.id ?? selectedCustomerId;
      writeLocalCustomers(customers);
    } else if (customers.length) {
      await saveRemoteCustomers();
    }

    realtimeEnabled = true;
    setLiveStatus("Live sync", "live");
    openRealtimeStream();
    render();
  } catch {
    realtimeEnabled = false;
    setLiveStatus("Offline local", "offline");
  }
}

function canUseRealtimeServer() {
  return location.protocol === "http:" || location.protocol === "https:";
}

async function fetchCustomers() {
  const response = await fetch(REALTIME_API, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to load customers.");
  return response.json();
}

async function saveRemoteCustomers() {
  const response = await fetch(REALTIME_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(customers),
  });

  if (!response.ok) throw new Error("Unable to save customers.");
}

function queueRemoteSave() {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(async () => {
    try {
      await saveRemoteCustomers();
      setLiveStatus("Live sync", "live");
    } catch {
      realtimeEnabled = false;
      setLiveStatus("Offline local", "offline");
    }
  }, 180);
}

function openRealtimeStream() {
  eventSource?.close();
  eventSource = new EventSource(REALTIME_EVENTS);

  eventSource.addEventListener("customers", (event) => {
    customers = normalizeCustomers(JSON.parse(event.data));
    writeLocalCustomers(customers);
    keepSelectionVisible();
    render();
    setLiveStatus("Live sync", "live");
  });

  eventSource.addEventListener("error", () => {
    setLiveStatus("Reconnecting", "offline");
  });
}

function bindLocalRealtime() {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue || realtimeEnabled) return;
    customers = normalizeCustomers(JSON.parse(event.newValue));
    keepSelectionVisible();
    render();
  });

  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("customer-tracker-live");
    window.customerTrackerChannel = channel;
    channel.addEventListener("message", (event) => {
      if (realtimeEnabled || event.data?.type !== "customers") return;
      customers = normalizeCustomers(event.data.customers);
      keepSelectionVisible();
      render();
    });
  }
}

function broadcastLocalCustomers() {
  window.customerTrackerChannel?.postMessage({ type: "customers", customers });
}

function writeLocalCustomers(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCustomers(records)));
}

function keepSelectionVisible() {
  if (!customers.some((customer) => customer.id === selectedCustomerId)) {
    selectedCustomerId = customers[0]?.id ?? null;
  }
}

function setLiveStatus(text, mode) {
  elements.liveStatus.textContent = text;
  elements.liveStatus.className = `live-status ${mode === "live" ? "" : mode}`;
}

function render() {
  renderMetrics();
  renderPipeline();
  renderTasks();
  renderCustomers();
}

function renderMetrics() {
  const openCustomers = customers.filter((customer) => customer.stage !== "won");
  const totalValue = customers.reduce((sum, customer) => sum + Number(customer.value || 0), 0);
  const dueNow = customers.filter((customer) => ["overdue", "today"].includes(getTaskStatus(customer.followUp))).length;
  const atRisk = customers.filter((customer) => customer.stage === "at-risk").length;
  const pendingTwoFactor = customers.filter((customer) => customer.twoFactor?.enabled && customer.twoFactor.status !== "verified").length;

  const metrics = [
    ["Total customers", customers.length],
    ["Open pipeline", openCustomers.length],
    ["Pipeline value", formatCurrency(totalValue)],
    ["Needs attention", dueNow + atRisk + pendingTwoFactor],
  ];

  elements.metricGrid.innerHTML = metrics
    .map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderPipeline() {
  const maxCount = Math.max(1, ...Object.keys(stageLabels).map((stage) => countByStage(stage)));
  elements.pipeline.innerHTML = Object.entries(stageLabels)
    .map(([stage, label]) => {
      const count = countByStage(stage);
      const width = `${Math.max(4, (count / maxCount) * 100)}%`;
      return `
        <div class="stage-row">
          <strong>${label}</strong>
          <div class="stage-bar" aria-hidden="true"><div class="stage-fill" style="--width: ${width}"></div></div>
          <span class="muted">${count}</span>
        </div>
      `;
    })
    .join("");
}

function renderTasks() {
  const tasks = customers
    .filter((customer) => customer.followUp)
    .sort((a, b) => parseDate(a.followUp) - parseDate(b.followUp));

  const priority = tasks.filter((customer) => ["overdue", "today"].includes(getTaskStatus(customer.followUp))).slice(0, 5);
  elements.priorityTasks.innerHTML = priority.length ? priority.map(taskTemplate).join("") : emptyState("No urgent follow-ups.");
  elements.allTasks.innerHTML = tasks.length ? tasks.map(taskTemplate).join("") : emptyState("No follow-ups scheduled.");
}

function renderCustomers() {
  const list = getVisibleCustomers();

  if (!list.some((customer) => customer.id === selectedCustomerId)) {
    selectedCustomerId = list[0]?.id ?? customers[0]?.id ?? null;
  }

  elements.customerList.innerHTML = list.length ? list.map(customerCardTemplate).join("") : emptyState("No customers match this view.");
  elements.customerList.querySelectorAll(".customer-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedCustomerId = card.dataset.id;
      renderCustomers();
    });
  });

  renderCustomerDetail();
}

function getVisibleCustomers() {
  const term = elements.search.value.trim().toLowerCase();
  const sortValue = elements.sort.value;

  return customers
    .filter((customer) => activeFilter === "all" || customer.stage === activeFilter)
    .filter((customer) => {
      const haystack = [
        customer.name,
        customer.company,
        customer.email,
        customer.phone,
        customer.owner,
        customer.notes,
        twoFactorLabel(customer.twoFactor),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    })
    .sort((a, b) => {
      if (sortValue === "name") return a.name.localeCompare(b.name);
      if (sortValue === "value") return Number(b.value || 0) - Number(a.value || 0);
      if (sortValue === "followUp") return dateSortValue(a.followUp) - dateSortValue(b.followUp);
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

function renderCustomerDetail() {
  const customer = customers.find((item) => item.id === selectedCustomerId);
  if (!customer) {
    elements.customerDetail.className = "customer-detail empty";
    elements.customerDetail.innerHTML = "Select a customer to see details.";
    return;
  }

  elements.customerDetail.className = "customer-detail";
  elements.customerDetail.innerHTML = `
    <article class="detail-card">
      <div class="detail-header">
        <div>
          <span class="tag ${customer.stage}">${stageLabels[customer.stage]}</span>
          <h2>${escapeHtml(customer.name)}</h2>
          <p class="muted">${escapeHtml(customer.company || "No company recorded")}</p>
        </div>
        <div class="detail-actions">
          <button class="icon-button" type="button" id="edit-selected-btn" title="Edit customer" aria-label="Edit customer">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 17.3V21h3.7L18.8 9.9l-3.7-3.7L4 17.3ZM21.7 7c.4-.4.4-1 0-1.4l-2.3-2.3c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.7 3.7L21.7 7Z" /></svg>
          </button>
        </div>
      </div>
      <div class="detail-grid">
        ${factTemplate("Email", customer.email || "Not set")}
        ${factTemplate("Phone", customer.phone || "Not set")}
        ${factTemplate("Owner", customer.owner || "Unassigned")}
        ${factTemplate("Value", formatCurrency(customer.value))}
        ${factTemplate("Follow-up", formatDate(customer.followUp))}
        ${factTemplate("2FA", twoFactorLabel(customer.twoFactor))}
        ${factTemplate("Updated", formatDate(customer.updatedAt))}
      </div>
      <div class="note-block">
        <span>Notes</span>
        <p>${escapeHtml(customer.notes || "No notes yet.")}</p>
      </div>
    </article>
  `;

  document.querySelector("#edit-selected-btn").addEventListener("click", () => openCustomerDialog(customer));
}

function customerCardTemplate(customer) {
  return `
    <button class="customer-card ${customer.id === selectedCustomerId ? "active" : ""}" type="button" data-id="${customer.id}">
      <span class="customer-card-header">
        <strong>${escapeHtml(customer.name)}</strong>
        <span class="tag ${customer.stage}">${stageLabels[customer.stage]}</span>
      </span>
      <span class="muted">${escapeHtml(customer.company || "No company")}</span>
      <span class="customer-meta">
        <span>${formatCurrency(customer.value)}</span>
        <span>${formatDate(customer.followUp)}</span>
        <span>${twoFactorShortLabel(customer.twoFactor)}</span>
      </span>
    </button>
  `;
}

function taskTemplate(customer) {
  const status = getTaskStatus(customer.followUp);
  return `
    <article class="task-item ${status}">
      <div class="task-item-header">
        <div>
          <h3>${escapeHtml(customer.name)}</h3>
          <p class="muted">${escapeHtml(customer.company || "No company")}</p>
        </div>
        <span class="tag ${status === "overdue" ? "at-risk" : "active"}">${taskLabel(customer.followUp)}</span>
      </div>
    </article>
  `;
}

function factTemplate(label, value) {
  return `<div class="fact"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function emptyState(message) {
  return `<div class="empty-state">${message}</div>`;
}

function openCustomerDialog(customer = null) {
  const editing = Boolean(customer);
  elements.dialogTitle.textContent = editing ? "Edit customer" : "New customer";
  elements.deleteCustomer.hidden = !editing;

  fields.id.value = customer?.id ?? "";
  fields.name.value = customer?.name ?? "";
  fields.company.value = customer?.company ?? "";
  fields.email.value = customer?.email ?? "";
  fields.phone.value = customer?.phone ?? "";
  fields.stage.value = customer?.stage ?? "lead";
  fields.value.value = customer?.value ?? "";
  fields.followUp.value = customer?.followUp ? customer.followUp.slice(0, 10) : "";
  fields.owner.value = customer?.owner ?? "";
  fields.twoFactorEnabled.checked = Boolean(customer?.twoFactor?.enabled);
  fields.twoFactorMethod.value = customer?.twoFactor?.method ?? "authenticator";
  fields.twoFactorStatus.value = customer?.twoFactor?.status ?? "pending";
  fields.twoFactorCode.value = customer?.twoFactor?.code ?? "";
  fields.notes.value = customer?.notes ?? "";

  syncTwoFactorControls();
  elements.dialog.showModal();
  fields.name.focus();
}

function closeDialog() {
  elements.dialog.close();
}

function saveCustomer() {
  const now = new Date().toISOString();
  const id = fields.id.value || createId();
  const nextCustomer = {
    id,
    name: fields.name.value.trim(),
    company: fields.company.value.trim(),
    email: fields.email.value.trim(),
    phone: fields.phone.value.trim(),
    stage: fields.stage.value,
    value: Number(fields.value.value || 0),
    followUp: fields.followUp.value,
    owner: fields.owner.value.trim(),
    twoFactor: buildTwoFactorRecord(id),
    notes: fields.notes.value.trim(),
    updatedAt: now,
  };

  const existingIndex = customers.findIndex((customer) => customer.id === id);
  if (existingIndex >= 0) {
    customers[existingIndex] = nextCustomer;
  } else {
    customers.unshift(nextCustomer);
  }

  selectedCustomerId = id;
  persist();
  closeDialog();
  setView("customers");
}

function deleteSelectedCustomer() {
  const id = fields.id.value;
  if (!id) return;
  const customer = customers.find((item) => item.id === id);
  const confirmed = confirm(`Delete ${customer?.name || "this customer"}?`);
  if (!confirmed) return;

  customers = customers.filter((item) => item.id !== id);
  selectedCustomerId = customers[0]?.id ?? null;
  persist();
  closeDialog();
  render();
}

function exportCustomers() {
  const csv = [
    ["Name", "Company", "Email", "Phone", "Stage", "Value", "Follow Up", "Owner", "2FA Required", "2FA Method", "2FA Status", "2FA Code", "Notes"],
    ...customers.map((customer) => [
      customer.name,
      customer.company,
      customer.email,
      customer.phone,
      stageLabels[customer.stage],
      customer.value,
      customer.followUp,
      customer.owner,
      customer.twoFactor?.enabled ? "Yes" : "No",
      twoFactorMethodLabels[customer.twoFactor?.method] ?? "",
      customer.twoFactor?.status ?? "",
      customer.twoFactor?.code ?? "",
      customer.notes,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function countByStage(stage) {
  return customers.filter((customer) => customer.stage === stage).length;
}

function getTaskStatus(dateValue) {
  if (!dateValue) return "clear";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${dateValue}T00:00:00`);
  if (date < today) return "overdue";
  if (date.getTime() === today.getTime()) return "today";
  return "upcoming";
}

function taskLabel(dateValue) {
  const status = getTaskStatus(dateValue);
  if (status === "overdue") return "Overdue";
  if (status === "today") return "Today";
  return formatDate(dateValue);
}

function dateSortValue(value) {
  return value ? parseDate(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function formatDate(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parseDate(value));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `customer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCustomers(records) {
  return records.map((customer) => ({
    ...customer,
    twoFactor: {
      enabled: false,
      method: "authenticator",
      status: "pending",
      code: "",
      verifiedAt: "",
      ...(customer.twoFactor ?? {}),
    },
  }));
}

function syncTwoFactorControls() {
  const enabled = fields.twoFactorEnabled.checked;
  fields.twoFactorMethod.disabled = !enabled;
  fields.twoFactorStatus.disabled = !enabled;
  fields.twoFactorCode.disabled = !enabled;
  elements.generateTwoFactorCode.disabled = !enabled;

  if (enabled && !fields.twoFactorCode.value) {
    fields.twoFactorCode.value = generateTwoFactorCode();
  }

  if (!enabled) {
    fields.twoFactorStatus.value = "pending";
  }
}

function buildTwoFactorRecord(customerId) {
  const existing = customers.find((customer) => customer.id === customerId)?.twoFactor;
  const enabled = fields.twoFactorEnabled.checked;
  const status = enabled ? fields.twoFactorStatus.value : "pending";
  const wasVerified = existing?.status === "verified";

  return {
    enabled,
    method: fields.twoFactorMethod.value,
    status,
    code: enabled ? fields.twoFactorCode.value || generateTwoFactorCode() : "",
    verifiedAt: status === "verified" ? existing?.verifiedAt || new Date().toISOString() : wasVerified ? existing.verifiedAt : "",
  };
}

function generateTwoFactorCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function twoFactorLabel(twoFactor) {
  if (!twoFactor?.enabled) return "Not required";
  const method = twoFactorMethodLabels[twoFactor.method] ?? "Authenticator app";
  const status = twoFactor.status === "verified" ? "Verified" : "Pending";
  return `${status} - ${method}`;
}

function twoFactorShortLabel(twoFactor) {
  if (!twoFactor?.enabled) return "2FA off";
  return twoFactor.status === "verified" ? "2FA verified" : "2FA pending";
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
