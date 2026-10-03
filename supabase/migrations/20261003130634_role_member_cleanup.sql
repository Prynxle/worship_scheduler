-- Consolidate the live roster to the approved ministry roles while preserving
-- schedule history. Devotion is an assignment kind, not a member qualification.

ALTER TABLE public.schedule_assignments
  ADD COLUMN is_devotion BOOLEAN NOT NULL DEFAULT FALSE;

DO $cleanup$
DECLARE
  c_church CONSTANT UUID := 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_lebron CONSTANT UUID := '862d6928-e2fa-4762-819a-6768463f841d';
  c_system_actor CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
  v_count INTEGER;
  v_rows INTEGER;
  v_definition TEXT;
  v_oid REGPROCEDURE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('johia:role-member-cleanup:20261003130634', 0));

  -- Lebron is the exact inactive roster row found during the preflight. Do not
  -- let changed account/assignment state turn this into a wider cascade.
  SELECT count(*) INTO v_count
  FROM public.members
  WHERE id = c_lebron AND church_id = c_church AND full_name = 'Lebron James'
    AND login_name = 'lebron' AND status = 'inactive' AND user_id IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Lebron delete precondition failed: expected the one inspected inactive member row, found %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_assignments WHERE member_id = c_lebron)
     OR EXISTS (SELECT 1 FROM public.member_skills WHERE member_id = c_lebron OR fallback_member_id = c_lebron)
     OR EXISTS (SELECT 1 FROM public.availability WHERE member_id = c_lebron)
     OR EXISTS (SELECT 1 FROM public.availability_submissions WHERE member_id = c_lebron)
     OR EXISTS (SELECT 1 FROM public.devotion_rotation WHERE member_id = c_lebron) THEN
    RAISE EXCEPTION 'Lebron delete aborted: related records changed since preflight; refusing to cascade them';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.member_roles mr JOIN public.roles r ON r.id = mr.role_id
  WHERE mr.member_id = c_lebron AND r.name = 'Vocalist';
  IF v_count <> 1 OR (SELECT count(*) FROM public.member_roles WHERE member_id = c_lebron) <> 1 THEN
    RAISE EXCEPTION 'Lebron delete precondition failed: expected exactly one Vocalist qualification, found %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = c_system_actor) THEN
    RAISE EXCEPTION 'Lebron delete aborted: System Migration User is missing; deletion audit cannot be attributed';
  END IF;

  DELETE FROM public.members WHERE id = c_lebron AND church_id = c_church;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Lebron delete failed: expected one member deletion, got %', v_rows;
  END IF;
  IF EXISTS (SELECT 1 FROM public.members WHERE id = c_lebron)
     OR EXISTS (SELECT 1 FROM public.member_roles WHERE member_id = c_lebron)
     OR NOT EXISTS (
       SELECT 1 FROM public.audit_logs
       WHERE entity_id = c_lebron AND entity_type = 'members' AND action = 'members_deleted'
         AND old_value->>'full_name' = 'Lebron James'
     ) THEN
    RAISE EXCEPTION 'Lebron delete postcondition failed or the deletion audit record is missing';
  END IF;

  -- Rename in place so the 24 existing historical Backup assignments retain
  -- their role FK and service rows. Abort if the target spelling already exists.
  IF EXISTS (SELECT 1 FROM public.roles WHERE name = 'Back Up') THEN
    RAISE EXCEPTION 'Role cleanup aborted: Back Up already exists; merge policy must be reviewed first';
  END IF;
  UPDATE public.roles SET name = 'Back Up' WHERE name = 'Backup';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Role cleanup precondition failed: expected one Backup role, renamed %', v_rows;
  END IF;

  -- No assignment or member qualification may be cascade-deleted by role cleanup.
  SELECT count(*) INTO v_count
  FROM public.roles r
  WHERE r.name NOT IN ('Back Up', 'Instrumentalist', 'Sound Engineer', 'Worship Leader')
    AND (
      EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.role_id = r.id)
      OR EXISTS (SELECT 1 FROM public.schedule_assignments sa WHERE sa.role_id = r.id)
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Role cleanup aborted: % obsolete roles still have qualifications or schedule assignments', v_count;
  END IF;

  DELETE FROM public.roles
  WHERE name NOT IN ('Back Up', 'Instrumentalist', 'Sound Engineer', 'Worship Leader');

  IF (SELECT count(DISTINCT name) FROM public.roles) <> 4
     OR EXISTS (
       SELECT 1 FROM public.roles
       WHERE name NOT IN ('Back Up', 'Instrumentalist', 'Sound Engineer', 'Worship Leader')
     ) THEN
    RAISE EXCEPTION 'Role cleanup postcondition failed: roles table does not contain exactly the four approved names';
  END IF;

  -- All active database predicates that count backup slots must accept the new
  -- exact spelling. Update installed routine definitions without replacing their
  -- authorization, tenant, availability, or schedule-version safeguards.
  FOR v_oid IN
    SELECT p.oid::regprocedure
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%(vocal|singer|backup)%'
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
    v_definition := replace(v_definition, '(vocal|singer|backup)', '(vocal|singer|backup|back up)');
    EXECUTE v_definition;
  END LOOP;

  -- Mark devotion rows independently of their generic persisted role. The role
  -- FK remains useful for ministry scoping; the marker makes devotion universal
  -- and prevents it from counting as a backup.
  v_oid := 'public.persist_month_schedule(uuid,uuid,integer,integer,uuid,jsonb,boolean)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  IF position('is_leader, status, assigned_by)' IN v_definition) = 0
     OR position($needle$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id)$needle$ IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Role cleanup aborted: installed persist_month_schedule definition differs from the reviewed migration baseline';
  END IF;
  v_definition := replace(v_definition,
    'is_leader, status, assigned_by)', 'is_leader, is_devotion, status, assigned_by)');
  v_definition := replace(v_definition,
    $needle$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id)$needle$,
    $replacement$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), COALESCE((v_assignment->>'is_devotion')::boolean, FALSE), 'pending', p_actor_id)$replacement$);
  EXECUTE v_definition;

  v_oid := 'public.replace_service_assignments(uuid,uuid,uuid,integer,jsonb,text,jsonb,jsonb)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  IF position('is_leader, status, assigned_by)' IN v_definition) = 0
     OR position($needle$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id)$needle$ IN v_definition) = 0
     OR strpos(v_definition, 'OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)') = 0 THEN
    RAISE EXCEPTION 'Role cleanup aborted: installed replace_service_assignments definition differs from the reviewed migration baseline';
  END IF;
  v_definition := replace(v_definition,
    'is_leader, status, assigned_by)', 'is_leader, is_devotion, status, assigned_by)');
  v_definition := replace(v_definition,
    $needle$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id)$needle$,
    $replacement$COALESCE((v_assignment->>'is_leader')::boolean, FALSE), COALESCE((v_assignment->>'is_devotion')::boolean, FALSE), 'pending', p_actor_id)$replacement$);
  v_definition := replace(v_definition,
    'OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)',
    'OR (NOT COALESCE((item->>''is_devotion'')::boolean, FALSE) AND NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id))');
  v_definition := replace(v_definition,
    'AND NULLIF(item->>''instrument_id'', '''')::uuid IS NULL',
    'AND NOT COALESCE((item->>''is_devotion'')::boolean, FALSE) AND NULLIF(item->>''instrument_id'', '''')::uuid IS NULL');
  EXECUTE v_definition;

  v_oid := 'public.assert_service_meets_publication_rules(uuid,uuid)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  IF strpos(v_definition, 'WHERE a.service_id = p_service_id AND NOT a.is_leader') = 0 THEN
    RAISE EXCEPTION 'Role cleanup aborted: installed publication rule definition differs from the reviewed migration baseline';
  END IF;
  v_definition := replace(v_definition,
    'WHERE a.service_id = p_service_id AND NOT a.is_leader',
    'WHERE a.service_id = p_service_id AND NOT a.is_leader AND NOT a.is_devotion');
  EXECUTE v_definition;

  v_oid := 'public.create_service_revision(uuid,uuid,uuid,integer)'::regprocedure;
  v_definition := pg_catalog.pg_get_functiondef(v_oid::oid);
  IF strpos(v_definition, 'is_leader, status, assigned_by)') = 0
     OR strpos(v_definition, 'SELECT v_revision_id, member_id, role_id, instrument_id, is_leader, status, p_actor_id') = 0 THEN
    RAISE EXCEPTION 'Role cleanup aborted: installed create_service_revision definition differs from the reviewed migration baseline';
  END IF;
  v_definition := replace(v_definition,
    'is_leader, status, assigned_by)', 'is_leader, is_devotion, status, assigned_by)');
  v_definition := replace(v_definition,
    'SELECT v_revision_id, member_id, role_id, instrument_id, is_leader, status, p_actor_id',
    'SELECT v_revision_id, member_id, role_id, instrument_id, is_leader, is_devotion, status, p_actor_id');
  EXECUTE v_definition;
END;
$cleanup$;
