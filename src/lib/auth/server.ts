import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'coordinator' | 'member';

export type AuthContext = {
  authId: string;
  userId: string;
  memberId: string | null;
  churchId: string;
  fullName: string;
  memberName: string | null;
  phone: string | null;
  role: AppRole;
};

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase server credentials are not configured');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: user } = await admin
    .from('users')
    .select('id, full_name, role, is_active, church_id')
    .eq('auth_id', data.user.id)
    .maybeSingle<{ id: string; full_name: string; role: AppRole; is_active: boolean; church_id: string }>();
  if (!user?.is_active) return null;

  const { data: member } = await admin
    .from('members')
    .select('id, status, full_name, phone')
    .eq('user_id', user.id)
    .eq('church_id', user.church_id)
    .maybeSingle<{ id: string; status: 'active' | 'inactive'; full_name: string; phone: string | null }>();

  return {
    authId: data.user.id,
    userId: user.id,
    memberId: member?.status === 'active' ? member.id : null,
    churchId: user.church_id,
    fullName: user.full_name,
    memberName: member?.status === 'active' ? member.full_name : null,
    phone: member?.status === 'active' ? member.phone : null,
    role: user.role,
  };
}

export function isStaff(role: AppRole) {
  return role === 'admin' || role === 'coordinator';
}

export async function requireStaff(request: Request): Promise<AuthContext | Response> {
  const context = await getAuthContext(request);
  if (!context) return new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  if (!isStaff(context.role)) return new Response(JSON.stringify({ error: 'Staff access required.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return context;
}
