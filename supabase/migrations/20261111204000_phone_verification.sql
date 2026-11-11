-- LOVE Story: wspólna weryfikacja numeru telefonu przez Infobip.
-- Tabele są dostępne wyłącznie dla service_role; żaden klient przeglądarkowy nie czyta OTP.

create table if not exists public.phone_verification_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz not null default now()
);

create table if not exists public.verified_phone_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null unique,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_verification_rate_limits (
  scope_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.phone_verification_challenges enable row level security;
alter table public.verified_phone_numbers enable row level security;
alter table public.phone_verification_rate_limits enable row level security;

revoke all on public.phone_verification_challenges from anon, authenticated;
revoke all on public.verified_phone_numbers from anon, authenticated;
revoke all on public.phone_verification_rate_limits from anon, authenticated;
grant all on public.phone_verification_challenges to service_role;
grant all on public.verified_phone_numbers to service_role;
grant all on public.phone_verification_rate_limits to service_role;

create or replace function public.consume_phone_rate_limit(p_scope_key text, p_limit integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.phone_verification_rate_limits(scope_key, window_started_at, request_count)
  values (p_scope_key, now(), 1)
  on conflict (scope_key) do update
    set window_started_at = case
          when public.phone_verification_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else public.phone_verification_rate_limits.window_started_at
        end,
        request_count = case
          when public.phone_verification_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else public.phone_verification_rate_limits.request_count + 1
        end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

create or replace function public.phone_verification_start(
  p_user_id uuid,
  p_phone_e164 text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_user_limit_key text,
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
  -- A missing challenge row cannot be locked with SELECT ... FOR UPDATE.
  -- Serialize all starts for this user before checking cooldown or inserting,
  -- so simultaneous requests cannot both pass the 60-second cooldown.
  perform pg_advisory_xact_lock(
    hashtextextended('phone-verification-user:' || p_user_id::text, 0)
  );

  if exists (
    select 1 from public.verified_phone_numbers
    where user_id = p_user_id and phone_e164 = p_phone_e164
  ) then
    return jsonb_build_object('status', 'already_verified');
  end if;

  if exists (
    select 1 from public.verified_phone_numbers
    where phone_e164 = p_phone_e164 and user_id <> p_user_id
  ) then
    return jsonb_build_object('status', 'number_unavailable');
  end if;

  select sent_at into v_sent_at
  from public.phone_verification_challenges
  where user_id = p_user_id
  for update;

  if v_sent_at is not null and v_sent_at > now() - interval '60 seconds' then
    return jsonb_build_object(
      'status', 'cooldown',
      'retry_after', greatest(1, ceil(extract(epoch from (v_sent_at + interval '60 seconds' - now())))::integer)
    );
  end if;

  if not public.consume_phone_rate_limit(p_user_limit_key, 5)
     or not public.consume_phone_rate_limit(p_phone_limit_key, 5)
     or not public.consume_phone_rate_limit(p_ip_limit_key, 20) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.phone_verification_challenges(user_id, phone_e164, code_hash, expires_at, attempts, sent_at)
  values (p_user_id, p_phone_e164, p_code_hash, p_expires_at, 0, now())
  on conflict (user_id) do update set
    phone_e164 = excluded.phone_e164,
    code_hash = excluded.code_hash,
    expires_at = excluded.expires_at,
    attempts = 0,
    sent_at = now();

  delete from public.phone_verification_rate_limits
  where window_started_at < now() - interval '1 day';

  return jsonb_build_object('status', 'started');
end;
$$;

create or replace function public.phone_verification_check(p_user_id uuid, p_code_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_challenge public.phone_verification_challenges%rowtype;
  v_phone text;
  v_attempts integer;
begin
  select * into v_challenge
  from public.phone_verification_challenges
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_challenge.expires_at <= now() then
    delete from public.phone_verification_challenges where user_id = p_user_id;
    return jsonb_build_object('status', 'expired');
  end if;

  if v_challenge.attempts >= 5 then
    delete from public.phone_verification_challenges where user_id = p_user_id;
    return jsonb_build_object('status', 'locked');
  end if;

  if v_challenge.code_hash <> p_code_hash then
    v_attempts := v_challenge.attempts + 1;
    if v_attempts >= 5 then
      delete from public.phone_verification_challenges where user_id = p_user_id;
      return jsonb_build_object('status', 'locked');
    end if;
    update public.phone_verification_challenges
      set attempts = v_attempts
      where user_id = p_user_id;
    return jsonb_build_object('status', 'invalid', 'attempts_left', 5 - v_attempts);
  end if;

  v_phone := v_challenge.phone_e164;

  begin
    insert into public.verified_phone_numbers(user_id, phone_e164, verified_at, updated_at)
    values (p_user_id, v_phone, now(), now())
    on conflict (user_id) do update set
      phone_e164 = excluded.phone_e164,
      verified_at = now(),
      updated_at = now();
  exception when unique_violation then
    delete from public.phone_verification_challenges where user_id = p_user_id;
    return jsonb_build_object('status', 'number_unavailable');
  end;

  delete from public.phone_verification_challenges where user_id = p_user_id;
  return jsonb_build_object('status', 'verified');
end;
$$;

create or replace function public.phone_verification_cancel(p_user_id uuid, p_code_hash text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.phone_verification_challenges
  where user_id = p_user_id and code_hash = p_code_hash;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.consume_phone_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.phone_verification_start(uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.phone_verification_check(uuid, text) from public, anon, authenticated;
revoke all on function public.phone_verification_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_phone_rate_limit(text, integer) to service_role;
grant execute on function public.phone_verification_start(uuid, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.phone_verification_check(uuid, text) to service_role;
grant execute on function public.phone_verification_cancel(uuid, text) to service_role;


-- Central RLS gate: authenticated users may access protected public tables and
-- Storage objects only after their phone has been verified. The function reads
-- the verified-number table as its owner but is scoped strictly to auth.uid().
create schema if not exists private;

create or replace function private.phone_verification_is_complete()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.verified_phone_numbers v
      where v.user_id = (select auth.uid())
    );
$function$;

grant usage on schema private to authenticated;
revoke all on function private.phone_verification_is_complete() from public, anon;
grant execute on function private.phone_verification_is_complete() to authenticated;

do $phone_gate$
declare
  v_table record;
begin
  for v_table in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
  loop
    execute format(
      'drop policy if exists phone_verification_required on %I.%I',
      v_table.nspname, v_table.relname
    );
    execute format(
      'create policy phone_verification_required on %I.%I as restrictive for all to authenticated using ((select private.phone_verification_is_complete())) with check ((select private.phone_verification_is_complete()))',
      v_table.nspname, v_table.relname
    );
  end loop;

  if to_regclass('storage.objects') is not null
     and exists (
       select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
     ) then
    execute 'drop policy if exists phone_verification_required on storage.objects';
    execute 'create policy phone_verification_required on storage.objects as restrictive for all to authenticated using (private.phone_verification_is_complete()) with check (private.phone_verification_is_complete())';
  end if;
end;
$phone_gate$;
