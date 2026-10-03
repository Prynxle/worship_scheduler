import { describe, expect, it } from 'vitest';
import type { Member } from '../types/database';
import { DevotionRotation } from './devotion-rotation';

function member(id: string, status: Member['status'] = 'active'): Member {
  return {
    id,
    church_id: 'church',
    full_name: id,
    status,
    max_monthly_assignments: 3,
    priority_score: 1,
    total_assignments: 0,
    created_at: '',
    updated_at: '',
    roles: [],
  };
}

describe('DevotionRotation', () => {
  it('includes active members without a devotion role qualification', () => {
    const rotation = new DevotionRotation('church', []);
    const candidates = rotation.getNextDevotionMembers([member('active')], 1, 4, 8, 2026);

    expect(candidates.map((candidate) => candidate.member_id)).toEqual(['active']);
  });

  it('continues to exclude inactive members', () => {
    const rotation = new DevotionRotation('church', []);
    const candidates = rotation.getNextDevotionMembers([member('inactive', 'inactive')], 1, 4, 8, 2026);

    expect(candidates).toEqual([]);
  });
});
