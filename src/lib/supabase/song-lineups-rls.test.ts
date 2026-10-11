import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/20261011043154_song_lineups.sql', import.meta.url)), 'utf8');

describe('song lineup schema and access migration', () => {
  it('binds lineups to a same-church service and submitting member and prevents duplicate service lineups', () => {
    expect(migration).toMatch(/UNIQUE\s*\(id, church_id\)/i);
    expect(migration).toMatch(/service_id UUID NOT NULL UNIQUE/i);
    expect(migration).toMatch(/FOREIGN KEY \(service_id, church_id\)[\s\S]*?REFERENCES public\.services\(id, church_id\)/i);
    expect(migration).toMatch(/FOREIGN KEY \(submitted_by_member_id, church_id\)[\s\S]*?REFERENCES public\.members\(id, church_id\)/i);
  });

  it('lets RLS readers see only active lineups when the caller is staff or assigned to the service', () => {
    expect(migration).toContain('ALTER TABLE public.song_lineups ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('ALTER TABLE public.song_lineup_songs ENABLE ROW LEVEL SECURITY;');
    expect(migration).toMatch(/status IN \('submitted', 'confirmed'\)[\s\S]*?private\.can_view_song_lineup\(church_id, service_id\)/);
    expect(migration).toMatch(/u\.auth_id = \(SELECT auth\.uid\(\)\)[\s\S]*?u\.church_id = p_church_id[\s\S]*?u\.is_active/);
    expect(migration).toMatch(/m\.status = 'active'[\s\S]*?a\.service_id = p_service_id/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION private\.can_view_song_lineup\(UUID, UUID\) FROM PUBLIC, anon/);
  });

  it('requires at least two songs and confines all mutation functions to the server role', () => {
    expect(migration).toMatch(/jsonb_array_length\(p_songs\) < 2/);
    expect(migration).toMatch(/ON CONFLICT \(service_id\) DO UPDATE[\s\S]*?submitted_by_member_id = p_member_id/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.save_song_lineup\(UUID, UUID, UUID, JSONB\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_song_lineup\(UUID, UUID, UUID, JSONB\) TO service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.review_song_lineup\(UUID, UUID, TEXT, JSONB\) TO service_role/);
  });

  it('keeps songs normalized and in a stable, unique order per lineup', () => {
    expect(migration).toContain('CREATE TABLE public.song_lineup_songs');
    expect(migration).toMatch(/musical_key TEXT CHECK/);
    expect(migration).toMatch(/chords_url TEXT CHECK/);
    expect(migration).toMatch(/UNIQUE \(lineup_id, position\)/);
    expect(migration).toMatch(/ON DELETE CASCADE/);
  });
});
