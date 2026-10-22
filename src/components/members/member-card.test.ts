import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemberCard } from './member-card';
import type { Member } from '@/lib/types/database';

/**
 * Layout contract for the member card (issue #90).
 *
 * On a phone the card is a couple of hundred pixels wide, and the header row
 * puts three things in it: the avatar, the member's name and nickname, and the
 * Edit control. Two of those are text the coordinator has to read, and they
 * collided: the name was squeezed into a narrow column beside the nickname,
 * and the row's minimum width was the width of that content, so the card grew
 * wider than the screen and its right edge was cut off.
 *
 * These assertions are about the rendered markup rather than about pixels
 * because the repository has no DOM test environment; `react-dom/server` is
 * enough to see the structure and the classes that produce it.
 */

/** The longest name in the roster, with the longest nickname: the worst case. */
const MEMBER: Member = {
  id: 'member-1',
  church_id: 'church-1',
  full_name: 'Amirah Hechanova Cruz',
  nickname: 'Shael',
  status: 'active',
  gender: 'female',
  max_monthly_assignments: 3,
  priority_score: 50,
  total_assignments: 0,
  last_scheduled_date: '2026-10-05T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function renderCard(member: Member = MEMBER): string {
  return renderToStaticMarkup(createElement(MemberCard, { member, onEdit: () => {} }));
}

/**
 * The opening tag that starts at `start`. Scans for the closing `>` outside of
 * attribute values, because Tailwind classes such as `[&>svg]` contain one.
 */
function openingTag(markup: string, start: number): string {
  let quote: string | null = null;
  for (let i = start + 1; i < markup.length; i += 1) {
    const char = markup[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return markup.slice(start, i + 1);
    }
  }
  throw new Error(`Unterminated tag at ${start}`);
}

function classesOfTag(tag: string): string[] {
  const match = tag.match(/class="([^"]*)"/);
  if (!match) throw new Error(`No class attribute on ${tag}`);
  return match[1].trim().split(/\s+/);
}

/**
 * The opening tag of the `levels`-th `<div>` that encloses the position
 * `index`. Level one is the innermost div, level two its parent, and so on.
 */
function enclosingDivTag(markup: string, index: number, levels = 1): string {
  let from = index;
  for (let level = 0; level < levels; level += 1) {
    const start = markup.lastIndexOf('<div class="', from - 1);
    if (start === -1) throw new Error('No enclosing div');
    from = start;
  }
  return openingTag(markup, from);
}

describe('MemberCard', () => {
  it('keeps the name and the nickname in one text flow', () => {
    const markup = renderCard();
    const heading = markup.slice(markup.indexOf('<h3'), markup.indexOf('</h3>'));

    expect(heading).toContain('Amirah Hechanova Cruz');
    // The nickname is inside the heading, so the two wrap together instead of
    // competing for the same column of the card.
    expect(heading).toMatch(/<span[^>]*>\(Shael\)<\/span>/);
  });

  it('lets the identity block shrink below the width of its content', () => {
    const markup = renderCard();

    // The block that holds the name.
    const nameBlock = classesOfTag(enclosingDivTag(markup, markup.indexOf('<h3')));
    expect(nameBlock).toContain('min-w-0');

    // The row that holds that block and the avatar. A flex item's automatic
    // minimum size is its content width, which is what pushed the card past
    // the edge of the screen.
    const avatar = markup.indexOf('<div class="rounded-full bg-card">');
    const identityRow = classesOfTag(enclosingDivTag(markup, avatar, 2));
    expect(identityRow).toContain('min-w-0');
  });

  it('keeps the name and the Edit control apart', () => {
    const markup = renderCard();

    // The header row has a gap, so the identity block and the Edit control
    // can never sit flush against each other.
    const avatar = markup.indexOf('<div class="rounded-full bg-card">');
    const headerRow = classesOfTag(enclosingDivTag(markup, avatar, 3));
    expect(headerRow).toContain('gap-3');
  });

  it('does not squeeze the avatar or the Edit control', () => {
    const markup = renderCard();

    // The avatar wrapper is the row the name sits next to, so it must keep
    // its size: a shrunken avatar is worse than a wrapped name.
    const avatar = markup.indexOf('<div class="rounded-full bg-card">');
    expect(classesOfTag(enclosingDivTag(markup, avatar, 1))).toContain('shrink-0');

    // The Edit control is the one thing on the row that must stay whole.
    const edit = markup.indexOf('aria-label="Edit Amirah Hechanova Cruz"');
    const editTag = openingTag(markup, markup.lastIndexOf('<button', edit));
    expect(classesOfTag(editTag)).toContain('shrink-0');
  });

  it('breaks a long name instead of letting it overflow the card', () => {
    const markup = renderCard();
    const heading = classesOfTag(openingTag(markup, markup.indexOf('<h3')));
    expect(heading).toContain('break-words');
  });

  it('wraps the assignment count and the last scheduled date', () => {
    const markup = renderCard();
    const metaRow = classesOfTag(enclosingDivTag(markup, markup.indexOf('Assignments:')));
    expect(metaRow).toContain('flex-wrap');
  });
});
