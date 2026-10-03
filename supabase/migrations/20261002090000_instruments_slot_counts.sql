-- Opt-in count-driven slots for the instrument catalogue.
--
-- WHAT THIS IS. Until now the scheduler read `instruments.max_count` as a hand-off
-- ceiling for exactly ONE slot, and ignored `min_count` entirely. A coordinator's
-- only way to ask for two guitarists a week was to add a second catalogue row
-- (`Guitar 1`, `Guitar 2`) -- which the engine could not honour anyway, because
-- the slot builder keyed slots on the instrument id, so `max_count` never
-- produced a second player and a `Guitar 2` row marked `is_required = false`
-- was never emitted at all. The count was configuration the product could not
-- express.
--
-- This migration adds the flag that lets it express it. `slot_counts` is
-- STRICTLY OPT-IN and defaults to false:
--
--   slot_counts IS FALSE (every row in this database today)
--       -> the row emits exactly one required slot, whatever min_count and
--          max_count say. Byte-identical to previous behaviour. This is the
--          whole point of an opt-in flag: no row can change behaviour by
--          existing, only by being opted in.
--
--   slot_counts IS TRUE
--       -> required_slots = min_count
--          optional_slots = max_count - min_count extra NON-BLOCKING slots.
--          An unfilled optional slot is never a gap, never a critical finding,
--          and never a publication blocker.
--
-- WHY NOT infer this from `max_count > min_count`, or a name allowlist, or a
-- default-on flag? Because THREE of the four guitar rows would change behaviour
-- the moment opt-in was inferred, with no maintainer having asked for it:
--
--   Electric Guitar  min 1 / max 2  required  max > min, so an inferred opt-in
--                                            would add a SECOND guitarist slot
--                                            to every week.
--   Guitar 2         min 0 / max 1  optional  max > min, so an inferred opt-in
--                                            would start emitting an optional
--                                            slot for a row the engine never
--                                            emitted at all (is_required false).
--   Acoustic Guitar  min 0 / max 1  optional  same hazard as Guitar 2.
--
-- `Guitar 1` is min 1 / max 1, NOT a 1/2 row, and it is named here only to show
-- that inference has no way to be made safe: it is the one row an inferred
-- opt-in would leave completely untouched (max == min, so it already means
-- exactly one required slot), while the three rows above would all change. A
-- rule cannot tell those two groups apart, because the only things separating
-- them are a name and a pair of integers that other instruments use for
-- unrelated reasons. Hence an explicit, per-row, opt-in act.
-- (20261002090100_guitar_collapse.sql records the same four rows with the same
-- min/max values; the two files must be read together.)
--
-- SCOPE: additive only. It creates no rows, renames nothing, deletes nothing,
-- and updates no `services` data. The companion migration
-- 20261002090100_guitar_collapse.sql is the one that flips the flag and
-- collapses the guitar rows; this file only makes that possible. The two are
-- ordered so the flag exists before any row depends on it, and so the
-- application code (which treats a MISSING `slot_counts` as inert) is safe to
-- deploy before this file, between this file and the collapse, or after both.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
--
-- NOT NULL DEFAULT false, so the ALTER gives every pre-existing row the correct
-- value atomically. A nullable column with no default would leave every existing
-- row NULL, and `slot_counts IS TRUE` would then be false for them -- correct,
-- but it would make "opted in" indistinguishable from "written before the
-- column existed" forever. NOT NULL makes the opt-in an explicit act.

ALTER TABLE public.instruments
  ADD COLUMN IF NOT EXISTS slot_counts BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.instruments.slot_counts IS
  'Opt in to count-driven slots. When true, the scheduler emits min_count required '
  'slots plus max_count - min_count optional (non-blocking) slots for this instrument. '
  'When false or absent, the row emits exactly one required slot regardless of '
  'min_count and max_count. Absent means inert, so application code may be deployed '
  'before this migration without mis-scheduling any week.';

-- ---------------------------------------------------------------------------
-- 2. The CHECK, and why it is a database invariant rather than a code comment
-- ---------------------------------------------------------------------------
--
-- `min_count >= 0 AND max_count >= min_count` on opted-in rows only.
--
-- A negative `min_count` would compute a negative `required_slots` and a
-- `max_count - min_count` larger than `max_count`, i.e. more optional slots than
-- the ceiling allows. An inverted pair would compute a negative number of
-- optional slots. Both are nonsense configurations, and the application already
-- degrades them defensively (see `minSlotsFor` / `maxSlotsFor` in
-- src/lib/scheduling/required-roles.ts) -- but "the application degrades it" is
-- not the same as "it cannot be stored". A CHECK makes the invariant
-- unviolatable at the only place a value can enter the table.
--
-- `min_count >= 0` and NOT `min_count >= 1`: zero is a legal, meaningful count.
-- `min_count = 0, max_count = 2, slot_counts = true` means "up to two
-- guitarists, none required" -- a position that contributes optional slots and
-- no blocking gap. Folding that to one would schedule a musician nobody asked
-- for and then report a gap for a position that is not required.
--
-- The predicate is `slot_counts = false OR (...)`, so it constrains ONLY opted-in
-- rows. A flag-off row keeps whatever legacy counts it has, including a
-- `min_count = 0, max_count = 99` hand-off ceiling, and is unaffected.
--
-- Idempotent: `ALTER TABLE ... ADD CONSTRAINT` has no `IF NOT EXISTS`, so the
-- guard is a `pg_constraint` lookup. Verified against this database before it
-- was written: 8 instrument rows, 0 with a negative `min_count`, 0 with
-- `max_count < min_count`, 0 NULL counts, so validating the constraint against
-- existing data cannot fail.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instruments_slot_counts_count_check'
      AND conrelid = 'public.instruments'::regclass
  ) THEN
    ALTER TABLE public.instruments
      ADD CONSTRAINT instruments_slot_counts_count_check
      CHECK (slot_counts = false OR (min_count >= 0 AND max_count >= min_count));
  END IF;
END;
$$;

-- No backfill, deliberately. Every row defaults to false, which IS the correct
-- value for every row in this database: no instrument has been asked for
-- count-driven slots yet, and the only row that will be opted in is `Guitar`,
-- opted in by 20261002090100_guitar_collapse.sql as part of a deliberate
-- product change whose own pre- and post-conditions are asserted there.