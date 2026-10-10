/* ============================================================
   js/backend/index.js — نقطة التجميع
   كل وحدة تسجّل مساراتها عند الاستيراد.
   ============================================================ */
import "./auth.js";
import "./settings.js";
import "./content.js";
import "./exams.js";
import "./planner.js";
import "./ai.js";
import "./admin-core.js";
import "./admin-announcements.js";
import "./admin-content.js";

export { backendRequest } from "./core.js";
