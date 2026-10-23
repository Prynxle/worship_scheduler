import type { ComponentProps } from 'react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemberProfileCard } from './member-profile-card';

/**
 * Layout contract for the member profile card (issue #90 follow-up).
 *
 * The card is a single band: the member's name and phone, their ministry roles
 * and their instruments. Measured on the worst profile in the roster, the band
 * used to break at phone widths: the name block was `flex-1`, whose zero flex
 * basis made the wrap decision believe it needed no space, so the other blocks
 * stayed on the same line, the name was left a sliver (2.9px of a 374px row at
 * 414px wide) and its text spilled across the block beside it.
 *
 * The rendered markup is checked because this repository has no DOM test
 * environment; `react-dom/server` is enough to see the structure and the
 * classes that produce it.
 */

type Props = ComponentProps<typeof MemberProfileCard>;

/** The widest profile in the roster: three roles and an instrument. */
const WORST_CASE: Props = {
  fullName: 'Dhon Obniala',
  phone: '0917 000 0000',
  ministryRoles: ['Worship Leader', 'Back Up', 'Instrumentalist'],
  instruments: ['Bass'],
};

function render(props: Props = WORST_CASE): string {
  return renderToStaticMarkup(createElement(MemberProfileCard, props));
}

function classesOf(markup: string, pattern: RegExp): string[] {
  const match = markup.match(pattern);
  if (!match) throw new Error(`No element matched ${pattern}`);
  return match[1].trim().split(/\s+/);
}

/** The class list of the block that holds the name and the phone number. */
const strip = (markup: string) =>
  classesOf(markup, /data-slot="card-content"[^>]*?class="([^"]*)"/);

/** The class list of the first block inside the strip. */
const nameBlock = (markup: string) =>
  classesOf(markup, /data-slot="card-content"[^>]*>\s*<div class="([^"]*)"/);

describe('MemberProfileCard', () => {
  it('stacks its blocks on a phone', () => {
    // A column cannot overlap its own children, which is what the phone layout
    // needs: every block keeps the full width of the card.
    expect(strip(render())).toContain('flex-col');
  });

  it('lays the blocks out as a wrapping row from small screens up', () => {
    const classes = strip(render());
    expect(classes).toContain('sm:flex-row');
    // Without wrapping, a row that runs out of room squeezes its blocks
    // instead of moving them to the next line.
    expect(classes).toContain('sm:flex-wrap');
  });

  it('gives the name block a content-sized basis so it is never squeezed to a sliver', () => {
    const classes = nameBlock(render());
    // `flex-1` is `flex: 1 1 0%`: a zero basis, which is what hid the name's
    // real width from the wrap decision.
    expect(classes).toContain('sm:flex-auto');
    expect(classes).not.toContain('flex-1');
    // It may still shrink when it has a line to itself.
    expect(classes).toContain('min-w-0');
  });

  it('renders every role and every instrument', () => {
    const markup = render();

    expect(markup).toContain('Ministry role');
    for (const role of WORST_CASE.ministryRoles) expect(markup).toContain(role);
    expect(markup).toContain('Instrument');
    for (const instrument of WORST_CASE.instruments) expect(markup).toContain(instrument);
  });

  it('states an empty profile instead of rendering empty blocks', () => {
    const markup = render({ fullName: 'Sam Remolano', ministryRoles: [], instruments: [] });

    expect(markup).toContain('Nothing recorded yet');
    expect(markup).not.toContain('Ministry role</h2>');
    expect(markup).not.toContain('Instrument</h2>');
  });

  it('shows the phone number only when the profile has one', () => {
    expect(render()).toContain('0917 000 0000');
    expect(render({ ...WORST_CASE, phone: null })).not.toContain('0917 000 0000');
  });
});
