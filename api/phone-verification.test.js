"use strict";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
const handler = require("./phone-verification");

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.PHONE_OTP_PEPPER = "";
  process.env.SZYBKISMS_API_TOKEN = "";
  process.env.SZYBKISMS_SENDER = "";
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end(body) { this.body = body; return this; },
    json() { return JSON.parse(this.body); }
  };
}

function request(body) {
  return {
    method: "POST",
    headers: { authorization: "Bearer test-session", "x-forwarded-for": "203.0.113.10" },
    socket: { remoteAddress: "203.0.113.10" },
    body
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function installFetch({ verifiedRows = [], challengeRows = [], rpcResult = null, smsError = null, smsStatus = "QUEUED" } = {}) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) {
      return jsonResponse({ id: "00000000-0000-4000-8000-000000000001", last_sign_in_at: new Date().toISOString() });
    }
    if (String(url).includes("/rest/v1/verified_phone_numbers")) return jsonResponse(verifiedRows);
    if (String(url).includes("/rest/v1/phone_verification_challenges")) return jsonResponse(challengeRows);
    if (String(url).includes("/rest/v1/rpc/phone_verification_start")) return jsonResponse(rpcResult || { status: "started" });
    if (String(url).includes("/rest/v1/rpc/phone_verification_cancel")) return jsonResponse(true);
    if (String(url).includes("/rest/messages/sms")) {
      if (smsError) throw smsError;
      return jsonResponse([{ id: 123, status_code: smsStatus, status_description: smsStatus === "QUEUED" ? "The message has been accepted" : "The message was rejected" }]);
    }
    throw new Error("Unexpected fetch URL: " + url);
  };
  return calls;
}

test("status remains available without OTP pepper or SzybkiSMS configuration", async () => {
  const calls = installFetch({ verifiedRows: [] });
  const res = responseRecorder();
  await handler(request({ action: "status" }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { verified: false, phone: null, verified_at: null });
  assert.equal(calls.some(call => call.url.includes("/rest/messages/sms")), false);
});

test("status masks the verified phone number", async () => {
  installFetch({
    verifiedRows: [{ phone_e164: "+48500100200", verified_at: "2026-11-11T12:00:00Z" }]
  });
  const res = responseRecorder();
  await handler(request({ action: "status" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().verified, true);
  assert.equal(res.json().phone, "+485••••200");
});

test("start refuses to send when SzybkiSMS is not configured", async () => {
  process.env.PHONE_OTP_PEPPER = "a".repeat(64);
  const calls = installFetch({ verifiedRows: [] });
  const res = responseRecorder();
  await handler(request({ action: "start", phone: "+48500100200" }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(calls.some(call => call.url.includes("/rest/messages/sms")), false);
  assert.equal(calls.some(call => call.url.includes("phone_verification_start")), false);
});

test("start sends the OTP through the SzybkiSMS REST API using Bearer auth", async () => {
  process.env.PHONE_OTP_PEPPER = "c".repeat(64);
  process.env.SZYBKISMS_API_TOKEN = "test-only-token";
  process.env.SZYBKISMS_SENDER = "LoveStory";
  const calls = installFetch({ verifiedRows: [] });
  const res = responseRecorder();
  await handler(request({ action: "start", phone: "+48500100200" }), res);

  const smsCall = calls.find(call => call.url === "https://api.szybkisms.pl/rest/messages/sms");
  assert.ok(smsCall, "SzybkiSMS REST endpoint was called");
  assert.equal(smsCall.options.headers.Authorization, "Bearer test-only-token");
  const payload = JSON.parse(smsCall.options.body);
  assert.equal(payload.recipients, "+48500100200");
  assert.match(payload.message, /LOVE Story/);
  assert.equal(payload.type, 1);
  assert.equal(payload.unicode, true);
  assert.equal(payload.sender, "LoveStory");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: true });
  assert.equal(res.body.includes("test-only-token"), false);
});

test("start rejects a SzybkiSMS HTTP 200 response when the provider rejects the message", async () => {
  process.env.PHONE_OTP_PEPPER = "d".repeat(64);
  process.env.SZYBKISMS_API_TOKEN = "test-only-token";
  const calls = installFetch({ verifiedRows: [], smsStatus: "REJECTED" });
  const res = responseRecorder();
  await handler(request({ action: "start", phone: "+48500100200" }), res);

  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /Operator nie przyjął/);
  assert.equal(calls.some(call => call.url.includes("/rest/v1/rpc/phone_verification_cancel")), true);
  assert.equal(res.body.includes("test-only-token"), false);
});

test("ambiguous SMS network failure preserves the challenge for a possibly delivered code", async () => {
  process.env.PHONE_OTP_PEPPER = "b".repeat(64);
  process.env.SZYBKISMS_API_TOKEN = "test-only-token";
  const calls = installFetch({ verifiedRows: [], smsError: new TypeError("simulated network timeout") });
  const res = responseRecorder();
  await handler(request({ action: "start", phone: "+48500100200" }), res);

  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /wyniku wysyłki/);
  assert.equal(calls.some(call => call.url.includes("/rest/v1/rpc/phone_verification_start")), true);
  assert.equal(calls.some(call => call.url.includes("/rest/v1/rpc/phone_verification_cancel")), false);
  assert.equal(res.body.includes("test-only-token"), false);
});

test("migration keeps the approved-ad exception SELECT-only and gates writes", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261111220000_phone_verification_enforcement.sql"), "utf8");
  const adsSelect = migration.match(/create policy phone_verification_ads_select[\s\S]*?;/i);
  assert.ok(adsSelect, "approved-ad SELECT policy exists");
  assert.match(adsSelect[0], /for select/i);
  assert.match(adsSelect[0], /status = 'approved'/i);
  assert.doesNotMatch(adsSelect[0], /for all/i);

  for (const command of ["insert", "update", "delete"]) {
    const policy = migration.match(new RegExp("create policy phone_verification_ads_" + command + "[\\s\\S]*?;", "i"));
    assert.ok(policy, "company_ads " + command.toUpperCase() + " policy exists");
    assert.match(policy[0], /is_phone_verified/i);
    assert.doesNotMatch(policy[0], /status\s*=\s*'approved'/i);
  }
});

test("migration explicitly revokes public execution from privileged RPCs", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261111220000_phone_verification_enforcement.sql"), "utf8");
  const protectedFunctions = [
    "admin_create_staff_id_card",
    "admin_list_staff_id_cards",
    "admin_list_staff_id_cards_v2",
    "admin_set_staff_id_card_status",
    "admin_list_training_users",
    "admin_set_training_code",
    "get_my_training_materials"
  ];
  for (const name of protectedFunctions) {
    assert.match(migration, new RegExp("revoke all on function public\\." + name + "\\(", "i"), name + " PUBLIC/anon revoke");
    assert.match(migration, new RegExp("grant execute on function public\\." + name + "\\(", "i"), name + " authenticated grant");
  }
});
