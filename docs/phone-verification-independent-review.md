# Niezależny przegląd bezpieczeństwa weryfikacji telefonu

## Status korekt — 2026-11-11

Ten dokument pierwotnie opisywał problemy wykryte przed poprawkami w migracji. Stan na gałęzi `feature/infobip-offline-hardening`:

- **P1 — `company_ads`: poprawione w migracji** `20261111220000_phone_verification_enforcement.sql`. Wyjątek zatwierdzonych reklam jest wyłącznie dla SELECT; INSERT, UPDATE i DELETE mają osobne restrykcyjne bramki weryfikacji.
- **P1 — administracyjne RPC: poprawione w migracji**. Siedem wymienionych funkcji ma jawne `REVOKE ALL ... FROM PUBLIC, anon` i `GRANT EXECUTE ... TO authenticated`.
- **P2 — niejednoznaczny wynik wysyłki SMS: częściowo zabezpieczone w follow-upie**. Po błędzie sieciowym endpoint nie anuluje już challenge, ponieważ dostawca mógł przyjąć SMS przed utratą odpowiedzi. Użytkownik może więc nadal użyć dostarczonego kodu; cooldown ogranicza natychmiastowe ponowne wysłanie. To nie zastępuje testu rzeczywistego zachowania dostawcy.
- **P2 — wiarygodność adresu IP: nadal otwarte**. Trzeba potwierdzić zachowanie `x-forwarded-for` na docelowej platformie przed wdrożeniem.
- **P2 — trzy tabele RLS bez polityk i ochrona przed hasłami ujawnionymi: nadal wymagają osobnej oceny**. Nie dodano szerokich polityk ani nie zmieniono ustawień Auth bez analizy wpływu na istniejące przepływy.

Follow-up dodaje mockowane testy endpointu i statyczne asercje migracji. Wynik CI oraz rzeczywiste testy PostgreSQL/RLS/Storage pozostają wymagane przed scaleniem.

---

Data przeglądu: 2026-11-11  
Zakres: gałąź `feature/infobip-phone-verification`, PR #1, dwie migracje SQL, endpoint `api/phone-verification.js`, helper serwerowy i skrypt przeglądarkowy.

## Werdykt

**NIE MERGOWAĆ I NIE WDRAŻAĆ.** W przeglądzie statycznym znaleziono problemy wymagające korekty. Nie wykonano migracji na lokalnym PostgreSQL, testów RLS/Storage ani testów przeglądarkowych. Nie należy traktować tego dokumentu jako potwierdzenia bezpieczeństwa produkcyjnego.

## Ustalenia wymagające działania

### P1 — polityka `company_ads` łączy wyjątek odczytu z operacjami zapisu

W migracji `20261111220000_phone_verification_enforcement.sql` polityka restrykcyjna jest zdefiniowana jako `FOR ALL` z warunkiem:

- `USING (is_phone_verified() OR status = 'approved')`
- `WITH CHECK (is_phone_verified())`

Warunek `USING` ma zastosowanie również do `DELETE`. Dla niezweryfikowanego użytkownika zatwierdzony wiersz spełnia `status = 'approved'`. Jeżeli istniejąca polityka permissive pozwala mu usuwać taki wiersz (np. własną reklamę), restrykcyjna polityka go nie zatrzyma. To przeczy komentarzowi, że wszystkie operacje konta wymagają weryfikacji.

**Zalecana korekta:** rozdzielić polityki restrykcyjne według komend. Wyjątek zatwierdzonych reklam pozostawić wyłącznie dla `SELECT`; dla `INSERT`, `UPDATE` i `DELETE` wymagać `private.is_phone_verified()`. Przed zmianą sprawdzić wszystkie istniejące polityki permissive na `company_ads`.

### P1 — uprawnienia EXECUTE funkcji SECURITY DEFINER

Migracja zastępuje część funkcji przez `CREATE OR REPLACE FUNCTION`, ale nie odbiera jawnie roli `anon` uprawnień do ich wywoływania. Kontrola `auth.uid()` w ciele funkcji jest ważna, lecz nie zastępuje zasady najmniejszych uprawnień.

**Zalecana korekta:** dla administracyjnych funkcji RPC jawnie wykonać `REVOKE ALL ... FROM PUBLIC, anon`, a następnie przyznać `EXECUTE` wyłącznie `authenticated` (oraz role serwerowe, jeśli rzeczywiście potrzebne). Funkcje celowo publiczne, takie jak ograniczony lookup statusu rekrutacji i weryfikacja publicznej karty, ocenić osobno i pozostawić publiczne tylko po potwierdzeniu minimalnego zakresu zwracanych danych.

Funkcje do jawnego sprawdzenia:
- `admin_create_staff_id_card(...)`
- `admin_list_staff_id_cards()`
- `admin_list_staff_id_cards_v2()`
- `admin_set_staff_id_card_status(...)`
- `admin_list_training_users()`
- `admin_set_training_code(...)`
- `get_my_training_materials(...)`

### P2 — tabele RLS bez polityk

Odczytany, tylko informacyjny wynik Supabase Security Advisor zgłosił trzy tabele z włączonym RLS i bez polityk:
- `public.kv_store_d14e403a`
- `public.partner_company_subscriptions`
- `public.service_collaboration_accounts`

Brak polityk oznacza domyślną odmowę dostępu dla ról objętych RLS. Może to być celowe, jeśli dostęp jest wyłącznie serwerowy, ale trzeba potwierdzić, że logowanie modułu współpracy i inne procesy nie próbują czytać tych tabel przed weryfikacją telefonu. Nie dodawać automatycznie szerokich polityk tylko po to, by usunąć ostrzeżenie.

### P2 — adres IP używany do limitowania

Endpoint bierze pierwszą wartość z `x-forwarded-for` jako identyfikator IP. Przed wdrożeniem trzeba potwierdzić zachowanie nagłówka na docelowym hostingu i to, czy klient nie może samodzielnie narzucić wartości używanej przez limit. Jeśli nagłówek nie jest wiarygodnie ustawiany przez platformę, limit IP może być obchodzony. Nie logować pełnych numerów ani kodów OTP.

### P2 — timeout wysyłki SMS i anulowanie challenge

Jeżeli dostawca przyjmie SMS, ale odpowiedź zaginie lub połączenie przekroczy timeout, endpoint może anulować challenge, mimo że SMS dotarł do odbiorcy. To powoduje dostarczenie kodu, który już nie działa. Warto rozważyć status wysyłki/ponowienie idempotentne lub inny model obsługi niejednoznacznego wyniku dostawcy. Nie wysyłać prawdziwych SMS-ów podczas testów migracji.

## Wyniki tylko informacyjnego odczytu Supabase

Security Advisor zwrócił także ostrzeżenie o wyłączonej ochronie przed hasłami ujawnionymi w wyciekach. To ustawienie Auth nie jest skutkiem tej gałęzi, ale warto omówić jego włączenie z opiekunem i sprawdzić wpływ na istniejące logowanie.

Advisor wskazał również funkcje SECURITY DEFINER dostępne dla `anon` i `authenticated`. To odczyt bieżącego stanu projektu, a nie dowód, że migracje z PR zostały zastosowane. Publiczne funkcje należy rozpatrywać osobno od funkcji administracyjnych.

## Plan testów do wykonania w lokalnym Supabase

Testy muszą odbyć się na lokalnej bazie z fikcyjnymi kontami i danymi. Nie używać produkcyjnego connection stringa, `supabase link`, `--remote`, prawdziwych danych ani aktywnego dostawcy SMS.

1. Uruchomić obie migracje w podanej kolejności i potwierdzić brak błędów SQL.
2. Utworzyć fikcyjne konto zweryfikowane, niezweryfikowane i konto administratora.
3. Dla `company_ads` sprawdzić osobno SELECT, INSERT, UPDATE i DELETE: niezweryfikowany użytkownik może odczytać zatwierdzone publiczne reklamy, ale nie może wykonywać operacji konta; zweryfikowany użytkownik zachowuje wyłącznie uprawnienia wynikające z istniejących polityk.
4. Dla każdej funkcji SECURITY DEFINER sprawdzić `has_function_privilege` dla `anon`, `authenticated` i `service_role`; bezpośrednio wywołać funkcje jako role anon i authenticated z fikcyjnymi JWT.
5. Sprawdzić, czy niezweryfikowane konto nie może czytać, przesyłać, zastępować ani usuwać obiektów Storage; zweryfikowane konto ma tylko dotychczasowe uprawnienia.
6. Zweryfikować wyjątki publiczne: zatwierdzone reklamy, publiczny odczyt ustawień, publiczne zgłoszenia rekrutacyjne i wąskie funkcje publicznego sprawdzania statusu.
7. Przetestować tabelę `service_collaboration_accounts` i pełny proces drugiego hasła przed OTP.
8. Testy OTP: poprawny kod, błędny kod, 5 prób, wygaśnięcie, ponowne użycie, cooldown 60 s, równoległe starty, limit numeru/użytkownika/IP, zmiana numeru i kolizja numerów.
9. Testy przeglądarkowe: świeże logowanie, przywrócona sesja, passkey, wylogowanie, anulowanie zmiany numeru i wszystkie panele ról.
10. Uruchomić Supabase Security Advisor po korektach i porównać wynik z bazowym stanem projektu.

## Granice wykonanej pracy

- Przeglądano pliki i metadane; nie zmieniano bazy.
- Odczytano Security Advisor i strukturę tabel; nie pobierano treści prywatnych rekordów.
- Nie wykonano migracji, SQL runtime, RLS, Storage ani E2E.
- Nie wysłano SMS i nie weryfikowano rzeczywistego klucza Infobip.
- Nie zmieniano sekretów Vercel, nie scalano PR i nie wdrażano produkcji.

