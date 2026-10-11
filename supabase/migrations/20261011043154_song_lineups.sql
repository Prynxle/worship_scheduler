-- Weekly worship song lineups. A service has at most one active lineup;
-- song rows remain normalized so each song can carry its own key and links.
-- Rollback before rollout: drop both public RPCs, the private policy helper,
-- the song tables, then the composite unique constraints on services and
-- members. Once used, dropping the tables removes submitted lineup data.
ALTER TABLE public.services ADD CONSTRAINT services_id_church_id_unique UNIQUE (id, church_id);
ALTER TABLE public.members ADD CONSTRAINT members_id_church_id_unique UNIQUE (id, church_id);

CREATE TABLE public.song_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  service_id UUID NOT NULL UNIQUE,
  submitted_by_member_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'confirmed', 'withdrawn')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT song_lineups_service_church_fkey FOREIGN KEY (service_id, church_id)
    REFERENCES public.services(id, church_id) ON DELETE CASCADE,
  CONSTRAINT song_lineups_leader_church_fkey FOREIGN KEY (submitted_by_member_id, church_id)
    REFERENCES public.members(id, church_id) ON DELETE CASCADE
);

CREATE TABLE public.song_lineup_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lineup_id UUID NOT NULL REFERENCES public.song_lineups(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  song_url TEXT NOT NULL CHECK (length(song_url) <= 2048),
  musical_key TEXT CHECK (musical_key IS NULL OR length(musical_key) <= 32),
  chords_url TEXT CHECK (chords_url IS NULL OR length(chords_url) <= 2048),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lineup_id, position)
);

CREATE INDEX idx_song_lineups_church_service ON public.song_lineups(church_id, service_id);
CREATE INDEX idx_song_lineups_leader ON public.song_lineups(submitted_by_member_id);
CREATE INDEX idx_song_lineup_songs_order ON public.song_lineup_songs(lineup_id, position);

CREATE TRIGGER update_song_lineups_updated_at BEFORE UPDATE ON public.song_lineups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_song_lineup_songs_updated_at BEFORE UPDATE ON public.song_lineup_songs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.song_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_lineup_songs ENABLE ROW LEVEL SECURITY;

-- schedule_assignments deliberately hides draft assignments from direct member
-- reads. This private definer helper checks that same caller's real active
-- account and assignment while bypassing only the nested RLS visibility issue;
-- it never accepts an actor id from a request or from client-controlled claims.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE OR REPLACE FUNCTION private.can_view_song_lineup(p_church_id UUID, p_service_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = p_church_id AND u.is_active
      AND (
        u.role IN ('admin', 'coordinator')
        OR EXISTS (
          SELECT 1 FROM public.members m
          JOIN public.schedule_assignments a ON a.member_id = m.id
          WHERE m.user_id = u.id AND m.church_id = p_church_id AND m.status = 'active'
            AND a.service_id = p_service_id
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION private.can_view_song_lineup(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_song_lineup(UUID, UUID) TO authenticated;

CREATE POLICY "Assigned members and staff can view active church song lineups"
  ON public.song_lineups FOR SELECT TO authenticated
  USING (
    church_id = get_user_church_id()
    AND status IN ('submitted', 'confirmed')
    AND private.can_view_song_lineup(church_id, service_id)
  );

CREATE POLICY "Authorized viewers can view songs in active lineups"
  ON public.song_lineup_songs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.song_lineups l WHERE l.id = song_lineup_songs.lineup_id AND l.status IN ('submitted', 'confirmed')));

-- Mutations are performed by authenticated server routes using the service
-- role only after checking the bearer-token user's role and service assignment.
-- No browser role receives direct mutation privileges.
REVOKE ALL ON public.song_lineups, public.song_lineup_songs FROM anon, authenticated;
GRANT SELECT ON public.song_lineups, public.song_lineup_songs TO authenticated;
GRANT ALL ON public.song_lineups, public.song_lineup_songs TO service_role;

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
    ON CONFLICT (service_id) DO UPDATE SET status = 'submitted', submitted_at = now(),
      confirmed_at = NULL, withdrawn_at = NULL, updated_at = now()
      WHERE song_lineups.church_id = p_church_id
        AND song_lineups.submitted_by_member_id = p_member_id
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

CREATE OR REPLACE FUNCTION public.review_song_lineup(
  p_church_id UUID, p_service_id UUID, p_action TEXT, p_songs JSONB DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_lineup_id UUID; v_song JSONB;
BEGIN
  SELECT id INTO v_lineup_id FROM public.song_lineups
    WHERE church_id = p_church_id AND service_id = p_service_id AND status <> 'withdrawn' FOR UPDATE;
  IF v_lineup_id IS NULL THEN RAISE EXCEPTION 'Lineup not found' USING ERRCODE = 'P0002'; END IF;

  IF p_action = 'confirm' THEN
    UPDATE public.song_lineups SET status = 'confirmed', confirmed_at = now(), updated_at = now() WHERE id = v_lineup_id;
  ELSIF p_action = 'withdraw' THEN
    UPDATE public.song_lineups SET status = 'withdrawn', withdrawn_at = now(), updated_at = now() WHERE id = v_lineup_id;
  ELSIF p_action = 'enrich' THEN
    IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' THEN RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023'; END IF;
    FOR v_song IN SELECT value FROM jsonb_array_elements(p_songs) LOOP
      IF length(coalesce(v_song->>'musical_key', '')) > 32 OR length(coalesce(v_song->>'chords_url', '')) > 2048
        OR (coalesce(v_song->>'chords_url', '') <> '' AND v_song->>'chords_url' !~* '^https?://') THEN
        RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023';
      END IF;
      UPDATE public.song_lineup_songs SET musical_key = nullif(btrim(v_song->>'musical_key'), ''),
        chords_url = nullif(btrim(v_song->>'chords_url'), ''), updated_at = now()
        WHERE id = (v_song->>'id')::UUID AND lineup_id = v_lineup_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Song does not belong to lineup' USING ERRCODE = '22023'; END IF;
    END LOOP;
  ELSE RAISE EXCEPTION 'Unsupported lineup action' USING ERRCODE = '22023'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.save_song_lineup(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_song_lineup(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_song_lineup(UUID, UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_song_lineup(UUID, UUID, TEXT, JSONB) TO service_role;
