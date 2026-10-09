import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, requireStaff } from '@/lib/auth/server';
import {
  AudienceError,
  parseAudienceSpec,
  resolveAudience,
} from '@/lib/announcements/audience';
import { isUuid } from '@/lib/members/validation';

const MAX_TITLE_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 5000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Announcement broadcast and feed routes (issue #45).
 *
 * Reads are scoped to the caller's own rows (`user_id` + `church_id` from the
 * authenticated session, never from the request). Publishing is staff-only and
 * resolves recipients server-side; rows are written with the service-role
 * client because one broadcast inserts a row for every recipient.
 */

export async function GET(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { searchParams } = new URL(request.url);

  const limitRaw = Number(searchParams.get('limit') ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const before = searchParams.get('before');
  if (before && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: 'The pagination cursor is not valid.' }, { status: 400 });
  }

  const admin = getAdminClient();

  let query = admin
    .from('notifications')
    .select('id, type, title, message, is_read, created_at, created_by, audience_type, announcement_id')
    .eq('user_id', context.userId)
    .eq('church_id', context.churchId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load notifications.' }, { status: 500 });

  // The badge counts every unread row, not just the ones on this page, so an
  // older unread announcement cannot make the indicator understate. Removed
  // rows are not "on the list" anymore, so they leave the count with the feed.
  const { count: unreadCount, error: countError } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', context.userId)
    .eq('church_id', context.churchId)
    .is('dismissed_at', null)
    .eq('is_read', false);
  if (countError) return NextResponse.json({ error: 'Could not load notifications.' }, { status: 500 });

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && notifications.length > 0
    ? (notifications[notifications.length - 1].created_at as string)
    : null;

  return NextResponse.json({ notifications, nextCursor, unreadCount: unreadCount ?? 0 });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `The title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'A message is required.' }, { status: 400 });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `The message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  const audience = parseAudienceSpec(body.audience);
  if (!audience) {
    return NextResponse.json(
      { error: 'Choose who should receive this announcement.' },
      { status: 400 },
    );
  }

  const admin = getAdminClient();

  let recipients: string[];
  try {
    recipients = await resolveAudience(admin, auth.churchId, audience);
  } catch (error) {
    if (error instanceof AudienceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // One uuid for the whole fan-out: every recipient row of this broadcast
  // shares it, which is what lets DELETE remove the announcement entirely
  // rather than one recipient's copy.
  const announcementId = crypto.randomUUID();
  const rows = recipients.map((userId) => ({
    user_id: userId,
    church_id: auth.churchId,
    type: 'announcement',
    title,
    message,
    created_by: auth.userId,
    audience_type: audience.type,
    announcement_id: announcementId,
  }));

  const { error: insertError } = await admin.from('notifications').insert(rows);
  if (insertError) return NextResponse.json({ error: 'Could not publish the announcement.' }, { status: 500 });

  return NextResponse.json({ announcement: { recipients: recipients.length } }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  // `action: 'read'` marks rows read; `action: 'dismiss'` stamps dismissed_at,
  // which removes the rows from this recipient's feed without touching the
  // database rows anyone else still sees. Dismiss is per-id only: there is no
  // "dismiss everything" shortcut, because that would silently empty a feed.
  const action = body.action === 'dismiss' ? 'dismiss' : 'read';
  const markAll = body.all === true;
  const ids = Array.isArray(body.ids) ? body.ids : null;

  if (action === 'dismiss' && markAll) {
    return NextResponse.json(
      { error: 'Choose the notifications to remove.' },
      { status: 400 },
    );
  }

  if (!markAll) {
    if (!ids || ids.length === 0 || !ids.every(isUuid)) {
      return NextResponse.json(
        { error: action === 'dismiss'
          ? 'Provide the notification ids to remove.'
          : 'Provide the notification ids to mark as read, or set all to true.' },
        { status: 400 },
      );
    }
  }

  const patch = action === 'dismiss'
    ? { dismissed_at: new Date().toISOString() }
    : { is_read: true };

  // Service-role client, so the row scope here IS the enforcement: filter to
  // the caller's own rows before writing, exactly as the UPDATE RLS policy
  // would require of a direct client.
  let query = getAdminClient()
    .from('notifications')
    .update(patch)
    .eq('user_id', context.userId)
    .eq('church_id', context.churchId);
  if (!markAll) query = query.in('id', ids as string[]);

  const { data, error } = await query.select('id');
  if (error) return NextResponse.json({ error: 'Could not update the notifications.' }, { status: 500 });

  return NextResponse.json({ updated: data?.length ?? 0 });
}

export async function DELETE(request: NextRequest) {
  // Staff-only: a delete removes every recipient's row of the announcement,
  // not just the caller's copy, so admin/coordinator is checked server-side.
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  const announcementIds = Array.isArray(body.announcement_ids) ? body.announcement_ids : null;
  if (!announcementIds || announcementIds.length === 0 || !announcementIds.every(isUuid)) {
    return NextResponse.json(
      { error: 'Provide the announcement ids to delete.' },
      { status: 400 },
    );
  }

  // Church-scoped: an id from another tenant matches no row and deletes
  // nothing, same stance the audience resolver takes on foreign ids.
  const { data, error } = await getAdminClient()
    .from('notifications')
    .delete()
    .eq('church_id', auth.churchId)
    .in('announcement_id', [...new Set(announcementIds as string[])])
    .select('id');
  if (error) return NextResponse.json({ error: 'Could not delete the announcement.' }, { status: 500 });

  return NextResponse.json({ deleted: data?.length ?? 0 });
}
