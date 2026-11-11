const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";

function serverKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function headers(key) {
  const value = String(key || "");
  const result = { apikey: value };
  if (!value.startsWith("sb_secret_")) result.Authorization = "Bearer " + value;
  return result;
}

async function isPhoneVerified(userId, key = serverKey()) {
  if (!key) {
    const error = new Error("Brak serwerowego klucza Supabase.");
    error.status = 503;
    throw error;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId || ""))) {
    return false;
  }
  const response = await fetch(
    SUPABASE_URL + "/rest/v1/verified_phone_numbers?user_id=eq." +
      encodeURIComponent(userId) + "&select=user_id&limit=1",
    { headers: headers(key), cache: "no-store" }
  );
  if (!response.ok) {
    const error = new Error("Nie udało się sprawdzić weryfikacji telefonu.");
    error.status = 503;
    throw error;
  }
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function requirePhoneVerified(userId, key = serverKey()) {
  return isPhoneVerified(userId, key);
}

module.exports = { isPhoneVerified, requirePhoneVerified, serverKey };
