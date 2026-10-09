'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Filter } from 'lucide-react';

export interface MemberFilterOption {
  id: string;
  name: string;
  ministry_name: string | null;
}

export interface MemberFiltersProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: MemberFilterOption[];
  instruments: MemberFilterOption[];
  selectedRoleIds: string[];
  selectedInstrumentIds: string[];
  onSelectedRoleIdsChange: (next: string[]) => void;
  onSelectedInstrumentIdsChange: (next: string[]) => void;
  matchCount: number;
  totalCount: number;
  optionsLoading?: boolean;
  optionsError?: string;
  onRetry?: () => void;
}

/**
 * Role and instrument filters, applied on top of the search box and the
 * all/active/inactive tabs.
 *
 * The lists are built from the loaded roster rather than fetched per filter
 * change, so a coordinator flicking between filters never waits on the network.
 * Ids are matched against `member.roles[].role_id` / `member.skills[]
 * .instrument_id` rather than the display names, which is why the option list
 * comes from the tenant-scoped options endpoint: a name comparison would let a
 * member pass a filter on a role that no longer exists on their record.
 */
export function MemberFilters({
  open,
  onOpenChange,
  roles,
  instruments,
  selectedRoleIds,
  selectedInstrumentIds,
  onSelectedRoleIdsChange,
  onSelectedInstrumentIdsChange,
  matchCount,
  totalCount,
  optionsLoading = false,
  optionsError = '',
  onRetry,
}: MemberFiltersProps) {
  const activeCount = selectedRoleIds.length + selectedInstrumentIds.length;

  function toggle(list: string[], setList: (next: string[]) => void, id: string, checked: boolean) {
    setList(checked ? [...list, id] : list.filter((item) => item !== id));
  }

  function clearAll() {
    onSelectedRoleIdsChange([]);
    onSelectedInstrumentIdsChange([]);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={activeCount > 0 ? 'border-primary/50 text-foreground' : undefined}
            aria-label={activeCount > 0 ? `Filter, ${activeCount} active` : 'Filter members'}
          />
        }
      >
        <Filter className="h-4 w-4 mr-1" />
        Filter
        {activeCount > 0 ? (
          <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
            {activeCount}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 gap-3">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Roles</legend>
          {optionsLoading ? <div aria-busy="true" className="space-y-2 py-1"><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><span className="sr-only">Loading role filters</span></div> : optionsError ? (
            <p className="text-xs text-destructive">{optionsError}</p>
          ) : roles.length === 0 ? (
            <p className="text-xs text-muted-foreground">This church has no roles configured yet.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 has-[[data-checked]]:bg-primary/5"
                >
                  <Checkbox
                    checked={selectedRoleIds.includes(role.id)}
                    onCheckedChange={(checked) => toggle(selectedRoleIds, onSelectedRoleIdsChange, role.id, checked)}
                  />
                  <span className="flex-1 truncate">{role.name}</span>
                  {role.ministry_name ? (
                    <span className="truncate text-xs text-muted-foreground">{role.ministry_name}</span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Instruments</legend>
          {optionsLoading ? <div aria-busy="true" className="space-y-2 py-1"><div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-1/2 animate-pulse rounded bg-muted" /><span className="sr-only">Loading instrument filters</span></div> : optionsError ? (
            <p className="text-xs text-destructive">{optionsError}</p>
          ) : instruments.length === 0 ? (
            <p className="text-xs text-muted-foreground">This church has no instruments configured yet.</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
              {instruments.map((instrument) => (
                <label
                  key={instrument.id}
                  className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 has-[[data-checked]]:bg-primary/5"
                >
                  <Checkbox
                    checked={selectedInstrumentIds.includes(instrument.id)}
                    onCheckedChange={(checked) =>
                      toggle(selectedInstrumentIds, onSelectedInstrumentIdsChange, instrument.id, checked)
                    }
                  />
                  <span className="flex-1 truncate">{instrument.name}</span>
                  {instrument.ministry_name ? (
                    <span className="truncate text-xs text-muted-foreground">{instrument.ministry_name}</span>
                  ) : null}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex items-center justify-between border-t border-border pt-2.5">
          <p className="text-xs text-muted-foreground" role="status">
            {activeCount === 0
              ? `${totalCount} member${totalCount === 1 ? '' : 's'}`
              : `${matchCount} of ${totalCount} match`}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            disabled={activeCount === 0}
          >
            Clear all
          </Button>
        </div>
        {optionsError && onRetry ? <Button type="button" size="sm" variant="outline" className="w-full" onClick={onRetry} disabled={optionsLoading}>{optionsLoading ? 'Loading filters…' : 'Retry loading filters'}</Button> : null}
      </PopoverContent>
    </Popover>
  );
}
