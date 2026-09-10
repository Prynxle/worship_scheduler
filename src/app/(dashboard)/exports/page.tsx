'use client';

import { ExportOptions } from '@/components/exports/export-options';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Calendar, FileText, Image as ImageIcon } from 'lucide-react';

export default function ExportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Exports</h2>
          <p className="text-muted-foreground">Export schedules for printing and sharing</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExportOptions
          onExportPDF={() => console.log('Export PDF')}
          onExportImage={() => console.log('Export Image')}
          onExportPrint={() => console.log('Export Print')}
        />

        <Card className="card-glow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Select Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Month</label>
              <Select defaultValue="august">
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="july">July 2026</SelectItem>
                  <SelectItem value="august">August 2026</SelectItem>
                  <SelectItem value="september">September 2026</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Week</label>
              <Select defaultValue="all">
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select week" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Weeks</SelectItem>
                  <SelectItem value="1">Week 1</SelectItem>
                  <SelectItem value="2">Week 2</SelectItem>
                  <SelectItem value="3">Week 3</SelectItem>
                  <SelectItem value="4">Week 4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Format</label>
              <Select defaultValue="a4">
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4 Portrait</SelectItem>
                  <SelectItem value="a4-landscape">A4 Landscape</SelectItem>
                  <SelectItem value="social">Social Media (1080x1080)</SelectItem>
                  <SelectItem value="announcement">Church Announcement</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button className="w-full">
              <Download className="h-4 w-4 mr-1" />
              Generate Export
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="card-glow">
        <CardHeader>
          <CardTitle>Recent Exports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { name: 'August 2026 Schedule.pdf', type: 'PDF', date: 'Aug 1, 2026', size: '245 KB' },
              { name: 'Week 3 Announcement.png', type: 'Image', date: 'Jul 28, 2026', size: '1.2 MB' },
              { name: 'July 2026 Schedule.pdf', type: 'PDF', date: 'Jul 1, 2026', size: '238 KB' },
            ].map((exportItem, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-secondary p-2">
                    {exportItem.type === 'PDF' ? (
                      <FileText className="h-5 w-5 text-destructive" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-accent" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{exportItem.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {exportItem.type} &middot; {exportItem.size}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm text-muted-foreground">{exportItem.date}</div>
                  <Button variant="ghost" size="sm">
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
