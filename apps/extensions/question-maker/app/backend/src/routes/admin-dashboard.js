import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { loadAdminDashboard } from "../services/adminDashboardService.js";

const router = express.Router();

/**
 * GET /api/admin/dashboard — the ADMIN dashboard's Question Maker rollup:
 * content, courses and assessments, "Needs your attention" counts, AI health,
 * weekly question versions and recent activity. The admin's cookie is
 * forwarded so Core's admin-only reads (bug reports, models) see the admin.
 *
 * Auth: ADMIN.
 */
router.get("/admin/dashboard", requireAuth, requireRole("ADMIN"), (req, res, next) => {
  loadAdminDashboard({ cookie: req.headers.cookie ?? "" })
    .then((data) => res.json({ success: true, data }))
    .catch(next);
});

export default router;
