-- ============================================================================
-- Migration: replace event kind/color with a free-text description
-- Purpose: The `kind` enum ('Service' | 'Rehearsal' | 'Gathering') was too
--          rigid for real ministry use, and `color` existed only to paint the
--          dot beside each event. Both are replaced by a single optional
--          `description` text field so staff can say whatever is useful.
--
-- Safety: existing `kind` values are copied into `description` before the
--          column is dropped, so no user-entered information is lost.
-- ============================================================================

-- 1. Add the replacement column. Nullable and unconstrained so the backfill
--    below cannot fail on a long or unusual legacy value.
alter table public.events
  add column if not exists description text;

-- 2. Preserve the old category as readable text before dropping it.
update public.events
  set description = kind
  where description is null
    and kind is not null;

-- 3. Drop the rigid category and the colour that only fed the removed dot.
--    The CHECK constraints on both columns are dropped with the columns.
alter table public.events drop column if exists kind;
alter table public.events drop column if exists color;

-- 4. Bound the new field at the database level. The API validates the same
--    limit (MAX_EVENT_DESCRIPTION_LENGTH in src/lib/api/events.ts) so a
--    non-app writer cannot bypass it.
alter table public.events
  drop constraint if exists events_description_length;

alter table public.events
  add constraint events_description_length
  check (description is null or char_length(description) <= 500);
