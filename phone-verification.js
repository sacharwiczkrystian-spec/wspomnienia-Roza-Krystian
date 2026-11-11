(function () {
  "use strict";
  const endpoint = "/api/phone-verification";
  let activePhone = "";
  let activeSession = null;

  function request(session, body) {
    return fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify(body)
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Operacja weryfikacji nie powiodła się.");
      return data;
    });
  }

  function mount() {
    let root = document.getElementById("phoneVerificationGate");
    if (root) return root;
    root = document.createElement("div");
    root.id = "phoneVerificationGate";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:none;place-items:center;padding:18px;background:#100b0deF;color:#fff4e7;font:15px/1.5 system-ui,sans-serif";
    root.innerHTML = '<section style="width:min(440px,100%);padding:24px;border:1px solid #60404a;border-radius:18px;background:#21151a;box-shadow:0 20px 70px #0008"><h2 style="margin:0 0 8px;color:#f0d99c">Potwierdź numer telefonu</h2><p id="phoneGateIntro" style="color:#d0bdb9;font-size:13px">Weryfikacja jest wymagana przy pierwszym logowaniu i po zmianie numeru.</p><label for="phoneGateNumber" style="display:block;margin:14px 0 6px">Numer telefonu (format międzynarodowy)</label><input id="phoneGateNumber" inputmode="tel" autocomplete="tel" placeholder="+48500100200" style="width:100%;padding:12px;border:1px solid #77505a;border-radius:9px;background:#100b0d;color:#fff4e7"><button id="phoneGateSend" type="button" style="margin-top:12px;padding:11px 15px;border:0;border-radius:9px;background:#dfbd76;color:#21151a;font-weight:800">Wyślij kod SMS</button><div id="phoneGateCodeWrap" style="display:none"><label for="phoneGateCode" style="display:block;margin:14px 0 6px">Kod z SMS-a</label><input id="phoneGateCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="width:100%;padding:12px;border:1px solid #77505a;border-radius:9px;background:#100b0d;color:#fff4e7"><button id="phoneGateVerify" type="button" style="margin-top:12px;padding:11px 15px;border:0;border-radius:9px;background:#dfbd76;color:#21151a;font-weight:800">Potwierdź numer</button></div><p id="phoneGateStatus" role="status" aria-live="polite" style="min-height:24px;color:#f4d38a"></p><p style="color:#bfaeaa;font-size:11px">Kod jest jednorazowy, ważny 5 minut. Nie udostępniaj go nikomu.</p></section>';
    document.body.appendChild(root);
    root.querySelector("#phoneGateSend").addEventListener("click", async () => {
      const button = root.querySelector("#phoneGateSend");
      button.disabled = true;
      try {
        activePhone = root.querySelector("#phoneGateNumber").value.trim();
        const result = await request(activeSession, { action: "start", phone: activePhone });
        if (result.already_verified) { root.style.display = "none"; root.dispatchEvent(new CustomEvent("verified")); return; }
        root.querySelector("#phoneGateCodeWrap").style.display = "block";
        root.querySelector("#phoneGateStatus").textContent = "Wysłaliśmy kod SMS. Wpisz go poniżej.";
      } catch (error) { root.querySelector("#phoneGateStatus").textContent = error.message; }
      finally { button.disabled = false; }
    });
    root.querySelector("#phoneGateVerify").addEventListener("click", async () => {
      const button = root.querySelector("#phoneGateVerify");
      button.disabled = true;
      try {
        const code = root.querySelector("#phoneGateCode").value.trim();
        await request(activeSession, { action: "verify", phone: activePhone, code });
        root.querySelector("#phoneGateStatus").textContent = "Numer telefonu został potwierdzony.";
        root.style.display = "none";
        root.dispatchEvent(new CustomEvent("verified"));
      } catch (error) { root.querySelector("#phoneGateStatus").textContent = error.message; }
      finally { button.disabled = false; }
    });
    return root;
  }

  async function ensurePhoneVerified(session) {
    if (!session?.access_token) return false;
    const status = await request(session, { action: "status" });
    if (status.verified) return true;
    activeSession = session;
    const root = mount();
    root.style.display = "grid";
    root.querySelector("#phoneGateNumber").value = "";
    root.querySelector("#phoneGateCode").value = "";
    root.querySelector("#phoneGateCodeWrap").style.display = "none";
    root.querySelector("#phoneGateStatus").textContent = "";
    return new Promise(resolve => {
      const done = () => { root.removeEventListener("verified", done); resolve(true); };
      root.addEventListener("verified", done, { once: true });
    });
  }

  window.LoveStoryPhoneVerification = { ensurePhoneVerified };
})();