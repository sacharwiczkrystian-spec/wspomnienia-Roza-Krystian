"use strict";
const crypto = require("node:crypto");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
function verifyStandardWebhook(rawBody, headers, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof secret !== "string" || !secret.startsWith("v1,whsec_")) return false;
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(nowSeconds - timestampNumber) > MAX_CLOCK_SKEW_SECONDS) return false;
  const secretBytes = Buffer.from(secret.slice("v1,whsec_".length), "base64");
  if (secretBytes.length < 32) return false;
  const signedContent = id + "." + timestamp + "." + rawBody;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest();
  return String(signatures).split(/\s+/).some((entry) => {
    const match = /^v1,([A-Za-z0-9+/]+={0,2})$/.exec(entry);
    if (!match) return false;
    const supplied = Buffer.from(match[1], "base64");
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
}
function buildSmsPayload(phone, otp, sender) {
  const payload = {
    recipients: phone,
    message: "Twój kod logowania LOVE Story: " + otp + ". Nie udostępniaj go nikomu.",
    type: 1,
    unicode: true
  };
  if (sender) payload.sender = sender;
  return payload;
}
async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }
  const secret = process.env.SUPABASE_SEND_SMS_HOOK_SECRET || "";
  const token = process.env.SZYBKISMS_API_TOKEN || "";
  if (!secret || !token) {
    console.error("Supabase Send SMS hook is missing server configuration");
    return json(res, 503, { error: "SMS provider is not configured" });
  }
  let rawBody;
  try { rawBody = await readRawBody(req); }
  catch (_) { return json(res, 413, { error: "Request body too large" }); }

  const headers = {
    "webhook-id": getHeader(req, "webhook-id"),
    "webhook-timestamp": getHeader(req, "webhook-timestamp"),
    "webhook-signature": getHeader(req, "webhook-signature")
  };
  if (!verifyStandardWebhook(rawBody, headers, secret)) {
    return json(res, 401, { error: "Invalid webhook signature" });
  }
  let event;
  try { event = JSON.parse(rawBody); }
  catch (_) { return json(res, 400, { error: "Invalid JSON payload" }); }

  const phone = String(event?.user?.phone || "");
  const otp = String(event?.sms?.otp || "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(otp)) {
    return json(res, 400, { error: "Invalid SMS event payload" });
  }
  try {
    const payload = buildSmsPayload(phone, otp, process.env.SZYBKISMS_SENDER || "");
    const response = await fetch("https://api.szybkisms.pl/rest/messages/sms", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    let result = null;
    if (response.ok) {
      try { result = await response.json(); } catch (_) {}
    }
    const messages = Array.isArray(result) ? result : (Array.isArray(result?.messages) ? result.messages : []);
    const accepted = response.ok && messages.length > 0 && messages.every((item) => item && item.status_code === "QUEUED");
    if (!accepted) {
      console.error("SzybkiSMS did not accept Supabase MFA message", { status: response.status });
      return json(res, 502, { error: "SMS provider rejected the message" });
    }
    return json(res, 200, {});
  } catch (error) {
    console.error("Supabase Send SMS provider request failed", { name: error?.name || "Error" });
    return json(res, 502, { error: "SMS provider request failed" });
  }
}
module.exports = handler;
module.exports.verifyStandardWebhook = verifyStandardWebhook;
module.exports.buildSmsPayload = buildSmsPayload;
module.exports.config = { api: { bodyParser: false } };
