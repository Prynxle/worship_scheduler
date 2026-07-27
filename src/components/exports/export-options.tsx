'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileImage, FileText, Printer } from 'lucide-react';

interface ExportOptionsProps {
  onExportPDF?: () => void;
  onExportImage?: () => void;
  onExportPrint?: () => void;
  isExporting?: boolean;
}

export function ExportOptions({
  onExportPDF,
  onExportImage,
  onExportPrint,
  isExporting,
}: ExportOptionsProps) {
  const exports = [
    {
      title: 'PDF Document',
      description: 'High-quality PDF for printing or sharing',
      icon: FileText,
      action: onExportPDF,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
    },
    {
      title: 'Image (PNG)',
      description: 'High-resolution image for social media',
      icon: FileImage,
      action: onExportImage,
      color: 'text-accent',
      bgColor: 'bg-accent/10',
    },
    {
      title: 'Print Layout',
      description: 'Optimized A4 layout for printing',
      icon: Printer,
      action: onExportPrint,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
  ];

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          Export Schedule
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {exports.map((exportOption) => (
            <div
              key={exportOption.title}
              className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
            >
              <div className="flex items-center gap-4">
                <div className={`rounded-lg p-2 ${exportOption.bgColor}`}>
                  <exportOption.icon className={`h-5 w-5 ${exportOption.color}`} />
                </div>
                <div>
                  <div className="font-medium text-foreground">{exportOption.title}</div>
                  <div className="text-sm text-muted-foreground">{exportOption.description}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={exportOption.action}
                disabled={isExporting}
              >
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
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
