"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyStandardWebhook, buildSmsPayload } = require("./supabase-send-sms");
const secretBytes = crypto.randomBytes(32);
const secret = "v1,whsec_" + secretBytes.toString("base64");
const now = 1800000000;
function signed(rawBody, timestamp = String(now)) {
  const id = "msg_test_123";
  const signature = crypto.createHmac("sha256", secretBytes)
    .update(id + "." + timestamp + "." + rawBody).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": "v1," + signature };
}
test("accepts a correctly signed, recent webhook", () => {
  const body = JSON.stringify({ user: { phone: "+48500100200" }, sms: { otp: "123456" } });
  assert.equal(verifyStandardWebhook(body, signed(body), secret, now), true);
});
test("rejects a modified body", () => {
  const body = '{"sms":{"otp":"123456"}}';
  assert.equal(verifyStandardWebhook(body + " ", signed(body), secret, now), false);
});
test("rejects an expired timestamp", () => {
  const body = "{}";
  assert.equal(verifyStandardWebhook(body, signed(body, String(now - 301)), secret, now), false);
});
test("rejects an invalid secret", () => {
  assert.equal(verifyStandardWebhook("{}", signed("{}"), "wrong", now), false);
});
test("builds the expected SzybkiSMS payload", () => {
  assert.deepEqual(buildSmsPayload("+48500100200", "123456", "LOVEStory"), {
    recipients: "+48500100200",
    message: "Twój kod logowania LOVE Story: 123456. Nie udostępniaj go nikomu.",
    type: 1, unicode: true, sender: "LOVEStory"
  });
});
