/**
 * login.js
 * ------------------------------------------------------------
 * منصة أ/ إسماعيل عماد التعليمية
 * تشغيل صفحة login.html
 *
 * المكان: /js/login.js
 *
 * المرجع:
 *   - الوثيقة الأصلية (بنود 17، 18، 19، 104، 105، 106، 114، 204)
 *   - Master Design System (بنود 33، 34، 36، 44، 55)
 *
 * ⚠️ قواعد:
 *   - كل التحقق الحقيقي في Worker.
 *   - التحقق هنا للـ UX فقط.
 *   - كلمة المرور لا تُخزَّن في الفرونت.
 *
 * ⚠️ حالة الملف:
 *   - WORKER_URL = PLACEHOLDER_WORKER_URL (البند 207).
 *   - الدوال سترجع NETWORK_ERROR حتى بناء الـ Worker.
 *   - هذا سلوك متوقع ومقصود.
 * ------------------------------------------------------------
 */

import { onReady, safeText, showToast } from "./helpers.js";
import {
  requireGuest,
  getRedirectTarget,
  navigateTo,
  ROUTES
} from "./router.js";
import {
  loginStudent,
  firstLoginStudent,
  AUTH_ERRORS
} from "./auth.js";
import {
  validateLoginForm,
  validateFirstLoginForm,
  showFieldError,
  clearFieldError,
  clearFormErrors
} from "./validation.js";


/* ============================================================
   01 — المراجع للعناصر (تُملأ عند الجاهزية)
   ============================================================ */

let loginForm = null;
let codeInput = null;
let passwordInput = null;
let firstLoginSection = null;
let fullNameInput = null;
let stageSelect = null;
let submitBtn = null;

/** حالة "أول مرة" — بتتحول true لما الـ Worker يطلبها */
let isFirstLoginMode = false;

/** حالة الإرسال — لمنع الإرسال المزدوج */
let isSubmitting = false;


/* ============================================================
   02 — تجميع العناصر
   ============================================================ */

function cacheElements() {
  loginForm         = document.getElementById("loginForm");
  codeInput         = document.getElementById("codeInput");
  passwordInput     = document.getElementById("passwordInput");
  firstLoginSection = document.getElementById("firstLoginSection");
  fullNameInput     = document.getElementById("fullNameInput");
  stageSelect       = document.getElementById("stageSelect");
  submitBtn         = document.getElementById("submitBtn");
}


/* ============================================================
   03 — إظهار / إخفاء قسم First Login
   ============================================================ */

/**
 * إظهار قسم First Login.
 * - يضيف كلاس is-visible.
 * - يعيّن وضع firstLoginMode.
 * - يركّز على أول حقل مطلوب.
 */
function showFirstLoginSection() {
  if (!firstLoginSection) return;

  isFirstLoginMode = true;
  firstLoginSection.classList.add("is-visible");

  // ترتيب الـ scroll لأول حقل
  if (fullNameInput) {
    // تأخير بسيط لضمان ظهور القسم
    setTimeout(() => {
      fullNameInput.focus();
      fullNameInput.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }
}

/**
 * إخفاء قسم First Login.
 * - يُستخدم لو حصل خطأ بعد الإظهار.
 */
function hideFirstLoginSection() {
  if (!firstLoginSection) return;
  isFirstLoginMode = false;
  firstLoginSection.classList.remove("is-visible");
}


/* ============================================================
   04 — تفعيل / تعطيل زر الإرسال
   المرجع: الوثيقة الأصلية — بند 122
   ============================================================ */

function setSubmitting(state) {
  isSubmitting = !!state;

  if (!submitBtn) return;

  submitBtn.disabled = isSubmitting;

  if (isSubmitting) {
    submitBtn.classList.add("is-loading");
    submitBtn.setAttribute("aria-busy", "true");
  } else {
    submitBtn.classList.remove("is-loading");
    submitBtn.removeAttribute("aria-busy");
  }
}


/* ============================================================
   05 — معالجة الأخطاء
   المرجع: الوثيقة الأصلية — بند 114
   القعتمد على error.code وليس نص الرسالة.
   ============================================================ */

/**
 * عرض خطأ حقل معيّن.
 * @param {"code"|"password"|"fullName"|"stage"} field
 * @param {string} message
 */
function showErrorOnField(field, message) {
  if (field === "code" && codeInput) {
    showFieldError(codeInput, message);
    return;
  }
  if (field === "password" && passwordInput) {
    showFieldError(passwordInput, message);
    return;
  }
  if (field === "fullName" && fullNameInput) {
    showFieldError(fullNameInput, message);
    return;
  }
  if (field === "stage" && stageSelect) {
    showFieldError(stageSelect, message);
    return;
  }
}

/**
 * معالجة أخطاء Worker.
 * @param {Object} error - { code, message }
 */
function handleWorkerError(error) {
  const code = error && error.code ? error.code : AUTH_ERRORS.SERVER_ERROR;
  const message = error && error.message
    ? error.message
    : "حدث خطأ. حاول مرة أخرى.";

  switch (code) {

    // كود غلط
    case AUTH_ERRORS.INVALID_CODE:
      showErrorOnField("code", message || "الكود غير صحيح.");
      showToast(message || "الكود غير صحيح.", "error");
      break;

    // كلمة المرور غلط
    case AUTH_ERRORS.INVALID_PASSWORD:
      showErrorOnField("password", message || "كلمة المرور غير صحيحة.");
      showToast(message || "كلمة المرور غير صحيحة.", "error");
      break;

    // كود معطل
    case AUTH_ERRORS.CODE_DISABLED:
      showToast(message || "هذا الكود غير مفعّل. تواصل مع الإدارة.", "warning");
      break;

    // كود منتهي
    case AUTH_ERRORS.CODE_EXPIRED:
      showToast(message || "انتهت صلاحية هذا الكود.", "warning");
      break;

    // كود مستخدم بالفعل (بس محاولة First Login جديدة)
    case AUTH_ERRORS.ALREADY_ACTIVATED:
      showToast(message || "هذا الكود مستخدم بالفعل.", "error");
      break;

    // Worker طلب First Login
    case AUTH_ERRORS.FIRST_LOGIN_REQUIRED:
      showFirstLoginSection();
      showToast(
        message || "هذه أول مرة يتم فيها استخدام الكود. أكمل بياناتك.",
        "info",
        4000
      );
      break;

    // مرحلة ناقصة
    case AUTH_ERRORS.STAGE_REQUIRED:
      showErrorOnField("stage", message || "من فضلك اختر المرحلة.");
      break;

    // جلسة انتهت (مش متوقعة في login)
    case AUTH_ERRORS.UNAUTHORIZED:
      showToast(message || "انتهت الجلسة. حاول مرة أخرى.", "warning");
      break;

    // غير مسموح
    case AUTH_ERRORS.FORBIDDEN:
      showToast(message || "غير مسموح بهذا الإجراء.", "error");
      break;

    // شبكة
    case AUTH_ERRORS.NETWORK_ERROR:
      showToast(message || "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.", "error");
      break;

    // Timeout
    case AUTH_ERRORS.TIMEOUT:
      showToast(message || "انتهت مدة الطلب. حاول مرة أخرى.", "warning");
      break;

    // خطأ خادم
    case AUTH_ERRORS.SERVER_ERROR:
    default:
      showToast(message || "حدث خطأ. حاول مرة أخرى.", "error");
      break;
  }
}


/* ============================================================
   06 — التوجيه بعد النجاح
   المرجع: الوثيقة الأصلية — بند 204
   ============================================================ */

/**
 * التوجيه بعد تسجيل دخول ناجح.
 * - إن وُجد ?redirect= → يوجّهه.
 * - وإلا → للصفحة الرئيسية.
 */
function redirectAfterLogin() {
  const target = getRedirectTarget();

  if (target) {
    // توجيه للرابط المطلوب
    window.location.replace(target);
    return;
  }

  // توجيه للـ Home
  navigateTo(ROUTES.HOME);
}


/* ============================================================
   07 — إرسال النموذج
   ============================================================ */

/**
 * معالجة إرسال النموذج.
 * @param {Event} event
 */
async function handleSubmit(event) {
  if (event) event.preventDefault();

  // منع الإرسال المزدوج (بند 184)
  if (isSubmitting) return;

  // مسح الأخطاء القديمة
  clearFormErrors(loginForm);

  // قراءة القيم
  const code     = codeInput ? codeInput.value : "";
  const password = passwordInput ? passwordInput.value : "";

  // ==========================================================
  // المرحلة 1: التحقق في الفرونت
  // ==========================================================

  if (isFirstLoginMode) {
    // ---------- First Login ----------
    const fullName = fullNameInput ? fullNameInput.value : "";
    const stage    = stageSelect ? stageSelect.value : "";

    const { valid, errors } = validateFirstLoginForm({
      code,
      password,
      fullName,
      stage
    });

    if (!valid) {
      if (errors.code)     showErrorOnField("code", errors.code);
      if (errors.password) showErrorOnField("password", errors.password);
      if (errors.fullName) showErrorOnField("fullName", errors.fullName);
      if (errors.stage)    showErrorOnField("stage", errors.stage);

      // ركّز على أول حقل فيه خطأ
      if (errors.code && codeInput) codeInput.focus();
      else if (errors.password && passwordInput) passwordInput.focus();
      else if (errors.fullName && fullNameInput) fullNameInput.focus();
      else if (errors.stage && stageSelect) stageSelect.focus();

      return;
    }

    // ---------- إرسال First Login ----------
    setSubmitting(true);

    const result = await firstLoginStudent({
      code: safeText(code),
      password: String(password),
      fullName: safeText(fullName),
      stage: safeText(stage)
    });

    setSubmitting(false);

    if (result && result.success) {
      showToast("تم تسجيل الدخول بنجاح 🎉", "success");
      // تأخير بسيط لعرض الـ Toast
      setTimeout(() => redirectAfterLogin(), 400);
      return;
    }

    // فشل
    handleWorkerError(result && result.error ? result.error : null);
    return;
  }

  // ==========================================================
  // المرحلة 2: Returning Login (الوضع العادي)
  // ==========================================================

  const { valid, errors } = validateLoginForm({ code, password });

  if (!valid) {
    if (errors.code)     showErrorOnField("code", errors.code);
    if (errors.password) showErrorOnField("password", errors.password);

    if (errors.code && codeInput) codeInput.focus();
    else if (errors.password && passwordInput) passwordInput.focus();

    return;
  }

  setSubmitting(true);

  const result = await loginStudent(safeText(code), String(password));

  setSubmitting(false);

  if (result && result.success) {
    showToast("تم تسجيل الدخول بنجاح 🎉", "success");
    setTimeout(() => redirectAfterLogin(), 400);
    return;
  }

  // فشل
  handleWorkerError(result && result.error ? result.error : null);
}


/* ============================================================
   08 — تنظيف الأخطاء عند الكتابة
   ============================================================ */

/**
 * عند الكتابة في حقل، نزيل رسالة الخطأ الخاصة به.
 */
function bindFieldCleanup() {
  const fields = [codeInput, passwordInput, fullNameInput, stageSelect];

  fields.forEach((field) => {
    if (!field) return;

    const eventName = field.tagName === "SELECT" ? "change" : "input";

    field.addEventListener(eventName, () => {
      clearFieldError(field);
    });
  });
}


/* ============================================================
   09 — التهيئة
   ============================================================ */

function init() {
  // 1) لو مسجّل بالفعل → توجيه
  requireGuest();

  // 2) تجميع العناصر
  cacheElements();

  // 3) لو الصفحة ناقصة عناصر أساسية، نوقف بهدوء
  if (!loginForm || !codeInput || !passwordInput || !submitBtn) {
    return;
  }

  // 4) ربط أحداث الإرسال
  loginForm.addEventListener("submit", handleSubmit);

  // 5) تنظيف الأخطاء عند الكتابة
  bindFieldCleanup();

  // 6) تركيز تلقائي على حقل الكود (تجربة أفضل)
  //    (لكن ليس على الموبايل حتى لا تُفتح لوحة المفاتيح تلقائيًا)
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile && codeInput) {
    codeInput.focus();
  }
}


/* ============================================================
   10 — التشغيل
   ============================================================ */

onReady(init);