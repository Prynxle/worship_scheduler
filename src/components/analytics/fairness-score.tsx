'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Target } from 'lucide-react';
import { FairnessReport } from '@/lib/types/scheduling';

interface FairnessScoreProps {
  overallScore: number;
  reports: FairnessReport[];
  /** Optional cap for compact placements; the Fairness tab passes no cap. */
  limit?: number;
}

export function FairnessScore({ overallScore, reports, limit }: FairnessScoreProps) {
  const visibleReports = limit ? reports.slice(0, limit) : reports;
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

        {reports.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No active members with assignments for this month.
          </p>
        ) : (
          <>
            <div className="space-y-0">
              {visibleReports.map((report) => {
                const atLimit = report.assignment_count >= report.max_allowed;
                const overLimit = report.assignment_count > report.max_allowed;
                const badgeLabel = overLimit ? 'over limit' : atLimit ? 'at limit' : report.status;

                return (
                  <div
                    key={report.member_id}
                    className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-muted-foreground">
                        {report.member_name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {report.member_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {report.assignment_count}/{report.max_allowed} assignments ·{' '}
                          {Math.round(report.utilization)}% of limit · score{' '}
                          {Math.round(report.fairness_score)}
                        </div>
                      </div>
                    </div>
                    <Badge
                      className={
                        atLimit
                          ? 'shrink-0 bg-destructive/15 text-destructive border-destructive/20'
                          : getStatusColor(report.status)
                      }
                    >
                      {badgeLabel}
                    </Badge>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Member score is 100 at the 60% workload target and falls as workload moves away
              from it. Overall is the mean member score.
            </p>
            {limit !== undefined && reports.length > limit ? (
              <p className="text-xs text-muted-foreground">
                Showing the {limit} most-assigned members. The Fairness tab lists everyone.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
