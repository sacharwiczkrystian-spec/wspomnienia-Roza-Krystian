-- Rejestracja LOVE Story: numer telefonu musi być potwierdzony przed utworzeniem konta.
-- Tabela jest zapisywana wyłącznie przez backend; hook Auth atomowo zużywa potwierdzenie.

create table if not exists public.phone_registration_challenges (
  email text primary key check (email = lower(email)),
  phone_e164 text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz not null default now(),
  verified_at timestamptz
);

create table if not exists public.phone_registration_rate_limits (
  scope_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.phone_registration_challenges enable row level security;
alter table public.phone_registration_rate_limits enable row level security;

revoke all on public.phone_registration_challenges from public, anon, authenticated;
revoke all on public.phone_registration_rate_limits from public, anon, authenticated;
grant all on public.phone_registration_challenges to service_role;
grant all on public.phone_registration_rate_limits to service_role;

-- Auth Hook potrzebuje wyłącznie odczytu i atomowego usunięcia potwierdzonego wyzwania.
grant usage on schema public to supabase_auth_admin;
grant select, delete on public.phone_registration_challenges to supabase_auth_admin;
create policy phone_registration_hook_select
  on public.phone_registration_challenges for select to supabase_auth_admin using (true);
create policy phone_registration_hook_delete
  on public.phone_registration_challenges for delete to supabase_auth_admin using (true);

create or replace function public.consume_phone_registration_rate_limit(
  p_scope_key text,
  p_limit integer
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.phone_registration_rate_limits(scope_key, window_started_at, request_count)
  values (p_scope_key, now(), 1)
  on conflict (scope_key) do update
    set window_started_at = case
          when public.phone_registration_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else public.phone_registration_rate_limits.window_started_at
        end,
        request_count = case
          when public.phone_registration_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else public.phone_registration_rate_limits.request_count + 1
        end
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;

create or replace function public.phone_registration_start(
  p_email text,
  p_phone_e164 text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_email_limit_key text,
  p_phone_limit_key text,
  p_ip_limit_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_sent_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('phone-registration:' || p_email, 0));

  select sent_at into v_sent_at
  from public.phone_registration_challenges
  where email = p_email
  for update;

  if v_sent_at is not null and v_sent_at > now() - interval '60 seconds' then
    return jsonb_build_object(
      'status', 'cooldown',
      'retry_after', greatest(1, ceil(extract(epoch from (v_sent_at + interval '60 seconds' - now())))::integer)
    );
  end if;

  if not public.consume_phone_registration_rate_limit(p_email_limit_key, 5)
     or not public.consume_phone_registration_rate_limit(p_phone_limit_key, 5)
     or not public.consume_phone_registration_rate_limit(p_ip_limit_key, 20) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.phone_registration_challenges(email, phone_e164, code_hash, expires_at, attempts, sent_at, verified_at)
  values (p_email, p_phone_e164, p_code_hash, p_expires_at, 0, now(), null)
  on conflict (email) do update set
    phone_e164 = excluded.phone_e164,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    sent_at = now(),
    verified_at = null;

  delete from public.phone_registration_rate_limits
  where window_started_at < now() - interval '1 day';

  return jsonb_build_object('status', 'started');
end;
$$;

create or replace function public.phone_registration_verify(
  p_email text,
  p_code_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_challenge public.phone_registration_challenges%rowtype;
  v_attempts integer;
begin
  select * into v_challenge
  from public.phone_registration_challenges
  where email = p_email
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_challenge.expires_at <= now() then
    delete from public.phone_registration_challenges where email = p_email;
    return jsonb_build_object('status', 'expired');
  end if;

  if v_challenge.attempts >= 5 then
    delete from public.phone_registration_challenges where email = p_email;
    return jsonb_build_object('status', 'locked');
  end if;

  if v_challenge.code_hash <> p_code_hash then
    v_attempts := v_challenge.attempts + 1;
    if v_attempts >= 5 then
      delete from public.phone_registration_challenges where email = p_email;
      return jsonb_build_object('status', 'locked');
    end if;
    update public.phone_registration_challenges set attempts = v_attempts where email = p_email;
    return jsonb_build_object('status', 'invalid', 'attempts_left', 5 - v_attempts);
  end if;

  update public.phone_registration_challenges
    set verified_at = coalesce(verified_at, now())
    where email = p_email;

  return jsonb_build_object('status', 'verified', 'phone_e164', v_challenge.phone_e164);
end;
$$;

create or replace function public.phone_registration_cancel(
  p_email text,
  p_code_hash text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.phone_registration_challenges
  where email = p_email and code_hash = p_code_hash;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.consume_phone_registration_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.phone_registration_start(text, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.phone_registration_verify(text, text) from public, anon, authenticated;
revoke all on function public.phone_registration_cancel(text, text) from public, anon, authenticated;
grant execute on function public.consume_phone_registration_rate_limit(text, integer) to service_role;
grant execute on function public.phone_registration_start(text, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.phone_registration_verify(text, text) to service_role;
grant execute on function public.phone_registration_cancel(text, text) to service_role;

-- Włącz tę funkcję jako Auth Hook: Authentication > Hooks > Before User Created.
-- Istniejące logowania nie wywołują tego hooka.
create or replace function public.hook_require_phone_registration_verification(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_phone text;
  v_consumed text;
begin
  v_email := lower(trim(event->'user'->>'email'));
  v_phone := event->'user'->'user_metadata'->>'signup_phone_e164';

  if coalesce(v_email, '') = '' or coalesce(v_phone, '') = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Przed utworzeniem konta potwierdź numer telefonu kodem SMS.'
    ));
  end if;

  delete from public.phone_registration_challenges
  where email = v_email
    and phone_e164 = v_phone
    and verified_at is not null
    and expires_at > now()
  returning email into v_consumed;

  if v_consumed is not null then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 400,
    'message', 'Potwierdzenie numeru wygasło lub nie istnieje. Wyślij i potwierdź nowy kod SMS.'
  ));
end;
$$;

revoke all on function public.hook_require_phone_registration_verification(jsonb) from public, anon, authenticated;
grant execute on function public.hook_require_phone_registration_verification(jsonb) to supabase_auth_admin;
