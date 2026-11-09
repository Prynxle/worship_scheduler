import { NextRequest } from 'next/server';
import { deleteExport } from '@/lib/export/delete-export';

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return deleteExport(request, id);
}
