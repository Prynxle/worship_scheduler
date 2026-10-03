-- Collapse four guitar catalogue rows into one count-driven `Guitar`, and
-- re-point the month at it without touching a single published fact.
--
-- THE PRODUCT CHANGE. The ministry catalogue carried four guitar rows that were
-- never four positions:
--
--   Guitar 1        min 1 / max 1  required   3 skills   7 assignments  SURVIVOR
--   Guitar 2        min 0 / max 1  optional   5 skills   0 assignments  doomed
--   Electric Guitar min 1 / max 2  required   0 skills   0 assignments  doomed
--   Acoustic Guitar min 0 / max 1  optional   0 skills   0 assignments  doomed
--
-- The engine keyed assignment slots on the instrument id, so `Guitar 2` and
-- `Acoustic Guitar` -- both `is_required = false` -- were never emitted at all,
-- and `Electric Guitar` was emitted as a *second required guitarist every week*
-- purely because it was marked required and nobody holds the skill. That last
-- fact is why 7 of the ministry's 8 services carry a gap row for it.
--
-- The intent was always "one guitarist required, a second if the roster has
-- one". 20261002090000 added `instruments.slot_counts`, the flag that lets a
-- single row express that. This migration uses it:
--
--   Guitar   is_required TRUE   min_count 1   max_count 2   slot_counts TRUE
--
-- which means: ONE required slot (a missing guitarist is still a real gap and
-- still blocks publication), plus ONE optional slot that is filled greedily
-- after every hard position, and whose absence is never a gap and never a
-- finding. `min_count 1 / max_count 2` is preserved from Electric Guitar, which
-- is where the "two players when available" intent lived.
--
-- WHY THE SURVIVOR IS `Guitar 1` AND NOT AN INSERT. It is the only guitar row
-- with assignments (7) and with member skill rows (3 of the 5 distinct
-- guitarists). Keeping its id means every one of those 7 assignments keeps
-- pointing at the same instrument row through the rename -- no assignment row is
-- updated, so no `schedule_version` counter moves and no historical lineup is
-- reinterpreted. An insert-then-delete would have had to rewrite 7 assignment
-- rows and 8 audit-worthy columns.
--
-- WHY SKILLS ARE MERGED BEFORE THE DELETES. `member_skills.instrument_id` is
-- `ON DELETE CASCADE`. Deleting a guitar row before moving its skills would
-- silently destroy a qualification and shrink the eligible pool for a member
-- who demonstrably plays. So the merge is strictly first, and the order is
-- asserted by the post-conditions rather than by comment.
--
-- IDEMPOTENCE IS STRUCTURAL, NOT A `WHERE`. A second run finds the survivor
-- already collapsed and the doomed ids already gone, and returns before touching
-- anything. That is checked FIRST, before the pre-conditions, so re-running an
-- applied migration is a clean no-op rather than a precondition failure.
--
-- THE GUARD READS `slot_counts`, SO 20261002090000 MUST HAVE RUN FIRST. The
-- idempotence test is `... AND v_survivor_row.slot_counts IS TRUE`, and the
-- step-5 UPDATE writes that column, so the ordering between these two files is
-- part of the contract, not an accident of their timestamps. Applying this file
-- without 20261002090000 fails at parse time with
-- `column "slot_counts" does not exist`, which is loud and safe: nothing is
-- written, and 20261002090000 is additive, so the fix is simply to apply it and
-- re-run this file. Do not reorder, rename, or squash the pair into one file
-- without carrying the dependency forward explicitly.
--
-- CONCURRENCY. `pg_advisory_xact_lock` on a fixed key, taken before any read, so
-- two sessions applying this concurrently serialise on one lock instead of both
-- passing the idempotence check and both merging. The lock is transaction-scoped
-- (`_xact_`), so it is released by commit or rollback and cannot leak.

DO $collapse$
DECLARE
  c_church     CONSTANT UUID := 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_ministry   CONSTANT UUID := 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_survivor   CONSTANT UUID := 'daf85d83-4753-473b-abdb-2bfb2856279c';
  c_guitar2    CONSTANT UUID := '8f1b2321-923a-405f-bde8-1640be5fb5b3';
  c_electric   CONSTANT UUID := 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_acoustic   CONSTANT UUID := 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

  v_doomed CONSTANT UUID[] := ARRAY[c_guitar2, c_electric, c_acoustic];

  -- The four names whose gap rows are stale the moment the rows they name are
  -- gone. Post-merge `public.instruments` no longer contains any of them, so a
  -- "does this gap name a current instrument?" test cannot find them.
  c_gone_names CONSTANT TEXT[] := ARRAY['guitar 1', 'guitar 2', 'electric guitar', 'acoustic guitar'];

  v_survivor_row RECORD;
  v_doomed_count INTEGER;
  v_service     RECORD;
  v_preserved   JSONB;
  v_instruments JSONB;
  v_skills      INTEGER;
  v_blocker     TEXT;
  v_protected   TEXT;
  v_protected_after TEXT;
  v_doomed_skills INTEGER;
  -- How many `services` rows this run actually rewrote, reported in the closing
  -- NOTICE so an operator can confirm the scope of the recompute from the log
  -- rather than by querying the table afterwards.
  v_recomputed INTEGER;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Serialise concurrent applications of THIS migration
  -- -------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('johia:guitar-collapse:20261002090100', 0)::bigint);

  -- -------------------------------------------------------------------------
  -- 2. Idempotence, checked BEFORE the pre-conditions
  -- -------------------------------------------------------------------------
  SELECT * INTO v_survivor_row FROM public.instruments WHERE id = c_survivor;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'guitar collapse aborted: survivor % does not exist. This migration must not create it.',
      c_survivor;
  END IF;
  IF v_survivor_row.name = 'Guitar'
     AND v_survivor_row.is_required
     AND v_survivor_row.min_count = 1
     AND v_survivor_row.max_count = 2
     AND v_survivor_row.slot_counts IS TRUE
     AND NOT EXISTS (SELECT 1 FROM public.instruments WHERE id = ANY (v_doomed)) THEN
    RAISE NOTICE 'guitar collapse: already applied (survivor is Guitar min 1 / max 2, opted in); no-op.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Pre-conditions. Every one of these is an assertion, not a branch: if the
  --    database does not look like the database this migration was written
  --    against, the correct outcome is to abort, not to guess.
  -- -------------------------------------------------------------------------
  IF v_survivor_row.ministry_id IS DISTINCT FROM c_ministry THEN
    RAISE EXCEPTION 'guitar collapse aborted: survivor % is in ministry %, expected %.',
      c_survivor, v_survivor_row.ministry_id, c_ministry;
  END IF;
  -- Name, required flag AND counts together, because step 5 overwrites all four.
  -- A coordinator who edited `Guitar 1`'s counts between this file being written
  -- and this file being run must get an abort naming what was actually found, not
  -- a silent overwrite of a configuration change nobody asked this file to
  -- discard. `Guitar 1` is min 1 / max 1 in this database; `Electric Guitar` is
  -- the row that carries min 1 / max 2, and it is one of the doomed three.
  IF v_survivor_row.name <> 'Guitar 1'
     OR NOT v_survivor_row.is_required
     OR v_survivor_row.min_count IS DISTINCT FROM 1
     OR v_survivor_row.max_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'guitar collapse aborted: survivor % is "%"/required %/min %/max %, expected an uncollapsed "Guitar 1"/required true/min 1/max 1.',
      c_survivor, v_survivor_row.name, v_survivor_row.is_required,
      v_survivor_row.min_count, v_survivor_row.max_count;
  END IF;

  SELECT count(*) INTO v_doomed_count FROM public.instruments WHERE id = ANY (v_doomed);
  IF v_doomed_count <> 3 THEN
    RAISE EXCEPTION 'guitar collapse aborted: expected 3 doomed guitar rows, found %.', v_doomed_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.instruments i
             WHERE i.id = ANY (v_doomed) AND i.ministry_id IS DISTINCT FROM c_ministry) THEN
    RAISE EXCEPTION 'guitar collapse aborted: a doomed row is outside ministry %.', c_ministry;
  END IF;

  -- `instruments` carries `UNIQUE (ministry_id, name)`. Without this, the rename
  -- below fails with a raw 23505 instead of a statement of intent. The
  -- conflicting row is reported by id, because naming the row that blocks the
  -- rename is the whole point of the check.
  SELECT i.id::text INTO v_blocker
  FROM public.instruments i
  WHERE i.ministry_id = c_ministry AND lower(i.name) = 'guitar' AND i.id <> c_survivor
  LIMIT 1;
  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION 'guitar collapse aborted: ministry % already has an instrument named "Guitar" (%).',
      c_ministry, v_blocker;
  END IF;

  -- An assignment pointing at a row this migration deletes would be rewritten by
  -- `ON DELETE SET NULL` into an assignment with a NULL instrument, or blocked.
  -- Today all three doomed rows have zero assignments; if that is no longer true
  -- this migration must stop rather than decide for itself how to re-point a
  -- lineup. (The `EXISTS` check below aborts before that could occur anyway.)
  IF EXISTS (SELECT 1 FROM public.schedule_assignments a WHERE a.instrument_id = ANY (v_doomed)) THEN
    RAISE EXCEPTION
      'guitar collapse aborted: % schedule_assignments reference a doomed guitar row. Re-point them by hand first.',
      (SELECT count(*) FROM public.schedule_assignments WHERE instrument_id = ANY (v_doomed));
  END IF;

  -- Tenant scope on the data being moved: no skill row outside this church may be
  -- carried onto the survivor.
  SELECT count(*) INTO v_doomed_skills FROM public.member_skills ms
  JOIN public.members m ON m.id = ms.member_id
  WHERE ms.instrument_id = ANY (v_doomed) AND m.church_id IS DISTINCT FROM c_church;
  IF v_doomed_skills <> 0 THEN
    RAISE EXCEPTION 'guitar collapse aborted: % member_skills on doomed rows belong to another church.', v_doomed_skills;
  END IF;

  -- The merge in step 4 is a single `INSERT ... ON CONFLICT DO UPDATE` fed every
  -- doomed skill row at once, and that command cannot touch the same conflict
  -- target twice: a member holding a skill on two or more doomed instruments would
  -- raise Postgres' `cannot affect row a second time`. That message is true but
  -- opaque - it names neither the member nor the instruments - and it would abort
  -- mid-merge. Today the overlap is impossible (Electric Guitar and Acoustic
  -- Guitar hold zero skills, so all 5 doomed skills belong to Guitar 2 holders
  -- only), which makes this an assertion rather than an assumption: if a later
  -- roster does overlap, the failure names the member and the two positions
  -- instead of surfacing an engine error string.
  IF EXISTS (
    SELECT 1
    FROM public.member_skills ms
    WHERE ms.instrument_id = ANY (v_doomed)
    GROUP BY ms.member_id
    HAVING count(DISTINCT ms.instrument_id) > 1
  ) THEN
    RAISE EXCEPTION
      'guitar collapse aborted: these members hold a skill on more than one doomed guitar row, so the step-4 merge would collide: %. De-duplicate their member_skills by hand first.',
      (SELECT string_agg(x.member_id || ' (' || x.instruments || ')', ', ' ORDER BY x.member_id)
         FROM (
           SELECT ms.member_id::text AS member_id,
                  string_agg(DISTINCT i.name, ' + ' ORDER BY i.name) AS instruments
           FROM public.member_skills ms
           JOIN public.instruments i ON i.id = ms.instrument_id
           WHERE ms.instrument_id = ANY (v_doomed)
           GROUP BY ms.member_id
           HAVING count(DISTINCT ms.instrument_id) > 1
         ) x);
  END IF;

  -- Fingerprint every column this migration must NOT change, before it changes
  -- anything. Compared at the end; the prose below promises this, the assertion
  -- proves it.
  SELECT md5(string_agg(
           concat_ws('|', s.id::text, s.status,
                     coalesce(s.schedule_version::text, ''), coalesce(s.validated_version::text, ''),
                     coalesce(s.validated_by::text, ''), coalesce(s.validated_at::text, ''),
                     coalesce(s.published_by::text, ''), coalesce(s.published_at::text, ''),
                     coalesce(s.generation_metadata::text, ''), coalesce(s.revision_of::text, ''),
                     coalesce(s.active_overrides::text, '')),
           E'\n' ORDER BY s.id::text))
  INTO v_protected
  FROM public.services s
  WHERE s.church_id = c_church AND s.ministry_id = c_ministry;

  -- -------------------------------------------------------------------------
  -- 4. Merge the skills FIRST (CASCADE order is load-bearing, see header)
  -- -------------------------------------------------------------------------
  --
  -- On conflict the survivor's row wins its own columns, except that proficiency
  -- takes the HIGHER of the two and `is_primary` is sticky. `skill_level` is a
  -- varchar constrained to four words, so the higher value has to come from an
  -- explicit rank: 'expert' sorts BELOW 'intermediate' as text, and taking the
  -- text maximum would silently downgrade an expert guitarist.
  INSERT INTO public.member_skills (member_id, instrument_id, skill_level, is_primary, fallback_member_id, created_at)
  SELECT ms.member_id, c_survivor, ms.skill_level, ms.is_primary, ms.fallback_member_id, ms.created_at
  FROM public.member_skills ms
  JOIN public.members m ON m.id = ms.member_id
  WHERE ms.instrument_id = ANY (v_doomed)
    AND m.church_id = c_church
  ON CONFLICT (member_id, instrument_id) DO UPDATE
    SET skill_level = CASE
          WHEN (CASE public.member_skills.skill_level
                  WHEN 'expert' THEN 4 WHEN 'advanced' THEN 3
                  WHEN 'intermediate' THEN 2 WHEN 'beginner' THEN 1 ELSE 0 END)
             >= (CASE EXCLUDED.skill_level
                  WHEN 'expert' THEN 4 WHEN 'advanced' THEN 3
                  WHEN 'intermediate' THEN 2 WHEN 'beginner' THEN 1 ELSE 0 END)
          THEN public.member_skills.skill_level
          ELSE EXCLUDED.skill_level
        END,
        is_primary = public.member_skills.is_primary OR EXCLUDED.is_primary,
        fallback_member_id = COALESCE(public.member_skills.fallback_member_id, EXCLUDED.fallback_member_id);

  -- -------------------------------------------------------------------------
  -- 5. Delete the doomed rows, then rename and opt in the survivor
  -- -------------------------------------------------------------------------
  DELETE FROM public.instruments WHERE id = ANY (v_doomed) AND ministry_id = c_ministry;

  UPDATE public.instruments
  SET name         = 'Guitar',
      is_required  = TRUE,
      min_count    = 1,
      max_count    = 2,
      slot_counts  = TRUE
  WHERE id = c_survivor AND ministry_id = c_ministry;

  -- -------------------------------------------------------------------------
  -- 6. Recompute ONLY `services.unfilled_positions`
  -- -------------------------------------------------------------------------
  --
  -- `unfilled_positions` is the served read model (`GET /api/schedule` hands back
  -- exactly these bytes), so a row naming a deleted instrument is not a cosmetic
  -- leftover: it tells the editor to fill a position the catalogue no longer has.
  --
  -- `unfilled_positions` is ALSO the only deferrable-gap list publication consults,
  -- so leaving it stale would either hide a real shortfall or publish against
  -- garbage. It has to move in the same transaction as the catalogue or the
  -- schedule briefly claims to be complete when it is not.
  --
  -- NOTHING ELSE ON `services` IS TOUCHED. Not `status`, not `schedule_version`,
  -- not `validated_*`, not `published_*`, not `generation_metadata`, not
  -- `revision_of`, not `active_overrides`, not `updated_at`, and not any
  -- existing `audit_logs` row. The `updated_at` column moves only as a trigger
  -- side effect of updating `unfilled_positions` (via
  -- `update_services_updated_at`), so all 8 affected services will have their
  -- `updated_at` bumped. No other column is modified and no existing audit row
  -- is disturbed. That is why this recomputes the JSON surgically instead of
  -- re-running the full gap engine from 20260930120000: a full recompute would
  -- re-derive leader, backup and Devotion gaps too, and if the underlying data
  -- had drifted since that migration it would silently rewrite facts this file
  -- has no business touching. The non-instrument entries are therefore carried
  -- across VERBATIM.
  --
  -- The instrument entries are re-derived to match `unfilledFrom` in
  -- src/lib/scheduling/gaps.ts byte for byte, because a backfilled gap and a
  -- generated gap must be indistinguishable to the coordinator or the same
  -- shortfall renders as two different facts depending on which wrote the row.
  -- `minSlotsFor`'s count contract is mirrored exactly, including the defensive
  -- fallbacks: only a row with `slot_counts IS TRUE` and a non-negative
  -- `min_count` uses `min_count`; anything else demands exactly 1, which is the
  -- historical presence test.
  FOR v_service IN
    SELECT id, week_number, date, ministry_id, COALESCE(unfilled_positions, '[]'::jsonb) AS current_gaps
    FROM public.services
    WHERE church_id = c_church AND ministry_id = c_ministry
  LOOP
    -- Everything that is NOT an instrument gap for this ministry, carried through
    -- untouched. The explicit name list is what removes the now-dangling
    -- 'Guitar 1' / 'Electric Guitar' rows, which no longer match any catalogue row.
    SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO v_preserved
    FROM jsonb_array_elements(v_service.current_gaps) e
    WHERE NOT EXISTS (
            SELECT 1 FROM public.instruments i
            WHERE i.ministry_id = v_service.ministry_id
              AND i.is_required
              AND lower(e->>'role_name') = lower(i.name))
      AND lower(e->>'role_name') <> ALL (c_gone_names);

    -- Required instruments, re-derived from the POST-merge catalogue.
    SELECT COALESCE(jsonb_agg(t.g ORDER BY t.instrument_name), '[]'::jsonb)
    INTO v_instruments
    FROM (
      SELECT i.name AS instrument_name,
             jsonb_build_object(
               'service_id', v_service.id,
               'week_number', v_service.week_number,
               'date', v_service.date,
               'role_name', i.name,
               'required_slots', GREATEST(1, c.req - c.assigned),
               -- Message strings copied from `unfilledFrom` in gaps.ts:74-75
               -- verbatim, including the `req <= 1` threshold (not `req = 1`), so
               -- a row that requires none of the instrument and one that requires
               -- a single player render identically to the application.
               'message', CASE
                 WHEN c.req <= 1
                   THEN 'Required ' || i.name || ' is not assigned for week ' || v_service.week_number::text || '.'
                 ELSE 'Only ' || c.assigned::text || ' of ' || c.req::text || ' ' || i.name
                      || ' assigned for week ' || v_service.week_number::text || '.'
               END,
               -- Empty on purpose, exactly as `unfilledFrom`: this gap was found
               -- by reading a lineup, not by exhausting a candidate pool.
               'eligible_candidates', '[]'::jsonb,
               'rejected_candidates', '[]'::jsonb) AS g
      FROM public.instruments i
      CROSS JOIN LATERAL (
        -- `min_count` is an integer column, so no rounding is needed; the cast is
        -- only to keep the value an integer, because it is interpolated straight
        -- into a message string a coordinator reads and `numeric` renders as '2'.
        SELECT (CASE WHEN i.slot_counts IS TRUE AND i.min_count >= 0
                     THEN i.min_count::int ELSE 1 END) AS req,
               (SELECT count(*)::int FROM public.schedule_assignments a
                 WHERE a.service_id = v_service.id AND a.instrument_id = i.id) AS assigned
      ) c
      WHERE i.ministry_id = v_service.ministry_id
        AND i.is_required
        AND c.assigned < c.req
    ) t;

    UPDATE public.services
    SET unfilled_positions = v_preserved || v_instruments
    WHERE id = v_service.id;

    v_recomputed := COALESCE(v_recomputed, 0) + 1;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 7. Post-conditions
  -- -------------------------------------------------------------------------
  SELECT * INTO v_survivor_row FROM public.instruments WHERE id = c_survivor;
  IF v_survivor_row.name IS DISTINCT FROM 'Guitar'
     OR v_survivor_row.is_required IS NOT TRUE
     OR v_survivor_row.min_count <> 1
     OR v_survivor_row.max_count <> 2
     OR v_survivor_row.slot_counts IS NOT TRUE THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: survivor is %, required %, min %, max %, slot_counts %.',
      v_survivor_row.name, v_survivor_row.is_required, v_survivor_row.min_count,
      v_survivor_row.max_count, v_survivor_row.slot_counts;
  END IF;

  IF EXISTS (SELECT 1 FROM public.instruments WHERE id = ANY (v_doomed)) THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: a doomed row survived the delete.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.instruments i
             WHERE i.ministry_id = c_ministry AND lower(i.name) = ANY (c_gone_names)) THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: a retired guitar name is still in the catalogue.';
  END IF;

  -- Every guitarist who held a skill on ANY of the four rows is still on the
  -- survivor. This is the assertion that would have caught a delete-before-merge
  -- ordering: it is the check that fails loudly when a cascade ate a
  -- qualification.
  SELECT count(*) INTO v_skills FROM public.member_skills WHERE instrument_id = c_survivor;
  IF v_skills <> 5 THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: survivor holds % member_skills, expected 5 (3 from Guitar 1, 5 from Guitar 2, all 3 of the Guitar 1 holders also hold Guitar 2, so 3 + 5 - 3 = 5 distinct).',
      v_skills;
  END IF;

  -- No assignment may still name one of the three retired instrument ids.
  --
  -- The check this replaces selected assignments ON the survivor and then
  -- asserted that no `instruments` row had that id -- but the survivor's
  -- existence was proven two paragraphs earlier in this same step, so the
  -- predicate could never be true. It was documentation pretending to be a
  -- guarantee. This version asserts the property the file actually cares about
  -- after the deletes: a retired id is referenced by nothing. If an assignment
  -- were left on or re-pointed at a deleted row, this fires; the old one could
  -- not. The surviving 7 lineups are untouched by construction, because no
  -- UPDATE ever touched `schedule_assignments` and the survivor's id is the same
  -- id those 7 rows already pointed at.
  IF EXISTS (SELECT 1 FROM public.schedule_assignments a
             WHERE a.instrument_id = ANY (v_doomed)) THEN
    RAISE EXCEPTION
      'guitar collapse post-condition failed: % schedule_assignments still reference a retired guitar row (the survivor % keeps its own %).',
      (SELECT count(*) FROM public.schedule_assignments WHERE instrument_id = ANY (v_doomed)),
      c_survivor,
      (SELECT count(*) FROM public.schedule_assignments WHERE instrument_id = c_survivor);
  END IF;

  -- No served gap row may name a retired position.
  IF EXISTS (SELECT 1 FROM public.services s, LATERAL jsonb_array_elements(COALESCE(s.unfilled_positions, '[]'::jsonb)) e
             WHERE s.church_id = c_church AND s.ministry_id = c_ministry
               AND lower(e->>'role_name') = ANY (c_gone_names)) THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: a services.unfilled_positions row still names a retired guitar position.';
  END IF;

  -- And the columns this file promised not to touch did not move. Compared to the
  -- fingerprint taken in step 3, which is still held in `v_protected`; the AFTER
  -- value goes into a separate variable, because assigning it to `v_protected`
  -- would have made this comparison before-versus-after and quietly always pass.
  SELECT md5(string_agg(
           concat_ws('|', s.id::text, s.status,
                     coalesce(s.schedule_version::text, ''), coalesce(s.validated_version::text, ''),
                     coalesce(s.validated_by::text, ''), coalesce(s.validated_at::text, ''),
                     coalesce(s.published_by::text, ''), coalesce(s.published_at::text, ''),
                     coalesce(s.generation_metadata::text, ''), coalesce(s.revision_of::text, ''),
                     coalesce(s.active_overrides::text, '')),
           E'\n' ORDER BY s.id::text))
  INTO v_protected_after
  FROM public.services s
  WHERE s.church_id = c_church AND s.ministry_id = c_ministry;

  IF v_protected_after IS DISTINCT FROM v_protected THEN
    RAISE EXCEPTION 'guitar collapse post-condition failed: a protected services column changed.';
  END IF;

  -- `services` carries an AFTER UPDATE audit trigger, so this recompute writes
  -- its own `audit_logs` rows with the System Migration User as actor. Those are
  -- the trigger's doing, not this file's: no existing audit row is read, updated
  -- or deleted here, and the fingerprint above covers every column an audit
  -- snapshot is taken from.
  RAISE NOTICE 'guitar collapse: applied. Guitar = min 1 / max 2, slot_counts on, % skills carried over, % services unfilled_positions recomputed.',
    v_skills, COALESCE(v_recomputed, 0);
END;
$collapse$;

-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
--
-- It does not validate or republish any service. Validation state and publication
-- state are deliberately left exactly as they were: this migration changes what a
-- future generation or validation run WILL compute, and a coordinator who wants a
-- service re-validated against the new catalogue triggers that through the
-- product, which also records who asked for it. Silently re-validating eight
-- services under the System Migration User would put a `validated_by` and a
-- `validated_at` into the audit trail that no human authorised.