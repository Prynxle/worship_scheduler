import type { Instrument, Ministry, Role } from '@/lib/types/database';
import type { NormalizedMinistryRule } from './rules';

export interface EffectiveBackupRange {
  min: number;
  max: number;
}

export interface MinistryWithConfiguration extends Ministry {
  roles: Role[];
  instruments: Instrument[];
  rules: NormalizedMinistryRule[];
  effective_backup_range: EffectiveBackupRange;
}

export interface MinistriesResponse {
  ministries: MinistryWithConfiguration[];
}
