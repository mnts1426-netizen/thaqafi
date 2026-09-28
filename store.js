// حفظ/تحميل حالة الدوري في localStorage + نسخة احتياطية في Firestore
const STORAGE_KEY = "lepas_state_v1";

// النصوص الافتراضية القديمة لشرح المسابقة (قبل كل تحديث لاحق للنص) - تُستخدم فقط للتمييز
// بين "لم يُعدَّل الشرح أبداً" و"المدير عدّله بنفسه"، حتى لا يُطمس تعديل المدير عند تحديث النص الافتراضي
const LEGACY_EXPLAIN_DEFAULTS = [
  `كل فريق يبني أكاديميته الثقافية مستخدمًا رصيده، وأول خطوة إجبارية هي حصول الفريق على 🏞️ أرض الأكاديمية من خانة الدعم - بدونها لا يستطيع البناء ولا اللعب.

🏢 المباني: الإدارة العامة، المكتبة الثقافية، قاعة التدريب - كل مبنى يُشترى مرة واحدة فقط.
👨‍💼 الموظفون: مدير الأكاديمية، المدرب الثقافي، الباحث، مسؤول المسابقات، سكرتير.
👥 اللاعبون: 5 لاعبين دفعة واحدة.

تكرار شراء موظف أو دفعة لاعبين يتطلب امتلاك عنصر واحد على الأقل من كل نوع أولاً، وسعر التكرار يتضاعف ×2.

⚽ المباريات: من صفحة كل فريق اضغط «ابدأ المباراة» ويحدد البرنامج الخصم التالي تلقائيًا بنظام الذهاب والإياب (مرة على ملعب الفريق ومرة على ملعب الخصم)، ولا يواجه الفريق نفس الخصم مرتين قبل أن يواجه البقية.

نقاط الدوري: فوز = 3، تعادل = 1، خسارة = 1 إن سجّل الخاسر هدفًا أو 0 إن لم يسجّل. ويُضاف للرصيد مكافأة عن كل هدف، ومكافأة حسب ما يملكه الفريق.

🃏 البطاقات تُستخدم من داخل المباراة (بحد أقصى 3 بطاقات لكل فريق في المباراة، ومرة واحدة لكل نوع بطاقة) مع نافذة تأكيد. بطاقات المنح والسحب متاحة في وضع النهائي فقط.

🏆 النتيجة النهائية = نقاط الدوري + نقاط الأكاديمية.

⌨️ للرجوع خطوة للخلف في أي وقت اضغط Esc أو Backspace.`,
  `المسابقة تُقام على مرحلتين مستقلتين تمامًا: الفتيان والأشبال، ولا توجد أي علاقة بين نتائج أو بيانات مرحلة والأخرى.
كل مرحلة لها فرقها وجدولها ونتائجها الخاصة تمامًا كأنها مسابقة منفصلة بالكامل.

كل فريق يبني أكاديميته الثقافية مستخدمًا رصيده، وأول خطوة إجبارية هي حصول الفريق على 🏞️ أرض الأكاديمية من خانة الدعم - بدونها لا يستطيع البناء ولا اللعب.

🏢 المباني: الإدارة العامة، المكتبة الثقافية، قاعة التدريب - كل مبنى يُشترى مرة واحدة فقط.
👨‍💼 الموظفون: مدير الأكاديمية، المدرب الثقافي، الباحث، مسؤول المسابقات، سكرتير.
👥 اللاعبون: 5 لاعبين دفعة واحدة.

تكرار شراء موظف أو دفعة لاعبين يتطلب امتلاك عنصر واحد على الأقل من كل نوع أولاً، وسعر التكرار يتضاعف ×2.

⚽ المباريات: من صفحة كل فريق اضغط «ابدأ المباراة» ويحدد البرنامج الخصم التالي تلقائيًا بنظام الذهاب والإياب (مرة على ملعب الفريق ومرة على ملعب الخصم)، ولا يواجه الفريق نفس الخصم مرتين قبل أن يواجه البقية.

نقاط الدوري: فوز = 3، تعادل = 1، خسارة = 1 إن سجّل الخاسر هدفًا أو 0 إن لم يسجّل. ويُضاف للرصيد مكافأة عن كل هدف، ومكافأة حسب ما يملكه الفريق.

🃏 البطاقات تُستخدم من داخل المباراة (بحد أقصى 3 بطاقات لكل فريق في المباراة، ومرة واحدة لكل نوع بطاقة) مع نافذة تأكيد. بطاقات المنح والسحب متاحة في وضع النهائي فقط.

🏆 النتيجة النهائية = نقاط الدوري + نقاط الأكاديمية.

⌨️ للرجوع خطوة للخلف في أي وقت اضغط Esc أو Backspace.`,
  `المسابقة تُقام على مرحلتين مستقلتين تمامًا: الفتيان والأشبال، ولا توجد أي علاقة بين نتائج أو بيانات مرحلة والأخرى.
كل مرحلة لها فرقها وجدولها ونتائجها الخاصة تمامًا كأنها مسابقة منفصلة بالكامل.

كل فريق يبني أكاديميته الثقافية مستخدمًا رصيده، وأول خطوة إجبارية هي حصول الفريق على 🏞️ أرض الأكاديمية - إما مجاناً من خانة الدعم، أو بشرائها ذاتيًا من متجر الأكاديمية بـ 20 نقطة - بدونها لا يستطيع البناء ولا اللعب.

🏢 المباني: الإدارة العامة، المكتبة الثقافية، قاعة التدريب - كل مبنى يُشترى مرة واحدة فقط. ولا يستفيد الفريق من مكافأة مبنى إلا إذا وظّف الموظف المرتبط به: الإدارة العامة تحتاج مدير الأكاديمية، المكتبة الثقافية تحتاج الباحث، وقاعة التدريب تحتاج المدرب الثقافي.
👨‍💼 الموظفون: مدير الأكاديمية، المدرب الثقافي، الباحث، مسؤول المسابقات، سكرتير.
👥 اللاعبون: 5 لاعبين دفعة واحدة.

تكرار شراء موظف أو دفعة لاعبين يتطلب امتلاك عنصر واحد على الأقل من كل نوع أولاً، وسعر التكرار يتضاعف ×2.

⚽ المباريات: من صفحة كل فريق اضغط «ابدأ المباراة» ويحدد البرنامج الخصم التالي تلقائيًا بنظام الذهاب والإياب (مرة على ملعب الفريق ومرة على ملعب الخصم)، ولا يواجه الفريق نفس الخصم مرتين قبل أن يواجه البقية.

نقاط الدوري: فوز = 3، تعادل = 1، خسارة = 1 إن سجّل الخاسر هدفًا أو 0 إن لم يسجّل - وهذه النقاط لا تُجمع أبداً مع الرصيد. الرصيد نفسه يزيد بعد كل مباراة بثلاث مكافآت منفصلة: مكافأة عن كل هدف، ومكافأة حسب ما يملكه الفريق، ومكافأة ثابتة حسب النتيجة (فوز = 5، تعادل = 3 لكل فريق، خسارة = 1).

🃏 البطاقات تُستخدم من داخل المباراة (بحد أقصى 3 بطاقات لكل فريق في المباراة، ومرة واحدة لكل نوع بطاقة) مع نافذة تأكيد. بطاقات المنح والسحب متاحة في وضع النهائي فقط.

🏆 النتيجة النهائية = نقاط الدوري + نقاط الأكاديمية.

⌨️ للرجوع خطوة للخلف في أي وقت اضغط Esc أو Backspace.`,
];

function emptyTeamCounts(list) {
  const obj = {};
  list.forEach((item) => (obj[item.id] = 0));
  return obj;
}

function newTeam(id, name, order) {
  return {
    id,
    name,
    order,
    balance: CONFIG.startingBalance,
    hasLand: false, // أرض الأكاديمية - شرط إجباري قبل أي بناء أو مباراة
    buildings: emptyTeamCounts(CONFIG.buildings),
    employees: emptyTeamCounts(CONFIG.employees),
    players: emptyTeamCounts(CONFIG.players),
    matches: { played: 0, won: 0, drawn: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0 },
    lastOpponentId: null,
    cardUsage: {}, // {cardId: matchId} - البطاقة مستخدمة في هذه المباراة
    cardLog: [],
    supportLog: [],
    yellowCards: 0,
    redCards: 0,
  };
}

// كل مرحلة (الفتيان/الأشبال) دوري مستقل تمامًا بهذا الشكل
function emptyStage() {
  return {
    setupDone: false,
    teams: [],
    matchLog: [],
    schedule: [], // [{leg, round, teamAId (المستضيف), teamBId (الضيف), played, scoreA, scoreB}]
    isFinalMode: false,
  };
}

function defaultState() {
  const stages = {};
  CONFIG.stages.forEach((s) => (stages[s.id] = emptyStage()));
  return { stages, explainText: CONFIG.explainDefault };
}

// يُبقي عدادات الفريق مطابقة تماماً لعناصر الإعدادات الحالية (يحذف أي عنصر أُلغي ويضيف الجديد بصفر)
function normalizeCounts(counts, list) {
  const out = {};
  list.forEach((item) => (out[item.id] = (counts && counts[item.id]) || 0));
  return out;
}

// يضمن وجود كل الحقول على حالة قديمة محفوظة، حتى لا تتعطل الصفحة إذا كانت البيانات أقدم من آخر تحديث
function migrateTeam(t, landFromOldBonus) {
  const ownedBuildingBefore = t.buildings && Object.values(t.buildings).some((v) => v > 0);
  t.buildings = normalizeCounts(t.buildings, CONFIG.buildings);
  t.employees = normalizeCounts(t.employees, CONFIG.employees);
  t.players = normalizeCounts(t.players, CONFIG.players);
  if (typeof t.hasLand !== "boolean") t.hasLand = !!(landFromOldBonus || ownedBuildingBefore);
  // حدود البطاقات القديمة كانت يومية؛ أصبحت لكل مباراة
  const usageValues = Object.values(t.cardUsage || {});
  if (usageValues.some((v) => typeof v !== "string")) t.cardUsage = {};
  t.cardUsage = t.cardUsage || {};
  t.cardLog = t.cardLog || [];
  t.supportLog = t.supportLog || [];
  t.yellowCards = t.yellowCards || 0;
  t.redCards = t.redCards || 0;
  t.lastOpponentId = t.lastOpponentId || null;
  t.matches = t.matches || { played: 0, won: 0, drawn: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0 };
  delete t.shieldActiveDay;
  return t;
}

// يضمن وجود كل الحقول على مرحلة قديمة محفوظة، حتى لا تتعطل الصفحة إذا كانت البيانات أقدم من آخر تحديث
function migrateStage(s, landFromOldBonus) {
  s = s || emptyStage();
  const defaults = emptyStage();
  Object.keys(defaults).forEach((key) => {
    if (s[key] === undefined) s[key] = defaults[key];
  });
  s.teams.forEach((t) => migrateTeam(t, landFromOldBonus));

  // جداول قديمة بلا "دور": كل دورة كاملة تصبح دورًا واحدًا
  if (s.schedule.some((f) => f.leg === undefined)) {
    const n = s.teams.length;
    const roundsPerLeg = n % 2 === 0 ? n - 1 : n;
    s.schedule.forEach((f) => {
      if (f.leg === undefined) f.leg = Math.floor((f.round - 1) / Math.max(1, roundsPerLeg)) + 1;
    });
  }
  return s;
}

// يدعم حالة قديمة من قبل إضافة المرحلتين (الفتيان/الأشبال) وحالة جديدة على حد سواء، بلا فقدان أي بيانات
function migrateState(state) {
  if (!state.stages) {
    const landFromOldBonus = !!state.academyLandGranted;
    if (state.isFinalMode === undefined && state.isFinalDay !== undefined) state.isFinalMode = !!state.isFinalDay;
    const old = migrateStage(
      {
        setupDone: state.setupDone,
        teams: state.teams,
        matchLog: state.matchLog,
        schedule: state.schedule,
        isFinalMode: state.isFinalMode,
      },
      landFromOldBonus
    );
    // البيانات القديمة (من قبل المرحلتين) تصبح مرحلة "الفتيان" تلقائياً، والأشبال تبدأ فارغة
    const stages = {};
    CONFIG.stages.forEach((s) => (stages[s.id] = emptyStage()));
    stages[CONFIG.stages[0].id] = old;
    return { stages, explainText: normalizeExplainText(state.explainText) };
  }
  CONFIG.stages.forEach((s) => {
    state.stages[s.id] = migrateStage(state.stages[s.id], false);
  });
  state.explainText = normalizeExplainText(state.explainText);
  return state;
}

// يُبقي تعديل المدير الخاص كما هو دائماً، ولا يستبدل إلا نصاً فارغاً أو النص الافتراضي القديم تماماً (قبل تحديثه)
function normalizeExplainText(text) {
  if (typeof text !== "string" || !text.trim()) return CONFIG.explainDefault;
  if (LEGACY_EXPLAIN_DEFAULTS.includes(text)) return CONFIG.explainDefault;
  return text;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    return migrateState(parsed);
  } catch (e) {
    console.error("فشل تحميل الحالة، بدء حالة جديدة", e);
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  pushToCloud(state);
}

// يرفع نسخة مطابقة للحالة الحالية إلى Firestore كنسخة احتياطية - لا يوقف عمل البرنامج إن فشل (لا إنترنت مثلاً)
function pushToCloud(state) {
  if (!firebaseDb) return;
  firebaseDb
    .collection("lepas_state")
    .doc("current")
    .set(JSON.parse(JSON.stringify(state)))
    .catch((e) => console.error("تعذّر رفع النسخة الاحتياطية إلى Firebase", e));
}

// يُستدعى مرة واحدة عند بدء التطبيق فقط إن كان الجهاز فارغاً تماماً (لا يوجد حفظ محلي بعد) -
// يستعيد آخر نسخة محفوظة سحابياً حتى لا تُفقد البيانات لو انكسر الجهاز أو مُسحت بياناته.
function tryCloudRestore() {
  if (!firebaseDb) return Promise.resolve(null);
  return firebaseDb
    .collection("lepas_state")
    .doc("current")
    .get()
    .then((doc) => (doc.exists ? doc.data() : null))
    .catch((e) => {
      console.error("تعذّرت استعادة النسخة الاحتياطية من Firebase", e);
      return null;
    });
}

/* ================= جدول الذهاب والإياب ================= */

// أزواج دوري فردي (كل فريق ضد كل فريق مرة) بطريقة الدائرة الدورانية، مرتبة حسب الجولات
function roundRobinPairs(teams) {
  const BYE = "__bye__";
  const arr = teams.map((t) => t.id);
  if (arr.length % 2 !== 0) arr.push(BYE);

  const n = arr.length;
  const half = n / 2;
  const pairs = [];
  let current = arr.slice();

  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < half; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a !== BYE && b !== BYE) pairs.push({ round: r + 1, a, b });
    }
    const fixed = current[0];
    const rest = current.slice(1);
    rest.unshift(rest.pop());
    current = [fixed, ...rest];
  }
  return pairs;
}

// المستضيف في مباراة الذهاب: توزيع متوازن بحيث يستضيف كل فريق عدداً متقارباً من المباريات
// (مع 3 فرق: الأول يستضيف الثاني، والثاني يستضيف الثالث، والثالث يستضيف الأول)
function homeOf(teamIds, aId, bId) {
  const n = teamIds.length;
  const ia = teamIds.indexOf(aId);
  const ib = teamIds.indexOf(bId);
  const d = (ib - ia + n) % n;
  if (n % 2 === 1) return d <= (n - 1) / 2 ? aId : bId;
  if (d < n / 2) return aId;
  if (d > n / 2) return bId;
  return ia < ib ? aId : bId;
}

// دورة كاملة = دور ذهاب + دور إياب (كل فريق يلعب ضد كل فريق مرة على ملعبه ومرة على ملعب الخصم)
function generateCycle(teams, startLeg, startRound) {
  const ids = teams.map((t) => t.id);
  const pairs = roundRobinPairs(teams);
  const roundsPerLeg = pairs.reduce((m, p) => Math.max(m, p.round), 0);
  const fixtures = [];
  [0, 1].forEach((legOffset) => {
    pairs.forEach((p) => {
      const firstHome = homeOf(ids, p.a, p.b);
      const home = legOffset === 0 ? firstHome : firstHome === p.a ? p.b : p.a;
      const away = home === p.a ? p.b : p.a;
      fixtures.push({
        leg: startLeg + legOffset,
        round: startRound + legOffset * roundsPerLeg + p.round,
        teamAId: home,
        teamBId: away,
        played: false,
        scoreA: 0,
        scoreB: 0,
      });
    });
  });
  return fixtures;
}

// إذا انتهت كل مباريات الجدول يُضاف تلقائياً ذهاب وإياب جديدان - لا ينفد الجدول أبداً ولا تُمس أي مباراة سابقة
function ensureSchedule(state) {
  if (!state.teams.length) return false;
  if (!state.schedule.length) {
    state.schedule = generateCycle(state.teams, 1, 0);
    return true;
  }
  if (state.schedule.every((f) => f.played)) {
    const maxLeg = Math.max(...state.schedule.map((f) => f.leg));
    const maxRound = Math.max(...state.schedule.map((f) => f.round));
    state.schedule.push(...generateCycle(state.teams, maxLeg + 1, maxRound));
    return true;
  }
  return false;
}

function currentLeg(state) {
  const unplayed = state.schedule.filter((f) => !f.played);
  return unplayed.length ? Math.min(...unplayed.map((f) => f.leg)) : null;
}

// المباراة القادمة لفريق معيّن داخل الدور الحالي فقط:
// لا يواجه الفريق نفس الخصم مرتين قبل أن يواجه البقية، ويُفضَّل أن يلعب على ملعبه إن أمكن.
function nextFixtureForTeam(state, teamId) {
  const leg = currentLeg(state);
  if (leg === null) return null;
  const candidates = state.schedule.filter(
    (f) => !f.played && f.leg === leg && (f.teamAId === teamId || f.teamBId === teamId)
  );
  if (!candidates.length) return null;
  const team = state.teams.find((t) => t.id === teamId);
  const opponentOf = (f) => (f.teamAId === teamId ? f.teamBId : f.teamAId);
  const fresh = candidates.filter((f) => opponentOf(f) !== team.lastOpponentId);
  const pool = fresh.length ? fresh : candidates;
  return pool.find((f) => f.teamAId === teamId) || pool[0];
}
