'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Church, Loader2, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as {
        error?: string;
        access_token?: string;
        refresh_token?: string;
      };

      if (!response.ok || !result.access_token || !result.refresh_token) {
        setError(result.error ?? 'We could not sign you in.');
        return;
      }

      const { error: sessionError } = await getSupabaseClient().auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (sessionError) {
        setError('Your session could not be saved. Please try again.');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('We could not reach the sign-in service. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#11100e] text-[#f5efe4]">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden="true">
        <div className="absolute -left-32 top-16 h-96 w-96 rounded-full bg-[#c9944c]/15 blur-3xl" />
        <div className="absolute -bottom-48 right-0 h-[34rem] w-[34rem] rounded-full bg-[#73563a]/20 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,.03)_48%,transparent_49%)]" />
      </div>

      <section className="relative hidden flex-1 flex-col justify-between border-r border-white/10 p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-3 text-sm uppercase tracking-[0.22em] text-[#d8b477]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d8b477]/50">
            <Church className="h-4 w-4" />
          </span>
          JOHIA
        </div>
        <div className="max-w-xl">
          <p className="mb-5 text-xs uppercase tracking-[0.36em] text-[#d8b477]/70">Worship team workspace</p>
          <h1 className="font-display text-6xl leading-[0.95] tracking-[-0.04em] text-[#f6ead6] xl:text-8xl">
            Make room for the song.
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-[#b9aa96]">
            Your roster, availability, and Sunday assignments in one quiet place.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-[#9f917f]">
          <UsersRound className="h-4 w-4 text-[#d8b477]" />
          A shared space for the whole team
        </div>
      </section>

      <section className="relative flex w-full items-center justify-center px-5 py-10 sm:px-10 lg:max-w-xl lg:px-16">
        <Card className="w-full max-w-md border-white/10 bg-white/[0.045] shadow-2xl shadow-black/30 backdrop-blur-xl">
          <CardHeader className="px-7 pt-8 sm:px-9 sm:pt-10">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#d8b477]/50 text-[#d8b477]">
                <Church className="h-4 w-4" />
              </div>
              <span className="text-xs uppercase tracking-[0.24em] text-[#d8b477]">JOHIA</span>
            </div>
            <p className="mb-3 text-xs uppercase tracking-[0.3em] text-[#d8b477]">Welcome in</p>
            <CardTitle className="font-display text-4xl tracking-[-0.04em] text-[#f6ead6]">What should we call you?</CardTitle>
            <CardDescription className="pt-2 text-[#b9aa96]">Use the name on the worship roster.</CardDescription>
          </CardHeader>
          <CardContent className="px-7 pb-8 sm:px-9 sm:pb-10">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label className="text-[#d4c7b5]" htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Zedrick"
                  className="h-12 border-white/10 bg-black/20 text-base text-[#f6ead6] placeholder:text-[#8f8171] focus-visible:border-[#d8b477] focus-visible:ring-[#d8b477]/30"
                  required
                />
              </div>
              {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
              <Button
                type="submit"
                disabled={isLoading || !name.trim()}
                className="h-12 w-full bg-[#d8b477] text-[#211a13] hover:bg-[#edcc91]"
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                {isLoading ? 'Checking the roster…' : 'Enter workspace'}
              </Button>
            </form>
            <p className="mt-6 text-center text-xs leading-5 text-[#8f8171]">
              Names are matched without regard to capitalization.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
