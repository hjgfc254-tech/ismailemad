/* ============================================================
   setup.js — تجهيز المنصة مرة واحدة
   ------------------------------------------------------------
   1) ينشئ حساب الأدمن في Firebase Authentication + مستند admins/{uid}
      ويُقفل إنشاء أدمن جديد بعد ذلك (config/adminLock).
   2) ينشئ settings/general و settings/ai بقيم افتراضية.
   3) ينشئ باقي الكوليكشنات بمستند مؤقت _init (يُخفيه js/backend/core.js).
   ⚠️ شغّله فور نشر القواعد، ثم احذف setup.html و setup.js.
   ============================================================ */

import { FIREBASE_CONFIG } from "./env.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  initializeAuth, inMemoryPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs,
  query, where, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);
const auth = initializeAuth(app, { persistence: inMemoryPersistence });
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true
});

const PLACEHOLDER_ID = "_init";

const COLLECTIONS = [
  { name: "admins", label: "الأدمن" },
  { name: "settings", label: "الإعدادات" },
  { name: "codes", label: "أكواد الدخول" },
  { name: "students", label: "الطلاب" },
  { name: "lessonGroups", label: "مجموعات الدروس" },
  { name: "lessons", label: "الدروس" },
  { name: "lessonProgress", label: "تقدم الدروس" },
  { name: "announcements", label: "الإعلانات" },
  { name: "announcementReplies", label: "ردود الإعلانات" },
  { name: "announcementReads", label: "قراءات الإعلانات" },
  { name: "exams", label: "الاختبارات" },
  { name: "examAttempts", label: "محاولات الاختبارات" },
  { name: "planner", label: "المنظّم" },
  { name: "studySessions", label: "جلسات المذاكرة" },
  { name: "aiUsage", label: "استخدام المساعد" },
  { name: "subscriptionRequests", label: "طلبات الاشتراك" }
];

const SETTINGS_DEFAULTS = {
  general: {
    platformName: "منصة أ/ إسماعيل عماد",
    academicYear: "",
    prayerEnabled: true,
    aiEnabled: true,
    subscriptionsEnabled: true,
    passingPercent: 50
  },
  ai: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    apiKey: "",
    dailyLimit: 20,
    maxOutputTokens: 1000
  }
};

const $ = (id) => document.getElementById(id);
const listEl = $("list");
const logEl = $("log");
const buttons = [$("btnCreate"), $("btnCheck"), $("btnClean")];

function log(msg, type) {
  const line = document.createElement("div");
  line.textContent = msg;
  if (type === "err") line.style.color = "var(--err)";
  if (type === "ok") line.style.color = "var(--ok)";
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function resetLog() { logEl.textContent = ""; }
function setBusy(busy) { buttons.forEach((b) => { b.disabled = busy; }); }

function errText(e) {
  const code = e && e.code ? String(e.code) : "";
  if (code === "permission-denied") return "لا توجد صلاحية (القواعد منشورة، والحساب ليس أدمن).";
  if (code === "unavailable") return "لا يوجد اتصال بـ Firestore.";
  if (code === "auth/operation-not-allowed") return "فعّل Email/Password من Firebase ← Authentication ← Sign-in method.";
  if (code === "auth/weak-password") return "كلمة المرور ضعيفة (6 أحرف على الأقل).";
  if (code === "auth/invalid-email") return "البريد الإلكتروني غير صحيح.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") return "كلمة المرور غير صحيحة لهذا البريد.";
  if (code === "auth/too-many-requests") return "محاولات كثيرة. انتظر قليلًا.";
  if (code === "auth/network-request-failed") return "لا يوجد اتصال بالإنترنت.";
  return (e && e.message) || "خطأ غير معروف";
}

/* ---------- الدخول ---------- */

function readForm() {
  const email = $("adminEmail").value.trim().toLowerCase();
  const name = $("adminName").value.trim();
  const password = $("adminPass").value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("اكتب بريدًا صحيحًا للأدمن.");
  if (password.length < 6) throw new Error("كلمة المرور 6 أحرف على الأقل.");
  return { email, name, password };
}

/** createIfMissing=true: ينشئ حساب Authentication إن لم يكن موجودًا */
async function signInAdmin(createIfMissing) {
  const { email, name, password } = readForm();
  if (createIfMissing) {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      return { uid: cred.user.uid, email, name, created: true };
    } catch (e) {
      if (!(e && e.code === "auth/email-already-in-use")) throw e;
    }
  }
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return { uid: cred.user.uid, email, name, created: false };
}

/* ---------- الحالة ---------- */

async function inspect(name) {
  const snap = await getDocs(query(collection(db, name), limit(2)));
  const docs = snap.docs;
  const real = docs.filter((d) => d.data()._placeholder !== true).length;
  return { exists: docs.length > 0, real, placeholder: docs.length - real };
}

function renderRow(name, label, state) {
  let li = listEl.querySelector(`[data-name="${name}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.name = name;
    listEl.appendChild(li);
  }
  li.textContent = "";
  const left = document.createElement("span");
  left.textContent = label + " ";
  const code = document.createElement("code");
  code.textContent = name;
  left.appendChild(code);

  const tag = document.createElement("span");
  tag.className = "tag";
  if (!state) tag.textContent = "—";
  else if (state.error) { tag.className = "tag err"; tag.textContent = "خطأ"; }
  else if (!state.exists) tag.textContent = "غير موجودة";
  else if (state.real > 0) { tag.className = "tag ok"; tag.textContent = "موجودة (فيها بيانات)"; }
  else { tag.className = "tag ok"; tag.textContent = "موجودة (فارغة)"; }
  li.appendChild(left);
  li.appendChild(tag);
}

function renderAllEmpty() {
  listEl.textContent = "";
  COLLECTIONS.forEach((c) => renderRow(c.name, c.label, null));
}

async function checkAll() {
  for (const c of COLLECTIONS) {
    try {
      renderRow(c.name, c.label, await inspect(c.name));
    } catch (e) {
      renderRow(c.name, c.label, { error: true });
      log(`تعذر فحص ${c.name}: ${errText(e)}`, "err");
    }
  }
}

/* ---------- الإنشاء ---------- */

async function ensureAdminDoc(info) {
  const adminRef = doc(db, "admins", info.uid);
  let exists = false;
  try {
    exists = (await getDoc(adminRef)).exists();
  } catch (e) {
    exists = false;
  }
  if (exists) {
    log("حساب الأدمن: موجود بالفعل.");
    return true;
  }
  try {
    const batch = writeBatch(db);
    batch.set(adminRef, {
      email: info.email,
      name: info.name || "أدمن",
      status: "active",
      createdAt: serverTimestamp()
    });
    batch.set(doc(db, "config", "adminLock"), {
      uid: info.uid,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    log(`الأدمن ${info.email}: تم إنشاؤه، وأُغلق إنشاء أدمن جديد.`, "ok");
    return true;
  } catch (e) {
    if (e && e.code === "permission-denied") {
      log("تم تجهيز هذه المنصة بأدمن آخر من قبل. سجّل بحساب الأدمن الصحيح.", "err");
      return false;
    }
    throw e;
  }
}

async function ensureSettingsDoc(id) {
  const ref = doc(db, "settings", id);
  const snap = await getDoc(ref);
  if (snap.exists()) { log(`settings/${id}: موجود، لم يتغير.`); return; }
  await setDoc(ref, { ...SETTINGS_DEFAULTS[id], createdAt: serverTimestamp() });
  log(`settings/${id}: تم إنشاؤه بالقيم الافتراضية.`, "ok");
}

async function ensurePlaceholder(name) {
  const state = await inspect(name);
  if (state.exists) { log(`${name}: موجودة بالفعل.`); return; }
  await setDoc(doc(db, name, PLACEHOLDER_ID), {
    _placeholder: true,
    note: "مستند مؤقت لإظهار الكوليكشن. يُخفى تلقائيًا ويمكن حذفه.",
    createdAt: serverTimestamp()
  });
  log(`${name}: تم إنشاؤها (مستند مؤقت).`, "ok");
}

async function createAll() {
  resetLog();
  setBusy(true);
  try {
    const info = await signInAdmin(true);
    log(info.created ? "تم إنشاء حساب الدخول." : "تم تسجيل الدخول.");
    const okAdmin = await ensureAdminDoc(info);
    if (!okAdmin) return;

    await ensureSettingsDoc("general");
    await ensureSettingsDoc("ai");

    for (const c of COLLECTIONS) {
      if (c.name === "settings" || c.name === "admins") continue;
      try { await ensurePlaceholder(c.name); }
      catch (e) { log(`${c.name}: فشل — ${errText(e)}`, "err"); }
    }
    await checkAll();
    log("تم. يمكنك الآن الدخول من /admin/login بنفس البريد وكلمة المرور.", "ok");
  } catch (e) {
    log("توقف التنفيذ: " + errText(e), "err");
  } finally {
    setBusy(false);
  }
}

async function cleanPlaceholders() {
  if (!window.confirm("حذف كل المستندات المؤقتة؟ الكوليكشنات الفارغة ستختفي من Console حتى تُكتب فيها بيانات.")) return;
  resetLog();
  setBusy(true);
  try {
    await signInAdmin(false);
    let removed = 0;
    for (const c of COLLECTIONS) {
      try {
        const snap = await getDocs(query(collection(db, c.name), where("_placeholder", "==", true)));
        for (const d of snap.docs) {
          await deleteDoc(d.ref);
          removed += 1;
          log(`${c.name}/${d.id}: تم حذفه.`);
        }
      } catch (e) {
        log(`${c.name}: فشل — ${errText(e)}`, "err");
      }
    }
    log(removed ? `تم حذف ${removed} مستند مؤقت.` : "لا توجد مستندات مؤقتة.", "ok");
    await checkAll();
  } catch (e) {
    log(errText(e), "err");
  } finally {
    setBusy(false);
  }
}

$("btnCreate").addEventListener("click", createAll);
$("btnCheck").addEventListener("click", async () => {
  resetLog();
  setBusy(true);
  try {
    await signInAdmin(false);
    log("جارٍ الفحص...");
    await checkAll();
    log("تم الفحص.", "ok");
  } catch (e) {
    log(errText(e), "err");
  } finally {
    setBusy(false);
  }
});
$("btnClean").addEventListener("click", cleanPlaceholders);

renderAllEmpty();
