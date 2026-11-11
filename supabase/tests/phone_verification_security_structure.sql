-- Read-only structural regression checks for the phone-verification migrations.
-- Run ONLY against a disposable local Supabase database after applying both
-- migrations. This script intentionally raises an exception when a security
-- invariant is missing. It does not create, update, or delete application data.

do $test$
declare
  v_bad text;
  v_fn regprocedure;
begin
  -- The OTP tables must have RLS enabled.
  if not coalesce((select c.relrowsecurity
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'phone_verification_challenges'), false) then
    raise exception 'FAIL: RLS is not enabled on phone_verification_challenges';
  end if;

  if not coalesce((select c.relrowsecurity
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'verified_phone_numbers'), false) then
    raise exception 'FAIL: RLS is not enabled on verified_phone_numbers';
  end if;

  if not coalesce((select c.relrowsecurity
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = 'phone_verification_rate_limits'), false) then
    raise exception 'FAIL: RLS is not enabled on phone_verification_rate_limits';
  end if;

  if to_regprocedure('private.is_phone_verified()') is null then
    raise exception 'FAIL: private.is_phone_verified() is missing';
  end if;

  -- The public approved-ad exception must be SELECT-only. A FOR ALL policy
  -- with status='approved' in USING can unintentionally permit DELETE.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_ads'
      and policyname = 'phone_verification_required'
      and cmd = 'ALL'
  ) then
    raise exception 'FAIL: company_ads verification policy is FOR ALL; split the SELECT exception from write/delete gates';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_ads'
      and cmd = 'SELECT'
      and qual ilike '%approved%'
  ) then
    raise exception 'FAIL: company_ads is missing the explicit approved-ad SELECT exception';
  end if;

  -- Storage must remain protected for all authenticated object operations.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'phone_verification_required'
      and cmd = 'ALL'
      and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'FAIL: storage.objects is missing its restrictive FOR ALL verification policy';
  end if;

  -- Protected SECURITY DEFINER RPCs must not be executable by anon or PUBLIC.
  foreach v_fn in array array[
    to_regprocedure('public.admin_create_staff_id_card(text,text,text,text,text,text,date)'),
    to_regprocedure('public.admin_list_staff_id_cards()'),
    to_regprocedure('public.admin_list_staff_id_cards_v2()'),
    to_regprocedure('public.admin_set_staff_id_card_status(uuid,text)'),
    to_regprocedure('public.admin_list_training_users()'),
    to_regprocedure('public.admin_set_training_code(uuid,text)'),
    to_regprocedure('public.get_my_training_materials(text)')
  ] loop
    if v_fn is null then
      raise exception 'FAIL: one of the expected protected RPC functions is missing';
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anon can execute protected RPC %', v_fn;
    end if;
  end loop;

  -- OTP mutation RPCs must be server-only.
  foreach v_fn in array array[
    to_regprocedure('public.phone_verification_start(uuid,text,text,timestamp with time zone,text,text,text)'),
    to_regprocedure('public.phone_verification_check(uuid,text)'),
    to_regprocedure('public.phone_verification_cancel(uuid,text)')
  ] loop
    if v_fn is null then
      raise exception 'FAIL: one of the expected OTP RPC functions is missing';
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: client role can execute server-only OTP RPC %', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'FAIL: service_role cannot execute OTP RPC %', v_fn;
    end if;
  end loop;

  raise notice 'PASS: structural phone-verification security checks';
end;
$test$;
