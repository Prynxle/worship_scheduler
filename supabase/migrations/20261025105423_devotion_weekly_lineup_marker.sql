-- Devotion is selected from the members already assigned to the week's lineup.
-- The marker shares that member's single assignment row, so their ministry role,
-- instrument, qualification, and assignment count remain intact.
DO $migration$
DECLARE
  v_oid REGPROCEDURE;
  v_definition TEXT;
  v_role_check TEXT := $old$
      OR (NOT COALESCE((item->>'is_devotion')::boolean, FALSE) AND NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id))$old$;
  v_role_check_new TEXT := $new$
      OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)$new$;
  v_backup_check TEXT := $old$
    AND NOT COALESCE((item->>'is_devotion')::boolean, FALSE) AND NULLIF(item->>'instrument_id', '')::uuid IS NULL$old$;
  v_backup_check_new TEXT := $new$
    AND (NOT COALESCE((item->>'is_devotion')::boolean, FALSE) OR EXISTS (
      SELECT 1 FROM public.member_roles mr WHERE mr.member_id = (item->>'member_id')::uuid AND mr.role_id = r.id
    )) AND NULLIF(item->>'instrument_id', '')::uuid IS NULL$new$;
BEGIN
  v_oid := 'public.replace_service_assignments(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  IF pg_catalog.strpos(v_definition, v_role_check) = 0 OR pg_catalog.strpos(v_definition, v_backup_check) = 0 THEN
    RAISE EXCEPTION 'Devotion marker migration aborted: replace_service_assignments differs from the reviewed baseline';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_role_check, v_role_check_new);
  v_definition := pg_catalog.replace(v_definition, v_backup_check, v_backup_check_new);
  EXECUTE v_definition;

  v_oid := 'public.assert_service_meets_publication_rules(uuid,uuid)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  v_backup_check := $old$
  WHERE a.service_id = p_service_id AND NOT a.is_leader AND NOT a.is_devotion AND a.instrument_id IS NULL$old$;
  v_backup_check_new := $new$
  WHERE a.service_id = p_service_id AND NOT a.is_leader AND a.instrument_id IS NULL
    AND (NOT a.is_devotion OR EXISTS (
      SELECT 1 FROM public.member_roles mr WHERE mr.member_id = a.member_id AND mr.role_id = r.id
    ))$new$;
  IF pg_catalog.strpos(v_definition, v_backup_check) = 0 THEN
    RAISE EXCEPTION 'Devotion marker migration aborted: publication assertion differs from the reviewed baseline';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_backup_check, v_backup_check_new);
  EXECUTE v_definition;
END;
$migration$;
