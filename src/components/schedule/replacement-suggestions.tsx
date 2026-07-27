'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserPlus, Check } from 'lucide-react';
import { ReplacementSuggestion } from '@/lib/types/scheduling';

interface ReplacementSuggestionsProps {
  suggestions: ReplacementSuggestion[];
  onSelect?: (suggestion: ReplacementSuggestion) => void;
}

export function ReplacementSuggestions({ suggestions, onSelect }: ReplacementSuggestionsProps) {
  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'text-primary';
    if (score >= 0.6) return 'text-accent';
    return 'text-muted-foreground';
  };

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          Replacement Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
            >
              <div className="flex items-center gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                    {suggestion.member.full_name.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium text-foreground">{suggestion.member.full_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary">{suggestion.role.name}</Badge>
                    {suggestion.instrument && (
                      <Badge variant="outline">{suggestion.instrument.name}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {suggestion.reasons.slice(0, 3).map((reason, i) => (
                      <span key={i} className="text-xs text-muted-foreground">
                        {reason}{i < Math.min(suggestion.reasons.length, 3) - 1 ? ',' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className={`text-lg font-bold ${getConfidenceColor(suggestion.confidence_score)}`}>
                    {Math.round(suggestion.confidence_score * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">confidence</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => onSelect?.(suggestion)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Select
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
