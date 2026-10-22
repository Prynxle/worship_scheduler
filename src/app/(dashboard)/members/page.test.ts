import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MembersPage from './page';

/**
 * Layout contract for the Members page (issue #90).
 *
 * Two rows of this page put text next to a control, and both of them ran out
 * of room on a phone: the search field was squeezed to a couple of characters
 * wide, and the title sat flush against the Add Member button. The card grid
 * had the same problem from the other side -- its column track was sized by
 * the content, so the cards were wider than the screen and their right edge,
 * the Edit button included, was cut off.
 */

function renderPage(): string {
  return renderToStaticMarkup(createElement(MembersPage));
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

describe('MembersPage', () => {
  it('keeps the title clear of the Add Member button', () => {
    const markup = renderPage();
    const title = markup.indexOf('>Members</h2>');

    // The title block may shrink, so the button is never pushed off screen.
    expect(classesOfTag(enclosingDivTag(markup, title))).toContain('min-w-0');

    // And the row keeps a gap between the two.
    expect(classesOfTag(enclosingDivTag(markup, title, 2))).toContain('gap-3');
  });

  it('gives the search field the whole row on a phone', () => {
    const markup = renderPage();
    const field = markup.indexOf('aria-label="Search members"');

    // The field takes the full width of the toolbar, and the toolbar wraps,
    // so the Filter and member count buttons drop to the line below it
    // instead of squeezing the field down to a couple of characters.
    const searchBox = classesOfTag(enclosingDivTag(markup, field));
    expect(searchBox).toContain('w-full');
    expect(searchBox).toContain('min-w-0');
    expect(classesOfTag(enclosingDivTag(markup, field, 2))).toContain('flex-wrap');
  });

  it('gives the card grid a column template that can shrink', () => {
    // The grid only exists once the roster has loaded, and this repository has
    // no DOM test environment to drive the page into that state, so the
    // template is checked against the source.
    const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
    const grids = [...source.matchAll(/className="([^"]*)"/g)]
      .map((match) => match[1])
      .filter((className) => className.includes('md:grid-cols-2'));

    expect(grids).toHaveLength(1);
    // An implicit column is sized `auto`, whose minimum is the content's
    // width, so the track stayed wider than a phone screen.
    expect(grids[0]).toContain('grid-cols-1');
  });
});
