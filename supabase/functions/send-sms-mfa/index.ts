import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const hookSecret = Deno.env.get("SUPABASE_SEND_SMS_HOOK_SECRET") ?? "";
  const apiToken = Deno.env.get("SZYBKISMS_API_TOKEN") ?? "";
  const sender = Deno.env.get("SZYBKISMS_SENDER") ?? "";
  if (!hookSecret || !apiToken) {
    console.error("SMS hook secrets are not configured");
    return json({ error: "SMS provider is not configured" }, 503);
  }

  let payload: string;
  try {
    payload = await req.text();
    if (payload.length > 64 * 1024) return json({ error: "Payload too large" }, 413);
  } catch {
    return json({ error: "Could not read request" }, 400);
  }

  let event: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    const headers = Object.fromEntries(req.headers.entries());
    const secrets = hookSecret.split("|").map((value) => value.trim()).filter(Boolean);
    let verified: unknown = null;
    for (const secret of secrets) {
      if (!secret.startsWith("v1,whsec_")) continue;
      try {
        const verifier = new Webhook(secret.slice("v1,whsec_".length));
        verified = verifier.verify(payload, headers);
        break;
      } catch {
        // Try the next active secret during key rotation.
      }
    }
    if (!verified) return json({ error: "Invalid webhook signature" }, 401);
    event = verified as typeof event;
  } catch {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  const phone = String(event?.user?.phone ?? "");
  const otp = String(event?.sms?.otp ?? "");
  if (!/^\\+[1-9]\\d{7,14}$/.test(phone) || !/^\\d{6}$/.test(otp)) {
    return json({ error: "Invalid SMS event payload" }, 400);
  }

  try {
    const smsPayload: Record<string, unknown> = {
      recipients: phone,
      message: `Twój kod logowania LOVE Story: ${otp}. Nie udostępniaj go nikomu.`,
      type: 1,
      unicode: true,
    };
    if (sender) smsPayload.sender = sender;

    const response = await fetch("https://api.szybkisms.pl/rest/messages/sms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(smsPayload),
      signal: AbortSignal.timeout(10_000),
    });

    let result: unknown = null;
    if (response.ok) {
      try { result = await response.json(); } catch { /* handled as rejected */ }
    }
    const messages = Array.isArray(result)
      ? result
      : (result && typeof result === "object" && Array.isArray((result as { messages?: unknown[] }).messages)
        ? (result as { messages: unknown[] }).messages
        : []);
    const accepted = response.ok && messages.length > 0 &&
      messages.every((item) => !!item && typeof item === "object" &&
        (item as { status_code?: string }).status_code === "QUEUED");

    if (!accepted) {
      console.error("SzybkiSMS rejected MFA SMS", { status: response.status });
      return json({ error: "SMS provider rejected the message" }, 502);
    }
    return json({});
  } catch (error) {
    console.error("SzybkiSMS request failed", { name: error instanceof Error ? error.name : "Error" });
    return json({ error: "SMS provider request failed" }, 502);
  }
});
