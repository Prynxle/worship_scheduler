-- Protect submitted songs from the service cascade used by schedule regeneration.
CREATE OR REPLACE FUNCTION public.prevent_service_delete_with_song_lineup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.pg_trigger_depth() = 1
    AND EXISTS (SELECT 1 FROM public.song_lineups l WHERE l.service_id = OLD.id) THEN
    RAISE EXCEPTION 'A service with submitted songs cannot be deleted; retain its lineup before replacing the schedule'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_service_song_lineups ON public.services;
CREATE TRIGGER protect_service_song_lineups
  BEFORE DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.prevent_service_delete_with_song_lineup();
REVOKE ALL ON FUNCTION public.prevent_service_delete_with_song_lineup() FROM PUBLIC, anon, authenticated;

-- Transfer editing ownership when the schedule assigns a new worship leader;
-- song rows remain untouched and visible to the service's current assignments.
CREATE OR REPLACE FUNCTION public.sync_song_lineup_leader()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.is_leader THEN
    UPDATE public.song_lineups
    SET submitted_by_member_id = NEW.member_id, updated_at = now()
    WHERE service_id = NEW.service_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_service_song_lineup_leader ON public.schedule_assignments;
CREATE TRIGGER sync_service_song_lineup_leader
  AFTER INSERT OR UPDATE ON public.schedule_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sync_song_lineup_leader();
REVOKE ALL ON FUNCTION public.sync_song_lineup_leader() FROM PUBLIC, anon, authenticated;

-- The active scheduled leader can take ownership of an existing service lineup.
-- The function still validates that p_member_id is the current leader first.
CREATE OR REPLACE FUNCTION public.save_song_lineup(
  p_church_id UUID, p_service_id UUID, p_member_id UUID, p_songs JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_lineup_id UUID; v_song JSONB; v_position INTEGER := 0;
BEGIN
  IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' THEN
    RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_songs) < 2 OR jsonb_array_length(p_songs) > 30 THEN
    RAISE EXCEPTION 'A lineup must contain between 2 and 30 songs' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services s JOIN public.schedule_assignments a ON a.service_id = s.id
    JOIN public.members m ON m.id = a.member_id
    WHERE s.id = p_service_id AND s.church_id = p_church_id AND a.member_id = p_member_id
      AND a.is_leader AND m.church_id = p_church_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'Leader assignment is not valid' USING ERRCODE = '42501'; END IF;

  INSERT INTO public.song_lineups(church_id, service_id, submitted_by_member_id, status)
    VALUES (p_church_id, p_service_id, p_member_id, 'submitted')
    ON CONFLICT (service_id) DO UPDATE SET submitted_by_member_id = p_member_id,
      status = 'submitted', submitted_at = now(), confirmed_at = NULL,
      withdrawn_at = NULL, updated_at = now()
      WHERE song_lineups.church_id = p_church_id
    RETURNING id INTO v_lineup_id;
  IF v_lineup_id IS NULL THEN RAISE EXCEPTION 'Lineup cannot be edited by this leader' USING ERRCODE = '42501'; END IF;

  DELETE FROM public.song_lineup_songs WHERE lineup_id = v_lineup_id;
  FOR v_song IN SELECT value FROM jsonb_array_elements(p_songs) LOOP
    IF length(btrim(coalesce(v_song->>'title', ''))) NOT BETWEEN 1 AND 200
      OR length(coalesce(v_song->>'song_url', '')) > 2048
      OR coalesce(v_song->>'song_url', '') !~* '^https?://'
      OR length(coalesce(v_song->>'musical_key', '')) > 32
      OR length(coalesce(v_song->>'chords_url', '')) > 2048
      OR (coalesce(v_song->>'chords_url', '') <> '' AND v_song->>'chords_url' !~* '^https?://') THEN
      RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.song_lineup_songs(lineup_id, title, song_url, musical_key, chords_url, position)
      VALUES (v_lineup_id, btrim(v_song->>'title'), v_song->>'song_url',
        nullif(btrim(v_song->>'musical_key'), ''), nullif(btrim(v_song->>'chords_url'), ''), v_position);
    v_position := v_position + 1;
  END LOOP;
  RETURN v_lineup_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_song_lineup(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_song_lineup(UUID, UUID, UUID, JSONB) TO service_role;

-- Song changes should reach members already viewing their assigned-service page.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'song_lineups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.song_lineups;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'song_lineup_songs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.song_lineup_songs;
  END IF;
END;
$$;
