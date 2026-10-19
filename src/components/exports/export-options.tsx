'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';

interface ExportOptionsProps {
  onExportPDF?: () => void;
  isExporting?: boolean;
}

/**
 * The export formats on offer. PDF is the only format that is actually
 * generated; the image and print entries were removed rather than left as
 * silent no-op buttons that merely looked functional.
 */
export function ExportOptions({ onExportPDF, isExporting }: ExportOptionsProps) {
  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          Export Schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default">
          <div className="flex items-center gap-4">
            <div className="rounded-lg p-2 bg-destructive/10">
              <FileText className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <div className="font-medium text-foreground">PDF Document</div>
              <div className="text-sm text-muted-foreground">High-quality PDF for printing or sharing</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onExportPDF} disabled={isExporting}>
            {isExporting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
                Exporting...
              </span>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Export
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
