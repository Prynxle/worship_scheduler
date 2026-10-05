'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Music } from 'lucide-react';
import { MinistryConfig } from '@/components/ministries/ministry-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { MinistriesResponse, MinistryWithConfiguration } from '@/lib/ministries/types';

function responseError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  return typeof payload.error === 'string' ? payload.error : null;
}

export default function MinistriesPage() {
  const [ministries, setMinistries] = useState<MinistryWithConfiguration[]>([]);
  const [selectedMinistryId, setSelectedMinistryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadMinistries() {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await getSupabaseClient().auth.getSession();
        if (!session) {
          if (!cancelled) setError('Your session has expired. Sign in again to load ministry configuration.');
          return;
        }

        const response = await fetch('/api/ministries', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) throw new Error('Your session has expired. Sign in again to load ministry configuration.');
          throw new Error(responseError(payload) ?? 'Could not load ministry configuration.');
        }
        if (!payload || typeof payload !== 'object' || !('ministries' in payload) || !Array.isArray(payload.ministries)) {
          throw new Error('The ministry configuration response was invalid. Please try again.');
        }

        if (!cancelled) {
          const data = payload as MinistriesResponse;
          setMinistries(data.ministries);
          setSelectedMinistryId((current) => data.ministries.some((item) => item.id === current) ? current : data.ministries[0]?.id ?? '');
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load ministry configuration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMinistries();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const currentMinistry = ministries.find((ministry) => ministry.id === selectedMinistryId) ?? ministries[0];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Ministries</h2>
        <p className="text-muted-foreground">View ministry roles and scheduling configuration</p>
      </div>

      {loading && (
        <div role="status" aria-live="polite" className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
          Loading ministry configuration…
        </div>
      )}

      {!loading && error && (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/50 bg-card p-6">
          <p className="font-medium text-foreground">{error}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
              Try again
            </Button>
            {error.includes('Sign in') && <Link className="text-sm text-primary underline" href="/login">Go to sign in</Link>}
          </div>
        </div>
      )}

      {!loading && !error && ministries.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-semibold text-foreground">No ministries configured</h3>
          <p className="mt-1 text-sm text-muted-foreground">There are no ministries available for your church yet.</p>
        </div>
      )}

      {!loading && !error && currentMinistry && (
        <>
          <div className="flex flex-wrap items-center gap-3" aria-label="Select ministry">
            {ministries.map((ministry) => (
              <Button
                key={ministry.id}
                variant={currentMinistry.id === ministry.id ? 'default' : 'outline'}
                aria-pressed={currentMinistry.id === ministry.id}
                onClick={() => setSelectedMinistryId(ministry.id)}
              >
                <Music aria-hidden="true" className="mr-1 h-4 w-4" />
                {ministry.name}
              </Button>
            ))}
          </div>

          <MinistryConfig
            ministry={currentMinistry}
            roles={currentMinistry.roles}
            effectiveBackupRange={currentMinistry.effective_backup_range}
          />

          <div className="grid gap-6 md:grid-cols-2">
            <section className="space-y-4" aria-labelledby="ministry-rules-heading">
              <h3 id="ministry-rules-heading" className="text-lg font-semibold text-foreground">Ministry Rules</h3>
              {currentMinistry.rules.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No rules are configured for this ministry.</p>
              ) : (
                <div className="space-y-2">
                  {currentMinistry.rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
                      <div>
                        <div className="font-medium text-foreground">{rule.name}</div>
                        <div className="text-sm text-muted-foreground">{rule.description}</div>
                      </div>
                      <Badge variant={rule.is_active ? 'secondary' : 'outline'} aria-label={`${rule.name} ${rule.is_active ? 'enabled' : 'disabled'}`}>
                        {rule.is_active ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4" aria-labelledby="instrument-configuration-heading">
              <h3 id="instrument-configuration-heading" className="text-lg font-semibold text-foreground">Instrument Configuration</h3>
              {currentMinistry.instruments.length === 0 ? (
                <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No instruments are configured for this ministry.</p>
              ) : (
                <div className="space-y-2">
                  {currentMinistry.instruments.map((instrument) => (
                    <div key={instrument.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
                      <div>
                        <div className="font-medium text-foreground">{instrument.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {instrument.min_count} required {instrument.min_count === 1 ? 'slot' : 'slots'} · maximum {instrument.max_count}
                        </div>
                      </div>
                      <Badge variant={instrument.is_required ? 'secondary' : 'outline'}>
                        {instrument.is_required ? 'Required' : 'Optional'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
