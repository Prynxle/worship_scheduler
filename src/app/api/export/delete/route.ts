import { NextRequest } from 'next/server';
import { deleteExport } from '@/lib/export/delete-export';

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let id = searchParams.get('id');
  if (!id) {
    try {
      const body = await request.json().catch(() => null) as { id?: string } | null;
      if (body?.id) id = body.id;
    } catch {
      // ignore
    }
  }
  return deleteExport(request, id);
}
