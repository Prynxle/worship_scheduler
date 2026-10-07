-- Reduce event description length limit to 250 characters
alter table public.events
  drop constraint if exists events_description_length;

alter table public.events
  add constraint events_description_length
  check (description is null or char_length(description) <= 250);
