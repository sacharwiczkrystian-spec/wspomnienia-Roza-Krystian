-- Read-only verification after applying the MFA hardening candidate in staging.
do $$
declare
  fn text;
  sig regprocedure;
  expected text[] := array[
    'public.admin_create_staff_id_card(text,text,text,text,text,text,date)',
    'public.admin_list_staff_id_cards()',
    'public.admin_list_staff_id_cards_v2()',
    'public.admin_set_staff_id_card_status(uuid,text)',
    'public.admin_list_training_users()',
    'public.admin_set_training_code(uuid,text)',
    'public.get_my_training_materials(text)'
  ];
begin
  if to_regprocedure('private.require_aal2_for_enrolled_mfa()') is null then
    raise exception 'missing AAL2 helper';
  end if;

  foreach fn in array expected loop
    sig := to_regprocedure(fn);
    if sig is null then
      raise exception 'missing expected function: %', fn;
    end if;
    if position('private.require_aal2_for_enrolled_mfa' in pg_get_functiondef(sig)) = 0 then
      raise exception 'AAL2 guard missing from %', fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.admin_list_training_users()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_training_code(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_my_training_materials(text)', 'EXECUTE') then
    raise exception 'anonymous execution remains enabled on a protected training RPC';
  end if;
  -- Verify the private Storage policy is present and restrictive.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'mfa_require_aal2_when_factor_enrolled'
      and permissive = 'RESTRICTIVE'
      and cmd = 'ALL'
      and 'authenticated' = any(roles)
  ) then
    raise exception 'private Storage AAL2 policy is missing or not restrictive';
  end if;
end;$$;
