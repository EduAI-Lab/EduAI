import express from "express";
import {
  deleteUserProviderSetting,
  getUserProviderSettings,
  upsertUserProviderSetting,
} from "../services/eduaiClient.js";

const router = express.Router();

function cookieFor(req) {
  return typeof req.headers.cookie === "string" ? req.headers.cookie : "";
}

router.get("/provider-settings", async (req, res, next) => {
  try {
    res.json(await getUserProviderSettings(cookieFor(req)));
  } catch (error) {
    next(error);
  }
});

router.post("/provider-settings", async (req, res, next) => {
  const { providerName, isEnabled, apiKey, baseUrl } = req.body ?? {};
  if (typeof providerName !== "string" || !providerName.trim()) {
    return res.status(400).json({ error: "providerName is required" });
  }
  if (typeof isEnabled !== "boolean") {
    return res.status(400).json({ error: "isEnabled must be a boolean" });
  }
  if (apiKey !== undefined && typeof apiKey !== "string") {
    return res.status(400).json({ error: "apiKey must be a string" });
  }
  if (baseUrl !== undefined && typeof baseUrl !== "string") {
    return res.status(400).json({ error: "baseUrl must be a string" });
  }
  try {
    const payload = { providerName: providerName.trim(), isEnabled };
    if (apiKey !== undefined) payload.apiKey = apiKey;
    if (baseUrl !== undefined) payload.baseUrl = baseUrl;
    await upsertUserProviderSetting(cookieFor(req), payload);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.delete("/provider-settings", async (req, res, next) => {
  const providerName =
    typeof req.query.providerName === "string" ? req.query.providerName.trim() : "";
  if (!providerName) return res.status(400).json({ error: "providerName is required" });
  try {
    await deleteUserProviderSetting(cookieFor(req), providerName);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
