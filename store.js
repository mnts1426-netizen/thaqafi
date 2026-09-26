// حفظ/تحميل حالة الدوري في localStorage
const STORAGE_KEY = "lepas_state_v1";

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
    buildings: emptyTeamCounts(CONFIG.buildings),
    employees: emptyTeamCounts(CONFIG.employees),
    players: emptyTeamCounts(CONFIG.players),
    matches: { played: 0, won: 0, drawn: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0 },
    cardUsage: {}, // {cardId: {day, count}}
    cardLog: [],
    supportLog: [],
    yellowCards: 0,
    redCards: 0,
  };
}

function defaultState() {
  return {
    setupDone: false,
    currentDay: 1,
    teams: [],
    turnIndex: 0,
    matchLog: [],
    schedule: [], // [{round, teamAId, teamBId, played, scoreA, scoreB}]
    dayHistory: [], // [{day, endedAt, teamsSnapshot, events}]
    isFinalDay: false,
  };
}

// يضمن وجود كل الحقول (حتى المضافة لاحقاً في تحديثات جديدة) على حالة قديمة محفوظة،
// حتى لا تتعطل الصفحة إذا كانت البيانات المحفوظة أقدم من آخر تحديث للبرنامج.
function migrateTeam(t) {
  t.players = t.players || emptyTeamCounts(CONFIG.players);
  t.cardUsage = t.cardUsage || {};
  t.cardLog = t.cardLog || [];
  t.supportLog = t.supportLog || [];
  t.yellowCards = t.yellowCards || 0;
  t.redCards = t.redCards || 0;
  t.matches = t.matches || { played: 0, won: 0, drawn: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0 };
  return t;
}

function migrateState(state) {
  const defaults = defaultState();
  Object.keys(defaults).forEach((key) => {
    if (state[key] === undefined) state[key] = defaults[key];
  });
  state.teams.forEach(migrateTeam);
  return state;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.teams)) return defaultState();
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
    .set(state)
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

function resetAllData() {
  localStorage.removeItem(STORAGE_KEY);
}

// يولّد جدول دوري كامل (كل فريق يلعب ضد كل فريق مرة واحدة) بطريقة الدائرة الدورانية
function generateRoundRobin(teams) {
  const BYE = { id: "__bye__" };
  let arr = teams.map((t) => ({ id: t.id }));
  if (arr.length % 2 !== 0) arr.push(BYE);

  const n = arr.length;
  const half = n / 2;
  const rounds = [];
  let current = arr.slice();

  for (let r = 0; r < n - 1; r++) {
    const roundMatches = [];
    for (let i = 0; i < half; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a.id !== BYE.id && b.id !== BYE.id) {
        roundMatches.push({ round: r + 1, teamAId: a.id, teamBId: b.id, played: false, scoreA: 0, scoreB: 0 });
      }
    }
    rounds.push(roundMatches);
    const fixed = current[0];
    const rest = current.slice(1);
    rest.unshift(rest.pop());
    current = [fixed, ...rest];
  }

  const fixtures = [];
  rounds.forEach((round) => round.forEach((m) => fixtures.push(m)));
  return fixtures;
}
