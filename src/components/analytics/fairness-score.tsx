'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Target } from 'lucide-react';
import { FairnessReport } from '@/lib/types/scheduling';

interface FairnessScoreProps {
  overallScore: number;
  reports: FairnessReport[];
}

export function FairnessScore({ overallScore, reports }: FairnessScoreProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'underutilized':
        return 'bg-accent/15 text-accent border-accent/20';
      case 'overutilized':
        return 'bg-destructive/15 text-destructive border-destructive/20';
      default:
        return 'bg-primary/15 text-primary border-primary/20';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-primary';
    if (score >= 60) return 'text-accent';
    return 'text-destructive';
  };

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Fairness Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <div className={`text-4xl font-bold ${getScoreColor(overallScore)}`}>
            {Math.round(overallScore)}%
          </div>
          <p className="text-sm text-muted-foreground mt-1">Overall Fairness</p>
        </div>

        <Progress value={overallScore} className="h-2" />

        <div className="space-y-0">
          {reports.slice(0, 10).map((report) => (
            <div
              key={report.member_id}
              className="flex items-center justify-between py-2.5 border-b border-border last:border-0"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-sm font-medium text-muted-foreground">
                  {report.member_name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{report.member_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {report.assignment_count}/{report.max_allowed} assignments
                  </div>
                </div>
              </div>
              <Badge className={getStatusColor(report.status)}>
                {report.status}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
