'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, AlertCircle, Info, X, Check } from 'lucide-react';
import { ValidationResult } from '@/lib/types/scheduling';

interface ConflictListProps {
  conflicts: ValidationResult[];
  onResolve?: (conflict: ValidationResult) => void;
  onDismiss?: (conflict: ValidationResult) => void;
}

export function ConflictList({ conflicts, onResolve, onDismiss }: ConflictListProps) {
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-[oklch(0.70_0.08_80)]" />;
      default:
        return <Info className="h-5 w-5 text-accent" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-destructive/5 border-destructive/20';
      case 'warning':
        return 'bg-[oklch(0.70_0.08_80)]/5 border-[oklch(0.70_0.08_80)]/20';
      default:
        return 'bg-accent/5 border-accent/20';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-destructive/15 text-destructive border-destructive/20';
      case 'warning':
        return 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)] border-[oklch(0.70_0.08_80)]/20';
      default:
        return 'bg-accent/15 text-accent border-accent/20';
    }
  };

  if (conflicts.length === 0) {
    return (
      <Card className="card-glow">
        <CardContent className="py-8 text-center">
          <Check className="h-12 w-12 text-primary mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground">No conflicts found</h3>
          <p className="text-muted-foreground">All scheduling rules are satisfied</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[oklch(0.70_0.08_80)]" />
          Conflicts ({conflicts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {conflicts.map((conflict, index) => (
            <div
              key={index}
              className={`flex items-start justify-between rounded-lg border p-4 ${getSeverityColor(conflict.severity)}`}
            >
              <div className="flex items-start gap-3">
                {getSeverityIcon(conflict.severity)}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{conflict.message}</span>
                    <Badge className={getSeverityBadge(conflict.severity)}>
                      {conflict.severity}
                    </Badge>
                  </div>
                  {conflict.member_name && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Member: {conflict.member_name}
                    </p>
                  )}
                  {conflict.recommendation && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Recommendation: {conflict.recommendation}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {conflict.severity === 'critical' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onResolve?.(conflict)}
                  >
                    Resolve
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDismiss?.(conflict)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
