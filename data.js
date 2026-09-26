// إعدادات الدوري الثقافي - عدّل القيم هنا فقط دون الحاجة لتعديل باقي الكود
const CONFIG = {
  startingBalance: 5, // نقاط بداية الدوري لكل فريق
  questionsPerMatch: 5,
  matchPoints: { win: 3, drawEach: 1, lossIfScored: 1, lossIfZero: 0 },
  redCardBonusForOthers: 2,

  buildings: [
    { id: "admin_office", name: "الإدارة العامة", cost: 20, basic: true },
    { id: "library", name: "المكتبة الثقافية", cost: 15 },
    { id: "training_hall", name: "قاعة التدريب", cost: 15 },
    { id: "intel_center", name: "مركز الذكاء", cost: 15 },
    { id: "debate_hall", name: "قاعة المناظرات", cost: 15 },
    { id: "heroes_hall", name: "قاعة الأبطال", cost: 15 },
    { id: "research_center", name: "مركز البحث", cost: 15 },
  ],

  employees: [
    { id: "director", name: "مدير الأكاديمية", cost: 10 },
    { id: "coach", name: "المدرب الثقافي", cost: 5 },
    { id: "researcher", name: "الباحث", cost: 5 },
    { id: "announcer", name: "المذيع", cost: 5 },
    { id: "advisor", name: "المستشار", cost: 5 },
    { id: "contest_officer", name: "مسؤول المسابقات", cost: 5 },
    { id: "secretary", name: "سكرتير", cost: 5 },
    { id: "hr_manager", name: "مدير الموارد البشرية", cost: 5 },
  ],

  players: [{ id: "players_batch", name: "لاعبون (دفعة)", cost: 5, batchSize: 5 }],

  minEmployees: 1,
  priceDoublingPerUnit: true, // كل وحدة إضافية من نفس العنصر لنفس الفريق = ضعف سعر الوحدة السابقة

  // مكافأة رصيد ثابتة (وليست مضروبة بالأهداف) حسب فئة كل عنصر مملوك في الأكاديمية،
  // تُجمع لكل عنصر مملوك على حدة (كل وحدة تُحسب لها).
  ownershipBonusTiers: {
    20: { win: 5, draw: 4, loss: 3 },
    15: { win: 4, draw: 3, loss: 2 },
    10: { win: 2, draw: 1, loss: 1 },
    5: { win: 1, draw: 1, loss: 1 },
  },

  // مكافأة رصيد عامة لكل هدف يسجله الفريق نفسه في المباراة (تُصرف دائماً بلا شرط ملكية)
  goalBonus: { win: 3, draw: 2, loss: 1 },

  // بطاقات تُستخدم أثناء المباراة قبل طرح السؤال (تُسحب حضورياً ويسجّلها المدير)
  effectCards: [
    { id: "shield", name: "الدرع", desc: "تمنع استخدام أي بطاقة ضد هذا الفريق خلال المباراة", dailyLimit: true },
    { id: "joker", name: "الجوكر", desc: "تستخدم لاستخدام بطاقة الخصم ضده (عدا الدرع)", dailyLimit: true },
    { id: "penalty_kick", name: "ركلة ترجيح", desc: "نهاية المباراة عند تعادل النتيجة، سؤال واحد للمجموعة", dailyLimit: true },
    { id: "star_contestant", name: "المتسابق النجم", desc: "قبل السؤال: متسابق مختار يحصل على هدفين إن أجاب صحيحاً", dailyLimit: true },
    { id: "double_goal", name: "الهدف بهدفين", desc: "قبل السؤال: الإجابة الصحيحة تُحسب هدفين", dailyLimit: true },
    { id: "stop_rival", name: "توقف للخصم", desc: "قبل السؤال: يحصل الفريق على السؤال ويجيب لوحده", dailyLimit: true },
  ],

  // بطاقات تمنح/تسحب عناصر من الأكاديمية أو الرصيد - متاحة فقط في يوم نهائي الدوري
  actionCards: [
    { id: "revoke_deed", name: "سحب صك مبنى", target: "building", mode: "remove", desc: "لا يجوز سحب المبنى الأساسي", finalOnly: true },
    { id: "terminate_employee", name: "إنهاء عقد موظف", target: "employee", mode: "remove", amount: 1, desc: "لا يجوز النزول لأقل من موظف واحد", finalOnly: true },
    { id: "new_deed", name: "صك مبنى جديد", target: "building", mode: "add", desc: "منح مبنى جديد مجاناً", finalOnly: true },
    { id: "plus5_points", name: "إضافة 5 نقاط", target: "balance", mode: "add", amount: 5, finalOnly: true },
    { id: "plus10_points_final", name: "إضافة 10 نقاط (نهائي الدوري)", target: "balance", mode: "add", amount: 10, finalOnly: true },
  ],

  disciplineCards: [
    { id: "yellow", name: "إنذار شفوي (كرت أصفر)" },
    { id: "red", name: "كرت أحمر" },
  ],
};
