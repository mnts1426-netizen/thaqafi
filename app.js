let state = loadState();
let currentView = "intro"; // الصفحة الافتتاحية ثابتة عند كل فتح للموقع
let activeStageId = null; // null | 'middle' (الفتيان) | 'elementary' (الأشبال) - يُختار قبل ظهور الرئيسية في كل دخول
let activeTeamId = null; // الفريق الذي نحن داخل صفحته - كل صفحات الفريق تعرض بياناته فقط
let pendingMatch = null;
let academySubView = null; // null | 'buildings' | 'employees' | 'players'
let cardsSubView = null; // null | 'effect' | 'action' | 'discipline'
let showFullResults = false; // إظهار الإجمالي الكامل (كل الدورات + الأكاديمية) في شاشة النتائج - يُطلَب صريحاً كل زيارة
const openModals = [];

const root = document.getElementById("app");
const T = CONFIG.texts;

// حالة المرحلة المختارة حالياً (الفتيان أو الأشبال) - كل الفرق والمباريات والنتائج معزولة تماماً بين المرحلتين
function stage() {
  return state.stages[activeStageId];
}

function stageConfig(id) {
  return CONFIG.stages.find((s) => s.id === id);
}

function persist() {
  saveState(state);
}

function getTeam(id) {
  return stage().teams.find((t) => t.id === id);
}

function activeTeam() {
  return getTeam(activeTeamId);
}

function countItems(counts, list) {
  return list.reduce((sum, item) => sum + ((counts && counts[item.id]) || 0), 0);
}

function pointsFromCounts(counts, list) {
  return list.reduce((sum, item) => sum + ((counts && counts[item.id]) || 0) * item.cost, 0);
}

// كل عنصر مع مفتاح تخزينه في بيانات الفريق، لتوحيد التعامل مع المباني/الموظفين/اللاعبين
function allShopCategories() {
  return [
    { key: "buildings", list: CONFIG.buildings },
    { key: "employees", list: CONFIG.employees },
    { key: "players", list: CONFIG.players },
  ];
}

function allShopItemsFlat() {
  const out = [];
  allShopCategories().forEach(({ key, list }) => list.forEach((item) => out.push({ key, item })));
  return out;
}

function academyStats(team) {
  const buildingCount = countItems(team.buildings, CONFIG.buildings);
  const employeeCount = countItems(team.employees, CONFIG.employees);
  const playerBatches = countItems(team.players, CONFIG.players);
  const playerCount = playerBatches * (CONFIG.players[0]?.batchSize || 5);
  const academyTotal =
    pointsFromCounts(team.buildings, CONFIG.buildings) +
    pointsFromCounts(team.employees, CONFIG.employees) +
    pointsFromCounts(team.players, CONFIG.players);
  return { buildingCount, employeeCount, playerBatches, playerCount, academyTotal };
}

// النتيجة النهائية = نقاط الدوري + نقاط الأكاديمية (أثر البطاقات مطبَّق أصلاً أثناء اللعب، لا يُخصم مرة أخرى)
function finalScore(team) {
  return team.matches.points + academyStats(team).academyTotal;
}

function rankedTeams() {
  return stage().teams.slice().sort((a, b) => {
    const diff = finalScore(b) - finalScore(a);
    if (diff) return diff;
    if (b.matches.points !== a.matches.points) return b.matches.points - a.matches.points;
    return academyStats(b).academyTotal - academyStats(a).academyTotal;
  });
}

// كل مباراة = جولة واحدة تضم كل فرق المرحلة معًا. سجل الجولات الجديد يحمل results؛ أي سجل قديم بين فريقين يُتجاهل هنا
function roundEntries() {
  return stage().matchLog.filter((m) => Array.isArray(m.results));
}

function nextRoundNumber() {
  return roundEntries().length + 1;
}

function lastRoundEntry() {
  const list = roundEntries();
  return list.length ? list[list.length - 1] : null;
}

// مكافأة الرصيد حسب الملكية: تُجمع لكل وحدة مملوكة على حدة حسب فئة تكلفتها الأساسية الثابتة
// (مبنى يحتاج موظفاً غير موظَّف بعد لا تُحسب مكافأته هنا أبداً)
function ownershipBalanceBonus(team, result) {
  let total = 0;
  allShopItemsFlat().forEach(({ key, item }) => {
    const count = team[key][item.id] || 0;
    if (count <= 0) return;
    const tier = CONFIG.ownershipBonusTiers[item.cost];
    if (tier) total += count * tier[result];
  });
  return total;
}

function goalBalanceBonus(result, goals) {
  return (CONFIG.goalBonus[result] || 0) * goals;
}

// مكافأة رصيد ثابتة إضافية حسب نتيجة المباراة فقط - منفصلة تمامًا عن نقاط الدوري ولا تُجمع معها أبداً
function resultBalanceBonus(result) {
  return CONFIG.resultBalanceBonus[result] || 0;
}

// السعر الفعلي للوحدة التالية (الموظفون واللاعبون يتضاعف سعرهم مع كل وحدة يملكها الفريق، والمبنى سعره ثابت ويُشترى مرة واحدة)
function nextItemCost(team, key, item) {
  if (key === "buildings") return item.cost;
  const count = team[key][item.id] || 0;
  return CONFIG.priceDoublingPerUnit ? item.cost * Math.pow(2, count) : item.cost;
}

function ownsOneOfEverything(team) {
  return allShopItemsFlat().every(({ key, item }) => (team[key][item.id] || 0) >= 1);
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nowISO() {
  return new Date().toISOString();
}

function timeLabel(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return "";
  }
}

function roundLabel(n) {
  return `الجولة ${n}`;
}

const TEAM_COLORS = ["#12a89b", "#f2a93b", "#e5484d", "#6c5ce7", "#0984e3", "#00b894", "#e17055", "#d63384"];

function teamColor(team) {
  return TEAM_COLORS[(team.order || 0) % TEAM_COLORS.length];
}

function avatarHtml(team, size) {
  return `<span class="team-avatar" style="background:${teamColor(team)}; width:${size}px; height:${size}px; font-size:${Math.round(size * 0.45)}px;">${esc(
    (team.name || "?").trim().charAt(0)
  )}</span>`;
}

const RESULT_LABELS = { win: "فوز", draw: "تعادل", loss: "خسارة" };

function resultChip(result, label) {
  return `<span class="result-chip ${result}">${label || RESULT_LABELS[result]}</span>`;
}

// تسمية مركز الفريق في مباراة الفرق كلها (مع الإشارة لأي تعادل)
function tierLabel(r) {
  return r.tied ? `تعادل — المركز ${r.place}` : `المركز ${r.place}`;
}

function effectCardById(id) {
  return CONFIG.effectCards.find((c) => c.id === id);
}

/* ================= النوافذ المنبثقة ================= */
function openModal({ html, boxClass = "", dismissable = true, onClose }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-box ${boxClass}">${html}</div>`;
  document.body.appendChild(overlay);
  const entry = { overlay, dismissable, close: null };
  entry.close = () => {
    const i = openModals.indexOf(entry);
    if (i !== -1) openModals.splice(i, 1);
    overlay.remove();
    if (onClose) onClose();
  };
  openModals.push(entry);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && dismissable) entry.close();
  });
  return entry;
}

function closeTopModal() {
  const top = openModals[openModals.length - 1];
  if (!top) return false;
  if (top.dismissable) top.close();
  return true;
}

function notice(title, message, icon = "ℹ️") {
  const m = openModal({
    boxClass: "game-modal",
    html: `
      <div class="modal-icon">${icon}</div>
      <h2>${esc(title)}</h2>
      <p class="modal-message">${esc(message)}</p>
      <button class="btn btn-gold modal-wide-btn" data-ok>حسنًا</button>`,
  });
  m.overlay.querySelector("[data-ok]").onclick = () => m.close();
}

function confirmModal({ icon = "❓", title, message = "", html = "", confirmLabel = "تأكيد", cancelLabel = "إلغاء", danger = false, onConfirm }) {
  const m = openModal({
    boxClass: "game-modal",
    html: `
      <div class="modal-icon">${icon}</div>
      <h2>${esc(title)}</h2>
      ${message ? `<p class="modal-message">${esc(message)}</p>` : ""}
      ${html}
      <div class="modal-actions">
        <button class="btn btn-outline-light" data-cancel>${esc(cancelLabel)}</button>
        <button class="btn ${danger ? "btn-danger" : "btn-gold"}" data-confirm>${esc(confirmLabel)}</button>
      </div>`,
  });
  m.overlay.querySelector("[data-cancel]").onclick = () => m.close();
  m.overlay.querySelector("[data-confirm]").onclick = () => {
    m.close();
    onConfirm();
  };
}

// اختيار عنصر من قائمة (بدل نافذة الكتابة اليدوية) - options: [{label, value, disabled, note}]
function chooseModal({ icon = "📋", title, message = "", options, onChoose }) {
  const m = openModal({
    boxClass: "game-modal",
    html: `
      <div class="modal-icon">${icon}</div>
      <h2>${esc(title)}</h2>
      ${message ? `<p class="modal-message">${esc(message)}</p>` : ""}
      <div class="choice-list">
        ${options
          .map(
            (o, i) =>
              `<button class="choice-btn" data-i="${i}" ${o.disabled ? "disabled" : ""}>${esc(o.label)}${
                o.note ? `<small>${esc(o.note)}</small>` : ""
              }</button>`
          )
          .join("")}
      </div>
      <button class="btn btn-outline-light modal-wide-btn" data-cancel>إلغاء</button>`,
  });
  m.overlay.querySelector("[data-cancel]").onclick = () => m.close();
  m.overlay.querySelectorAll("[data-i]").forEach((btn) => {
    btn.onclick = () => {
      m.close();
      onChoose(options[parseInt(btn.dataset.i, 10)].value);
    };
  });
}

// نافذة إدخال نص واحد (اسم فريق، إلخ) - textarea اختياري للنصوص الطويلة
function promptModal({ icon = "✏️", title, message = "", defaultValue = "", textarea = false, onSubmit, onCancel }) {
  const fieldHtml = textarea
    ? `<textarea id="promptInput" class="prompt-textarea" rows="10">${esc(defaultValue)}</textarea>`
    : `<input type="text" id="promptInput" class="prompt-input" value="${esc(defaultValue)}" />`;
  const m = openModal({
    boxClass: "game-modal",
    html: `
      <div class="modal-icon">${icon}</div>
      <h2>${esc(title)}</h2>
      ${message ? `<p class="modal-message">${esc(message)}</p>` : ""}
      ${fieldHtml}
      <div class="modal-actions">
        <button class="btn btn-outline-light" data-cancel>إلغاء</button>
        <button class="btn btn-gold" data-save>💾 حفظ واعتماد</button>
      </div>`,
  });
  const input = m.overlay.querySelector("#promptInput");
  input.focus();
  m.overlay.querySelector("[data-cancel]").onclick = () => {
    m.close();
    if (onCancel) onCancel();
  };
  m.overlay.querySelector("[data-save]").onclick = () => {
    const value = input.value.trim();
    if (!value) {
      input.focus();
      return;
    }
    m.close();
    onSubmit(value);
  };
  return m;
}

function requireLand(team) {
  if (team.hasLand) return true;
  notice("🔒 هذه الوظيفة مقفلة", T.landRequired, "🏞️");
  return false;
}

/* ================= التنقل والرجوع ================= */
function setView(view) {
  currentView = view;
  if (view === "results") showFullResults = false; // كل زيارة جديدة لشاشة النتائج تبدأ مقفلة على الإجمالي الكامل
  render();
  window.scrollTo(0, 0);
}

// الرجوع خطوة للخلف (Esc أو Backspace): من القسم الفرعي لقائمته، ومن صفحات الفريق لصفحة الفريق، ومنها للرئيسية
function goBack() {
  if (currentView === "match-live") {
    notice("لا يمكن الرجوع أثناء المباراة", "أنهِ المباراة أو استخدم زر «إلغاء المباراة» للخروج منها.", "⚽");
    return;
  }
  if (currentView === "academy" && academySubView) {
    academySubView = null;
    render();
    return;
  }
  if (currentView === "cards" && cardsSubView) {
    cardsSubView = null;
    render();
    return;
  }
  const parents = {
    "stage-select": "intro",
    setup: "stage-select",
    team: "hub",
    academy: "team",
    support: "team",
    cards: "team",
    "team-results": "team",
    results: "hub",
  };
  const parent = parents[currentView];
  if (!parent) return;
  if (parent === "team" && !activeTeam()) return setView("hub");
  setView(parent);
}

document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
  if (e.key === "Escape" || (e.key === "Backspace" && !typing)) {
    e.preventDefault();
    if (closeTopModal()) return;
    goBack();
  }
});

function addBackButton(container) {
  const labels = {
    team: "← الرئيسية",
    academy: academySubView ? "← أقسام الأكاديمية" : "← صفحة الفريق",
    support: "← صفحة الفريق",
    cards: cardsSubView ? "← أقسام البطاقات" : "← صفحة الفريق",
    "team-results": "← صفحة الفريق",
    results: "← الرئيسية",
  };
  const btn = document.createElement("button");
  btn.className = "back-btn";
  btn.innerHTML = `${labels[currentView] || "← رجوع"} <kbd>Esc</kbd>`;
  btn.onclick = () => goBack();
  container.appendChild(btn);
}

function render() {
  root.innerHTML = "";
  if (currentView === "intro") return renderIntro();
  if (currentView === "stage-select") return renderStageSelect();
  if (currentView === "setup") return renderSetup();
  root.appendChild(renderTopbar());
  const container = document.createElement("div");
  container.className = "container";
  root.appendChild(container);

  switch (currentView) {
    case "team":
      renderTeamPage(container);
      break;
    case "academy":
      renderAcademy(container);
      break;
    case "support":
      renderSupport(container);
      break;
    case "cards":
      renderCards(container);
      break;
    case "team-results":
      renderTeamResults(container);
      break;
    case "results":
      renderResults(container);
      break;
    case "match-live":
      renderMatchLive(container);
      break;
    default:
      renderHub(container);
  }
  // يحفظ تقدّم المباراة الجارية (أو يمسح المحفوظ إن انتهت) في كل مرة تُرسم الصفحة - يحمي من فقدان المباراة لو انكسر الجهاز
  savePendingMatch(activeStageId, pendingMatch);
}

/* ================= الشاشة الافتتاحية ================= */
function renderIntro() {
  const div = document.createElement("div");
  div.className = "intro-screen";

  const sparklePositions = [
    [8, 15], [85, 10], [15, 80], [90, 70], [50, 8], [70, 85], [30, 40], [95, 40], [5, 55],
  ];
  sparklePositions.forEach(([x, y], i) => {
    const s = document.createElement("div");
    s.className = "sparkle";
    s.style.left = x + "%";
    s.style.top = y + "%";
    s.style.width = 6 + (i % 3) * 4 + "px";
    s.style.height = s.style.width;
    s.style.animationDelay = i * 0.3 + "s";
    div.appendChild(s);
  });

  div.innerHTML += `
    <button class="intro-explain-btn" id="btnExplain">📖 شرح المسابقة</button>
    <div class="intro-logo"><img src="assets/logo.png?v=2" alt="شعار الدوري الثقافي" /></div>
    <div class="intro-title">${esc(T.introTitle)}</div>
    <div class="slogans">
      ${T.introSlogans.map((s, i) => `<div class="slogan ${i === 0 ? "right" : ""}">${esc(s)}</div>`).join("")}
    </div>
    <div class="subtext">${esc(T.introSubtext)}</div>
    <button class="btn-start" id="btnStart">${esc(T.startButton)}</button>
  `;

  root.appendChild(div);
  document.getElementById("btnStart").onclick = () => setView("stage-select");
  document.getElementById("btnExplain").onclick = () => openExplainModal();
}

function openExplainModal() {
  const text = state.explainText || CONFIG.explainDefault;
  const paragraphsHtml = esc(text)
    .split(/\n\s*\n/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const m = openModal({
    html: `
      <button class="close-modal" data-close>إغلاق ✕</button>
      <h2>📖 شرح المسابقة</h2>
      ${paragraphsHtml}
      <div class="modal-actions">
        <button class="btn btn-outline" id="btnEditExplain">✏️ تعديل النص</button>
      </div>`,
  });
  m.overlay.querySelector("[data-close]").onclick = () => m.close();
  m.overlay.querySelector("#btnEditExplain").onclick = () => {
    m.close();
    promptModal({
      icon: "📖",
      title: "تعديل شرح المسابقة",
      message: "التعديل يظهر لكل من يفتح شرح المسابقة بعد الحفظ.",
      defaultValue: text,
      textarea: true,
      onSubmit: (newText) => {
        state.explainText = newText;
        persist();
        openExplainModal();
      },
      onCancel: () => openExplainModal(),
    });
  };
}

/* ================= تسجيل الفرق ================= */
function renderSetup() {
  const sc = stageConfig(activeStageId);
  const div = document.createElement("div");
  div.className = "intro-screen";
  div.style.justifyContent = "flex-start";
  div.style.paddingTop = "60px";
  div.innerHTML = `
    <div class="intro-logo small"><img src="assets/logo.png?v=2" alt="" /></div>
    <div class="intro-title">تسجيل فرق ${esc(sc.label)}</div>
    <p style="opacity:0.85; margin-top:-10px;">${esc(sc.sub)}</p>
    <div class="card" style="color:#10222a; max-width:480px; width:100%;">
      <label>كم عدد الفرق المشاركة؟</label>
      <div style="display:flex; gap:10px; margin:10px 0;">
        <input type="number" id="teamCount" min="2" max="16" value="3" style="flex:1;" />
        <button class="btn btn-primary" id="btnGenFields">تأكيد العدد</button>
      </div>
      <div class="setup-team-inputs" id="teamInputs"></div>
      <button class="btn btn-gold" id="btnConfirmTeams" style="width:100%; margin-top:12px; display:none;">✅ بدء الدوري بهذه الفرق</button>
    </div>
  `;
  root.appendChild(div);

  document.getElementById("btnGenFields").onclick = () => {
    const n = parseInt(document.getElementById("teamCount").value, 10) || 0;
    if (n < 2) {
      notice("عدد غير صالح", "يجب أن يكون عدد الفرق فريقين على الأقل.", "⚠️");
      return;
    }
    const wrap = document.getElementById("teamInputs");
    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const defaultName = `${sc.namePrefix} ${i + 1}`;
      wrap.innerHTML += `<input type="text" value="${esc(defaultName)}" placeholder="اسم الفريق ${i + 1}" class="team-name-input" />`;
    }
    document.getElementById("btnConfirmTeams").style.display = "block";
  };

  document.getElementById("btnConfirmTeams").onclick = () => {
    const names = Array.from(document.querySelectorAll(".team-name-input")).map((inp) => inp.value.trim());
    if (names.some((n) => !n)) {
      notice("أسماء ناقصة", "يرجى تعبئة أسماء جميع الفرق.", "⚠️");
      return;
    }
    if (new Set(names).size !== names.length) {
      notice("أسماء مكررة", "يجب أن يكون لكل فريق اسم مختلف.", "⚠️");
      return;
    }
    const stamp = Date.now();
    state.stages[activeStageId] = emptyStage();
    stage().teams = names.map((name, i) => newTeam("team_" + stamp + "_" + i, name, i));
    stage().setupDone = true;
    persist();
    setView("hub");
  };
}

/* ================= اختيار المرحلة (الفتيان / الأشبال) ================= */
function renderStageSelect() {
  const div = document.createElement("div");
  div.className = "intro-screen";
  div.innerHTML = `
    <div class="intro-logo small"><img src="assets/logo.png?v=2" alt="" /></div>
    <div class="intro-title">اختر المرحلة</div>
    <p class="subtext" style="margin-bottom:10px;">لكل مرحلة دوريها وفرقها ونتائجها الخاصة، منفصلة تمامًا عن المرحلة الأخرى.</p>
  `;
  const grid = document.createElement("div");
  grid.className = "grid stage-select-grid";
  CONFIG.stages.forEach((sc) => {
    const st = state.stages[sc.id];
    const btn = document.createElement("button");
    btn.className = "hub-btn stage-btn";
    btn.innerHTML = `
      ${esc(sc.label)}
      <span class="tag">${esc(sc.sub)}</span>
      <span class="tag">${st.teams.length ? `${st.teams.length} فرق مسجّلة` : "لم يبدأ بعد"}</span>`;
    btn.onclick = () => {
      activeStageId = sc.id;
      activeTeamId = null;
      setView(stage().setupDone ? "hub" : "setup");
    };
    grid.appendChild(btn);
  });
  div.appendChild(grid);
  root.appendChild(div);
}

/* ================= الشريط العلوي ================= */
function renderTopbar() {
  const sc = stageConfig(activeStageId);
  const bar = document.createElement("div");
  bar.className = "topbar";
  bar.innerHTML = `
    <button class="brand" id="btnBrandHome" title="الرئيسية">
      <img src="assets/logo.png?v=2" alt="" class="brand-logo" />
      <span>الدوري الثقافي</span>
    </button>
    <div class="topbar-actions">
      <button class="top-btn stage-badge" id="btnSwitchStage" title="تبديل المرحلة">${esc(sc.label)} 🔄</button>
      <button class="top-btn gold" id="btnGeneralResults">🏆 النتائج العامة</button>
      <button class="top-btn ${stage().isFinalMode ? "active" : ""}" id="btnToggleFinal">${stage().isFinalMode ? "🏁 وضع النهائي: مفعّل" : "🏁 تفعيل وضع النهائي"}</button>
      <span class="kbd-hint" title="اضغط Esc أو Backspace للرجوع خطوة للخلف"><kbd>Esc</kbd> رجوع</span>
    </div>
    <button class="top-btn exit" id="btnExit">🚪 خروج</button>
  `;

  const blockedDuringMatch = () => {
    if (currentView !== "match-live") return false;
    notice("المباراة جارية", "أنهِ المباراة أو ألغِها أولاً قبل الانتقال لصفحة أخرى.", "⚽");
    return true;
  };

  bar.querySelector("#btnBrandHome").onclick = () => {
    if (!blockedDuringMatch()) setView("hub");
  };
  bar.querySelector("#btnSwitchStage").onclick = () => {
    if (blockedDuringMatch()) return;
    activeTeamId = null;
    setView("stage-select");
  };
  bar.querySelector("#btnGeneralResults").onclick = () => {
    if (!blockedDuringMatch()) setView("results");
  };
  bar.querySelector("#btnToggleFinal").onclick = () => {
    if (stage().isFinalMode) {
      stage().isFinalMode = false;
      persist();
      render();
      return;
    }
    confirmModal({
      icon: "🏁",
      title: "تفعيل وضع النهائي؟",
      message: "سيتيح وضع النهائي بطاقات المنح والسحب لجميع الفرق.",
      confirmLabel: "تفعيل وضع النهائي",
      onConfirm: () => {
        stage().isFinalMode = true;
        persist();
        render();
      },
    });
  };
  bar.querySelector("#btnExit").onclick = () => {
    if (blockedDuringMatch()) return;
    confirmModal({
      icon: "🚪",
      title: "الخروج من الدوري؟",
      message: "جميع البيانات محفوظة، ويمكنك العودة في أي وقت.",
      confirmLabel: "خروج",
      onConfirm: () => setView("intro"),
    });
  };
  return bar;
}

/* ================= الرئيسية: الفرق ================= */
function renderHub(container) {
  if (!stage().teams.length) {
    container.innerHTML = `<div class="card">لا توجد فرق مسجلة. <button class="btn btn-primary" id="goSetup">تسجيل الفرق</button></div>`;
    container.querySelector("#goSetup").onclick = () => setView("setup");
    return;
  }
  const head = document.createElement("div");
  head.className = "hub-head";
  head.innerHTML = `
    <div>
      <h2>🏆 الفرق</h2>
      <p>اضغط على الفريق للدخول إلى صفحته</p>
    </div>
    <div class="leg-progress">
      <div class="leg-progress-label">⚽ ${esc(roundLabel(nextRoundNumber()))} القادمة — كل الفرق معًا</div>
    </div>`;
  container.appendChild(head);
  container.appendChild(buildNextMatchCard());

  const ranks = rankedTeams().map((t) => t.id);
  const grid = document.createElement("div");
  grid.className = "grid team-card-grid";
  stage().teams.forEach((t) => {
    const s = academyStats(t);
    const card = document.createElement("button");
    card.className = "team-card" + (t.hasLand ? "" : " no-land");
    card.style.setProperty("--team-color", teamColor(t));
    card.innerHTML = `
      <span class="team-card-rank">#${ranks.indexOf(t.id) + 1}</span>
      ${avatarHtml(t, 58)}
      <div class="team-card-name">${esc(t.name)}</div>
      <div class="team-card-stats">
        <span title="الرصيد">💰 ${t.balance}</span>
        <span title="المباني">🏢 ${s.buildingCount}</span>
        <span title="نقاط الدوري">⚽ ${t.matches.points}</span>
      </div>
      <span class="land-badge ${t.hasLand ? "ok" : "missing"}">${t.hasLand ? "🏞️ لديه أرض الأكاديمية" : "🔒 بدون أرض أكاديمية"}</span>
    `;
    card.onclick = () => {
      activeTeamId = t.id;
      setView("team");
    };
    grid.appendChild(card);
  });
  container.appendChild(grid);
}

// بطاقة بدء المباراة القادمة: كل فرق المرحلة تلعب معًا في مباراة واحدة (تُحسب جولة)
function buildNextMatchCard() {
  const card = document.createElement("div");
  card.className = "next-match-card";
  card.innerHTML = `
    <div class="next-match-title">⚽ ${esc(roundLabel(nextRoundNumber()))} — مباراة كاملة لكل الفرق، وتنتهي الجولة بانتهاء المباراة</div>
    <div class="next-match-vs">${stage()
      .teams.map((t) => `<span class="nm-team">${avatarHtml(t, 40)} ${esc(t.name)}</span>`)
      .join('<span class="nm-vs">VS</span>')}</div>
    <button class="btn-start" id="btnStartMatch">⚽ ابدأ المباراة</button>`;
  card.querySelector("#btnStartMatch").onclick = () => startMatch();
  return card;
}

/* ================= صفحة الفريق ================= */
function renderTeamPage(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  addBackButton(container);

  const s = academyStats(team);
  const header = document.createElement("div");
  header.className = "team-header";
  header.style.setProperty("--team-color", teamColor(team));
  header.innerHTML = `
    ${avatarHtml(team, 72)}
    <div class="team-header-info">
      <h2>${esc(team.name)} <button class="edit-name-btn" id="btnEditName" title="تعديل اسم الفريق">✏️ تعديل الاسم</button></h2>
      <div class="team-header-chips">
        <span>💰 الرصيد: <b>${team.balance}</b></span>
        <span>⚽ نقاط الدوري: <b>${team.matches.points}</b></span>
        <span>🏗️ نقاط الأكاديمية: <b>${s.academyTotal}</b></span>
        <span class="${team.hasLand ? "ok" : "missing"}">${team.hasLand ? "🏞️ لديه أرض الأكاديمية" : "🔒 بدون أرض أكاديمية"}</span>
      </div>
    </div>`;
  container.appendChild(header);
  header.querySelector("#btnEditName").onclick = () => {
    promptModal({
      icon: "✏️",
      title: "تعديل اسم الفريق",
      message: "سيظهر الاسم الجديد في كل مكان (الرئيسية، المباريات، النتائج، السجلات).",
      defaultValue: team.name,
      onSubmit: (newName) => {
        const duplicate = stage().teams.some((t) => t.id !== team.id && t.name === newName);
        if (duplicate) {
          notice("اسم مستخدم", "يوجد فريق آخر بنفس الاسم في هذه المرحلة، اختر اسمًا مختلفًا.", "⚠️");
          return;
        }
        team.name = newName;
        persist();
        render();
      },
    });
  };

  if (!team.hasLand) {
    const lock = document.createElement("div");
    lock.className = "lock-banner";
    lock.innerHTML = `
      <div><b>🔒 ${esc(T.landRequired)}</b><br/>امنح الفريق أرض الأكاديمية من خانة الدعم أو اشترها من متجر الأكاديمية لفتح البناء. المباريات والبطاقات تعمل بلا شرط.</div>
      <button class="btn btn-gold" id="goGrantLand">🤝 اذهب إلى الدعم</button>`;
    container.appendChild(lock);
    lock.querySelector("#goGrantLand").onclick = () => setView("support");
  }

  container.appendChild(buildNextMatchCard());

  const tiles = [
    { id: "academy", icon: "🏗️", label: "إنشاء الأكاديمية", needsLand: false },
    { id: "support", icon: "🤝", label: "الدعم", needsLand: false },
    { id: "cards", icon: "🃏", label: "البطاقات", needsLand: false },
    { id: "team-results", icon: "📊", label: "نتائج الفريق", needsLand: false },
  ];
  const grid = document.createElement("div");
  grid.className = "grid";
  tiles.forEach((tile) => {
    const locked = tile.needsLand && !team.hasLand;
    const btn = document.createElement("button");
    btn.className = "hub-btn" + (locked ? " locked" : "");
    btn.innerHTML = `<span class="icon">${tile.icon}</span>${tile.label}${locked ? '<span class="lock-tag">🔒 يتطلب أرض الأكاديمية</span>' : ""}`;
    btn.onclick = () => {
      if (locked) return requireLand(team);
      if (tile.id === "academy") academySubView = null;
      if (tile.id === "cards") cardsSubView = null;
      setView(tile.id);
    };
    grid.appendChild(btn);
  });
  container.appendChild(grid);
  container.appendChild(buildTeamActivityCard(team));
}

// سجل الفريق الموحّد: كل ما عمله الفريق وما حصل عليه (مباريات، مشتريات، دعم، بطاقات)، الأحدث أولاً
function buildTeamActivityCard(team) {
  const items = [
    ...team.purchaseLog.map((l) => ({ at: l.at, html: esc(l.text) })),
    ...team.supportLog.map((l) => ({ at: l.at, html: esc(l.text) })),
    ...team.cardLog.map((l) => ({ at: l.at, html: esc(l.text) })),
    ...stage()
      .matchLog.filter((m) => Array.isArray(m.results) && m.results.some((r) => r.teamId === team.id))
      .map((m) => {
        const r = m.results.find((x) => x.teamId === team.id);
        return {
          at: m.at,
          html: `⚽ ${esc(roundLabel(m.round))}: ${esc(tierLabel(r))} — ${r.score} هدف، <b>+${r.leaguePoints}</b> نقطة دوري${
            r.rescued ? " (منها نقطة الإنقاذ 🚑)" : ""
          }، <b>+${r.bonus}</b> رصيد`,
        };
      }),
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>📜 سجل الفريق</h3>${
    items.length
      ? `<ul class="log-list">${items
          .map((i) => `<li>${i.html}${i.at ? ` <small>${esc(timeLabel(i.at))}</small>` : ""}</li>`)
          .join("")}</ul>`
      : '<p class="small-note">لم يعمل الفريق أي شيء بعد.</p>'
  }`;
  return card;
}

/* ================= إنشاء الأكاديمية ================= */
function renderAcademy(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  addBackButton(container);

  if (!team.hasLand) {
    const canAfford = team.balance >= CONFIG.landCost;
    const lock = document.createElement("div");
    lock.className = "lock-banner";
    lock.innerHTML = `
      <div>
        <b>🔒 ${esc(T.landRequired)}</b>
        <div class="small-note" style="margin-top:4px;">💰 رصيد الفريق: ${team.balance} نقطة — سعر الأرض ${CONFIG.landCost} نقطة</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn shop-btn ${canAfford ? "buy" : "poor"}" id="btnBuyLand">${canAfford ? `🏞️ شراء الأرض — ${CONFIG.landCost} نقطة` : `الرصيد غير كافٍ (${CONFIG.landCost})`}</button>
        <button class="btn btn-gold" id="goGrantLand">🤝 اذهب إلى الدعم</button>
      </div>`;
    container.appendChild(lock);
    lock.querySelector("#goGrantLand").onclick = () => setView("support");
    lock.querySelector("#btnBuyLand").onclick = () => {
      if (team.balance < CONFIG.landCost) return notice("الرصيد غير كافٍ", `رصيد الفريق ${team.balance} نقطة، وسعر الأرض ${CONFIG.landCost} نقطة.`, "💰");
      confirmModal({
        icon: "🏞️",
        title: "شراء أرض الأكاديمية؟",
        message: `سيُخصم ${CONFIG.landCost} نقطة من رصيد فريق ${team.name} (الرصيد الحالي ${team.balance}).`,
        confirmLabel: "تأكيد الشراء",
        onConfirm: () => {
          if (team.hasLand || team.balance < CONFIG.landCost) return;
          team.balance -= CONFIG.landCost;
          team.hasLand = true;
          team.supportLog.push({ at: nowISO(), text: `🏞️ اشترى الفريق أرض الأكاديمية بنفسه (${CONFIG.landCost} نقطة)` });
          persist();
          render();
          fireConfetti(window.innerWidth / 2, 180, 50);
        },
      });
    };
    return;
  }

  const s = academyStats(team);
  const head = document.createElement("div");
  head.className = "card";
  head.innerHTML = `
    <h2 style="margin:0 0 6px;">🏗️ أكاديمية ${esc(team.name)}</h2>
    <div class="balance-line">💰 رصيد الفريق: <b>${team.balance}</b> نقطة</div>
    <div class="small-note">ℹ️ تكرار شراء موظف أو دفعة لاعبين يتطلب امتلاك عنصر واحد على الأقل من كل نوع أولاً، وسعر التكرار يتضاعف.</div>`;
  container.appendChild(head);

  const categories = [
    { key: "buildings", label: "المباني", icon: "🏢", list: CONFIG.buildings, summary: `${s.buildingCount} / ${CONFIG.buildings.length}` },
    { key: "employees", label: "الموظفون", icon: "👨‍💼", list: CONFIG.employees, summary: `${s.employeeCount} موظف` },
    { key: "players", label: "اللاعبون", icon: "👥", list: CONFIG.players, summary: `${s.playerCount} لاعب` },
  ];

  if (!academySubView) {
    const grid = document.createElement("div");
    grid.className = "grid";
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "hub-btn";
      btn.innerHTML = `<span class="icon">${cat.icon}</span> ${cat.label}<span class="tag">يملك: ${cat.summary}</span>`;
      btn.onclick = () => {
        academySubView = cat.key;
        render();
      };
      grid.appendChild(btn);
    });
    container.appendChild(grid);
    return;
  }

  const active = categories.find((c) => c.key === academySubView);
  container.appendChild(buildShopSection(`${active.icon} ${active.label}`, active.list, team, active.key));
}

function buildShopSection(title, list, team, key) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${title}</h3>`;
  const everything = ownsOneOfEverything(team);

  list.forEach((item) => {
    const count = team[key][item.id] || 0;
    const cost = nextItemCost(team, key, item);
    const row = document.createElement("div");
    row.className = "item-row shop-row";

    let ownedText = "";
    if (key === "buildings") ownedText = count > 0 ? "✅ الفريق يمتلكه بالفعل" : "لم يُبنَ بعد";
    else if (key === "players") ownedText = `لدى الفريق: ${count * (item.batchSize || 5)} لاعب`;
    else ownedText = `لدى الفريق: ${count}`;

    let state_ = "buy";
    let btnLabel = `شراء — ${cost} نقطة`;
    if (key === "buildings" && count > 0) {
      state_ = "owned";
      btnLabel = "✅ مملوك";
    } else if (key !== "buildings" && count > 0 && !everything) {
      state_ = "gated";
      btnLabel = "🔒 أكمل كل العناصر أولاً";
    } else if (team.balance < cost) {
      state_ = "poor";
      btnLabel = `الرصيد غير كافٍ (${cost})`;
    }

    row.innerHTML = `
      <div class="shop-item">
        <b>${esc(item.name)}</b> ${item.basic ? '<span class="tag">أساسي</span>' : ""}
        <div class="shop-meta">${ownedText} · السعر: ${cost} نقطة</div>
      </div>
      <button class="btn shop-btn ${state_}">${btnLabel}</button>`;

    row.querySelector("button").onclick = () => {
      if (state_ === "owned") return notice("لا يمكن الشراء", "لا يمكن شراء هذا المبنى، لأن الفريق يمتلكه بالفعل.", "🏢");
      if (state_ === "gated")
        return notice("لا يمكن التكرار الآن", "لا يمكن شراء عنصر ثانٍ قبل امتلاك عنصر واحد على الأقل من كل المباني والموظفين واللاعبين.", "🔒");
      if (state_ === "poor") return notice("الرصيد غير كافٍ", `رصيد الفريق ${team.balance} نقطة، والسعر ${cost} نقطة.`, "💰");
      confirmModal({
        icon: key === "buildings" ? "🏢" : key === "players" ? "👥" : "👨‍💼",
        title: `شراء «${item.name}»؟`,
        message: `سيُخصم ${cost} نقطة من رصيد فريق ${team.name} (الرصيد الحالي ${team.balance}).`,
        confirmLabel: "تأكيد الشراء",
        onConfirm: () => {
          if (key === "buildings" && (team[key][item.id] || 0) > 0) return;
          if (team.balance < cost) return;
          team.balance -= cost;
          team[key][item.id] = (team[key][item.id] || 0) + 1;
          team.purchaseLog.push({ at: nowISO(), text: `🏗️ شراء «${item.name}» بـ ${cost} نقطة` });
          persist();
          render();
          fireConfetti(window.innerWidth / 2, 160, 24);
        },
      });
    };
    card.appendChild(row);
  });
  return card;
}

/* ================= الدعم (للفريق الحالي فقط) ================= */
function renderSupport(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  addBackButton(container);

  const head = document.createElement("div");
  head.className = "card";
  head.innerHTML = `
    <h2 style="margin:0 0 6px;">🤝 دعم فريق ${esc(team.name)}</h2>
    <div class="balance-line">💰 رصيد الفريق: <b>${team.balance}</b> نقطة</div>
    <div class="small-note">الدعم يُمنح لهذا الفريق مباشرة حسب البطاقة التي سُحبت حضوريًا.</div>`;
  container.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "grid";

  const landBtn = document.createElement("button");
  landBtn.className = "hub-btn support-btn" + (team.hasLand ? " done" : " highlight");
  landBtn.innerHTML = team.hasLand
    ? `<span class="icon">🏞️</span>أرض الأكاديمية<span class="tag">✅ حصل عليها الفريق</span>`
    : `<span class="icon">🏞️</span>منح أرض الأكاديمية<span class="tag warn">مطلوبة أولاً</span>`;
  landBtn.onclick = () => {
    if (team.hasLand) return notice("تم مسبقًا", `فريق ${team.name} حصل على أرض الأكاديمية بالفعل.`, "🏞️");
    confirmModal({
      icon: "🏞️",
      title: "منح أرض الأكاديمية",
      message: `سيحصل فريق ${team.name} على أرض الأكاديمية وتُفتح له وظائف البناء والمباريات والبطاقات.`,
      confirmLabel: "منح الأرض",
      onConfirm: () => {
        team.hasLand = true;
        team.supportLog.push({ at: nowISO(), text: "🏞️ منح أرض الأكاديمية" });
        persist();
        render();
        fireConfetti(window.innerWidth / 2, 180, 50);
      },
    });
  };
  grid.appendChild(landBtn);

  const options = [
    { icon: "💰", label: "دعم بـ 5 نقاط", run: () => grantPoints(team, 5) },
    { icon: "🏢", label: "دعم بمبنى", run: () => grantBuilding(team) },
    { icon: "👨‍💼", label: "دعم بموظف", run: () => grantEmployee(team) },
  ];
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "hub-btn support-btn" + (team.hasLand ? "" : " locked");
    btn.innerHTML = `<span class="icon">${opt.icon}</span>${opt.label}${team.hasLand ? "" : '<span class="lock-tag">🔒 بعد منح الأرض</span>'}`;
    btn.onclick = () => (team.hasLand ? opt.run() : requireLand(team));
    grid.appendChild(btn);
  });
  container.appendChild(grid);

  container.appendChild(buildManualAdjustCard(team));
  container.appendChild(logCard(`سجل دعم ${team.name}`, team.supportLog));
}

// تعديل يدوي من المدير خارج المباراة (إضافة أو خصم) لنقاط الدوري أو الأهداف أو الرصيد - كل تعديل يُسجَّل في سجل الفريق
const MANUAL_FIELDS = [
  { icon: "⚽", label: "نقاط الدوري", get: (t) => t.matches.points, set: (t, v) => (t.matches.points = v) },
  { icon: "🎯", label: "الأهداف", get: (t) => t.matches.goalsFor, set: (t, v) => (t.matches.goalsFor = v) },
  { icon: "💰", label: "الرصيد", get: (t) => t.balance, set: (t, v) => (t.balance = v) },
];

function buildManualAdjustCard(team) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>✍️ تعديل يدوي</h3>
    <p class="small-note">أضف أو اخصم يدويًا (اكتب رقمًا سالبًا للخصم، مثل -3). يُسجَّل كل تعديل في سجل الفريق.</p>`;
  MANUAL_FIELDS.forEach((f) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `<div>${f.icon} ${f.label}: <b>${f.get(team)}</b></div><button class="btn btn-gold">تعديل</button>`;
    row.querySelector("button").onclick = () => manualAdjust(team, f);
    card.appendChild(row);
  });
  return card;
}

function manualAdjust(team, f) {
  promptModal({
    icon: f.icon,
    title: `تعديل ${f.label} لفريق ${team.name}`,
    message: `القيمة الحالية: ${f.get(team)}. اكتب الرقم المراد إضافته، أو رقمًا سالبًا للخصم.`,
    onSubmit: (value) => {
      const normalized = value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[−–]/g, "-");
      const n = Number(normalized);
      if (!Number.isInteger(n) || n === 0) return notice("رقم غير صحيح", "اكتب عددًا صحيحًا غير الصفر، مثل 3 أو -2.", "⚠️");
      const next = f.get(team) + n;
      if (next < 0) return notice("لا يمكن", `لا يمكن أن تصبح ${f.label} أقل من صفر (القيمة الحالية ${f.get(team)}).`, "⚠️");
      f.set(team, next);
      team.supportLog.push({ at: nowISO(), text: `✍️ تعديل يدوي: ${n > 0 ? "+" : ""}${n} ${f.label} (أصبحت ${next})` });
      persist();
      render();
    },
  });
}

function grantPoints(team, amount) {
  confirmModal({
    icon: "💰",
    title: `دعم فريق ${team.name} بـ ${amount} نقاط؟`,
    confirmLabel: "تأكيد الدعم",
    onConfirm: () => {
      team.balance += amount;
      team.supportLog.push({ at: nowISO(), text: `💰 دعم بـ ${amount} نقاط` });
      persist();
      render();
    },
  });
}

function grantBuilding(team) {
  const options = CONFIG.buildings.map((b) => ({
    label: b.name,
    value: b.id,
    disabled: (team.buildings[b.id] || 0) > 0,
    note: (team.buildings[b.id] || 0) > 0 ? "الفريق يمتلكه بالفعل" : "",
  }));
  if (options.every((o) => o.disabled)) return notice("لا يوجد مبنى متاح", `فريق ${team.name} يمتلك كل المباني بالفعل.`, "🏢");
  chooseModal({
    icon: "🏢",
    title: `اختر المبنى الممنوح لفريق ${team.name}`,
    options,
    onChoose: (id) => {
      const b = CONFIG.buildings.find((x) => x.id === id);
      team.buildings[id] = 1;
      team.supportLog.push({ at: nowISO(), text: `🏢 دعم بمبنى: ${b.name}` });
      persist();
      render();
    },
  });
}

function grantEmployee(team) {
  chooseModal({
    icon: "👨‍💼",
    title: `اختر الموظف الممنوح لفريق ${team.name}`,
    options: CONFIG.employees.map((e) => ({ label: e.name, value: e.id, note: `لدى الفريق: ${team.employees[e.id] || 0}` })),
    onChoose: (id) => {
      const e = CONFIG.employees.find((x) => x.id === id);
      team.employees[id] = (team.employees[id] || 0) + 1;
      team.supportLog.push({ at: nowISO(), text: `👨‍💼 دعم بموظف: ${e.name}` });
      persist();
      render();
    },
  });
}

function logCard(title, entries) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${esc(title)}</h3>${
    entries.length
      ? `<ul class="log-list">${entries
          .slice()
          .reverse()
          .map((l) => `<li>${esc(l.text)}${l.at ? ` <small>${esc(timeLabel(l.at))}</small>` : ""}</li>`)
          .join("")}</ul>`
      : '<p class="small-note">لا يوجد شيء بعد.</p>'
  }`;
  return card;
}

/* ================= البطاقات (للفريق الحالي فقط) ================= */
function renderCards(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  addBackButton(container);

  const head = document.createElement("div");
  head.className = "card";
  head.innerHTML = `<h2 style="margin:0 0 6px;">🃏 بطاقات ${esc(team.name)}</h2>
    <div class="small-note">بطاقات المباراة تعمل داخل المباراة المباشرة للسؤال الحالي فقط، وبلا حد لعدد مرات الاستخدام. ويمكن تسجيل استخدامها هنا خارج المباراة أيضًا.</div>`;
  container.appendChild(head);

  if (!cardsSubView) {
    const categories = [
      { key: "effect", label: "بطاقات المباراة", icon: "⚡" },
      { key: "action", label: "المنح والسحب", icon: "🃏", lockTag: !stage().isFinalMode ? "🔒 وضع النهائي فقط" : "" },
      { key: "discipline", label: "البطاقات التأديبية", icon: "🟨🟥" },
    ];
    const grid = document.createElement("div");
    grid.className = "grid";
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "hub-btn" + (cat.lockTag ? " locked" : "");
      btn.innerHTML = `<span class="icon">${cat.icon}</span> ${cat.label}${cat.lockTag ? `<span class="lock-tag">${cat.lockTag}</span>` : ""}`;
      btn.onclick = () => {
        cardsSubView = cat.key;
        render();
      };
      grid.appendChild(btn);
    });
    container.appendChild(grid);
    container.appendChild(logCard(`سجل بطاقات ${team.name}`, team.cardLog));
    return;
  }

  if (cardsSubView === "effect") {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h3>⚡ بطاقات المباراة</h3><p class="small-note">داخل المباراة تُرفع من شاشتها وتعمل في السؤال الحالي فقط. هنا (خارج المباراة) يُسجَّل الاستخدام في سجل الفريق فقط، بلا أي أثر على النقاط أو الرصيد، وبلا حد لعدد المرات.</p>
      <div class="effect-info-grid"></div>`;
    const infoGrid = card.querySelector(".effect-info-grid");
    CONFIG.effectCards.forEach((c) => {
      const tile = document.createElement("button");
      tile.className = "effect-info";
      tile.innerHTML = `<span class="effect-info-icon">${c.icon}</span><b>${esc(c.name)}</b><span>${esc(c.desc)}</span>`;
      tile.onclick = () =>
        confirmModal({
          icon: c.icon,
          title: `تسجيل استخدام «${c.name}» لفريق ${team.name}؟`,
          message: "خارج المباراة يُسجَّل الاستخدام في سجل الفريق فقط.",
          confirmLabel: "تسجيل الاستخدام",
          onConfirm: () => {
            team.cardLog.push({ at: nowISO(), text: `${c.icon} ${c.name} — استخدام خارج المباراة` });
            persist();
            render();
          },
        });
      infoGrid.appendChild(tile);
    });
    container.appendChild(card);
  }

  if (cardsSubView === "action") {
    const card = document.createElement("div");
    card.className = "card";
    if (!stage().isFinalMode) {
      card.innerHTML = `<h3>🃏 بطاقات المنح والسحب</h3><div class="lock-inline">🔒 متاحة فقط في وضع النهائي. فعّله من الشريط العلوي عند الوصول للنهائي.</div>`;
    } else if (!team.hasLand) {
      card.innerHTML = `<h3>🃏 بطاقات المنح والسحب</h3><div class="lock-inline">🔒 ${esc(T.landRequired)}</div>`;
    } else {
      card.innerHTML = `<h3>🃏 بطاقات المنح والسحب — وضع النهائي 🏁</h3><p class="small-note">تُطبَّق على فريق ${esc(team.name)}.</p>`;
      CONFIG.actionCards.forEach((c) => {
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `<div><b>${esc(c.name)}</b> <span class="tag ${c.mode === "remove" ? "danger" : ""}">${c.mode === "remove" ? "سحب" : "منح"}</span>
          ${c.desc ? `<div class="shop-meta">${esc(c.desc)}</div>` : ""}</div>
          <button class="btn ${c.mode === "remove" ? "btn-danger" : "btn-gold"}">${c.mode === "remove" ? "سحب من الفريق" : "منح للفريق"}</button>`;
        row.querySelector("button").onclick = () => applyActionCard(team, c);
        card.appendChild(row);
      });
    }
    container.appendChild(card);
  }

  if (cardsSubView === "discipline") {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h3>🟨🟥 البطاقات التأديبية</h3>
      <p class="small-note">تُسجَّل من داخل المباراة المباشرة، وبلا أي حد لعدد المرات. هذه الأرقام إجمالي كل الدوري:</p>
      <div class="item-row"><div>🟨 إجمالي الإنذارات</div><b>${team.yellowCards}</b></div>
      <div class="item-row"><div>🟥 إجمالي الكروت الحمراء</div><b>${team.redCards}</b></div>`;
    container.appendChild(card);
  }
}

function applyActionCard(team, c) {
  const log = (text) => {
    team.cardLog.push({ at: nowISO(), text });
    persist();
    render();
  };

  if (c.target === "balance") {
    return confirmModal({
      icon: "💰",
      title: `${c.name} لفريق ${team.name}؟`,
      confirmLabel: "تأكيد",
      onConfirm: () => {
        team.balance += c.amount;
        log(c.name);
      },
    });
  }

  if (c.target === "building" && c.mode === "add") {
    const options = CONFIG.buildings
      .filter((b) => !(team.buildings[b.id] > 0))
      .map((b) => ({ label: b.name, value: b.id }));
    if (!options.length) return notice("لا يوجد مبنى متاح", `فريق ${team.name} يمتلك كل المباني بالفعل.`, "🏢");
    return chooseModal({
      icon: "🏢",
      title: `${c.name} — اختر المبنى`,
      options,
      onChoose: (id) => {
        team.buildings[id] = 1;
        log(`${c.name} (${CONFIG.buildings.find((b) => b.id === id).name})`);
      },
    });
  }

  if (c.target === "building" && c.mode === "remove") {
    const options = CONFIG.buildings
      .filter((b) => !b.basic && team.buildings[b.id] > 0)
      .map((b) => ({ label: b.name, value: b.id }));
    if (!options.length) return notice("لا يوجد ما يُسحب", "لا يوجد مبنى غير أساسي يمكن سحبه من هذا الفريق.", "🏢");
    return chooseModal({
      icon: "🏢",
      title: `${c.name} — اختر المبنى المسحوب`,
      options,
      onChoose: (id) => {
        team.buildings[id] = 0;
        log(`${c.name} (${CONFIG.buildings.find((b) => b.id === id).name})`);
      },
    });
  }

  if (c.target === "employee" && c.mode === "add") {
    return chooseModal({
      icon: "👨‍💼",
      title: `${c.name} — اختر الموظف`,
      options: CONFIG.employees.map((e) => ({ label: e.name, value: e.id })),
      onChoose: (id) => {
        team.employees[id] = (team.employees[id] || 0) + 1;
        log(`${c.name} (${CONFIG.employees.find((e) => e.id === id).name})`);
      },
    });
  }

  if (c.target === "employee" && c.mode === "remove") {
    if (countItems(team.employees, CONFIG.employees) - 1 < CONFIG.minEmployees) {
      return notice("لا يمكن", `الحد الأدنى للموظفين هو ${CONFIG.minEmployees}.`, "👨‍💼");
    }
    return chooseModal({
      icon: "👨‍💼",
      title: `${c.name} — اختر الموظف`,
      options: CONFIG.employees
        .filter((e) => team.employees[e.id] > 0)
        .map((e) => ({ label: e.name, value: e.id, note: `لدى الفريق: ${team.employees[e.id]}` })),
      onChoose: (id) => {
        team.employees[id] -= 1;
        log(`${c.name} (${CONFIG.employees.find((e) => e.id === id).name})`);
      },
    });
  }
}

/* ================= نتائج الفريق التفصيلية ================= */
function renderTeamResults(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  addBackButton(container);
  const s = academyStats(team);
  const m = team.matches;

  const stats = [
    ["💰", "رصيد الفريق", team.balance],
    ["⚽", "نقاط الدوري", m.points],
    ["🏗️", "نقاط الأكاديمية", s.academyTotal],
    ["👥", "عدد اللاعبين", s.playerCount],
    ["👨‍💼", "عدد الموظفين", s.employeeCount],
    ["🏢", "عدد المباني", s.buildingCount],
    ["🟥", "البطاقات الحمراء", team.redCards],
    ["🟨", "البطاقات الصفراء", team.yellowCards],
    ["🎮", "عدد المباريات", m.played],
    ["🟢", "مرات المركز الأول", m.won],
    ["🟡", "مرات التعادل / الوسط", m.drawn],
    ["🔴", "مرات المركز الأخير", m.lost],
  ];

  const head = document.createElement("div");
  head.className = "card";
  head.innerHTML = `<h2 style="margin:0;">📊 نتائج فريق ${esc(team.name)}</h2>
    <div class="stat-grid">${stats
      .map(([icon, label, val]) => `<div class="stat-tile"><span class="stat-icon">${icon}</span><span class="stat-val">${val}</span><span class="stat-label">${label}</span></div>`)
      .join("")}</div>`;
  container.appendChild(head);

  const owned = document.createElement("div");
  owned.className = "card";
  const buildings = CONFIG.buildings.filter((b) => team.buildings[b.id] > 0).map((b) => b.name);
  const employees = CONFIG.employees.filter((e) => team.employees[e.id] > 0).map((e) => `${e.name} ×${team.employees[e.id]}`);
  owned.innerHTML = `<h3>🏗️ ممتلكات الأكاديمية</h3>
    <p><b>🏞️ أرض الأكاديمية:</b> ${team.hasLand ? "✅ نعم" : "❌ لا"}</p>
    <p><b>🏢 المباني:</b> ${esc(buildings.join("، ") || "لا يوجد")}</p>
    <p><b>👨‍💼 الموظفون:</b> ${esc(employees.join("، ") || "لا يوجد")}</p>
    <p><b>👥 اللاعبون:</b> ${s.playerCount}</p>`;
  container.appendChild(owned);

  const history = stage().matchLog.filter((x) =>
    Array.isArray(x.results)
      ? x.results.some((r) => r.teamId === team.id)
      : x.teamAId
      ? x.teamAId === team.id || x.teamBId === team.id
      : x.teamAName === team.name || x.teamBName === team.name
  );
  const hist = document.createElement("div");
  hist.className = "card";
  hist.innerHTML = `<h3>⚽ مباريات ${esc(team.name)}</h3>${
    history.length
      ? `<ul class="log-list match-history">${history
          .slice()
          .reverse()
          .map((x) => {
            if (Array.isArray(x.results)) {
              const mine = x.results.find((r) => r.teamId === team.id);
              const scores = x.results.map((r) => `${esc(r.teamName)} <b>${r.score}</b>`).join(" • ");
              return `<li>${resultChip(mine.tier, tierLabel(mine))} ${esc(roundLabel(x.round))}: ${scores} <small>(+${mine.leaguePoints} نقطة دوري، +${mine.bonus} رصيد)</small> ${
                x.at ? `<small>${esc(timeLabel(x.at))}</small>` : ""
              }</li>`;
            }
            const isA = x.teamAId ? x.teamAId === team.id : x.teamAName === team.name;
            const mine = isA ? x.scoreA : x.scoreB;
            const theirs = isA ? x.scoreB : x.scoreA;
            const result = mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
            return `<li>${resultChip(result)} ${esc(x.teamAName)} <b>${x.scoreA} : ${x.scoreB}</b> ${esc(x.teamBName)} ${
              x.at ? `<small>${esc(timeLabel(x.at))}</small>` : ""
            }</li>`;
          })
          .join("")}</ul>`
      : '<p class="small-note">لم يلعب الفريق أي مباراة بعد.</p>'
  }`;
  container.appendChild(hist);
}

/* ================= النتائج العامة (منصة التتويج) ================= */
function renderResults(container) {
  addBackButton(container);

  if (!stage().teams.length) {
    const head0 = document.createElement("div");
    head0.className = "results-head";
    head0.innerHTML = `<h2>🏆 النتائج العامة</h2>`;
    container.appendChild(head0);
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "لا توجد فرق بعد.";
    container.appendChild(empty);
    return;
  }

  const head = document.createElement("div");
  head.className = "results-head";
  head.innerHTML = showFullResults
    ? `<h2>🏆 الإجمالي الكامل لكل الجولات</h2><p>الإجمالي = ⚽ كل نقاط الدوري + 🏗️ نقاط الأكاديمية</p>`
    : lastRoundEntry()
    ? `<h2>🏆 نتائج ${esc(roundLabel(lastRoundEntry().round))}</h2><p>نتائج آخر مباراة فقط — بلا نقاط أكاديمية وبلا جولات سابقة</p>`
    : `<h2>🏆 النتائج العامة</h2><p>لم تُلعب أي مباراة بعد</p>`;
  container.appendChild(head);

  const toggleWrap = document.createElement("div");
  toggleWrap.style.textAlign = "center";
  toggleWrap.style.marginBottom = "14px";
  if (!showFullResults) {
    toggleWrap.innerHTML = `<button class="btn btn-gold" id="btnRevealFull">🔓 إظهار الإجمالي الكامل (كل الجولات)</button>`;
    container.appendChild(toggleWrap);
    toggleWrap.querySelector("#btnRevealFull").onclick = () =>
      confirmModal({
        icon: "🔓",
        title: "إظهار الإجمالي الكامل؟",
        message: "سيظهر ترتيب الفرق بإجمالي كل الجولات مجتمعة مع نقاط الأكاديمية.",
        confirmLabel: "إظهار الإجمالي",
        onConfirm: () => {
          showFullResults = true;
          render();
        },
      });
  } else {
    toggleWrap.innerHTML = `<button class="btn btn-outline" id="btnHideFull">🔒 رجوع لنتائج آخر مباراة فقط</button>`;
    container.appendChild(toggleWrap);
    toggleWrap.querySelector("#btnHideFull").onclick = () => {
      showFullResults = false;
      render();
    };
  }

  const medals = ["🥇", "🥈", "🥉"];

  if (showFullResults) {
    const ranked = rankedTeams();
    const podiumBlock = (team, place) => {
      const s = academyStats(team);
      return `<div class="podium-place place-${place}">
        <div class="podium-medal">${medals[place - 1]}</div>
        ${avatarHtml(team, place === 1 ? 70 : 56)}
        <div class="podium-name">${esc(team.name)}</div>
        <div class="podium-total">${finalScore(team)} <small>نقطة</small></div>
        <div class="podium-breakdown">⚽ ${team.matches.points} + 🏗️ ${s.academyTotal}</div>
        <div class="podium-step">المركز ${place === 1 ? "الأول" : place === 2 ? "الثاني" : "الثالث"}</div>
      </div>`;
    };
    // الترتيب المطلوب في العرض: الثالث ثم الأول ثم الثاني
    const order = [3, 1, 2].filter((p) => ranked[p - 1]);
    const podium = document.createElement("div");
    podium.className = "podium";
    podium.innerHTML = order.map((p) => podiumBlock(ranked[p - 1], p)).join("");
    container.appendChild(podium);

    if (ranked.length > 3) {
      const rest = document.createElement("div");
      rest.className = "card";
      rest.innerHTML = `<h3>بقية المراكز</h3>${ranked
        .slice(3)
        .map(
          (t, i) =>
            `<div class="rest-row"><span>المركز ${i + 4}</span> ${avatarHtml(t, 32)} <b>${esc(t.name)}</b><span class="rest-total">${finalScore(t)} نقطة</span></div>`
        )
        .join("")}`;
      container.appendChild(rest);
    }

    // إنهاء الدوري لا يظهر إلا هنا (عند إظهار الإجمالي الكامل) - ليس في نتائج الدورة الافتراضية ولا في شاشة نهاية المباراة
    const danger = document.createElement("div");
    danger.className = "card danger-zone";
    danger.innerHTML = `<h3>🧹 إنهاء الدوري</h3>
      <p class="small-note">يحذف كل بيانات الدوري الحالي (الفرق، الأكاديميات، المباريات، الأرصدة) ويعيدك لتسجيل فرق جديدة.</p>
      <button class="btn btn-danger" id="btnEndLeague">إنهاء الدوري ومسح بياناته</button>`;
    container.appendChild(danger);
    danger.querySelector("#btnEndLeague").onclick = () =>
      confirmModal({
        icon: "⚠️",
        title: "إنهاء الدوري",
        message: "هل أنت متأكد؟ سيتم حذف بيانات الدوري الحالية ولا يمكن التراجع عن العملية.",
        cancelLabel: "إلغاء",
        confirmLabel: "تأكيد إنهاء الدوري",
        danger: true,
        onConfirm: resetLeague,
      });

    fireConfetti(window.innerWidth / 2, 220, 40);
  } else {
    const last = lastRoundEntry();
    if (last) {
      const ranked = last.results;
      const podiumBlockRound = (r, idx) => {
        const team = getTeam(r.teamId) || { name: r.teamName, order: idx };
        return `<div class="podium-place place-${idx + 1}">
        <div class="podium-medal">${medals[idx]}</div>
        ${avatarHtml(team, idx === 0 ? 70 : 56)}
        <div class="podium-name">${esc(r.teamName)}</div>
        <div class="podium-total">${r.leaguePoints} <small>نقطة</small></div>
        <div class="podium-breakdown">${r.score} هدف</div>
        <div class="podium-step">${esc(tierLabel(r))}</div>
      </div>`;
      };
      // الترتيب المطلوب في العرض: الثالث ثم الأول ثم الثاني
      const order = [2, 0, 1].filter((i) => ranked[i]);
      const podium = document.createElement("div");
      podium.className = "podium";
      podium.innerHTML = order.map((i) => podiumBlockRound(ranked[i], i)).join("");
      container.appendChild(podium);

      if (ranked.length > 3) {
        const rest = document.createElement("div");
        rest.className = "card";
        rest.innerHTML = `<h3>بقية المراكز</h3>${ranked
          .slice(3)
          .map(
            (r) =>
              `<div class="rest-row"><span>${esc(tierLabel(r))}</span> ${avatarHtml(getTeam(r.teamId) || { name: r.teamName, order: 0 }, 32)} <b>${esc(r.teamName)}</b><span class="rest-total">${r.leaguePoints} نقطة</span></div>`
          )
          .join("")}`;
        container.appendChild(rest);
      }
    }
  }

  fireConfetti(window.innerWidth / 2, 220, 40);
}

// يمسح بيانات المرحلة الحالية فقط (الفتيان أو الأشبال) - المرحلة الأخرى تبقى محفوظة تمامًا كما هي
function resetLeague() {
  const finishedStage = stageConfig(activeStageId);
  pendingMatch = null;
  clearPendingMatch();
  activeTeamId = null;
  academySubView = null;
  cardsSubView = null;
  state.stages[activeStageId] = emptyStage();
  activeStageId = null;
  persist(); // يستبدل النسخة السحابية أيضاً حتى لا تُستعاد بيانات هذه المرحلة تلقائياً
  setView("stage-select");
  notice("تم إنهاء الدوري", `حُذفت بيانات دوري ${finishedStage.label}. اختر مرحلة لتسجيل فرق جديدة.`, "🧹");
}

/* ================= المباريات ================= */
// كل مباراة تضم كل فرق المرحلة معًا وتُحسب جولة واحدة. تُلعب دائماً بلا أي شرط (أرض أو غيرها) - الأرض مطلوبة فقط لفتح متجر الأكاديمية
function startMatch() {
  const teams = stage().teams;
  confirmModal({
    icon: "⚽",
    title: "جاهزون للمباراة؟",
    html: `<div class="pre-match">${teams
      .map((t) => `<span>${avatarHtml(t, 44)}<b>${esc(t.name)}</b></span>`)
      .join('<span class="pre-vs">VS</span>')}</div>
      <p class="modal-message">${esc(roundLabel(nextRoundNumber()))} — مباراة كاملة لكل الفرق</p>`,
    confirmLabel: "🚀 ابدأ المباراة",
    onConfirm: startMatchNow,
  });
}

function startMatchNow() {
  const ids = stage().teams.map((t) => t.id);
  const perTeam = (value) => Object.fromEntries(ids.map((id) => [id, value]));
  pendingMatch = {
    id: "m_" + Date.now(),
    round: nextRoundNumber(),
    teamIds: ids,
    scores: perTeam(0),
    questions: CONFIG.questionsPerMatch, // عدّاد إرشادي بعدد الأهداف، قابل للزيادة أثناء المباراة
    shield: perTeam(false), // الدرع للسؤال الحالي فقط
    armed: perTeam(null), // بطاقة مضاعفة مرفوعة: الإجابة الصحيحة في هذا السؤال = هدفان
    stopRival: null, // الفريق الذي حصل على السؤال الحالي وحده
    stopCard: null, // البطاقة التي حجزت السؤال (توقف للخصم أو ركلة ترجيح)
    active: [], // البطاقات المرفوعة في السؤال الحالي [{teamId, cardId}] - يأخذ الجوكر منها
    used: Object.fromEntries(ids.map((id) => [id, []])), // بطاقات كل فريق المستخدمة في هذه المباراة (مرة لكل بطاقة، وبحد أقصى)
    faceoff: null, // جزائية مشرف/طالب في السؤال الحالي: {by: teamId, cardId} - مواجهة إجبارية لكل الفرق
    rescue: {}, // {teamId: true} بطاقة الإنقاذ مفعّلة حتى نهاية المباراة
    discipline: Object.fromEntries(ids.map((id) => [id, { yellow: 0, red: 0 }])), // إنذارات وكروت هذه المباراة (للإحصائيات)
  };
  setView("match-live");
}

// انتهى السؤال الحالي: يزول أثر كل البطاقات المرفوعة (الدرع والمضاعفة والتوقف) ولا ينتقل لأي سؤال آخر
function clearQuestionState() {
  pendingMatch.teamIds.forEach((id) => {
    pendingMatch.shield[id] = false;
    pendingMatch.armed[id] = null;
  });
  pendingMatch.stopRival = null;
  pendingMatch.stopCard = null;
  pendingMatch.faceoff = null;
  pendingMatch.active = [];
}

function liveTiers() {
  return computeMatchTiers(pendingMatch.teamIds.map((id) => ({ teamId: id, score: pendingMatch.scores[id] })));
}

function totalGoals() {
  return pendingMatch.teamIds.reduce((n, id) => n + pendingMatch.scores[id], 0);
}

// ممنوع من الإجابة: بسبب "توقف للخصم" لفريق آخر - إلا إن كان محمياً بالدرع في هذا السؤال
function isBlocked(teamId) {
  return (
    !!pendingMatch.stopRival &&
    pendingMatch.stopRival !== teamId &&
    !pendingMatch.shield[teamId]
  );
}

function renderMatchLive(container) {
  if (!pendingMatch) return setView("hub");
  const teams = pendingMatch.teamIds.map((id) => getTeam(id));
  const tiers = Object.fromEntries(liveTiers().map((r) => [r.teamId, r]));
  const goals = totalGoals();
  const questionsDone = goals >= pendingMatch.questions;

  const card = document.createElement("div");
  card.className = "card match-card";
  card.innerHTML = `
    <div class="match-head">
      <h3>⚽ مباراة مباشرة</h3>
      <span class="match-chip">${esc(roundLabel(pendingMatch.round))}</span>
      <span class="match-chip${questionsDone ? " done" : ""}">❓ الأسئلة (الأهداف): ${goals} / ${pendingMatch.questions}${questionsDone ? " ✅" : ""}
        <button class="q-adjust" data-q-minus title="إنقاص عدد الأسئلة">−</button><button class="q-adjust" data-q-plus title="زيادة عدد الأسئلة">+</button></span>
    </div>`;

  // لافتات البطاقات المفعّلة في السؤال الحالي
  const banners = [];
  teams.forEach((t) => {
    if (pendingMatch.armed[t.id]) {
      const c = effectCardById(pendingMatch.armed[t.id]);
      banners.push(
        `<div class="effect-banner arm"><span>${c.icon} <b>${esc(c.name)}</b>: الإجابة الصحيحة لفريق <b>${esc(t.name)}</b> في هذا السؤال = هدفان</span></div>`
      );
    }
    if (pendingMatch.shield[t.id])
      banners.push(`<div class="effect-banner shield"><span>🛡️ فريق <b>${esc(t.name)}</b> محمي بالدرع في هذا السؤال فقط</span></div>`);
  });
  if (pendingMatch.stopRival) {
    const holder = getTeam(pendingMatch.stopRival);
    const stopBy = effectCardById(pendingMatch.stopCard || "stop_rival");
    const exempt = teams.filter((t) => t.id !== holder.id && pendingMatch.shield[t.id]).map((t) => t.name);
    banners.push(
      `<div class="effect-banner stop"><span>${stopBy.icon} ${esc(stopBy.name)}: السؤال لفريق <b>${esc(holder.name)}</b> وحده — الفرق الأخرى ممنوعة من الإجابة${
        exempt.length ? ` (عدا المحميين بالدرع: ${esc(exempt.join("، "))})` : ""
      }</span></div>`
    );
  }
  if (pendingMatch.faceoff) {
    const f = pendingMatch.faceoff;
    const c = effectCardById(f.cardId);
    const exempt = teams.filter((t) => t.id !== f.by && pendingMatch.shield[t.id]).map((t) => t.name);
    banners.push(
      `<div class="effect-banner stop"><span>${c.icon} ${esc(c.name)} لفريق <b>${esc(getTeam(f.by).name)}</b>: مواجهة إجبارية — ${esc(c.vsLabel)}، والإجابة لهم فقط في هذا السؤال${
        exempt.length ? ` (عدا المحميين بالدرع: ${esc(exempt.join("، "))})` : ""
      }</span></div>`
    );
  }
  teams.forEach((t) => {
    if (pendingMatch.rescue[t.id])
      banners.push(`<div class="effect-banner shield"><span>🚑 الإنقاذ مفعّل لفريق <b>${esc(t.name)}</b>: إن انتهت المباراة وهو في المركز الأخير يحصل على نقطة دوري إضافية</span></div>`);
  });
  if (banners.length) card.innerHTML += `<div class="effect-banners">${banners.join("")}</div>`;

  const teamBox = (t) => {
    const score = pendingMatch.scores[t.id];
    const blocked = isBlocked(t.id);
    const tr = tiers[t.id];
    return `<div class="match-team" style="--team-color:${teamColor(t)}">
      <div class="match-team-name">${esc(t.name)}</div>
      <div class="match-score" id="score${t.id}">${score}</div>
      <div class="match-live-result">${resultChip(tr.tier, esc(tierLabel(tr)))}</div>
      ${pendingMatch.armed[t.id] ? '<div class="armed-tag">⚽⚽ الهدف القادم ×2</div>' : ""}
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-primary goal-btn" data-plus="${t.id}" ${blocked ? "disabled" : ""}>${blocked ? "✋ ممنوع" : "+ هدف"}</button>
        <button class="btn btn-outline-light" data-minus="${t.id}">-</button>
      </div>
    </div>`;
  };

  card.innerHTML += `<div class="match-vs">${teams.map(teamBox).join('<div class="vs-badge">VS</div>')}</div>
    <div style="text-align:center; margin-top:14px;"><button class="btn btn-gold" id="endQuestion">✔ انتهى السؤال (يزول أثر البطاقات المرفوعة)</button></div>`;
  container.appendChild(card);

  const cardsPanel = document.createElement("div");
  cardsPanel.className = "grid";
  teams.forEach((t) => cardsPanel.appendChild(buildLiveCardPicker(t)));
  container.appendChild(cardsPanel);

  const endWrap = document.createElement("div");
  endWrap.className = "match-end";
  endWrap.innerHTML = `<button class="btn-start" id="endMatch">🏁 إنهاء المباراة وحساب النقاط</button>
    <button class="btn btn-outline-light" id="cancelMatch">إلغاء المباراة</button>`;
  container.appendChild(endWrap);

  card.querySelectorAll("[data-plus]").forEach((btn) => {
    btn.onclick = (e) => {
      const id = btn.dataset.plus;
      const add = pendingMatch.armed[id] ? 2 : 1;
      pendingMatch.scores[id] += add;
      clearQuestionState(); // الإجابة تُنهي السؤال، فيزول أثر كل بطاقاته
      const x = e.clientX;
      const y = e.clientY;
      render();
      const el = document.getElementById("score" + id);
      if (el) el.classList.add("score-pop");
      fireConfetti(x, y, add === 2 ? 40 : 18);
    };
  });
  card.querySelectorAll("[data-minus]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.minus;
      pendingMatch.scores[id] = Math.max(0, pendingMatch.scores[id] - 1);
      render();
    };
  });
  card.querySelector("[data-q-minus]").onclick = () => {
    pendingMatch.questions = Math.max(1, pendingMatch.questions - 1);
    render();
  };
  card.querySelector("[data-q-plus]").onclick = () => {
    pendingMatch.questions += 1;
    render();
  };
  card.querySelector("#endQuestion").onclick = () => {
    clearQuestionState();
    render();
  };

  endWrap.querySelector("#endMatch").onclick = () => {
    const summary = liveTiers()
      .map((r) => `${getTeam(r.teamId).name} ${r.score}`)
      .join(" • ");
    confirmModal({
      icon: "🏁",
      title: "إنهاء المباراة وحساب النقاط؟",
      message: `النتيجة: ${summary}`,
      confirmLabel: "إنهاء وحساب النقاط",
      onConfirm: finalizeMatch,
    });
  };
  endWrap.querySelector("#cancelMatch").onclick = () =>
    confirmModal({
      icon: "⚠️",
      title: "إلغاء المباراة؟",
      message: "لن تُحتسب أي نتيجة، ويمكنك بدء المباراة من جديد لاحقًا.",
      confirmLabel: "إلغاء المباراة",
      cancelLabel: "متابعة اللعب",
      danger: true,
      onConfirm: () => {
        pendingMatch = null;
        clearPendingMatch();
        setView("hub");
      },
    });
}

// بطاقات فريق في المباراة - المدير يختار البطاقة التي رفعها الفريق فعلياً (مطبوعة حضورياً)؛ بلا حد لعدد مرات الاستخدام
function buildLiveCardPicker(team) {
  const box = document.createElement("div");
  box.className = "card live-cards";
  box.style.setProperty("--team-color", teamColor(team));
  box.innerHTML = `<h3>🃏 بطاقات ${esc(team.name)} <small>(${pendingMatch.used[team.id].length} / ${CONFIG.maxCardsPerMatch})</small></h3>`;
  const wrap = document.createElement("div");
  wrap.className = "card-tiles-wrap";
  CONFIG.effectCards.forEach((c) => {
    const raised = pendingMatch.active.some((a) => a.teamId === team.id && a.cardId === c.id);
    const used = pendingMatch.used[team.id].includes(c.id);
    const tile = document.createElement("button");
    tile.className = "card-tile" + (used ? " used" : "");
    tile.innerHTML = `<span class="card-tile-icon">${c.icon}</span><span class="card-tile-name">${esc(c.name)}</span>
      <span class="card-tile-state">${raised ? "🔥 مرفوعة الآن" : used ? "✅ استُخدمت" : "جاهزة"}</span>`;
    tile.onclick = () => useLiveCard(team, c);
    wrap.appendChild(tile);
  });
  box.appendChild(wrap);

  // البطاقات التأديبية (إنذار/كرت أحمر) - بلا أي حد لعدد المرات
  const dWrap = document.createElement("div");
  dWrap.className = "card-tiles-wrap";
  [
    { type: "yellow", icon: "🟨", name: "إنذار شفوي" },
    { type: "red", icon: "🟥", name: "كرت أحمر" },
  ].forEach((d) => {
    const tile = document.createElement("button");
    tile.className = "card-tile";
    tile.innerHTML = `<span class="card-tile-icon">${d.icon}</span><span class="card-tile-name">${d.name}</span>
      <span class="card-tile-state">الإجمالي: ${d.type === "yellow" ? team.yellowCards : team.redCards}</span>`;
    tile.onclick = () => useDisciplineCard(team, d.type);
    dWrap.appendChild(tile);
  });
  box.appendChild(dWrap);
  return box;
}

function useDisciplineCard(team, type) {
  if (type === "yellow") {
    return confirmModal({
      icon: "🟨",
      title: `تسجيل إنذار شفوي لفريق ${team.name}؟`,
      message: "إنذار فقط، بلا أي أثر على الرصيد أو النقاط.",
      confirmLabel: "تسجيل الإنذار",
      onConfirm: () => {
        team.yellowCards++;
        if (pendingMatch) pendingMatch.discipline[team.id].yellow++;
        team.cardLog.push({ at: nowISO(), text: "🟨 إنذار شفوي" });
        persist();
        render();
      },
    });
  }
  confirmModal({
    icon: "🟥",
    title: `كرت أحمر لفريق ${team.name}؟`,
    message: `سيحصل كل فرق ${esc(stageConfig(activeStageId).label)} الأخرى على ${CONFIG.redCardBonusForOthers} نقطة في الرصيد، ولن يحصل فريق ${team.name} (المستحِق للكرت) على أي نقاط إطلاقًا.`,
    confirmLabel: "تسجيل الكرت الأحمر",
    danger: true,
    onConfirm: () => {
      team.redCards++;
      if (pendingMatch) pendingMatch.discipline[team.id].red++;
      stage().teams.forEach((t) => {
        if (t.id === team.id) return;
        t.balance += CONFIG.redCardBonusForOthers;
        t.cardLog.push({ at: nowISO(), text: `🟥 +${CONFIG.redCardBonusForOthers} رصيد بسبب كرت أحمر على فريق ${team.name}` });
      });
      team.cardLog.push({ at: nowISO(), text: `🟥 كرت أحمر — حصلت كل الفرق الأخرى على +${CONFIG.redCardBonusForOthers} رصيد، وبلا أي نقاط لهذا الفريق` });
      persist();
      render();
    },
  });
}

// رفع بطاقة في السؤال الحالي: تُحسب مستخدمة لهذه المباراة (حتى لو جاوب غير الفريق)، وتُسجَّل مرفوعة ليأخذها الجوكر، ويزول أثرها بانتهاء السؤال
function raiseCard(team, card) {
  pendingMatch.used[team.id].push(card.id);
  pendingMatch.active.push({ teamId: team.id, cardId: card.id });
  team.cardLog.push({ at: nowISO(), text: `${card.icon} ${card.name} — في ${roundLabel(pendingMatch.round)}` });
}

function useLiveCard(team, card) {
  const used = pendingMatch.used[team.id];
  if (used.includes(card.id)) {
    return notice("البطاقة مستخدمة", `استخدم فريق ${team.name} بطاقة «${card.name}» في هذه المباراة بالفعل.`, card.icon);
  }
  if (used.length >= CONFIG.maxCardsPerMatch) {
    return notice(
      "بلغ الفريق الحد الأقصى للبطاقات",
      `لا يمكن لفريق ${team.name} استخدام أكثر من ${CONFIG.maxCardsPerMatch} بطاقات في المباراة الواحدة.`,
      "🃏"
    );
  }
  if (card.effect === "steal") return useJokerCard(team, card);
  const others = pendingMatch.teamIds.filter((id) => id !== team.id);
  const holdsQuestion = card.effect === "stopRival" || card.effect === "penalty";
  if (card.effect === "faceoff" && pendingMatch.faceoff) {
    return notice("توجد جزائية في هذا السؤال", "أنهِ السؤال الحالي أولاً (زر «انتهى السؤال») ثم استخدم البطاقة.", card.icon);
  }
  if (card.effect === "faceoff" && others.every((id) => pendingMatch.shield[id])) {
    return notice("🛡️ كل الخصوم محميون بالدرع", `لا يمكن استخدام «${card.name}» لأن كل الفرق الأخرى فعّلت الدرع في هذا السؤال. البطاقة لم تُستهلك.`, "🛡️");
  }
  if (card.effect === "shield" && pendingMatch.shield[team.id]) {
    return notice("الدرع مفعّل", `فريق ${team.name} محمي بالدرع في هذا السؤال بالفعل.`, card.icon);
  }
  if (holdsQuestion && pendingMatch.stopRival) {
    return notice("يوجد سؤال محجوز الآن", "أنهِ السؤال الحالي أولاً (زر «انتهى السؤال») ثم استخدم البطاقة.", "✋");
  }
  if (holdsQuestion && others.every((id) => pendingMatch.shield[id])) {
    return notice("🛡️ كل الخصوم محميون بالدرع", `لا يمكن استخدام «${card.name}» لأن كل الفرق الأخرى فعّلت الدرع في هذا السؤال. البطاقة لم تُستهلك.`, "🛡️");
  }
  if (card.effect === "arm" && pendingMatch.armed[team.id]) {
    return notice("مضاعفة مفعّلة بالفعل", `لدى فريق ${team.name} مضاعفة مفعّلة في هذا السؤال.`, card.icon);
  }
  confirmModal({
    icon: card.icon,
    title: card.name,
    html: `<div class="card-effect-text">${esc(card.confirmText.replace("{team}", team.name))}</div>`,
    confirmLabel: "✅ تأكيد الاستخدام",
    onConfirm: () => {
      if (card.effect === "shield") pendingMatch.shield[team.id] = true;
      if (card.effect === "arm") pendingMatch.armed[team.id] = card.id;
      if (card.effect === "rescue") {
        // بطاقة نهاية المباراة: تبقى حتى الإنهاء ولا ترتبط بالسؤال، ولا يأخذها الجوكر
        pendingMatch.rescue[team.id] = true;
        pendingMatch.used[team.id].push(card.id);
        team.cardLog.push({ at: nowISO(), text: `${card.icon} ${card.name} — في ${roundLabel(pendingMatch.round)}` });
        persist();
        render();
        return;
      }
      if (holdsQuestion) {
        pendingMatch.stopRival = team.id;
        pendingMatch.stopCard = card.id;
      }
      if (card.effect === "faceoff") pendingMatch.faceoff = { by: team.id, cardId: card.id };
      raiseCard(team, card);
      persist();
      render();
    },
  });
}

// الجوكر: يأخذ البطاقة التي رفعها خصم في السؤال الحالي ويستخدمها لصالح هذا الفريق (فيفقدها الخصم).
// لا يستطيع أخذ الدرع، ولا الأخذ من فريق محمي بالدرع في هذا السؤال
function useJokerCard(team, card) {
  const candidates = pendingMatch.active.filter((a) => a.teamId !== team.id && a.cardId !== "shield" && !pendingMatch.shield[a.teamId]);
  if (!candidates.length) {
    const anyRaised = pendingMatch.active.some((a) => a.teamId !== team.id);
    return notice(
      "لا توجد بطاقة يمكن أخذها",
      anyRaised
        ? "الدرع يحمي من الجوكر: لا يمكن أخذ الدرع نفسه ولا الأخذ من فريق محمي بالدرع."
        : "لا يوجد خصم رفع بطاقة في السؤال الحالي. ارفع الجوكر بعد أن يرفع الخصم بطاقته.",
      "🃏"
    );
  }
  chooseModal({
    icon: "🃏",
    title: `الجوكر: اختر البطاقة المرفوعة التي يأخذها ${team.name}`,
    options: candidates.map((a) => {
      const c = effectCardById(a.cardId);
      return { label: `${c.icon} ${c.name} — فريق ${getTeam(a.teamId).name}`, value: `${a.teamId}|${a.cardId}` };
    }),
    onChoose: (val) => {
      const [fromId, cardId] = val.split("|");
      const stolen = effectCardById(cardId);
      const from = getTeam(fromId);
      if (stolen.effect === "arm" && pendingMatch.armed[team.id]) {
        return notice("مضاعفة مفعّلة بالفعل", `لدى فريق ${team.name} مضاعفة مفعّلة في هذا السؤال.`, stolen.icon);
      }
      pendingMatch.active = pendingMatch.active.filter((a) => !(a.teamId === fromId && a.cardId === cardId));
      if (stolen.effect === "arm") {
        pendingMatch.armed[fromId] = null;
        pendingMatch.armed[team.id] = cardId;
      }
      if (stolen.effect === "stopRival" || stolen.effect === "penalty") pendingMatch.stopRival = team.id;
      if (stolen.effect === "faceoff" && pendingMatch.faceoff) pendingMatch.faceoff.by = team.id;
      pendingMatch.used[team.id].push(card.id, cardId); // الجوكر نفسه والبطاقة المأخوذة كلاهما يُحسبان على الفريق (كما كان سابقاً)
      pendingMatch.active.push({ teamId: team.id, cardId });
      team.cardLog.push({ at: nowISO(), text: `${card.icon} ${card.name} — أخذ «${stolen.name}» من فريق ${from.name} في ${roundLabel(pendingMatch.round)}` });
      from.cardLog.push({ at: nowISO(), text: `${card.icon} فقد بطاقة «${stolen.name}» بسبب جوكر فريق ${team.name} في ${roundLabel(pendingMatch.round)}` });
      persist();
      render();
    },
  });
}

// تنتهي المباراة بيد المدير: تُرتَّب كل الفرق حسب أهدافها، وتُمنح النقاط والرصيد حسب المركز (التعادل بنقاط التعادل)
function finalizeMatch() {
  const results = computeMatchTiers(pendingMatch.teamIds.map((id) => ({ teamId: id, score: pendingMatch.scores[id] })));
  const totalScore = results.reduce((n, r) => n + r.score, 0);
  results.forEach((r) => {
    const team = getTeam(r.teamId);
    r.teamName = team.name;
    r.leaguePoints = leaguePointsFor(r.tier, r.score);
    r.rescued = r.tier === "loss" && !!pendingMatch.rescue[r.teamId];
    if (r.rescued) r.leaguePoints += 1; // بطاقة الإنقاذ: نقطة إضافية فوق نقاط الخسارة
    r.cards = pendingMatch.used[r.teamId].slice();
    r.yellow = pendingMatch.discipline[r.teamId].yellow;
    r.red = pendingMatch.discipline[r.teamId].red;
    r.bonus = goalBalanceBonus(r.tier, r.score) + ownershipBalanceBonus(team, r.tier) + resultBalanceBonus(r.tier);
    team.matches.played++;
    team.matches.goalsFor += r.score;
    team.matches.goalsAgainst += totalScore - r.score;
    if (r.tier === "win") team.matches.won++;
    else if (r.tier === "draw") team.matches.drawn++;
    else team.matches.lost++;
    team.matches.points += r.leaguePoints;
    team.balance += r.bonus;
  });
  const entry = { at: nowISO(), round: pendingMatch.round, questions: pendingMatch.questions, results };
  stage().matchLog.push(entry);

  pendingMatch = null;
  clearPendingMatch();
  persist();
  showWinnerModal(entry);
}

// إحصائيات بسيطة للمباراة المنتهية (تُعرض في نافذة النهاية)
function matchStatsHtml(entry) {
  const r = entry.results;
  const totalGoals = r.reduce((n, x) => n + x.score, 0);
  const totalCards = r.reduce((n, x) => n + (x.cards || []).length, 0);
  const cardIcons = (ids) =>
    (ids || [])
      .map((id) => effectCardById(id))
      .filter(Boolean)
      .map((c) => `<span title="${esc(c.name)}">${c.icon}</span>`)
      .join(" ") || "—";
  return `<div class="match-stats">
    <h3>📊 إحصائيات المباراة</h3>
    <div class="match-stats-summary">⚽ مجموع الأهداف: <b>${totalGoals}</b>${entry.questions ? ` من ${entry.questions} أسئلة` : ""} • 🃏 البطاقات المستخدمة: <b>${totalCards}</b></div>
    <table class="match-stats-table">
      <thead><tr><th>الفريق</th><th>الأهداف</th><th>البطاقات</th><th>🟨</th><th>🟥</th><th>نقاط الدوري</th><th>الرصيد</th></tr></thead>
      <tbody>${r
        .map(
          (x) => `<tr><td>${esc(x.teamName)}${x.rescued ? " 🚑" : ""}</td><td>${x.score}</td><td>${cardIcons(x.cards)}</td><td>${x.yellow || 0}</td><td>${
            x.red || 0
          }</td><td>+${x.leaguePoints}</td><td>+${x.bonus}</td></tr>`
        )
        .join("")}</tbody>
    </table>
  </div>`;
}

// نافذة نهاية المباراة: منصة تتويج تفاعلية (الثالث ثم الأول ثم الثاني) لكل فرق المباراة
function showWinnerModal(entry) {
  const r = entry.results;
  const winner = r[0].tier === "win" ? r[0] : null;
  const medals = ["🥇", "🥈", "🥉"];
  const block = (x, idx) => `
    <div class="podium-place place-${idx + 1}">
      <div class="podium-medal">${medals[idx]}</div>
      ${avatarHtml(getTeam(x.teamId) || { name: x.teamName, order: idx }, idx === 0 ? 60 : 48)}
      <div class="podium-name">${esc(x.teamName)}</div>
      <div class="podium-total">+${x.leaguePoints} <small>نقطة دوري</small></div>
      <div class="podium-breakdown">🎯 ${x.score} هدف</div>
      <div class="podium-gain">💰 +${x.bonus} رصيد</div>
      <div class="podium-step">${esc(tierLabel(x))}</div>
    </div>`;
  const order = [2, 0, 1].filter((i) => r[i]);
  const rest = r.slice(3);
  const m = openModal({
    boxClass: "winner-box",
    onClose: () => setView("results"),
    html: `
      ${winner ? `<div class="winner-trophy">🏆</div><h2>الفائز: ${esc(winner.teamName)}</h2>` : `<div class="winner-trophy">🤝</div><h2>تعادل في الصدارة!</h2>`}
      <div class="podium winner-podium">${order.map((i) => block(r[i], i)).join("")}</div>
      ${
        rest.length
          ? `<div class="winner-rest">${rest
              .map((x) => `<div>${esc(tierLabel(x))} — <b>${esc(x.teamName)}</b>: 🎯 ${x.score} • ⚽ +${x.leaguePoints} • 💰 +${x.bonus}</div>`)
              .join("")}</div>`
          : ""
      }
      ${matchStatsHtml(entry)}
      <button class="btn-start modal-wide-btn" data-go>📊 إلى النتائج</button>`,
  });
  fireConfetti(window.innerWidth / 2, 120, 70);
  m.overlay.querySelector("[data-go]").onclick = () => m.close();
}

/* ================= كونفيتي احتفالي ================= */
function fireConfetti(x, y, count) {
  const colors = ["#f2a93b", "#12a89b", "#ffcf7a", "#e5484d", "#ffffff"];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.background = colors[i % colors.length];
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 140;
    el.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    el.style.setProperty("--dy", Math.sin(angle) * dist - 40 + "px");
    el.style.animationDuration = 0.7 + Math.random() * 0.6 + "s";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
}

// يسترجع مباراة كانت جارية ولم تُنهَ (بنتيجتها وبطاقاتها كما كانت) لو انكسر الجهاز أو أُعيد تحميل الصفحة بالخطأ أثناءها
function tryResumePendingMatch() {
  const saved = loadPendingMatch();
  if (!saved || !saved.pendingMatch || !saved.stageId || !state.stages[saved.stageId]) return false;
  const pm = saved.pendingMatch;
  const savedStage = state.stages[saved.stageId];
  const valid =
    Array.isArray(pm.teamIds) && pm.teamIds.length >= 2 && pm.teamIds.every((id) => savedStage.teams.some((t) => t.id === id));
  if (!valid) {
    // لقطة بالنظام القديم (مباراة بين فريقين) أو فرق تغيّرت - تُتجاهل بأمان
    clearPendingMatch();
    return false;
  }
  if (!pm.used) pm.used = Object.fromEntries(pm.teamIds.map((id) => [id, []]));
  if (pm.stopCard === undefined) pm.stopCard = null;
  if (pm.faceoff === undefined) pm.faceoff = null;
  if (!pm.rescue) pm.rescue = {};
  if (!pm.discipline) pm.discipline = Object.fromEntries(pm.teamIds.map((id) => [id, { yellow: 0, red: 0 }]));
  activeStageId = saved.stageId;
  activeTeamId = pm.teamIds[0];
  pendingMatch = pm;
  currentView = "match-live";
  return true;
}

const resumedMatch = tryResumePendingMatch();
render();
if (resumedMatch) {
  notice("تم استرجاع المباراة", "كانت هناك مباراة جارية لم تُنهَ، وتمت استعادتها بنتيجتها وبطاقاتها كما كانت.", "🔄");
}

function isValidCloudBackup(cloud) {
  return !!cloud && typeof cloud === "object" && (cloud.stages || Array.isArray(cloud.teams));
}

if (!localStorage.getItem(STORAGE_KEY)) {
  // جهاز فارغ تمامًا (لا يوجد حفظ محلي أصلاً) - استعادة تلقائية وصامتة، آمنة لأنه لا يوجد شيء محلي ليُفقد هنا
  tryCloudRestore().then((cloud) => {
    if (isValidCloudBackup(cloud)) {
      state = migrateState(cloud);
      saveState(state);
      render();
    }
  });
} else {
  // جهاز لديه بيانات محلية بالفعل - لا تُستبدل تلقائياً أبداً، فقط إن وُجدت نسخة سحابية أحدث فعلاً (حُدّثت من جهاز آخر لاحقًا)
  // يُسأل المدير أولاً؛ هذا يمنع ظهور بيانات قديمة/محذوفة بصمت عند فتح البرنامج من جهاز أو متصفح آخر
  tryCloudRestore().then((cloud) => {
    if (!isValidCloudBackup(cloud)) return;
    const cloudTime = cloud.updatedAt || 0;
    const localTime = state.updatedAt || 0;
    if (cloudTime <= localTime) return;
    confirmModal({
      icon: "☁️",
      title: "توجد نسخة أحدث محفوظة سحابيًا",
      message: `يبدو أن البيانات على هذا الجهاز ليست الأحدث - توجد نسخة حُدّثت لاحقًا من جهاز آخر (${new Date(cloudTime).toLocaleString("ar")}). هل تريد استخدامها بدلاً من بيانات هذا الجهاز؟`,
      confirmLabel: "استخدام النسخة الأحدث",
      cancelLabel: "إبقاء بيانات هذا الجهاز",
      onConfirm: () => {
        state = migrateState(cloud);
        saveState(state);
        render();
      },
    });
  });
}
