let state = loadState();
let currentView = state.setupDone ? "hub" : "intro";
let activeTeamId = null; // الفريق المعروض حالياً في الأكاديمية/البطاقات
let balanceVisible = {}; // {teamId: bool} - عرض/إخفاء الرصيد لكل فريق
let pendingMatch = null; // {teamAId, teamBId, scoreA, scoreB}
let academyLandGranted = state.academyLandGranted || false;
let academySubView = null; // null | 'buildings' | 'employees' | 'players'
let cardsSubView = null; // null | 'effect' | 'action' | 'discipline'

const root = document.getElementById("app");

function persist() {
  state.academyLandGranted = academyLandGranted;
  saveState(state);
}

function getTeam(id) {
  return state.teams.find((t) => t.id === id);
}

function sumCounts(obj) {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

function pointsFromCounts(counts, configList) {
  let total = 0;
  configList.forEach((item) => {
    total += (counts[item.id] || 0) * item.cost;
  });
  return total;
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
  const buildingCount = sumCounts(team.buildings);
  const employeeCount = sumCounts(team.employees);
  const playerBatches = sumCounts(team.players);
  const playerCount = playerBatches * (CONFIG.players[0]?.batchSize || 5);
  const buildingPoints = pointsFromCounts(team.buildings, CONFIG.buildings);
  const employeePoints = pointsFromCounts(team.employees, CONFIG.employees);
  const playerPoints = pointsFromCounts(team.players, CONFIG.players);
  const academyTotal = buildingPoints + employeePoints + playerPoints;
  return {
    buildingCount,
    employeeCount,
    playerBatches,
    playerCount,
    buildingPoints,
    employeePoints,
    playerPoints,
    academyTotal,
  };
}

// مكافأة الرصيد حسب الملكية: تُجمع لكل وحدة مملوكة (مبنى/موظف/دفعة لاعبين) على حدة حسب فئة تكلفتها الأساسية الثابتة
function ownershipBalanceBonus(team, result) {
  let total = 0;
  allShopItemsFlat().forEach(({ key, item }) => {
    const count = team[key][item.id] || 0;
    if (count <= 0) return;
    const tier = CONFIG.ownershipBonusTiers[item.cost];
    if (!tier) return;
    total += count * tier[result];
  });
  return total;
}

// السعر الفعلي للوحدة التالية من عنصر معيّن لهذا الفريق (يتضاعف مع كل وحدة يملكها)
function nextItemCost(team, key, item) {
  const count = team[key][item.id] || 0;
  return CONFIG.priceDoublingPerUnit ? item.cost * Math.pow(2, count) : item.cost;
}

// هل يملك الفريق واحدة على الأقل من كل عنصر متاح للشراء (مبانٍ + موظفون + لاعبون)؟
function ownsOneOfEverything(team) {
  return allShopItemsFlat().every(({ key, item }) => (team[key][item.id] || 0) >= 1);
}

// هل يُسمح للفريق بشراء وحدة أخرى من هذا العنصر؟ (أول وحدة مسموحة دوماً، والتكرار يتطلب امتلاك الكل أولاً)
function canPurchase(team, key, item) {
  const count = team[key][item.id] || 0;
  if (count === 0) return true;
  return ownsOneOfEverything(team);
}

function goalBalanceBonus(result, goals) {
  return (CONFIG.goalBonus[result] || 0) * goals;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// زر رجوع سريع للرئيسية (الفرق + الجدول) - يُضاف أعلى شاشات عمل الفريق
function addHomeBackButton(container) {
  const btn = document.createElement("button");
  btn.className = "btn btn-outline";
  btn.style.marginBottom = "12px";
  btn.textContent = "🏠 رجوع للرئيسية والمباريات";
  btn.onclick = () => setView("hub");
  container.appendChild(btn);
}

function setView(view) {
  currentView = view;
  render();
}

function render() {
  root.innerHTML = "";
  if (currentView === "intro") return renderIntro();
  if (currentView === "setup") return renderSetup();
  root.appendChild(renderTopbar());
  const container = document.createElement("div");
  container.className = "container";
  root.appendChild(container);

  switch (currentView) {
    case "hub":
      renderHub(container);
      break;
    case "academy":
      renderAcademy(container);
      break;
    case "match-setup":
      renderMatchSetup(container);
      break;
    case "match-live":
      renderMatchLive(container);
      break;
    case "support":
      renderSupport(container);
      break;
    case "cards":
      renderCards(container);
      break;
    case "day-history":
      renderDayHistory(container);
      break;
    case "results":
      renderResults(container);
      break;
    default:
      renderHub(container);
  }
}

/* ================= شاشة البداية ================= */
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
    <div class="intro-logo">الدوري<br/>الثقافي</div>
    <div class="intro-title">🏆 الدوري الثقافي — أكاديمية الأبطال</div>
    <div class="slogans">
      <div class="slogan right">🔥 من يبني أعظم أكاديمية؟</div>
      <div class="slogan">⚡ أجب.. ابنِ.. نافس.. توّج</div>
    </div>
    <div class="subtext">كل فريق لا يملك نقاطًا فقط، بل يبني أكاديمية ثقافية كاملة: مبانٍ وموظفون ولاعبون — وفي النهاية يُتوَّج الأكثر بناءً وتطورًا.</div>
    <button class="btn-start" id="btnStart">${state.setupDone ? "استمر في الدوري ▶" : "هيا لنذهب للتنافس"}</button>
  `;

  root.appendChild(div);
  document.getElementById("btnStart").onclick = () => setView(state.setupDone ? "hub" : "setup");
  document.getElementById("btnExplain").onclick = () => openExplainModal();
}

function openExplainModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <button class="close-modal" id="closeExplain">إغلاق ✕</button>
      <h2>📖 شرح المسابقة</h2>
      <p>كل فريق يملك <b>رصيدًا</b> من النقاط، ويستخدمه لبناء <b>أكاديميته الثقافية</b> المكوّنة من 3 عناصر:</p>
      <ul>
        <li>🏢 <b>مبانٍ</b> (الإدارة العامة، المكتبة الثقافية، قاعة التدريب...)</li>
        <li>👨‍💼 <b>موظفون</b> (مدير الأكاديمية، المدرب الثقافي، الباحث...)</li>
        <li>👥 <b>لاعبون</b> (كل دفعة شراء = 5 لاعبين دفعة واحدة)</li>
      </ul>
      <p>⚠️ لا يمكن شراء وحدة ثانية من أي عنصر قبل امتلاك واحدة على الأقل من <b>كل</b> عنصر آخر. وسعر كل عنصر <b>يتضاعف ×2</b> مع كل وحدة إضافية يشتريها نفس الفريق منه.</p>
      <p>هناك جدول دوري ثابت، وكل مباراة تُحسب لها <b>نقاط دوري ثابتة</b> (فوز=3، تعادل=1، خسارة=0) بالإضافة إلى <b>رصيد</b> يُضاف من مصدرين معًا: مكافأة عامة عن كل هدف يسجله الفريق، ومكافأة إضافية حسب ما يملكه الفريق فعليًا من مبانٍ وموظفين ولاعبين (على السعر الأساسي الثابت دومًا).</p>
      <p>خلال المباريات المباشرة تظهر كل <b>بطاقات المفاجأة</b> (الدرع، الجوكر، ركلة الترجيح، المتسابق النجم...)، ويختار المدير فقط البطاقة التي يملكها الفريق فعليًا (من نسخه المطبوعة حضوريًا). بطاقات المنح والسحب تكون متاحة فقط في يوم "نهائي الدوري". وتوجد أيضًا بطاقات تأديبية: كرت أصفر (إنذار شفوي) وكرت أحمر (يمنح باقي الفرق رصيدًا إضافيًا).</p>
      <p>في نهاية كل يوم يمكن للمدير "إنهاء الدوري لهذا اليوم" لحفظ لقطة كاملة عنه في السجل، دون تصفير أي رصيد أو أكاديمية أو نقاط — كل شيء يستمر لليوم التالي كما هو.</p>
      <p>في النهاية يُحسب <b>إجمالي الأكاديمية</b> (مبانٍ + موظفون + لاعبون) بشكل مستقل عن <b>نقاط الدوري</b>، ويُتوَّج الفريق الأكثر بناءً وتفوقًا.</p>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("closeExplain").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

/* ================= شاشة تسجيل الفرق ================= */
function renderSetup() {
  const div = document.createElement("div");
  div.className = "intro-screen";
  div.style.justifyContent = "flex-start";
  div.style.paddingTop = "60px";
  div.innerHTML = `
    <div class="intro-title">📝 تسجيل الفرق</div>
    <div class="card" style="color:#10222a; max-width:480px; width:100%;">
      <label>كم عدد الفرق المشاركة؟</label>
      <div style="display:flex; gap:10px; margin:10px 0;">
        <input type="number" id="teamCount" min="2" max="16" value="4" style="flex:1;" />
        <button class="btn btn-primary" id="btnGenFields">تأكيد العدد</button>
      </div>
      <div class="setup-team-inputs" id="teamInputs"></div>
      <button class="btn btn-gold" id="btnConfirmTeams" style="width:100%; margin-top:12px; display:none;">✅ بدء الدوري بهذه الفرق</button>
    </div>
  `;
  root.appendChild(div);

  document.getElementById("btnGenFields").onclick = () => {
    const n = parseInt(document.getElementById("teamCount").value, 10) || 0;
    const wrap = document.getElementById("teamInputs");
    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
      wrap.innerHTML += `<input type="text" placeholder="اسم الفريق ${i + 1} (ترتيب البدء ${i + 1})" data-order="${i}" class="team-name-input" />`;
    }
    document.getElementById("btnConfirmTeams").style.display = n > 0 ? "block" : "none";
  };

  document.getElementById("btnConfirmTeams").onclick = () => {
    const inputs = Array.from(document.querySelectorAll(".team-name-input"));
    const names = inputs.map((inp) => inp.value.trim());
    if (names.some((n) => !n)) {
      alert("يرجى تعبئة أسماء جميع الفرق");
      return;
    }
    state.teams = names.map((name, i) => newTeam("team_" + Date.now() + "_" + i, name, i));
    state.setupDone = true;
    state.currentDay = 1;
    state.turnIndex = 0;
    state.schedule = generateRoundRobin(state.teams);
    persist();
    setView("hub");
  };
}

/* ================= الشريط العلوي ================= */
function renderTopbar() {
  const bar = document.createElement("div");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="brand">🏆 الدوري الثقافي
      <button class="btn btn-outline" style="padding:4px 10px; font-size:12px; color:#fff;" id="btnExit">🚪 خروج</button>
    </div>
    <div class="day-pill">📅 اليوم ${state.currentDay} ${state.isFinalDay ? '<span class="tag danger">نهائي الدوري</span>' : ""} &nbsp;
      <button class="btn btn-outline" style="padding:4px 10px; font-size:12px;" id="btnToggleFinal">${state.isFinalDay ? "إلغاء وضع النهائي" : "🏁 هذا نهائي الدوري"}</button>
      <button class="btn btn-gold" style="padding:4px 10px; font-size:12px;" id="btnEndDay">إنهاء الدوري لهذا اليوم</button>
    </div>
  `;
  setTimeout(() => {
    const ft = document.getElementById("btnToggleFinal");
    if (ft)
      ft.onclick = () => {
        state.isFinalDay = !state.isFinalDay;
        persist();
        render();
      };
    const ed = document.getElementById("btnEndDay");
    if (ed) ed.onclick = () => endDayArchive();
    const ex = document.getElementById("btnExit");
    if (ex)
      ex.onclick = () => {
        if (confirm("الخروج إلى الشاشة الرئيسية؟ كل بياناتك محفوظة ولن يضيع شيء.")) {
          setView("intro");
        }
      };
  });
  return bar;
}

// يحفظ لقطة كاملة لليوم الحالي (نتائج/أكاديمية كل فريق + كل الأحداث) في سجل الأيام،
// ثم يتقدّم لليوم التالي بدون تصفير أي رصيد أو أكاديمية أو نقاط دوري - فقط اليوم يتغيّر وحدود البطاقات تتجدد.
function endDayArchive() {
  if (!confirm("سيتم حفظ كل شيء عن اليوم " + state.currentDay + " في السجل، والانتقال لليوم التالي. الرصيد والأكاديمية ونقاط الدوري لن تتغيّر إطلاقًا. تأكيد؟")) {
    return;
  }
  const day = state.currentDay;
  const teamsSnapshot = state.teams.map((t) => JSON.parse(JSON.stringify(t)));
  const events = {
    matches: state.matchLog.filter((m) => m.day === day),
    cardLogs: state.teams.flatMap((t) => t.cardLog.filter((l) => l.day === day).map((l) => ({ team: t.name, ...l }))),
    supportLogs: state.teams.flatMap((t) => t.supportLog.filter((l) => l.day === day).map((l) => ({ team: t.name, ...l }))),
  };
  state.dayHistory.push({ day, endedAt: new Date().toISOString(), teamsSnapshot, events });
  state.currentDay += 1;
  persist();
  render();
}

/* ================= الرئيسية (مركز الفريق) ================= */
function renderHub(container) {
  if (state.teams.length === 0) {
    container.innerHTML = `<div class="card">لا توجد فرق مسجلة. <button class="btn btn-primary" id="goSetup">تسجيل الفرق</button></div>`;
    container.querySelector("#goSetup").onclick = () => setView("setup");
    return;
  }
  if (!activeTeamId || !getTeam(activeTeamId)) activeTeamId = state.teams[0].id;

  // بطاقات الفرق - اضغط على فريق لتحديده، ثم انتقل لأي خانة (الأكاديمية/البطاقات/النتائج) وستجدها مفتوحة على هذا الفريق
  const teamsHeading = document.createElement("h3");
  teamsHeading.textContent = "🏆 الفرق — اضغط على فريق ثم افتح أي خانة من الأعلى";
  teamsHeading.style.color = "#fff";
  teamsHeading.style.textShadow = "0 0 12px rgba(0,0,0,0.4)";
  container.appendChild(teamsHeading);

  const teamsGrid = document.createElement("div");
  teamsGrid.className = "grid team-card-grid";
  state.teams.forEach((t) => {
    const s = academyStats(t);
    const selected = t.id === activeTeamId;
    const cardEl = document.createElement("button");
    cardEl.className = "team-card" + (selected ? " selected" : "");
    cardEl.innerHTML = `
      <div class="team-card-name">${esc(t.name)}</div>
      <div class="team-card-stats">
        <span>💰 ${t.balance}</span>
        <span>🏢 ${s.buildingCount}</span>
        <span>⚽ ${t.matches.points}</span>
      </div>
      ${selected ? '<span class="team-card-badge">✓ محدد</span>' : ""}
    `;
    cardEl.onclick = () => { activeTeamId = t.id; render(); };
    teamsGrid.appendChild(cardEl);
  });
  container.appendChild(teamsGrid);

  // خانات الفريق المحدد - إنشاء الأكاديمية / الدعم / البطاقات / النتائج
  const selectedTeam = getTeam(activeTeamId);
  const actionsCard = document.createElement("div");
  actionsCard.className = "card";
  actionsCard.innerHTML = `<h3>⚙️ خانات فريق ${esc(selectedTeam.name)}</h3>`;
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.innerHTML = `
    <button class="hub-btn" id="goAcademy"><span class="icon">🏗️</span> إنشاء الأكاديمية</button>
    <button class="hub-btn" id="goSupport"><span class="icon">🤝</span> الدعم</button>
    <button class="hub-btn" id="goCards"><span class="icon">🃏</span> البطاقات</button>
    <button class="hub-btn" id="goResults"><span class="icon">📊</span> النتائج</button>
  `;
  actionsCard.appendChild(grid);
  container.appendChild(actionsCard);

  grid.querySelector("#goAcademy").onclick = () => { academySubView = null; setView("academy"); };
  grid.querySelector("#goSupport").onclick = () => setView("support");
  grid.querySelector("#goCards").onclick = () => { cardsSubView = null; setView("cards"); };
  grid.querySelector("#goResults").onclick = () => setView("results");

  renderScheduleBlock(container);

  if (!academyLandGranted) {
    const bonusCard = document.createElement("div");
    bonusCard.className = "card";
    bonusCard.innerHTML = `<b>🎁 بونص بداية الدوري:</b> منح "أرض الأكاديمية" (مبنى مجاني) لجميع الفرق دفعة واحدة.
      <button class="btn btn-gold" id="grantLand" style="margin-inline-start:10px;">منح الآن لجميع الفرق</button>`;
    container.appendChild(bonusCard);
    bonusCard.querySelector("#grantLand").onclick = () => {
      state.teams.forEach((t) => {
        t.buildings["admin_office"] = (t.buildings["admin_office"] || 0) + 1;
      });
      academyLandGranted = true;
      persist();
      render();
    };
  }
}

function renderBalanceBox(team) {
  const visible = balanceVisible[team.id];
  return `
    <div class="balance-box">
      <div><b>💰 رصيد فريق ${esc(team.name)}:</b>
        <span class="${visible ? "" : "balance-hidden"}">${visible ? team.balance : "•••"}</span> نقطة
      </div>
      <button class="btn btn-outline" onclick="toggleBalance('${team.id}')">${visible ? "إخفاء الرصيد" : "إظهار الرصيد"}</button>
    </div>`;
}

function toggleBalance(teamId) {
  balanceVisible[teamId] = !balanceVisible[teamId];
  render();
}
window.toggleBalance = toggleBalance;

/* ================= إنشاء الأكاديمية ================= */
function renderAcademy(container) {
  addHomeBackButton(container);
  container.appendChild(teamPicker("academy"));
  const team = getTeam(activeTeamId) || state.teams[0];
  if (!team) return;

  const balCard = document.createElement("div");
  balCard.className = "card";
  balCard.innerHTML = renderBalanceBox(team);
  container.appendChild(balCard);

  if (!ownsOneOfEverything(team)) {
    const noteCard = document.createElement("div");
    noteCard.className = "card";
    noteCard.innerHTML = `<p class="tag warn">⚠️ لا يمكن شراء عنصر ثانٍ من أي نوع قبل امتلاك واحدة على الأقل من كل عنصر متاح (كل المباني + كل الموظفين + دفعة اللاعبين).</p>`;
    container.appendChild(noteCard);
  }

  const categories = [
    { key: "buildings", label: "المباني", icon: "🏢", list: CONFIG.buildings },
    { key: "employees", label: "الموظفون", icon: "👨‍💼", list: CONFIG.employees },
    { key: "players", label: "اللاعبون", icon: "👥", list: CONFIG.players },
  ];

  if (!academySubView) {
    const grid = document.createElement("div");
    grid.className = "grid";
    categories.forEach((cat) => {
      const owned = sumCounts(team[cat.key]);
      const btn = document.createElement("button");
      btn.className = "hub-btn";
      btn.innerHTML = `<span class="icon">${cat.icon}</span> ${cat.label}<span class="tag" style="margin-top:6px;">تملك: ${owned}</span>`;
      btn.onclick = () => { academySubView = cat.key; render(); };
      grid.appendChild(btn);
    });
    const supportBtn = document.createElement("button");
    supportBtn.className = "hub-btn";
    supportBtn.innerHTML = `<span class="icon">🤝</span> الدعم`;
    supportBtn.onclick = () => setView("support");
    grid.appendChild(supportBtn);
    container.appendChild(grid);
    return;
  }

  const active = categories.find((c) => c.key === academySubView);
  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-outline";
  backBtn.style.marginBottom = "12px";
  backBtn.textContent = "← رجوع لأقسام الأكاديمية";
  backBtn.onclick = () => { academySubView = null; render(); };
  container.appendChild(backBtn);

  container.appendChild(
    buildShopSection(
      `${active.icon} ${active.label}${active.key === "players" ? " (كل دفعة = 5 لاعبين)" : ""}`,
      active.list,
      team,
      active.key
    )
  );
}

function buildShopSection(title, list, team, key) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = title;
  card.appendChild(h);
  list.forEach((item) => {
    const count = team[key][item.id] || 0;
    const cost = nextItemCost(team, key, item);
    const allowed = canPurchase(team, key, item);
    const canAfford = team.balance >= cost;
    const disabled = !allowed || !canAfford;
    let reason = "";
    if (!allowed) reason = "أكمل امتلاك كل العناصر أولاً";
    else if (!canAfford) reason = "الرصيد غير كافٍ";
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      <div><span class="count-badge">${count}${key === "players" ? " (×5=" + count * (item.batchSize || 5) + ")" : ""}</span> ${esc(item.name)} ${item.basic ? '<span class="tag">أساسي</span>' : ""}
        <span class="tag">السعر التالي: ${cost} نقطة</span></div>
      <button class="btn btn-primary" ${disabled ? "disabled" : ""}>${disabled ? reason : "إنشاء (-" + cost + ")"}</button>
    `;
    row.querySelector("button").onclick = () => {
      if (disabled) return;
      team.balance -= cost;
      team[key][item.id] = count + 1;
      persist();
      render();
    };
    card.appendChild(row);
  });
  return card;
}

function teamPicker(returnView) {
  const wrap = document.createElement("div");
  wrap.className = "team-select-row";
  wrap.innerHTML = `<b>الفريق:</b> <select id="teamPickerSelect">
    ${state.teams.map((t) => `<option value="${t.id}" ${t.id === activeTeamId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
  </select>`;
  wrap.querySelector("select").onchange = (e) => {
    activeTeamId = e.target.value;
    render();
  };
  return wrap;
}

/* ================= الدعم ================= */
const SUPPORT_OPTIONS = [
  { id: "support_points", label: "سندعمكم بـ 5 نقاط", type: "balance", amount: 5 },
  { id: "support_building", label: "سندعمكم بمبنى جديد", type: "building" },
  { id: "support_employee", label: "سندعمكم بموظف جديد", type: "employee" },
];

function renderSupport(container) {
  addHomeBackButton(container);
  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-outline";
  backBtn.style.marginBottom = "12px";
  backBtn.textContent = "← رجوع لأقسام الأكاديمية";
  backBtn.onclick = () => { academySubView = null; setView("academy"); };
  container.appendChild(backBtn);

  container.appendChild(teamPicker("support"));
  const team = getTeam(activeTeamId) || state.teams[0];
  if (!team) return;

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>🤝 دعم الإدارة</h3><p>اختر الدعم المطابق للبطاقة التي سُحبت حضورياً — سيُسجَّل فوراً في شاشة النتائج.</p>`;
  const grid = document.createElement("div");
  grid.className = "grid";
  SUPPORT_OPTIONS.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "hub-btn";
    btn.style.background = "linear-gradient(160deg,#f2a93b,#c97f12)";
    btn.textContent = opt.label;
    btn.onclick = () => applySupport(team, opt);
    grid.appendChild(btn);
  });
  card.appendChild(grid);
  container.appendChild(card);

  if (team.supportLog.length) {
    const logCard = document.createElement("div");
    logCard.className = "card";
    logCard.innerHTML = `<h3>سجل الدعم لهذا الفريق</h3><ul class="log-list">${team.supportLog
      .slice()
      .reverse()
      .map((l) => `<li>يوم ${l.day} — ${esc(l.text)}</li>`)
      .join("")}</ul>`;
    container.appendChild(logCard);
  }
}

function applySupport(team, opt) {
  let text = opt.label;
  if (opt.type === "balance") {
    team.balance += opt.amount;
  } else if (opt.type === "building") {
    const pick = prompt("اسم المبنى الممنوح:\n" + CONFIG.buildings.map((b) => b.name).join("، "));
    const found = CONFIG.buildings.find((b) => b.name === pick);
    if (!found) return;
    team.buildings[found.id] = (team.buildings[found.id] || 0) + 1;
    text += " (" + found.name + ")";
  } else if (opt.type === "employee") {
    const pick = prompt("اسم الموظف الممنوح:\n" + CONFIG.employees.map((b) => b.name).join("، "));
    const found = CONFIG.employees.find((b) => b.name === pick);
    if (!found) return;
    team.employees[found.id] = (team.employees[found.id] || 0) + 1;
    text += " (" + found.name + ")";
  }
  team.supportLog.push({ day: state.currentDay, text });
  persist();
  render();
}

/* ================= المباريات ================= */
function renderMatchSetup(container) {
  renderScheduleBlock(container);
}

// جدول الدوري كامل + بدء المباراة التالية - يُستخدم في الرئيسية وفي شاشة المباريات معاً
function renderScheduleBlock(container) {
  if (!state.schedule || !state.schedule.length) {
    const noSchedCard = document.createElement("div");
    noSchedCard.className = "card";
    noSchedCard.innerHTML = `لا يوجد جدول مباريات. <button class="btn btn-primary" id="genSched">توليد الجدول الآن</button>`;
    container.appendChild(noSchedCard);
    noSchedCard.querySelector("#genSched").onclick = () => {
      state.schedule = generateRoundRobin(state.teams);
      persist();
      render();
    };
    return;
  }

  // إذا انتهت كل مباريات الجدول الحالي، يُضاف تلقائياً دور جديد كامل (كل فريق ضد كل فريق مرة أخرى)
  // بلا المساس بأي مباراة سابقة، حتى لا ينفد الجدول أبداً مهما طالت المسابقة.
  let nextFixture = state.schedule.find((f) => !f.played);
  if (!nextFixture) {
    const maxRound = Math.max(...state.schedule.map((f) => f.round));
    const newCycle = generateRoundRobin(state.teams).map((f) => ({ ...f, round: f.round + maxRound }));
    state.schedule.push(...newCycle);
    persist();
    nextFixture = newCycle[0];
  }

  const topCard = document.createElement("div");
  topCard.className = "card";
  topCard.innerHTML = `
    <h3>⚽ جدول الدوري</h3>
    <p>المباراة التالية: <b>${esc(getTeam(nextFixture.teamAId).name)}</b> 🆚 <b>${esc(getTeam(nextFixture.teamBId).name)}</b> (الجولة ${nextFixture.round})</p>
    <button class="btn btn-gold" id="startNext">🚀 ابدأ المباراة التالية</button>
  `;
  container.appendChild(topCard);
  topCard.querySelector("#startNext").onclick = () => startFixture(nextFixture);

  const listWrap = document.createElement("div");
  listWrap.innerHTML = '<h3 style="color:#fff; text-shadow:0 0 12px rgba(0,0,0,0.4);">📋 كل مباريات الجدول</h3>';
  container.appendChild(listWrap);

  const fixturesGrid = document.createElement("div");
  fixturesGrid.className = "grid fixture-grid";
  state.schedule.forEach((f, idx) => {
    const a = getTeam(f.teamAId);
    const b = getTeam(f.teamBId);
    const fx = document.createElement("div");
    fx.className = "fixture-card" + (f.played ? " played" : "");
    fx.innerHTML = `
      <div class="fixture-round">الجولة ${f.round}</div>
      <div class="fixture-teams">
        <span class="fixture-team">${esc(a.name)}</span>
        <span class="fixture-score">${f.played ? f.scoreA + " : " + f.scoreB : "VS"}</span>
        <span class="fixture-team">${esc(b.name)}</span>
      </div>
      ${f.played ? '<span class="tag">✅ انتهت</span>' : `<button class="btn btn-gold fixture-btn" data-idx="${idx}">▶ ابدأ هذه المباراة</button>`}
    `;
    if (!f.played) {
      fx.querySelector("button").onclick = () => startFixture(f);
    }
    fixturesGrid.appendChild(fx);
  });
  container.appendChild(fixturesGrid);

  if (state.matchLog.length) {
    const logCard = document.createElement("div");
    logCard.className = "card";
    logCard.innerHTML = `<h3>سجل آخر المباريات</h3><ul class="log-list">${state.matchLog
      .slice()
      .reverse()
      .slice(0, 15)
      .map((m) => `<li>يوم ${m.day} — ${esc(m.teamAName)} ${m.scoreA} : ${m.scoreB} ${esc(m.teamBName)}</li>`)
      .join("")}</ul>`;
    container.appendChild(logCard);
  }
}

function startFixture(fixture) {
  pendingMatch = { fixture, teamAId: fixture.teamAId, teamBId: fixture.teamBId, scoreA: 0, scoreB: 0 };
  setView("match-live");
}

function renderMatchLive(container) {
  if (!pendingMatch) return setView("hub");
  const teamA = getTeam(pendingMatch.teamAId);
  const teamB = getTeam(pendingMatch.teamBId);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>⚽ مباراة مباشرة</h3>`;
  const vs = document.createElement("div");
  vs.className = "match-vs";
  vs.innerHTML = `
    <div class="match-team">
      <div>${esc(teamA.name)}</div>
      <div class="match-score" id="scoreA">${pendingMatch.scoreA}</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-primary" id="plusA">+ هدف</button>
        <button class="btn btn-outline" id="minusA" style="color:#fff;">-</button>
      </div>
    </div>
    <div class="vs-badge">VS</div>
    <div class="match-team">
      <div>${esc(teamB.name)}</div>
      <div class="match-score" id="scoreB">${pendingMatch.scoreB}</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-primary" id="plusB">+ هدف</button>
        <button class="btn btn-outline" id="minusB" style="color:#fff;">-</button>
      </div>
    </div>
  `;
  card.appendChild(vs);

  const cardsPanel = document.createElement("div");
  cardsPanel.className = "grid";
  cardsPanel.style.marginTop = "10px";
  cardsPanel.appendChild(buildLiveCardPicker(teamA, "A"));
  cardsPanel.appendChild(buildLiveCardPicker(teamB, "B"));
  card.appendChild(cardsPanel);

  const endWrap = document.createElement("div");
  endWrap.style.textAlign = "center";
  endWrap.innerHTML = `<button class="btn btn-gold" id="endMatch">🏁 إنهاء المباراة وحساب النقاط</button>
    <button class="btn btn-outline" id="cancelMatch" style="margin-inline-start:10px;">إلغاء</button>`;
  card.appendChild(endWrap);
  container.appendChild(card);

  const bumpScore = (el) => {
    el.classList.remove("score-pop");
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth; // إعادة تشغيل الحركة
    el.classList.add("score-pop");
  };

  const refreshScores = () => {
    card.querySelector("#scoreA").textContent = pendingMatch.scoreA;
    card.querySelector("#scoreB").textContent = pendingMatch.scoreB;
  };

  card.querySelector("#plusA").onclick = (e) => {
    pendingMatch.scoreA++;
    refreshScores();
    bumpScore(card.querySelector("#scoreA"));
    fireConfetti(e.clientX, e.clientY, 18);
  };
  card.querySelector("#minusA").onclick = () => { pendingMatch.scoreA = Math.max(0, pendingMatch.scoreA - 1); refreshScores(); };
  card.querySelector("#plusB").onclick = (e) => {
    pendingMatch.scoreB++;
    refreshScores();
    bumpScore(card.querySelector("#scoreB"));
    fireConfetti(e.clientX, e.clientY, 18);
  };
  card.querySelector("#minusB").onclick = () => { pendingMatch.scoreB = Math.max(0, pendingMatch.scoreB - 1); refreshScores(); };

  card.querySelector("#cancelMatch").onclick = () => { pendingMatch = null; setView("hub"); };
  card.querySelector("#endMatch").onclick = () => finalizeMatch(teamA, teamB);
}

// أيقونة مميزة لكل بطاقة تأثير، لتمييزها بصريًا وتقليل الضغط الخاطئ
const CARD_ICONS = {
  shield: "🛡️",
  joker: "🃏",
  penalty_kick: "🥅",
  star_contestant: "🌟",
  double_goal: "⚽⚽",
  stop_rival: "✋",
};

// يعرض كل بطاقات التأثير لفريق أثناء المباراة المباشرة - المدير يختار فقط البطاقة التي يملكها الفريق فعلياً (مطبوعة حضورياً)
function buildLiveCardPicker(team, side) {
  const box = document.createElement("div");
  box.className = "card";
  box.style.background = "#0e2f38";
  box.style.color = "#fff";
  const h = document.createElement("h3");
  h.style.color = "#fff";
  h.textContent = `🃏 بطاقات ${team.name}`;
  box.appendChild(h);

  const tilesWrap = document.createElement("div");
  tilesWrap.className = "card-tiles-wrap";
  CONFIG.effectCards.forEach((c) => {
    const used = c.dailyLimit && team.cardUsage[c.id] && team.cardUsage[c.id].day === state.currentDay;
    const tile = document.createElement("button");
    tile.className = "card-tile" + (used ? " used" : "");
    tile.disabled = used;
    tile.innerHTML = `<span class="card-tile-icon">${CARD_ICONS[c.id] || "🃏"}</span><span class="card-tile-name">${esc(c.name)}</span>${used ? '<span class="card-tile-used">✅ استُخدمت اليوم</span>' : ""}`;
    tile.onclick = () => confirmCardUse(c, team.name, () => applyLiveCard(team, side, c.id));
    tilesWrap.appendChild(tile);
  });
  box.appendChild(tilesWrap);
  return box;
}

// نافذة تأكيد قبل تطبيق أي بطاقة فعليًا - لتقليل الضغط الخاطئ وتوضيح ماذا ستفعل البطاقة
function confirmCardUse(card, teamName, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box card-confirm-box">
      <div class="card-confirm-icon">${CARD_ICONS[card.id] || "🃏"}</div>
      <h2>${esc(card.name)}</h2>
      ${card.desc ? `<p>${esc(card.desc)}</p>` : ""}
      <p>سيتم استخدامها الآن لصالح فريق <b>${esc(teamName)}</b></p>
      <div style="display:flex; gap:10px; margin-top:16px;">
        <button class="btn btn-outline" id="cardCancelBtn" style="flex:1;">إلغاء</button>
        <button class="btn btn-gold" id="cardConfirmBtn" style="flex:1;">✅ تأكيد الاستخدام</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("cardCancelBtn").onclick = () => overlay.remove();
  document.getElementById("cardConfirmBtn").onclick = () => {
    overlay.remove();
    onConfirm();
  };
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };
}

function applyLiveCard(team, side, cardId) {
  const c = CONFIG.effectCards.find((x) => x.id === cardId);
  if (!c) return;
  if (c.dailyLimit && team.cardUsage[c.id] && team.cardUsage[c.id].day === state.currentDay) return;

  if (c.id === "shield") {
    team.shieldActiveDay = state.currentDay;
  } else if (c.id === "star_contestant" || c.id === "double_goal") {
    if (side === "A") pendingMatch.scoreA += 2; else pendingMatch.scoreB += 2;
  } else if (c.id === "stop_rival") {
    if (side === "A") pendingMatch.scoreA += 1; else pendingMatch.scoreB += 1;
  }
  // joker / penalty_kick: تسجيل فقط، بلا تأثير آلي مباشر على النتيجة

  if (c.dailyLimit) team.cardUsage[c.id] = { day: state.currentDay, count: 1 };
  team.cardLog.push({ day: state.currentDay, text: "استخدام أثناء المباراة: " + c.name });
  persist();
  render();
}

function finalizeMatch(teamA, teamB) {
  const { scoreA, scoreB } = pendingMatch;
  teamA.matches.played++;
  teamB.matches.played++;
  teamA.matches.goalsFor += scoreA;
  teamA.matches.goalsAgainst += scoreB;
  teamB.matches.goalsFor += scoreB;
  teamB.matches.goalsAgainst += scoreA;

  let resultA, resultB, winnerTeam;
  if (scoreA > scoreB) {
    resultA = "win";
    resultB = "loss";
    winnerTeam = teamA;
    teamA.matches.won++;
    teamA.matches.points += CONFIG.matchPoints.win;
    teamB.matches.lost++;
    teamB.matches.points += scoreB > 0 ? CONFIG.matchPoints.lossIfScored : CONFIG.matchPoints.lossIfZero;
  } else if (scoreB > scoreA) {
    resultA = "loss";
    resultB = "win";
    winnerTeam = teamB;
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

  // الرصيد الإضافي = مكافأة الأهداف العامة + مكافأة الملكية، لكل فريق بحسب نتيجته هو
  const bonusA = goalBalanceBonus(resultA, scoreA) + ownershipBalanceBonus(teamA, resultA);
  const bonusB = goalBalanceBonus(resultB, scoreB) + ownershipBalanceBonus(teamB, resultB);
  teamA.balance += bonusA;
  teamB.balance += bonusB;

  if (pendingMatch.fixture) {
    pendingMatch.fixture.played = true;
    pendingMatch.fixture.scoreA = scoreA;
    pendingMatch.fixture.scoreB = scoreB;
  }

  state.matchLog.push({
    day: state.currentDay,
    teamAName: teamA.name,
    teamBName: teamB.name,
    scoreA,
    scoreB,
    bonusA,
    bonusB,
  });

  pendingMatch = null;
  persist();
  showWinnerModal(winnerTeam, teamA, teamB, scoreA, scoreB, bonusA, bonusB);
}

function showWinnerModal(winnerTeam, teamA, teamB, scoreA, scoreB, bonusA, bonusB) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box winner-box">
      ${winnerTeam ? `<div class="winner-trophy">🏆</div><h2>الفائز: ${esc(winnerTeam.name)}</h2>` : `<div class="winner-trophy">🤝</div><h2>تعادل!</h2>`}
      <div style="font-size:22px; font-weight:800; margin:14px 0;">${esc(teamA.name)} <span style="color:var(--gold);">${scoreA} : ${scoreB}</span> ${esc(teamB.name)}</div>
      <div style="display:flex; justify-content:center; gap:14px; flex-wrap:wrap; margin-top:10px;">
        <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(242,169,59,0.4); border-radius:12px; padding:10px 18px;">
          <div style="font-size:13px; opacity:0.8;">${esc(teamA.name)}</div>
          <div style="font-size:20px; font-weight:800; color:var(--gold);">+${bonusA} 💰</div>
        </div>
        <div style="background:rgba(255,255,255,0.08); border:1px solid rgba(242,169,59,0.4); border-radius:12px; padding:10px 18px;">
          <div style="font-size:13px; opacity:0.8;">${esc(teamB.name)}</div>
          <div style="font-size:20px; font-weight:800; color:var(--gold);">+${bonusB} 💰</div>
        </div>
      </div>
      <button class="btn btn-gold" id="closeWinner" style="width:100%; margin-top:18px;">إلى النتائج 📊</button>
    </div>`;
  document.body.appendChild(overlay);
  fireConfetti(window.innerWidth / 2, 120, 60);
  document.getElementById("closeWinner").onclick = () => {
    overlay.remove();
    setView("results");
  };
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

/* ================= البطاقات ================= */
function renderCards(container) {
  addHomeBackButton(container);
  container.appendChild(teamPicker("cards"));
  const team = getTeam(activeTeamId) || state.teams[0];
  if (!team) return;

  const infoCard = document.createElement("div");
  infoCard.className = "card";
  infoCard.innerHTML = renderBalanceBox(team) +
    `<p>🛡️ الدرع مفعّل اليوم لهذا الفريق: <b>${team.shieldActiveDay === state.currentDay ? "نعم" : "لا"}</b></p>`;
  container.appendChild(infoCard);

  const categories = [
    { key: "effect", label: "بطاقات المباراة", icon: "⚡" },
    { key: "action", label: "المنح والسحب", icon: "🃏", locked: !state.isFinalDay },
    { key: "discipline", label: "تأديبية", icon: "🟨🟥" },
  ];

  if (!cardsSubView) {
    const grid = document.createElement("div");
    grid.className = "grid";
    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "hub-btn";
      btn.innerHTML = `<span class="icon">${cat.icon}</span> ${cat.label}${cat.locked ? '<span class="tag warn">🔒 نهائي فقط</span>' : ""}`;
      btn.onclick = () => { cardsSubView = cat.key; render(); };
      grid.appendChild(btn);
    });
    container.appendChild(grid);

    if (team.cardLog.length) {
      const logCard = document.createElement("div");
      logCard.className = "card";
      logCard.innerHTML = `<h3>سجل البطاقات لهذا الفريق</h3><ul class="log-list">${team.cardLog
        .slice()
        .reverse()
        .map((l) => `<li>يوم ${l.day} — ${esc(l.text)}</li>`)
        .join("")}</ul>`;
      container.appendChild(logCard);
    }
    return;
  }

  const backBtn = document.createElement("button");
  backBtn.className = "btn btn-outline";
  backBtn.style.marginBottom = "12px";
  backBtn.textContent = "← رجوع لأقسام البطاقات";
  backBtn.onclick = () => { cardsSubView = null; render(); };
  container.appendChild(backBtn);

  if (cardsSubView === "effect") {
    const effectCard = document.createElement("div");
    effectCard.className = "card";
    effectCard.innerHTML = `<h3>⚡ بطاقات المباراة (تُستخدم قبل طرح السؤال)</h3><p style="font-size:13px; color:#666;">الأفضل استخدامها من داخل شاشة المباراة المباشرة نفسها؛ هذه القائمة فقط لتسجيل استخدام أو مراجعة الحالة.</p>`;
    CONFIG.effectCards.forEach((c) => {
      const used = c.dailyLimit && team.cardUsage[c.id] && team.cardUsage[c.id].day === state.currentDay;
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `<div><span style="font-size:20px;">${CARD_ICONS[c.id] || "🃏"}</span> <b>${esc(c.name)}</b><br/><span style="font-size:12px;color:#555;">${esc(c.desc)}</span>
        ${c.dailyLimit ? '<span class="tag">مرة واحدة يومياً</span>' : ""}</div>
        <button class="btn btn-primary" ${used ? "disabled" : ""}>${used ? "مستخدمة اليوم" : "استخدام"}</button>`;
      row.querySelector("button").onclick = () => {
        confirmCardUse(c, team.name, () => {
          if (c.id === "shield") {
            team.shieldActiveDay = state.currentDay;
          }
          if (c.dailyLimit) team.cardUsage[c.id] = { day: state.currentDay, count: 1 };
          team.cardLog.push({ day: state.currentDay, text: "استخدام: " + c.name });
          persist();
          render();
        });
      };
      effectCard.appendChild(row);
    });
    container.appendChild(effectCard);
  }

  if (cardsSubView === "action") {
    const actionCard = document.createElement("div");
    actionCard.className = "card";
    if (!state.isFinalDay) {
      actionCard.innerHTML = `<h3>🃏 بطاقات المنح والسحب</h3><p class="tag warn">🔒 متاحة فقط في يوم "نهائي الدوري". فعّل وضع النهائي من الشريط العلوي عند الوصول لليوم الأخير.</p>`;
    } else {
      actionCard.innerHTML = `<h3>🃏 بطاقات المنح والسحب — وضع النهائي مفعّل 🏁</h3><p>تُطبَّق على الفريق المختار أعلاه (في حال "سحب"، يُسحب من هذا الفريق؛ وفي حال "منح"، يُمنح لهذا الفريق).</p>`;
      CONFIG.actionCards.forEach((c) => {
        const row = document.createElement("div");
        row.className = "item-row";
        row.innerHTML = `<div><b>${esc(c.name)}</b> <span class="tag ${c.mode === "remove" ? "danger" : ""}">${c.mode === "remove" ? "سحب" : "منح"}</span>
          ${c.desc ? `<br/><span style="font-size:12px;color:#555;">${esc(c.desc)}</span>` : ""}</div>
          <button class="btn ${c.mode === "remove" ? "btn-danger" : "btn-gold"}">${c.mode === "remove" ? "سحب من الفريق" : "منح للفريق"}</button>`;
        row.querySelector("button").onclick = () => applyActionCard(team, c);
        actionCard.appendChild(row);
      });
    }
    container.appendChild(actionCard);
  }

  if (cardsSubView === "discipline") {
    const disCard = document.createElement("div");
    disCard.className = "card";
    disCard.innerHTML = `<h3>🟨🟥 البطاقات التأديبية</h3>`;
    const yRow = document.createElement("div");
    yRow.className = "item-row";
    yRow.innerHTML = `<div>🟨 إنذار شفوي — عدد الإنذارات: <b>${team.yellowCards}</b></div>
      <button class="btn btn-outline">تسجيل إنذار</button>`;
    yRow.querySelector("button").onclick = () => {
      team.yellowCards++;
      team.cardLog.push({ day: state.currentDay, text: "🟨 إنذار شفوي" });
      persist();
      render();
    };
    disCard.appendChild(yRow);

    const rRow = document.createElement("div");
    rRow.className = "item-row";
    rRow.innerHTML = `<div>🟥 كرت أحمر — عدد الكروت الحمراء: <b>${team.redCards}</b><br/>
      <span style="font-size:12px;color:#555;">عند التسجيل: تُمنح بقية الفرق ${CONFIG.redCardBonusForOthers} نقطة لكل فريق</span></div>
      <button class="btn btn-danger">تسجيل كرت أحمر</button>`;
    rRow.querySelector("button").onclick = () => {
      if (!confirm(`سيتم منح كل الفرق الأخرى ${CONFIG.redCardBonusForOthers} نقطة. تأكيد؟`)) return;
      team.redCards++;
      state.teams.forEach((t) => {
        if (t.id !== team.id) t.balance += CONFIG.redCardBonusForOthers;
      });
      team.cardLog.push({ day: state.currentDay, text: "🟥 كرت أحمر" });
      persist();
      render();
    };
    disCard.appendChild(rRow);
    container.appendChild(disCard);
  }
}

function applyActionCard(team, c) {
  if (c.target === "balance") {
    team.balance += c.amount;
    team.cardLog.push({ day: state.currentDay, text: c.name });
    persist();
    render();
    return;
  }

  if (c.target === "building") {
    if (c.mode === "add") {
      const pick = prompt("اسم المبنى الممنوح:\n" + CONFIG.buildings.map((b) => b.name).join("، "));
      const found = CONFIG.buildings.find((b) => b.name === pick);
      if (!found) return;
      team.buildings[found.id] = (team.buildings[found.id] || 0) + 1;
      team.cardLog.push({ day: state.currentDay, text: c.name + " (" + found.name + ")" });
    } else {
      if (team.shieldActiveDay === state.currentDay) {
        alert("الفريق محمي بالدرع اليوم، لا يمكن سحب مبنى منه.");
        return;
      }
      const removable = CONFIG.buildings.filter((b) => !b.basic && (team.buildings[b.id] || 0) > 0);
      if (!removable.length) {
        alert("لا يوجد مبنى غير أساسي يمكن سحبه من هذا الفريق.");
        return;
      }
      const pick = prompt("اختر المبنى المسحوب:\n" + removable.map((b) => b.name).join("، "));
      const found = removable.find((b) => b.name === pick);
      if (!found) return;
      team.buildings[found.id] -= 1;
      team.cardLog.push({ day: state.currentDay, text: c.name + " (" + found.name + ")" });
    }
    persist();
    render();
    return;
  }

  if (c.target === "employee") {
    if (c.mode === "add") {
      const pick = prompt("اسم الموظف الممنوح:\n" + CONFIG.employees.map((b) => b.name).join("، "));
      const found = CONFIG.employees.find((b) => b.name === pick);
      if (!found) return;
      team.employees[found.id] = (team.employees[found.id] || 0) + 1;
      team.cardLog.push({ day: state.currentDay, text: c.name + " (" + found.name + ")" });
    } else {
      if (team.shieldActiveDay === state.currentDay) {
        alert("الفريق محمي بالدرع اليوم، لا يمكن إنهاء عقد موظف منه.");
        return;
      }
      const total = sumCounts(team.employees);
      if (total - 1 < CONFIG.minEmployees) {
        alert(`لا يمكن؛ الحد الأدنى للموظفين هو ${CONFIG.minEmployees}.`);
        return;
      }
      const removable = CONFIG.employees.filter((b) => (team.employees[b.id] || 0) > 0);
      const pick = prompt("اختر الموظف المُنهى عقده:\n" + removable.map((b) => b.name).join("، "));
      const found = removable.find((b) => b.name === pick);
      if (!found) return;
      team.employees[found.id] -= 1;
      team.cardLog.push({ day: state.currentDay, text: c.name + " (" + found.name + ")" });
    }
    persist();
    render();
    return;
  }
}

/* ================= النتائج ================= */
function renderResults(container) {
  addHomeBackButton(container);
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h2>📊 لوحة النتائج</h2><button class="btn btn-outline" id="goDayHistory">📅 سجل الأيام</button>`;
  container.appendChild(card);
  card.querySelector("#goDayHistory").onclick = () => setView("day-history");

  const rows = state.teams.map((t) => {
    const s = academyStats(t);
    return {
      team: t,
      ...s,
      grandTotal: s.academyTotal + t.matches.points,
    };
  });
  rows.sort((a, b) => b.academyTotal - a.academyTotal);

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>الفريق</th>
        <th>الرصيد</th>
        <th>لعب</th>
        <th>فاز</th>
        <th>تعادل</th>
        <th>خسر</th>
        <th>نقاط الدوري</th>
        <th>عدد المباني</th>
        <th>عدد الموظفين</th>
        <th>عدد اللاعبين</th>
        <th>نقاط الأكاديمية</th>
        <th>🟨</th>
        <th>🟥</th>
        <th><b>الإجمالي الكامل</b></th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r, idx) => `
        <tr class="${idx === 0 ? "top-team" : ""}">
          <td>${idx === 0 ? "🏆 " : ""}${esc(r.team.name)}</td>
          <td>${r.team.balance}</td>
          <td>${r.team.matches.played}</td>
          <td>${r.team.matches.won}</td>
          <td>${r.team.matches.drawn}</td>
          <td>${r.team.matches.lost}</td>
          <td>${r.team.matches.points}</td>
          <td>${r.buildingCount}</td>
          <td>${r.employeeCount}</td>
          <td>${r.playerCount}</td>
          <td><b>${r.academyTotal}</b></td>
          <td>${r.team.yellowCards}</td>
          <td>${r.team.redCards}</td>
          <td><b>${r.grandTotal}</b></td>
        </tr>`
        )
        .join("")}
    </tbody>
  `;
  card.appendChild(table);

  const note = document.createElement("p");
  note.style.marginTop = "10px";
  note.style.fontSize = "13px";
  note.style.color = "#666";
  note.textContent = "الترتيب أعلاه مبني على إجمالي نقاط الأكاديمية (مبانٍ + موظفون + لاعبون)، وهو مستقل عن نقاط الدوري الناتجة عن المباريات.";
  card.appendChild(note);
}

/* ================= سجل الأيام ================= */
function renderDayHistory(container) {
  addHomeBackButton(container);
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h2>📅 سجل الأيام المنتهية</h2><button class="btn btn-outline" id="goResultsBack">📊 رجوع للنتائج</button>`;
  card.querySelector("#goResultsBack").onclick = () => setView("results");
  if (!state.dayHistory.length) {
    card.innerHTML += "<p>لا يوجد أي يوم منتهٍ بعد. استخدم زر «إنهاء الدوري لهذا اليوم» في الأعلى بعد انتهاء مباريات اليوم.</p>";
    container.appendChild(card);
    return;
  }
  container.appendChild(card);

  state.dayHistory
    .slice()
    .reverse()
    .forEach((entry) => {
      const dayCard = document.createElement("div");
      dayCard.className = "card";
      const matchesHtml = entry.events.matches.length
        ? entry.events.matches.map((m) => `<li>${esc(m.teamAName)} ${m.scoreA} : ${m.scoreB} ${esc(m.teamBName)}</li>`).join("")
        : "<li>لا مباريات</li>";
      dayCard.innerHTML = `
        <h3>اليوم ${entry.day}</h3>
        <p class="tag">${new Date(entry.endedAt).toLocaleString("ar")}</p>
        <b>ترتيب الفرق نهاية ذلك اليوم:</b>
        <table>
          <thead><tr><th>الفريق</th><th>الرصيد</th><th>نقاط الدوري</th></tr></thead>
          <tbody>
            ${entry.teamsSnapshot
              .map((t) => `<tr><td>${esc(t.name)}</td><td>${t.balance}</td><td>${t.matches.points}</td></tr>`)
              .join("")}
          </tbody>
        </table>
        <b>مباريات ذلك اليوم:</b>
        <ul class="log-list">${matchesHtml}</ul>
      `;
      container.appendChild(dayCard);
    });
}

render();

// استعادة تلقائية من النسخة الاحتياطية السحابية فقط إذا كان هذا الجهاز فارغاً تماماً (لا يوجد حفظ محلي أصلاً)
if (!localStorage.getItem(STORAGE_KEY)) {
  tryCloudRestore().then((cloud) => {
    if (cloud && Array.isArray(cloud.teams) && cloud.teams.length) {
      state = migrateState(cloud);
      currentView = state.setupDone ? "hub" : "intro";
      saveState(state);
      render();
    }
  });
}
