import { Card, CardContent } from '@/components/ui/card';

type MemberProfileCardProps = {
  fullName: string;
  phone?: string | null;
  ministryRoles: string[];
  instruments: string[];
};

/**
 * The member's own profile, which leads the member workspace.
 *
 * It replaced a page header that described a page made of one task and pushed
 * the member's own details below the fold, so it spans the full grid and reads
 * across one band rather than stacking in a tall side column.
 *
 * The band has two breakpoints because it has two different jobs.
 *
 * On a phone the blocks stack. They used to share one line at every width, and
 * the name block was `flex-1` -- a zero flex basis -- so the wrap decision
 * believed it needed no space at all: the other blocks stayed on the line, the
 * name was left whatever sliver remained, and its text spilled across the block
 * beside it. Measured on a 3-role member, the name block was given 2.9px of a
 * 374px row at 414px wide and 24.5px of 520px at 560px wide. A column cannot
 * overlap its own children, so that is the phone layout.
 *
 * From `sm` up the band is a wrapping row again, and the name block's basis is
 * its content (`flex-auto`) rather than zero. The wrap decision therefore sees
 * the real widths, and when the roles and instruments do not fit beside the
 * name they move to the next line instead of squeezing it.
 */
export function MemberProfileCard({ fullName, phone, ministryRoles, instruments }: MemberProfileCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-8 sm:p-6">
        <div className="min-w-0 sm:flex-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Member workspace</p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold">{fullName}</h1>
          {phone ? <p className="mt-1.5 text-sm text-muted-foreground">{phone}</p> : null}
        </div>
        {ministryRoles.length ? (
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ministry role</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {ministryRoles.map((name) => (
                <li key={name}>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {instruments.length ? (
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Instrument</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {instruments.map((name) => (
                <li key={name}>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* A member with no role or instrument row is a real state, so it is
            stated rather than rendered as an empty list. The previous build
            hardcoded "Worship team member" here, which read as a role on every
            profile regardless of the truth. */}
        {!ministryRoles.length && !instruments.length ? (
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ministry role &amp; instrument</h2>
            <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet — ask the coordinator to update your profile.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
