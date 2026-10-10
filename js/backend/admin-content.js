/* ============================================================
   js/backend/admin-content.js — الإدارة: الدروس، الاختبارات، النتائج،
   الإعدادات، مجموعات الدروس
   ============================================================ */

import {
  fs, db, col, route, ok, bad, safeText, clamp, isValidStage, isYouTubeUrl,
  tsToMs, toPlain,
  requireAdmin, getDocData, queryDocs, listAll, ref
} from "./core.js";

/** حذف مجموعة مستندات على دفعات (حد Firestore: 500 عملية) */
async function deleteMany(name, ids) {
  for (let i = 0; i < ids.length; i += 400) {
    const batch = fs.writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.delete(ref(name, id)));
    await batch.commit();
  }
}

/* ---------------- التحقق من بيانات الاختبار ---------------- */

function validateExamPayload(body, opts = {}) {
  const { requireStatus = false } = opts;

  const title = safeText(body.title);
  const stage = safeText(body.stage);
  const policy = safeText(body.resultPolicy) || "immediate";
  const resultTime = body.resultTime || null;
  const resultDurationMinutes = clamp(Number(body.resultDurationMinutes) || 0, 0, 10080);
  const questions = Array.isArray(body.questions) ? body.questions : [];

  if (!title || title.length > 150) return { ok: false, error: "العنوان غير صالح." };
  if (!isValidStage(stage)) return { ok: false, error: "المرحلة غير صحيحة." };
  if (!["immediate", "after_duration", "after_datetime"].includes(policy)) {
    return { ok: false, error: "سياسة النتيجة غير صحيحة." };
  }
  if (policy === "after_datetime" && !resultTime) {
    return { ok: false, error: "حدد وقت ظهور النتيجة." };
  }
  if (policy === "after_duration" && resultDurationMinutes <= 0) {
    return { ok: false, error: "حدد مدة ظهور النتيجة." };
  }
  if (questions.length < 1) {
    return { ok: false, error: "يجب إضافة سؤال واحد على الأقل." };
  }

  const safeQuestions = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const text = safeText(q.text);
    const choices = Array.isArray(q.choices) ? q.choices.map((c) => safeText(c)) : [];
    const correctIndex = Number(q.correctIndex);

    if (!text) return { ok: false, error: `السؤال ${i + 1}: نص السؤال ناقص.` };
    if (choices.length < 3 || choices.length > 4) {
      return { ok: false, error: `السؤال ${i + 1}: يجب 3 أو 4 اختيارات.` };
    }
    if (choices.some((c) => !c)) {
      return { ok: false, error: `السؤال ${i + 1}: يوجد اختيار فارغ.` };
    }
    if (isNaN(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
      return { ok: false, error: `السؤال ${i + 1}: الإجابة الصحيحة غير محددة.` };
    }

    safeQuestions.push({ text, choices, correctIndex });
  }

  return {
    ok: true,
    title,
    stage,
    resultPolicy: policy,
    resultTime: policy === "after_datetime" ? resultTime : null,
    resultDurationMinutes: policy === "after_duration" ? resultDurationMinutes : 0,
    questions: safeQuestions
  };
}

/* ---------------- الدروس ---------------- */

route("GET", "/api/admin/lessons", async () => {
  requireAdmin();
  const rows = await listAll("lessons");
  const lessons = rows.map((d) => ({
    id: d.id,
    title: safeText(d.title),
    kind: safeText(d.kind) || "video",
    youtubeUrl: safeText(d.youtubeUrl),
    stage: safeText(d.stage),
    createdAt: d.createdAt || null
  }));
  lessons.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ lessons }));
});

route("POST", "/api/admin/lessons", async ({ body }) => {
  requireAdmin();
  const title = safeText(body.title);
  const kind = safeText(body.kind);
  const youtubeUrl = safeText(body.youtubeUrl);
  const stage = safeText(body.stage);

  if (!title || title.length > 150) bad("BAD_REQUEST", "العنوان غير صالح.");
  if (!["video", "audio"].includes(kind)) bad("BAD_REQUEST", "نوع الدرس غير صحيح.");
  if (!isYouTubeUrl(youtubeUrl)) bad("BAD_REQUEST", "رابط YouTube غير صالح.");
  if (!isValidStage(stage)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");

  const created = await fs.addDoc(col("lessons"), {
    title, kind, youtubeUrl, stage, createdAt: fs.serverTimestamp()
  });

  return ok({
    lesson: { id: created.id, title, kind, youtubeUrl, stage, createdAt: new Date().toISOString() }
  });
});

route("PATCH", "/api/admin/lessons/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");
  if (!(await getDocData("lessons", id))) bad("NOT_FOUND", "الدرس غير موجود.");

  const update = {};
  if (typeof body.title === "string") update.title = safeText(body.title);
  if (typeof body.kind === "string" && ["video", "audio"].includes(body.kind)) update.kind = body.kind;
  if (typeof body.youtubeUrl === "string" && isYouTubeUrl(body.youtubeUrl)) update.youtubeUrl = safeText(body.youtubeUrl);
  if (typeof body.stage === "string" && isValidStage(body.stage)) update.stage = body.stage;
  update.updatedAt = fs.serverTimestamp();

  await fs.updateDoc(ref("lessons", id), update);
  return ok({ updated: true });
});

route("DELETE", "/api/admin/lessons/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");
  if (!(await getDocData("lessons", id))) bad("NOT_FOUND", "الدرس غير موجود.");
  await fs.deleteDoc(ref("lessons", id));
  return ok({ deleted: true });
});

/* ---------------- الاختبارات ---------------- */

route("GET", "/api/admin/exams", async () => {
  requireAdmin();
  const [rows, attempts] = await Promise.all([listAll("exams"), listAll("examAttempts")]);
  const counts = {};
  attempts.forEach((a) => { counts[a.examId] = (counts[a.examId] || 0) + 1; });

  const exams = rows.map((d) => ({
    id: d.id,
    title: safeText(d.title),
    stage: safeText(d.stage),
    status: safeText(d.status) || "draft",
    resultPolicy: safeText(d.resultPolicy) || "immediate",
    resultTime: d.resultTime || null,
    resultDurationMinutes: Number(d.resultDurationMinutes) || 0,
    questionsCount: Array.isArray(d.questions) ? d.questions.length : 0,
    attemptsCount: counts[d.id] || 0,
    createdAt: d.createdAt || null
  }));
  exams.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ exams }));
});

route("POST", "/api/admin/exams", async ({ body }) => {
  requireAdmin();
  const v = validateExamPayload(body);
  if (!v.ok) bad("BAD_REQUEST", v.error);

  const created = await fs.addDoc(col("exams"), {
    title: v.title,
    stage: v.stage,
    resultPolicy: v.resultPolicy,
    resultTime: v.resultTime,
    resultDurationMinutes: v.resultDurationMinutes,
    questions: v.questions,
    status: "draft",
    createdAt: fs.serverTimestamp()
  });

  return ok(toPlain({
    exam: {
      id: created.id,
      title: v.title,
      stage: v.stage,
      status: "draft",
      resultPolicy: v.resultPolicy,
      resultTime: v.resultTime,
      resultDurationMinutes: v.resultDurationMinutes,
      questionsCount: v.questions.length,
      attemptsCount: 0,
      createdAt: new Date()
    }
  }));
});

route("PATCH", "/api/admin/exams/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");

  const v = validateExamPayload(body, { requireStatus: false });
  if (!v.ok) bad("BAD_REQUEST", v.error);
  if (!(await getDocData("exams", id))) bad("NOT_FOUND", "الاختبار غير موجود.");

  await fs.updateDoc(ref("exams", id), {
    title: v.title,
    stage: v.stage,
    resultPolicy: v.resultPolicy,
    resultTime: v.resultTime,
    resultDurationMinutes: v.resultDurationMinutes,
    questions: v.questions,
    updatedAt: fs.serverTimestamp()
  });
  return ok({ updated: true });
});

route("PATCH", "/api/admin/exams/:id/publish", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");

  const status = safeText(body.status);
  if (!["draft", "published"].includes(status)) bad("BAD_REQUEST", "الحالة غير صحيحة.");

  const exam = await getDocData("exams", id);
  if (!exam) bad("NOT_FOUND", "الاختبار غير موجود.");

  if (status === "published") {
    if (!exam.title || !isValidStage(exam.stage)) bad("BAD_REQUEST", "بيانات الاختبار ناقصة.");
    if (!Array.isArray(exam.questions) || exam.questions.length === 0) {
      bad("BAD_REQUEST", "الاختبار لا يحتوي على أسئلة.");
    }
  }

  await fs.updateDoc(ref("exams", id), {
    status,
    publishedAt: status === "published" ? fs.serverTimestamp() : null,
    updatedAt: fs.serverTimestamp()
  });
  return ok({ updated: true, status });
});

route("DELETE", "/api/admin/exams/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");
  if (!(await getDocData("exams", id))) bad("NOT_FOUND", "الاختبار غير موجود.");

  await fs.deleteDoc(ref("exams", id));

  try {
    const attempts = await queryDocs("examAttempts", fs.where("examId", "==", id), fs.limit(2000));
    await deleteMany("examAttempts", attempts.map((a) => a.id));
  } catch (e) { /* لا يؤثر */ }

  return ok({ deleted: true });
});

/* ---------------- النتائج ---------------- */

route("GET", "/api/admin/results", async ({ query }) => {
  requireAdmin();
  const examId = safeText(query.examId);

  const general = await getDocData("settings", "general");
  const passingPercent = clamp(parseInt((general && general.passingPercent) || "50", 10), 1, 100);

  const [attempts, exams, students] = await Promise.all([
    examId
      ? queryDocs("examAttempts", fs.where("examId", "==", examId), fs.limit(2000))
      : listAll("examAttempts"),
    listAll("exams"),
    listAll("students")
  ]);
  const examTitles = {};
  exams.forEach((e) => { examTitles[e.id] = safeText(e.title); });
  const studentNames = {};
  students.forEach((s) => { studentNames[s.id] = safeText(s.fullName); });

  const results = attempts.map((d) => ({
    id: d.id,
    examId: d.examId,
    examTitle: examTitles[d.examId] || "",
    studentId: d.studentId,
    studentName: studentNames[d.studentId] || "",
    stage: safeText(d.stage),
    score: Number(d.score) || 0,
    total: Number(d.total) || 0,
    percent: Number(d.percent) || 0,
    correctCount: Number(d.correctCount) || 0,
    wrongCount: Number(d.wrongCount) || 0,
    resultVisible: d.resultVisible === true,
    attemptedAt: d.attemptedAt || null
  }));
  results.sort((a, b) => tsToMs(b.attemptedAt) - tsToMs(a.attemptedAt));

  return ok(toPlain({
    results,
    passingPercent,
    examTitle: examId ? (examTitles[examId] || "") : ""
  }));
});

/* ---------------- الإعدادات ---------------- */

route("GET", "/api/admin/settings", async () => {
  requireAdmin();
  const d = await getDocData("settings", "general");
  if (!d) {
    return ok({
      settings: {
        academicYear: "",
        platformName: "منصة أ/ إسماعيل عماد",
        subscriptionsEnabled: true,
        prayerEnabled: true,
        aiEnabled: true,
        passingPercent: 50
      }
    });
  }
  return ok({
    settings: {
      academicYear: safeText(d.academicYear),
      platformName: safeText(d.platformName),
      subscriptionsEnabled: d.subscriptionsEnabled !== false,
      prayerEnabled: d.prayerEnabled !== false,
      aiEnabled: d.aiEnabled !== false,
      passingPercent: Math.min(Math.max(parseInt(d.passingPercent || "50", 10) || 50, 1), 100)
    }
  });
});

route("PATCH", "/api/admin/settings", async ({ body }) => {
  requireAdmin();
  const update = { updatedAt: fs.serverTimestamp() };
  if (typeof body.academicYear === "string" || body.academicYear === null) {
    update.academicYear = safeText(body.academicYear) || "";
  }
  if (typeof body.platformName === "string") update.platformName = safeText(body.platformName);
  if (typeof body.subscriptionsEnabled === "boolean") update.subscriptionsEnabled = body.subscriptionsEnabled;
  if (typeof body.prayerEnabled === "boolean") update.prayerEnabled = body.prayerEnabled;
  if (typeof body.aiEnabled === "boolean") update.aiEnabled = body.aiEnabled;
  if (body.passingPercent !== undefined) {
    const value = Number(body.passingPercent);
    if (!Number.isInteger(value) || value < 1 || value > 100) bad("BAD_REQUEST", "نسبة النجاح يجب أن تكون بين 1 و100.");
    update.passingPercent = value;
  }

  await fs.setDoc(ref("settings", "general"), update, { merge: true });
  return ok({ updated: true });
});

/* ---------------- مجموعات الدروس ---------------- */

route("GET", "/api/admin/lesson-groups", async () => {
  requireAdmin();
  const rows = await listAll("lessonGroups");
  const groups = rows.map((d) => ({
    id: d.id,
    name: safeText(d.name),
    stage: safeText(d.stage),
    active: d.active !== false,
    createdAt: d.createdAt || null
  }));
  groups.sort((a, b) => tsToMs(b.createdAt) - tsToMs(a.createdAt));
  return ok(toPlain({ groups }));
});

route("POST", "/api/admin/lesson-groups", async ({ body }) => {
  requireAdmin();
  const name = safeText(body.name);
  const stage = safeText(body.stage);
  const active = body.active !== false;

  if (!name || name.length > 80) bad("BAD_REQUEST", "اسم المجموعة غير صالح.");
  if (!isValidStage(stage)) bad("BAD_REQUEST", "المرحلة غير صحيحة.");

  const created = await fs.addDoc(col("lessonGroups"), {
    name, stage, active, createdAt: fs.serverTimestamp()
  });
  return ok({
    group: { id: created.id, name, stage, active, createdAt: new Date().toISOString() }
  });
});

route("PATCH", "/api/admin/lesson-groups/:id", async ({ params, body }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");
  if (!(await getDocData("lessonGroups", id))) bad("NOT_FOUND", "المجموعة غير موجودة.");

  const update = {};
  if (typeof body.name === "string") update.name = safeText(body.name);
  if (typeof body.stage === "string" && isValidStage(body.stage)) update.stage = body.stage;
  if (typeof body.active === "boolean") update.active = body.active;
  update.updatedAt = fs.serverTimestamp();

  await fs.updateDoc(ref("lessonGroups", id), update);
  return ok({ updated: true });
});

route("DELETE", "/api/admin/lesson-groups/:id", async ({ params }) => {
  requireAdmin();
  const id = safeText(params.id);
  if (!id) bad("BAD_REQUEST", "المعرّف مطلوب.");
  if (!(await getDocData("lessonGroups", id))) bad("NOT_FOUND", "المجموعة غير موجودة.");
  await fs.deleteDoc(ref("lessonGroups", id));
  return ok({ deleted: true });
});
