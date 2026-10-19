import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/20261013040915_song_lineup_schedule_safety.sql', import.meta.url)), 'utf8');

describe('song lineup schedule safety migration', () => {
  it('prevents service deletion from cascading away submitted lineups', () => {
    expect(migration).toMatch(/BEFORE DELETE ON public\.services[\s\S]*?prevent_service_delete_with_song_lineup/);
    expect(migration).toMatch(/FROM public\.song_lineups l WHERE l\.service_id = OLD\.id/);
    expect(migration).toMatch(/USING ERRCODE = '23503'/);
  });

  it('publishes lineup and song changes for assigned member updates', () => {
    expect(migration).toContain("tablename = 'song_lineups'");
    expect(migration).toContain("tablename = 'song_lineup_songs'");
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.song_lineups');
    expect(migration).toContain('ALTER PUBLICATION supabase_realtime ADD TABLE public.song_lineup_songs');
  });

  it('moves edit ownership to the assigned worship leader without a coordinator review', () => {
    expect(migration).toMatch(/AFTER INSERT OR UPDATE ON public\.schedule_assignments[\s\S]*?sync_song_lineup_leader/);
    expect(migration).toMatch(/UPDATE public\.song_lineups[\s\S]*?SET submitted_by_member_id = NEW\.member_id/);
    expect(migration).toMatch(/ON CONFLICT \(service_id\) DO UPDATE SET submitted_by_member_id = p_member_id/);
    expect(migration).toContain('DELETE FROM public.song_lineup_songs WHERE lineup_id = v_lineup_id;');
  });
});
