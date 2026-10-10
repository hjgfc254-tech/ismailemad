/* ============================================================
   js/backend/admin-core.js — الإدارة: الإحصاءات، الأكواد، الطلاب
   ============================================================ */

import {
  fs, db, col, route, ok, fail, bad, safeText, clamp, isValidStage, tsToMs, toPlain,
  generateCodeString, generatePassword, createStudentAccount,
  requireAdmin, getDocData, queryDocs, listAll, ref
} from "./core.js";

/* ---------------- GET /api/admin/statistics ---------------- */
route("GET", "/api/admin/statistics", async () => {
  requireAdmin();

  const [students, codes, exams, attempts, requests, announcements, sessions, aiUsage, general] =
    await Promise.all([
      listAll("students"),
      listAll("codes"),
      listAll("exams"),
      listAll("examAttempts"),
      listAll("subscriptionRequests"),
      listAll("announcements"),
      listAll("studySessions"),
      listAll("aiUsage"),
      getDocData("settings", "general")
    ]);

  const stageDistribution = {
    grade_4: 0, grade_5: 0, grade_6: 0,
    prep_1: 0, prep_2: 0, prep_3: 0,
    sec_1: 0, sec_2: 0, sec_3: 0
  };
  students.forEach((s) => {
    const k = safeText(s.stage);
    if (k in stageDistribution) stageDistribution[k] += 1;
  });

  const examsCount = exams.filter((e) => e.status === "published").length;

  const passingPercent = clamp(
    parseInt((general && general.passingPercent) || "50", 10), 1, 100
  );
  let sumPercent = 0;
  let passCount = 0;
  let failCount = 0;
  attempts.forEach((a) => {
    const p = Number(a.percent) || 0;
    sumPercent += p;
    if (p >= passingPercent) passCount += 1;
    else failCount += 1;
  });
  const averageScore = attempts.length > 0 ? Math.round(sumPercent / attempts.length) : 0;

  let studyMinutes = 0;
  sessions.forEach((s) => { studyMinutes += Number(s.durationMinutes) || 0; });
  const studyHoursTotal = Math.round((studyMinutes / 60) * 10) / 10;

  const pendingRequests = requests.filter((r) => r.status === "pending").length;

  const aiMessagesCount = aiUsage.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const aiActiveStudents = new Set(
    aiUsage.map((row) => safeText(row.studentId)).filter(Boolean)
  ).size;

  const best = {};
  attempts.forEach((a) => {
    const sid = safeText(a.studentId);
    const score = Number(a.score) || 0;
    if (!sid) return;
    if (!best[sid] || score > best[sid].score) {
      best[sid] = { score, percent: Number(a.percent) || 0 };
    }
  });
  const studentsById = {};
  students.forEach((s) => { studentsById[s.id] = s; });
  const topStudents = Object.keys(best)
    .map((id) => ({ id, ...best[id] }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5)
    .filter((t) => studentsById[t.id])
    .map((t) => ({
      id: t.id,
      name: safeText(studentsById[t.id].fullName),
      score: t.score,
      percent: t.percent
    }));

  return ok({
    stats: {
      studentsCount: students.length,
      codesCount: codes.length,
      examsCount,
      attemptsCount: attempts.length,
      studyHoursTotal,
      aiMessagesCount,
      requestsCount: requests.length,
      pendingRequests,
      announcementsCount: announcements.length
    },
    stageDistribution,
    performance: { averageScore, passCount, failCount, passingPercent },
    topStudents,
    usage: {
      aiMessagesCount,
      aiActiveStudents,
      studySessionsCount: sessions.length,
      averageSessionMinutes: sessions.length > 0 ? Math.round(studyMinutes / sessions.length) : 0
    }
  });
});

/* ---------------- الأكواد ---------------- */

route("GET", "/api/admin/codes", async () => {
  requireAdmin();
  const [rows, students] = await Promise.all([listAll("codes"), listAll("students")]);
  const names = {};
  students.forEach((s) => { names[s.id] = safeText(s.fullName); });

  const codes = rows.map((d) => ({
    id: d.id,
    code: safeText(d.code),
    password: d.password === undefined || d.password === null ? null : String(d.password),
    status: safeText(d.status) || (d.studentId ? "active" : "unused"),
    stage: d.stage || null,
    studentId: d.studentId || null,
    studentName: d.studentId ? (names[d.studentId] || null) : null,
    createdAt: d.createdAt || null,
    expiresAt: d.expiresAt || null,
    note: d.note || null
  }));
  codes.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ codes }));
});

route("POST", "/api/admin/codes/create", async ({ body }) => {
  requireAdmin();
  const count = clamp(Number(body.count), 1, 500);
  const stage = safeText(body.stage);
  const note = safeText(body.note) || null;
  if (!isValidStage(stage)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");

  // الأكواد الموجودة (رقم مستند الكود = الكود نفسه)
  const existing = new Set((await listAll("codes")).map((c) => safeText(c.code) || c.id));

  const created = [];
  let stopReason = null;
  let guard = 0;

  while (created.length < count && !stopReason) {
    if (guard++ > count * 20 + 200) { stopReason = "exhausted"; break; }

    const code = generateCodeString();
    if (existing.has(code)) continue;
    existing.add(code);

    const password = generatePassword();

    // حساب الدخول (بريد وهمي من الكود) في Firebase Authentication
    const acc = await createStudentAccount(code, password);
    if (!acc.ok) {
      if (acc.reason === "exists") continue;   // الكود محجوز من قبل، نجرّب غيره
      stopReason = acc.reason;
      break;
    }

    await fs.setDoc(ref("codes", code), {
      code,
      password,
      status: "unused",
      studentId: null,
      stage,
      note,
      createdAt: fs.serverTimestamp(),
      expiresAt: null
    });
    created.push({ id: code, code, password, stage, status: "unused" });
  }

  if (!created.length && stopReason) {
    return fail("SERVER_ERROR", provisionMessage(stopReason, 0));
  }

  const out = { codes: created };
  if (created.length < count) {
    out.partial = true;
    out.message = provisionMessage(stopReason || "exhausted", created.length);
  }
  return ok(out);
});

export function provisionMessage(reason, done) {
  const tail = done ? ` تم إنشاء ${done} كود فقط.` : "";
  switch (reason) {
    case "throttled":
      return "أوقف Firebase الإنشاء مؤقتًا لكثرة الطلبات. انتظر قليلًا ثم أكمل." + tail;
    case "disabled":
      return "فعّل تسجيل الدخول بالبريد وكلمة المرور من Firebase ← Authentication ← Sign-in method." + tail;
    case "network":
      return "انقطع الاتصال أثناء الإنشاء." + tail;
    case "exhausted":
      return "لا توجد أكواد متاحة كافية." + tail;
    default:
      return "تعذر إنشاء حساب الدخول." + tail;
  }
}


route("PATCH", "/api/admin/codes/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "معرّف الكود مطلوب.");

  const newStatus = safeText(body.status);
  if (!["unused", "active", "disabled"].includes(newStatus)) {
    bad("BAD_REQUEST", "حالة الكود غير صحيحة.");
  }

  const existing = await getDocData("codes", id);
  if (!existing) bad("NOT_FOUND", "الكود غير موجود.");
  if (newStatus === "unused" && safeText(existing.studentId)) {
    bad("BAD_REQUEST", "لا يمكن تحويل كود مرتبط بطالب إلى حالة (متاح).");
  }

  await fs.updateDoc(ref("codes", id), {
    status: newStatus,
    updatedAt: fs.serverTimestamp()
  });
  return ok({ updated: true, status: newStatus });
});

/* ---------------- الطلاب ---------------- */

route("GET", "/api/admin/students", async () => {
  requireAdmin();
  const rows = await listAll("students");
  const students = rows.map((d) => ({
    id: d.id,
    fullName: safeText(d.fullName),
    stage: safeText(d.stage),
    code: safeText(d.code),
    joinedAt: d.joinedAt || null,
    lastLogin: d.lastLogin || null,
    status: safeText(d.status) || "active",
    studyHoursTotal: Number(d.studyHoursTotal) || 0
  }));
  students.sort((a, b) => tsToMs(b.joinedAt) - tsToMs(a.joinedAt));
  return ok(toPlain({ students }));
});

route("GET", "/api/admin/students/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "معرّف الطالب مطلوب.");

  const s = await getDocData("students", id);
  if (!s) bad("NOT_FOUND", "الطالب غير موجود.");

  const [attempts, progress] = await Promise.all([
    queryDocs("examAttempts", fs.where("studentId", "==", id)),
    queryDocs("lessonProgress", fs.where("studentId", "==", id))
  ]);
  let totalScore = 0;
  let totalQ = 0;
  let correctTotal = 0;
  attempts.forEach((a) => {
    totalScore += Number(a.score) || 0;
    totalQ += Number(a.total) || 0;
    correctTotal += Number(a.correctCount) || 0;
  });
  const averageScore = totalQ > 0 ? Math.round((totalScore / totalQ) * 100) : 0;

  return ok(toPlain({
    student: {
      id,
      fullName: safeText(s.fullName),
      stage: safeText(s.stage),
      code: safeText(s.code),
      joinedAt: s.joinedAt || null,
      lastLogin: s.lastLogin || null,
      status: safeText(s.status) || "active"
    },
    stats: {
      attemptsCount: attempts.length,
      correctAnswers: correctTotal,
      studyHoursTotal: Math.round((Number(s.studyHoursTotal) || 0) * 10) / 10,
      completedLessons: progress.filter((p) => p.completed === true).length,
      averageScore
    }
  }));
});
