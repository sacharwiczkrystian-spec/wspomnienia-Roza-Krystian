"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const handler = require("./registration-phone-verification");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function responseRecorder() {
  return {
    statusCode: 200, headers: {}, body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end(body) { this.body = body; return this; },
    json() { return JSON.parse(this.body); }
  };
}
function req(body) {
  return {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.10" },
    socket: { remoteAddress: "203.0.113.10" },
    body
  };
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.PHONE_OTP_PEPPER = "p".repeat(64);
  process.env.SZYBKISMS_API_TOKEN = "test-sms-token";
  process.env.SZYBKISMS_SENDER = "LoveStory";
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
});

test("send validates email and E.164 phone before network calls", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error("unexpected fetch"); };
  const res = responseRecorder();
  await handler(req({ action: "start", email: "bad-email", phone: "500100200" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls, 0);
});

test("send stores a hashed challenge and submits the OTP to SzybkiSMS", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/rpc/phone_registration_start")) {
      const args = JSON.parse(options.body);
      assert.equal(args.p_email, "test@example.com");
      assert.equal(args.p_phone_e164, "+48500100200");
      assert.match(args.p_code_hash, /^[a-f0-9]{64}$/);
      assert.notEqual(args.p_email_limit_key, "test@example.com");
      return jsonResponse({ status: "started" });
    }
    if (String(url) === "https://api.szybkisms.pl/rest/messages/sms") {
      assert.equal(options.headers.Authorization, "Bearer test-sms-token");
      const payload = JSON.parse(options.body);
      assert.equal(payload.recipients, "+48500100200");
      assert.match(payload.message, /LOVE Story/);
      assert.equal(payload.sender, "LoveStory");
      return jsonResponse([{ id: 123, status_code: "QUEUED" }]);
    }
    throw new Error("Unexpected URL: " + url);
  };
  const res = responseRecorder();
  await handler(req({ action: "start", email: " Test@Example.com ", phone: "+48 500 100 200" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, sent: true });
  assert.equal(calls.length, 2);
});

test("send refuses cooldown and does not call the SMS provider", async () => {
  let smsCalled = false;
  global.fetch = async (url) => {
    if (String(url).includes("/rpc/phone_registration_start")) return jsonResponse({ status: "cooldown", retry_after: 37 });
    smsCalled = true;
    return jsonResponse([]);
  };
  const res = responseRecorder();
  await handler(req({ action: "start", email: "test@example.com", phone: "+48500100200" }), res);
  assert.equal(res.statusCode, 429);
  assert.match(res.json().error, /37 s/);
  assert.equal(smsCalled, false);
});

test("verify accepts only the matching verified phone challenge", async () => {
  let args;
  global.fetch = async (url, options = {}) => {
    assert.match(String(url), /rpc\/phone_registration_verify$/);
    args = JSON.parse(options.body);
    return jsonResponse({ status: "verified", phone_e164: "+48500100200" });
  };
  const res = responseRecorder();
  await handler(req({ action: "verify", email: "TEST@example.com", phone: "+48500100200", code: "123456" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, verified: true });
  assert.match(args.p_code_hash, /^[a-f0-9]{64}$/);
});

test("verify rejects a challenge for a different phone", async () => {
  global.fetch = async () => jsonResponse({ status: "verified", phone_e164: "+48500999999" });
  const res = responseRecorder();
  await handler(req({ action: "verify", email: "test@example.com", phone: "+48500100200", code: "123456" }), res);
  assert.equal(res.statusCode, 400);
});

test("OTP secrets are not returned in API responses", async () => {
  global.fetch = async (url) => {
    if (String(url).includes("/rpc/phone_registration_start")) return jsonResponse({ status: "started" });
    return jsonResponse([{ id: 123, status_code: "QUEUED" }]);
  };
  const res = responseRecorder();
  await handler(req({ action: "start", email: "test@example.com", phone: "+48500100200" }), res);
  assert.equal(res.body.includes("test-sms-token"), false);
  assert.equal(res.body.includes("123456"), false);
});
