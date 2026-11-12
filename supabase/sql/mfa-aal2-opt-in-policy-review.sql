-- REVIEW ONLY: opt-in AAL2 enforcement for tables containing private or privileged data.
-- This file is intentionally not applied to production and is not a migration.
-- Supabase's documented pattern: users with a verified MFA factor require aal2;
-- users without a verified factor may continue at aal1.
-- Review every table and every SECURITY DEFINER RPC before applying.

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.admin_financial_documents;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.admin_financial_documents
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.admin_users;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.admin_users
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.admins;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.admins
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.company_ads;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.company_ads
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.contact_messages;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.contact_messages
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.couples;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.couples
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.creator_friend_settings;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.creator_friend_settings
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.creator_friends;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.creator_friends
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.creator_settings;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.creator_settings
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.creator_users;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.creator_users
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_chat_message_reads;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_chat_message_reads
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_chat_messages;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_chat_messages
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_chat_reactions;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_chat_reactions
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_chat_status;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_chat_status
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_contracts;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_contracts
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_files;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_files
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.employee_personnel_dossiers;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.employee_personnel_dossiers
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.firefighter_memories;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.firefighter_memories
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.friend_locations;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.friend_locations
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.friend_messages;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.friend_messages
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.friend_notifications;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.friend_notifications
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.friend_requests;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.friend_requests
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.memories;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.memories
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.memory_safety_alerts;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.memory_safety_alerts
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.organization_meetings;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.organization_meetings
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.partner_collaborator_accounts;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.partner_collaborator_accounts
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.partner_company_accounts;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.partner_company_accounts
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.partnership_agreements;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.partnership_agreements
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.premium_access_requests;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.premium_access_requests
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.premium_users;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.premium_users
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.profiles;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.profiles
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.recruitment_agreement_signatures;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.recruitment_agreement_signatures
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.recruitment_applications;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.recruitment_applications
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.relationship_settings;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.relationship_settings
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.security_events;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.security_events
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.staff_id_cards;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.staff_id_cards
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.staff_permissions;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.staff_permissions
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.training_access;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.training_access
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

drop policy if exists "mfa_require_aal2_when_factor_enrolled" on public.training_materials;
create policy "mfa_require_aal2_when_factor_enrolled"
  on public.training_materials
  as restrictive
  for all
  to authenticated
  using (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ))
  with check (array[(select auth.jwt()->>'aal')] <@ (
    select case
      when count(id) > 0 then array['aal2']
      else array['aal1', 'aal2']
    end
    from auth.mfa_factors
    where (select auth.uid()) = user_id
      and status = 'verified'
  ));

-- Important: restrictive RLS policies do not constrain SECURITY DEFINER functions that bypass RLS.
-- Audit/restrict privileged RPCs separately before considering production rollout.