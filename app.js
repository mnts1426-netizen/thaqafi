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

// مبنى يحتاج موظفاً مرتبطاً به (requiresEmployee) لا يُحسب أي مكافأة منه إلا إذا كان الفريق قد وظّف ذلك الموظف أيضاً
function isBuildingActive(team, building) {
  return !building.requiresEmployee || (team.employees[building.requiresEmployee] || 0) > 0;
}

function activeBuildingsTotal(team) {
  return CONFIG.buildings.reduce((sum, b) => {
    const count = team.buildings[b.id] || 0;
    return sum + (count > 0 && isBuildingActive(team, b) ? count * b.cost : 0);
  }, 0);
}

function academyStats(team) {
  const buildingCount = countItems(team.buildings, CONFIG.buildings);
  const employeeCount = countItems(team.employees, CONFIG.employees);
  const playerBatches = countItems(team.players, CONFIG.players);
  const playerCount = playerBatches * (CONFIG.players[0]?.batchSize || 5);
  const academyTotal = activeBuildingsTotal(team) + pointsFromCounts(team.employees, CONFIG.employees) + pointsFromCounts(team.players, CONFIG.players);
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

// الدورة = ذهاب + إياب (كل فريق يلعب ضد كل فريق مرتين، تقريبًا 4 مباريات للفريق مع 3 فرق)
function currentCycleNumber() {
  const leg = currentLeg(stage());
  if (leg !== null) return Math.ceil(leg / 2);
  const legs = stage().matchLog.map((m) => m.leg).filter((l) => l !== undefined);
  return legs.length ? Math.ceil(Math.max(...legs) / 2) : 1;
}

// نقاط الدوري فقط (بلا أكاديمية) لمباريات دورة واحدة محددة، مُعادة الحساب من سجل المباريات مباشرة
function cycleMatchStats(cycleNum) {
  const stats = {};
  stage().teams.forEach((t) => (stats[t.id] = { played: 0, won: 0, drawn: 0, lost: 0, points: 0 }));
  stage().matchLog.forEach((m) => {
    if (m.leg === undefined || Math.ceil(m.leg / 2) !== cycleNum) return;
    const a = stats[m.teamAId];
    const b = stats[m.teamBId];
    if (!a || !b) return;
    a.played++;
    b.played++;
    if (m.scoreA > m.scoreB) {
      a.won++;
      a.points += CONFIG.matchPoints.win;
      b.lost++;
      b.points += m.scoreB > 0 ? CONFIG.matchPoints.lossIfScored : CONFIG.matchPoints.lossIfZero;
    } else if (m.scoreB > m.scoreA) {
      b.won++;
      b.points += CONFIG.matchPoints.win;
      a.lost++;
      a.points += m.scoreA > 0 ? CONFIG.matchPoints.lossIfScored : CONFIG.matchPoints.lossIfZero;
    } else {
      a.drawn++;
      b.drawn++;
      a.points += CONFIG.matchPoints.drawEach;
      b.points += CONFIG.matchPoints.drawEach;
    }
  });
  return stats;
}

function rankedByCycle(cycleNum) {
  const stats = cycleMatchStats(cycleNum);
  return stage()
    .teams.slice()
    .sort((a, b) => stats[b.id].points - stats[a.id].points);
}

// مكافأة الرصيد حسب الملكية: تُجمع لكل وحدة مملوكة على حدة حسب فئة تكلفتها الأساسية الثابتة
// (مبنى يحتاج موظفاً غير موظَّف بعد لا تُحسب مكافأته هنا أبداً)
function ownershipBalanceBonus(team, result) {
  let total = 0;
  allShopItemsFlat().forEach(({ key, item }) => {
    const count = team[key][item.id] || 0;
    if (count <= 0) return;
    if (key === "buildings" && !isBuildingActive(team, item)) return;
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

function legLabel(leg) {
  if (!leg) return "";
  const cycle = Math.ceil(leg / 2);
  const part = leg % 2 === 1 ? "الذهاب" : "الإياب";
  return cycle > 1 ? `الدورة ${cycle} — ${part}` : `دور ${part}`;
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

function resultChip(result) {
  return `<span class="result-chip ${result}">${RESULT_LABELS[result]}</span>`;
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
    <div class="intro-logo"><img src="assets/logo.png" alt="شعار الدوري الثقافي" /></div>
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
    <div class="intro-logo small"><img src="assets/logo.png" alt="" /></div>
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
    stage().schedule = generateCycle(stage().teams, 1, 0);
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
    <div class="intro-logo small"><img src="assets/logo.png" alt="" /></div>
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
      <img src="assets/logo-white.png" alt="" class="brand-logo" />
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
  if (ensureSchedule(stage())) persist();

  const leg = currentLeg(stage());
  const legFixtures = stage().schedule.filter((f) => f.leg === leg);
  const playedInLeg = legFixtures.filter((f) => f.played).length;
  const pct = legFixtures.length ? Math.round((playedInLeg / legFixtures.length) * 100) : 0;

  const head = document.createElement("div");
  head.className = "hub-head";
  head.innerHTML = `
    <div>
      <h2>🏆 الفرق</h2>
      <p>اضغط على الفريق للدخول إلى صفحته</p>
    </div>
    <div class="leg-progress">
      <div class="leg-progress-label">⚽ ${esc(legLabel(leg))} — ${playedInLeg} / ${legFixtures.length} مباريات</div>
      <div class="leg-progress-bar"><span style="width:${pct}%"></span></div>
    </div>`;
  container.appendChild(head);

  const ranks = rankedTeams().map((t) => t.id);
  const grid = document.createElement("div");
  grid.className = "grid team-card-grid";
  stage().teams.forEach((t) => {
    const s = academyStats(t);
    const next = nextFixtureForTeam(stage(), t.id);
    let nextHtml = `<span class="team-card-next done">✅ أنهى مباريات هذا الدور</span>`;
    if (next) {
      const opp = getTeam(next.teamAId === t.id ? next.teamBId : next.teamAId);
      const home = next.teamAId === t.id;
      nextHtml = `<span class="team-card-next">🎯 القادم: ضد ${esc(opp.name)} ${home ? "🏠 على ملعبه" : "✈️ على ملعب الخصم"}</span>`;
    }
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
      ${nextHtml}
    `;
    card.onclick = () => {
      activeTeamId = t.id;
      setView("team");
    };
    grid.appendChild(card);
  });
  container.appendChild(grid);

  container.appendChild(buildLegScheduleCard(legFixtures, leg));
}

// جدول مباريات الجولة الحالية فقط (لا يظهر أي جولة أخرى) - يُستبدل تلقائياً بمباريات الجولة التالية عند انتهاء هذه
function buildLegScheduleCard(legFixtures, leg) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>📋 جدول ${esc(legLabel(leg))}</h3>`;
  const grid = document.createElement("div");
  grid.className = "grid fixture-grid";
  legFixtures.forEach((f) => {
    const home = getTeam(f.teamAId);
    const away = getTeam(f.teamBId);
    const fx = document.createElement("div");
    fx.className = "fixture-card" + (f.played ? " played" : "");
    fx.innerHTML = `
      <div class="fixture-teams">
        <span class="fixture-team">🏠 ${esc(home.name)}</span>
        <span class="fixture-score">${f.played ? `${f.scoreA} : ${f.scoreB}` : "VS"}</span>
        <span class="fixture-team">✈️ ${esc(away.name)}</span>
      </div>
      <span class="tag ${f.played ? "" : "warn"}">${f.played ? "✅ انتهت" : "⏳ لم تُلعب بعد"}</span>`;
    grid.appendChild(fx);
  });
  card.appendChild(grid);
  return card;
}

/* ================= صفحة الفريق ================= */
function renderTeamPage(container) {
  const team = activeTeam();
  if (!team) return setView("hub");
  if (ensureSchedule(stage())) persist();
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

  // المباراة القادمة لهذا الفريق فقط
  const next = nextFixtureForTeam(stage(), team.id);
  const matchCard = document.createElement("div");
  matchCard.className = "next-match-card";
  if (next) {
    const home = getTeam(next.teamAId);
    const away = getTeam(next.teamBId);
    matchCard.innerHTML = `
      <div class="next-match-title">⚽ المباراة القادمة — ${esc(legLabel(next.leg))}</div>
      <div class="next-match-vs">
        <span class="nm-team">${avatarHtml(home, 40)} ${esc(home.name)} <small>🏠 صاحب الأرض</small></span>
        <span class="nm-vs">VS</span>
        <span class="nm-team">${avatarHtml(away, 40)} ${esc(away.name)} <small>✈️ الضيف</small></span>
      </div>
      <div class="next-match-stadium">🏟️ على ملعب ${esc(home.name)}</div>
      <button class="btn-start" id="btnStartMatch">⚽ ابدأ المباراة</button>`;
    container.appendChild(matchCard);
    matchCard.querySelector("#btnStartMatch").onclick = () => startMatchForTeam(team);
  } else {
    const leg = currentLeg(stage());
    const waiting = stage().teams
      .filter((t) => stage().schedule.some((f) => !f.played && f.leg === leg && (f.teamAId === t.id || f.teamBId === t.id)))
      .map((t) => t.name);
    matchCard.innerHTML = `
      <div class="next-match-title">✅ أنهى ${esc(team.name)} مبارياته في ${esc(legLabel(leg))}</div>
      <p class="next-match-wait">الفرق التي لديها مباريات متبقية في هذا الدور: <b>${esc(waiting.join("، ") || "—")}</b></p>`;
    container.appendChild(matchCard);
  }

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
    if (key === "buildings") {
      ownedText = count > 0 ? "✅ الفريق يمتلكه بالفعل" : "لم يُبنَ بعد";
      if (count > 0 && item.requiresEmployee && !isBuildingActive(team, item)) {
        const empName = CONFIG.employees.find((e) => e.id === item.requiresEmployee)?.name || item.requiresEmployee;
        ownedText += ` <span class="tag warn">⚠️ لا فائدة منه بدون ${esc(empName)}</span>`;
      }
    } else if (key === "players") ownedText = `لدى الفريق: ${count * (item.batchSize || 5)} لاعب`;
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

  container.appendChild(logCard(`سجل دعم ${team.name}`, team.supportLog));
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
    <div class="small-note">بطاقات المباراة تُستخدم من داخل شاشة المباراة فقط، مرة واحدة لكل فريق في المباراة.</div>`;
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
    card.innerHTML = `<h3>⚡ بطاقات المباراة</h3><p class="small-note">تُستخدم من شاشة المباراة المباشرة قبل طرح السؤال، وتظهر هناك لكل فريق مع نافذة تأكيد.</p>
      <div class="effect-info-grid">${CONFIG.effectCards
        .map(
          (c) => `<div class="effect-info"><span class="effect-info-icon">${c.icon}</span><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></div>`
        )
        .join("")}</div>`;
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
    card.innerHTML = `<h3>🟨🟥 البطاقات التأديبية</h3>`;
    const yRow = document.createElement("div");
    yRow.className = "item-row";
    yRow.innerHTML = `<div>🟨 إنذار شفوي — عدد الإنذارات: <b>${team.yellowCards}</b></div><button class="btn btn-gold">تسجيل إنذار</button>`;
    yRow.querySelector("button").onclick = () =>
      confirmModal({
        icon: "🟨",
        title: `تسجيل إنذار لفريق ${team.name}؟`,
        confirmLabel: "تسجيل الإنذار",
        onConfirm: () => {
          team.yellowCards++;
          team.cardLog.push({ at: nowISO(), text: "🟨 إنذار شفوي" });
          persist();
          render();
        },
      });
    card.appendChild(yRow);

    const rRow = document.createElement("div");
    rRow.className = "item-row";
    rRow.innerHTML = `<div>🟥 كرت أحمر — عدد الكروت الحمراء: <b>${team.redCards}</b>
      <div class="shop-meta">عند التسجيل: تُمنح بقية الفرق ${CONFIG.redCardBonusForOthers} نقطة لكل فريق</div></div>
      <button class="btn btn-danger">تسجيل كرت أحمر</button>`;
    rRow.querySelector("button").onclick = () =>
      confirmModal({
        icon: "🟥",
        title: `كرت أحمر لفريق ${team.name}؟`,
        message: `سيُمنح كل فريق آخر ${CONFIG.redCardBonusForOthers} نقطة في رصيده.`,
        confirmLabel: "تسجيل الكرت الأحمر",
        danger: true,
        onConfirm: () => {
          team.redCards++;
          stage().teams.forEach((t) => {
            if (t.id !== team.id) t.balance += CONFIG.redCardBonusForOthers;
          });
          team.cardLog.push({ at: nowISO(), text: "🟥 كرت أحمر" });
          persist();
          render();
        },
      });
    card.appendChild(rRow);
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
    ["🟢", "مرات الفوز", m.won],
    ["🟡", "مرات التعادل", m.drawn],
    ["🔴", "مرات الخسارة", m.lost],
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
    x.teamAId ? x.teamAId === team.id || x.teamBId === team.id : x.teamAName === team.name || x.teamBName === team.name
  );
  const hist = document.createElement("div");
  hist.className = "card";
  hist.innerHTML = `<h3>⚽ مباريات ${esc(team.name)}</h3>${
    history.length
      ? `<ul class="log-list match-history">${history
          .slice()
          .reverse()
          .map((x) => {
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
    ? `<h2>🏆 الإجمالي الكامل لكل الدورات</h2><p>الإجمالي = ⚽ كل نقاط الدوري + 🏗️ نقاط الأكاديمية</p>`
    : `<h2>🏆 نتائج الدورة ${currentCycleNumber()}</h2><p>نقاط هذه الدورة فقط (ذهاب وإياب لكل الفرق) — بلا نقاط أكاديمية وبلا دورات سابقة</p>`;
  container.appendChild(head);

  const toggleWrap = document.createElement("div");
  toggleWrap.style.textAlign = "center";
  toggleWrap.style.marginBottom = "14px";
  if (!showFullResults) {
    toggleWrap.innerHTML = `<button class="btn btn-gold" id="btnRevealFull">🔓 إظهار الإجمالي الكامل (كل الدورات)</button>`;
    container.appendChild(toggleWrap);
    toggleWrap.querySelector("#btnRevealFull").onclick = () =>
      confirmModal({
        icon: "🔓",
        title: "إظهار الإجمالي الكامل؟",
        message: "سيظهر ترتيب الفرق بإجمالي كل الدورات مجتمعة مع نقاط الأكاديمية.",
        confirmLabel: "إظهار الإجمالي",
        onConfirm: () => {
          showFullResults = true;
          render();
        },
      });
  } else {
    toggleWrap.innerHTML = `<button class="btn btn-outline" id="btnHideFull">🔒 رجوع لنتائج الدورة الحالية فقط</button>`;
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
    fireConfetti(window.innerWidth / 2, 220, 40);
  } else {
    const cycleNum = currentCycleNumber();
    const stats = cycleMatchStats(cycleNum);
    const ranked = rankedByCycle(cycleNum);
    const podiumBlockCycle = (team, place) => {
      const s = stats[team.id];
      return `<div class="podium-place place-${place}">
        <div class="podium-medal">${medals[place - 1]}</div>
        ${avatarHtml(team, place === 1 ? 70 : 56)}
        <div class="podium-name">${esc(team.name)}</div>
        <div class="podium-total">${s.points} <small>نقطة</small></div>
        <div class="podium-breakdown">لعب ${s.played} • فاز ${s.won} • تعادل ${s.drawn} • خسر ${s.lost}</div>
        <div class="podium-step">المركز ${place === 1 ? "الأول" : place === 2 ? "الثاني" : "الثالث"}</div>
      </div>`;
    };
    // الترتيب المطلوب في العرض: الثالث ثم الأول ثم الثاني
    const order = [3, 1, 2].filter((p) => ranked[p - 1]);
    const podium = document.createElement("div");
    podium.className = "podium";
    podium.innerHTML = order.map((p) => podiumBlockCycle(ranked[p - 1], p)).join("");
    container.appendChild(podium);

    if (ranked.length > 3) {
      const rest = document.createElement("div");
      rest.className = "card";
      rest.innerHTML = `<h3>بقية المراكز</h3>${ranked
        .slice(3)
        .map(
          (t, i) =>
            `<div class="rest-row"><span>المركز ${i + 4}</span> ${avatarHtml(t, 32)} <b>${esc(t.name)}</b><span class="rest-total">${stats[t.id].points} نقطة</span></div>`
        )
        .join("")}`;
      container.appendChild(rest);
    }
  }

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
}

// يمسح بيانات المرحلة الحالية فقط (الفتيان أو الأشبال) - المرحلة الأخرى تبقى محفوظة تمامًا كما هي
function resetLeague() {
  const finishedStage = stageConfig(activeStageId);
  pendingMatch = null;
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
// المباريات تُلعب دائماً بلا أي شرط (أرض أو غيرها) - أرض الأكاديمية مطلوبة فقط لفتح متجر الأكاديمية
function startMatchForTeam(team) {
  if (ensureSchedule(stage())) persist();
  const f = nextFixtureForTeam(stage(), team.id);
  if (!f) {
    notice("لا توجد مباراة لهذا الفريق الآن", `${team.name} أنهى مبارياته في هذا الدور. أكمل مباريات الفرق الأخرى أولاً.`, "✅");
    return;
  }
  const home = getTeam(f.teamAId);
  const away = getTeam(f.teamBId);
  confirmModal({
    icon: "⚽",
    title: "جاهزون للمباراة؟",
    html: `<div class="pre-match">
        <span>${avatarHtml(home, 44)}<b>${esc(home.name)}</b><small>🏠 صاحب الأرض</small></span>
        <span class="pre-vs">VS</span>
        <span>${avatarHtml(away, 44)}<b>${esc(away.name)}</b><small>✈️ الضيف</small></span>
      </div>
      <p class="modal-message">🏟️ على ملعب ${esc(home.name)} — ${esc(legLabel(f.leg))}</p>`,
    confirmLabel: "🚀 ابدأ المباراة",
    onConfirm: () => startFixture(f),
  });
}

function startFixture(fixture) {
  pendingMatch = {
    id: "m_" + Date.now(),
    fixture,
    teamAId: fixture.teamAId,
    teamBId: fixture.teamBId,
    scoreA: 0,
    scoreB: 0,
    shield: { A: false, B: false },
    armed: { A: null, B: null }, // بطاقة مضاعفة مفعّلة: الإجابة الصحيحة القادمة = هدفان
    stopRival: null, // الجهة التي حصلت على السؤال القادم وحدها
  };
  setView("match-live");
}

function liveResult(side) {
  const mine = side === "A" ? pendingMatch.scoreA : pendingMatch.scoreB;
  const theirs = side === "A" ? pendingMatch.scoreB : pendingMatch.scoreA;
  return mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
}

function renderMatchLive(container) {
  if (!pendingMatch) return setView("hub");
  const A = getTeam(pendingMatch.teamAId);
  const B = getTeam(pendingMatch.teamBId);
  const sideTeam = { A, B };

  const card = document.createElement("div");
  card.className = "card match-card";
  card.innerHTML = `
    <div class="match-head">
      <h3>⚽ مباراة مباشرة</h3>
      <span class="match-chip">🏟️ على ملعب ${esc(A.name)}</span>
      <span class="match-chip">${esc(legLabel(pendingMatch.fixture.leg))}</span>
    </div>`;

  // لافتات البطاقات المفعّلة الآن
  const banners = [];
  ["A", "B"].forEach((side) => {
    if (pendingMatch.armed[side]) {
      const c = effectCardById(pendingMatch.armed[side]);
      banners.push(
        `<div class="effect-banner arm"><span>${c.icon} <b>${esc(c.name)}</b>: الإجابة الصحيحة القادمة لفريق <b>${esc(sideTeam[side].name)}</b> = هدفان</span>
          <button class="btn btn-outline-light" data-clear-arm="${side}">✖ لم يُجب صحيحًا</button></div>`
      );
    }
    if (pendingMatch.shield[side])
      banners.push(`<div class="effect-banner shield"><span>🛡️ فريق <b>${esc(sideTeam[side].name)}</b> محمي بالدرع في هذه المباراة</span></div>`);
  });
  if (pendingMatch.stopRival) {
    const s = pendingMatch.stopRival;
    const other = s === "A" ? B : A;
    banners.push(
      `<div class="effect-banner stop"><span>✋ السؤال القادم لفريق <b>${esc(sideTeam[s].name)}</b> وحده — فريق ${esc(other.name)} ممنوع من الإجابة</span>
        <button class="btn btn-outline-light" data-clear-stop>✔ انتهى السؤال</button></div>`
    );
  }
  if (banners.length) card.innerHTML += `<div class="effect-banners">${banners.join("")}</div>`;

  const teamBox = (side, role) => {
    const t = sideTeam[side];
    const score = side === "A" ? pendingMatch.scoreA : pendingMatch.scoreB;
    const blocked = pendingMatch.stopRival && pendingMatch.stopRival !== side;
    return `<div class="match-team" style="--team-color:${teamColor(t)}">
      <div class="match-role">${role}</div>
      <div class="match-team-name">${esc(t.name)}</div>
      <div class="match-score" id="score${side}">${score}</div>
      <div class="match-live-result">${resultChip(liveResult(side))}</div>
      ${pendingMatch.armed[side] ? '<div class="armed-tag">⚽⚽ الهدف القادم ×2</div>' : ""}
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-primary goal-btn" data-plus="${side}" ${blocked ? "disabled" : ""}>${blocked ? "✋ ممنوع" : "+ هدف"}</button>
        <button class="btn btn-outline-light" data-minus="${side}">-</button>
      </div>
    </div>`;
  };

  card.innerHTML += `<div class="match-vs">${teamBox("A", "🏠 صاحب الأرض")}<div class="vs-badge">VS</div>${teamBox("B", "✈️ الضيف")}</div>`;
  container.appendChild(card);

  const cardsPanel = document.createElement("div");
  cardsPanel.className = "grid";
  cardsPanel.appendChild(buildLiveCardPicker(A, "A"));
  cardsPanel.appendChild(buildLiveCardPicker(B, "B"));
  container.appendChild(cardsPanel);

  const endWrap = document.createElement("div");
  endWrap.className = "match-end";
  endWrap.innerHTML = `<button class="btn-start" id="endMatch">🏁 إنهاء المباراة وحساب النقاط</button>
    <button class="btn btn-outline-light" id="cancelMatch">إلغاء المباراة</button>`;
  container.appendChild(endWrap);

  card.querySelectorAll("[data-plus]").forEach((btn) => {
    btn.onclick = (e) => {
      const side = btn.dataset.plus;
      const add = pendingMatch.armed[side] ? 2 : 1;
      if (side === "A") pendingMatch.scoreA += add;
      else pendingMatch.scoreB += add;
      pendingMatch.armed[side] = null;
      if (pendingMatch.stopRival === side) pendingMatch.stopRival = null;
      const x = e.clientX;
      const y = e.clientY;
      render();
      const el = document.getElementById("score" + side);
      if (el) el.classList.add("score-pop");
      fireConfetti(x, y, add === 2 ? 40 : 18);
    };
  });
  card.querySelectorAll("[data-minus]").forEach((btn) => {
    btn.onclick = () => {
      const side = btn.dataset.minus;
      if (side === "A") pendingMatch.scoreA = Math.max(0, pendingMatch.scoreA - 1);
      else pendingMatch.scoreB = Math.max(0, pendingMatch.scoreB - 1);
      render();
    };
  });
  card.querySelectorAll("[data-clear-arm]").forEach((btn) => {
    btn.onclick = () => {
      pendingMatch.armed[btn.dataset.clearArm] = null;
      render();
    };
  });
  const clearStop = card.querySelector("[data-clear-stop]");
  if (clearStop)
    clearStop.onclick = () => {
      pendingMatch.stopRival = null;
      render();
    };

  endWrap.querySelector("#endMatch").onclick = () => {
    const rA = liveResult("A");
    const summary = rA === "draw" ? "تعادل" : `فوز ${rA === "win" ? A.name : B.name}`;
    confirmModal({
      icon: "🏁",
      title: "إنهاء المباراة وحساب النقاط؟",
      message: `النتيجة: ${A.name} ${pendingMatch.scoreA} : ${pendingMatch.scoreB} ${B.name} — ${summary}`,
      confirmLabel: "إنهاء وحساب النقاط",
      onConfirm: () => finalizeMatch(A, B),
    });
  };
  endWrap.querySelector("#cancelMatch").onclick = () =>
    confirmModal({
      icon: "⚠️",
      title: "إلغاء المباراة؟",
      message: "لن تُحتسب أي نتيجة، وتبقى المباراة في الجدول لتُلعب لاحقًا.",
      confirmLabel: "إلغاء المباراة",
      cancelLabel: "متابعة اللعب",
      danger: true,
      onConfirm: () => {
        pendingMatch = null;
        setView("team");
      },
    });
}

// كل بطاقات المباراة لفريق - المدير يختار فقط البطاقة التي يملكها الفريق فعلياً (مطبوعة حضورياً)
function buildLiveCardPicker(team, side) {
  const box = document.createElement("div");
  box.className = "card live-cards";
  box.style.setProperty("--team-color", teamColor(team));
  box.innerHTML = `<h3>🃏 بطاقات ${esc(team.name)}</h3>`;
  const wrap = document.createElement("div");
  wrap.className = "card-tiles-wrap";
  CONFIG.effectCards.forEach((c) => {
    const used = team.cardUsage[c.id] === pendingMatch.id;
    const tile = document.createElement("button");
    tile.className = "card-tile" + (used ? " used" : "");
    tile.innerHTML = `<span class="card-tile-icon">${c.icon}</span><span class="card-tile-name">${esc(c.name)}</span>
      <span class="card-tile-state">${used ? "✅ استُخدمت" : "جاهزة"}</span>`;
    tile.onclick = () => useLiveCard(team, side, c);
    wrap.appendChild(tile);
  });
  box.appendChild(wrap);
  return box;
}

function useLiveCard(team, side, card) {
  const oppSide = side === "A" ? "B" : "A";
  const opp = getTeam(oppSide === "A" ? pendingMatch.teamAId : pendingMatch.teamBId);
  if (team.cardUsage[card.id] === pendingMatch.id) {
    return notice("البطاقة مستخدمة", `استخدم فريق ${team.name} بطاقة «${card.name}» في هذه المباراة بالفعل.`, card.icon);
  }
  const usedThisMatch = Object.values(team.cardUsage).filter((v) => v === pendingMatch.id).length;
  if (usedThisMatch >= CONFIG.maxCardsPerMatch) {
    return notice(
      "بلغ الفريق الحد الأقصى للبطاقات",
      `لا يمكن لفريق ${team.name} استخدام أكثر من ${CONFIG.maxCardsPerMatch} بطاقات في المباراة الواحدة.`,
      "🃏"
    );
  }
  if (card.effect === "stopRival" && pendingMatch.shield[oppSide]) {
    return notice("🛡️ الخصم محمي بالدرع", `لا يمكن استخدام «${card.name}» ضد فريق ${opp.name} لأنه فعّل الدرع في هذه المباراة. البطاقة لم تُستهلك.`, "🛡️");
  }
  if (card.effect === "stopRival" && pendingMatch.stopRival) {
    return notice("يوجد سؤال محجوز الآن", "أنهِ السؤال المحجوز الحالي أولاً ثم استخدم البطاقة.", "✋");
  }
  if (card.effect === "arm" && pendingMatch.armed[side]) {
    return notice("مضاعفة مفعّلة بالفعل", `لدى فريق ${team.name} مضاعفة مفعّلة للإجابة القادمة.`, card.icon);
  }
  confirmModal({
    icon: card.icon,
    title: card.name,
    html: `<div class="card-effect-text">${esc(card.confirmText.replace("{team}", team.name))}</div>`,
    confirmLabel: "✅ تأكيد الاستخدام",
    onConfirm: () => {
      if (card.effect === "shield") pendingMatch.shield[side] = true;
      if (card.effect === "arm") pendingMatch.armed[side] = card.id;
      if (card.effect === "stopRival") pendingMatch.stopRival = side;
      team.cardUsage[card.id] = pendingMatch.id;
      team.cardLog.push({ at: nowISO(), text: `${card.icon} ${card.name} — في مباراة ضد ${opp.name}` });
      persist();
      render();
    },
  });
}

function finalizeMatch(teamA, teamB) {
  const { scoreA, scoreB } = pendingMatch;
  teamA.matches.played++;
  teamB.matches.played++;
  teamA.matches.goalsFor += scoreA;
  teamA.matches.goalsAgainst += scoreB;
  teamB.matches.goalsFor += scoreB;
  teamB.matches.goalsAgainst += scoreA;

  const pointsBefore = { A: teamA.matches.points, B: teamB.matches.points };
  let resultA;
  let resultB;
  if (scoreA > scoreB) {
    resultA = "win";
    resultB = "loss";
    teamA.matches.won++;
    teamA.matches.points += CONFIG.matchPoints.win;
    teamB.matches.lost++;
    teamB.matches.points += scoreB > 0 ? CONFIG.matchPoints.lossIfScored : CONFIG.matchPoints.lossIfZero;
  } else if (scoreB > scoreA) {
    resultA = "loss";
    resultB = "win";
    teamB.matches.won++;
    teamB.matches.points += CONFIG.matchPoints.win;
    teamA.matches.lost++;
    teamA.matches.points += scoreA > 0 ? CONFIG.matchPoints.lossIfScored : CONFIG.matchPoints.lossIfZero;
  } else {
    resultA = resultB = "draw";
    teamA.matches.drawn++;
    teamB.matches.drawn++;
    teamA.matches.points += CONFIG.matchPoints.drawEach;
    teamB.matches.points += CONFIG.matchPoints.drawEach;
  }

  // الرصيد الإضافي = مكافأة الأهداف العامة + مكافأة الملكية + مكافأة ثابتة حسب النتيجة، لكل فريق بحسب نتيجته هو (لا تمس نقاط الدوري أبداً)
  const bonusA = goalBalanceBonus(resultA, scoreA) + ownershipBalanceBonus(teamA, resultA) + resultBalanceBonus(resultA);
  const bonusB = goalBalanceBonus(resultB, scoreB) + ownershipBalanceBonus(teamB, resultB) + resultBalanceBonus(resultB);
  teamA.balance += bonusA;
  teamB.balance += bonusB;
  teamA.lastOpponentId = teamB.id;
  teamB.lastOpponentId = teamA.id;

  const fixture = pendingMatch.fixture;
  fixture.played = true;
  fixture.scoreA = scoreA;
  fixture.scoreB = scoreB;

  stage().matchLog.push({
    at: nowISO(),
    leg: fixture.leg,
    teamAId: teamA.id,
    teamBId: teamB.id,
    teamAName: teamA.name,
    teamBName: teamB.name,
    scoreA,
    scoreB,
    bonusA,
    bonusB,
  });

  pendingMatch = null;
  persist();
  showWinnerModal({
    teamA,
    teamB,
    scoreA,
    scoreB,
    resultA,
    resultB,
    bonusA,
    bonusB,
    leagueA: teamA.matches.points - pointsBefore.A,
    leagueB: teamB.matches.points - pointsBefore.B,
  });
}

function showWinnerModal(r) {
  const winner = r.resultA === "win" ? r.teamA : r.resultB === "win" ? r.teamB : null;
  const side = (team, result, bonus, league) => `
    <div class="winner-side">
      ${avatarHtml(team, 44)}
      <b>${esc(team.name)}</b>
      ${resultChip(result)}
      <span class="winner-gain">⚽ +${league} نقاط دوري</span>
      <span class="winner-gain">💰 +${bonus} رصيد</span>
    </div>`;
  const m = openModal({
    boxClass: "winner-box",
    onClose: () => setView("results"),
    html: `
      ${winner ? `<div class="winner-trophy">🏆</div><h2>الفائز: ${esc(winner.name)}</h2>` : `<div class="winner-trophy">🤝</div><h2>تعادل!</h2>`}
      <div class="winner-score">${esc(r.teamA.name)} <span>${r.scoreA} : ${r.scoreB}</span> ${esc(r.teamB.name)}</div>
      <div class="winner-sides">${side(r.teamA, r.resultA, r.bonusA, r.leagueA)}${side(r.teamB, r.resultB, r.bonusB, r.leagueB)}</div>
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

render();

// استعادة تلقائية من النسخة الاحتياطية السحابية فقط إذا كان هذا الجهاز فارغاً تماماً (لا يوجد حفظ محلي أصلاً)
if (!localStorage.getItem(STORAGE_KEY)) {
  tryCloudRestore().then((cloud) => {
    if (cloud && typeof cloud === "object" && (cloud.stages || Array.isArray(cloud.teams))) {
      state = migrateState(cloud);
      saveState(state);
      render();
    }
  });
}
