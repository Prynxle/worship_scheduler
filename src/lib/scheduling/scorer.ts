import { Member } from '../types/database';
import { FairnessWeights, SchedulingConfig } from '../types/scheduling';

export interface TemporaryMemberState {
  currentMonthAssignments: number;
  totalAssignments: number;
  recentAssignments: number;
  lastAssignedDate?: string;
  lastAssignedWeek?: number;
  consecutiveAssignments: number;
  roleHistory: Map<string, number>;
  leaderAssignments: number;
}

export interface CandidateScore {
  total: number;
  monthlyWorkload: number;
  historicalWorkload: number;
  recentWorkload: number;
  consecutiveAssignment: number;
  roleWorkload: number;
  cooldown: number;
  leaderRotation: number;
}

const DEFAULT_WEIGHTS: FairnessWeights = {
  monthly_workload: 30,
  historical_workload: 1,
  recent_workload: 15,
  consecutive_assignment: 25,
  role_workload: 8,
  cooldown: 20,
  leader_rotation: 15,
};

export class FairnessScorer {
  private readonly weights: FairnessWeights;

  constructor(config?: SchedulingConfig) {
    this.weights = { ...DEFAULT_WEIGHTS, ...config?.fairness_weights };
  }

  score(
    member: Member,
    state: TemporaryMemberState,
    roleName: string,
    weekNumber: number,
    isLeader: boolean,
    cooldownWeeks: number,
    serviceDate?: string,
  ): CandidateScore {
    const roleCount = state.roleHistory.get(roleName) ?? 0;
    const weeksSinceLastAssignment = serviceDate && state.lastAssignedDate
      ? Math.floor((new Date(serviceDate).getTime() - new Date(state.lastAssignedDate).getTime()) / (7 * 86_400_000))
      : undefined;
    const consecutive = state.lastAssignedWeek === weekNumber - 1 || weeksSinceLastAssignment === 1
      ? state.consecutiveAssignments + 1
      : 0;
    const cooldown = (state.lastAssignedWeek === weekNumber - 1 || (weeksSinceLastAssignment !== undefined && weeksSinceLastAssignment >= 0 && weeksSinceLastAssignment < cooldownWeeks))
      ? cooldownWeeks > 0 ? 1 : 0
      : 0;
    const score: CandidateScore = {
      monthlyWorkload: state.currentMonthAssignments * this.weights.monthly_workload,
      historicalWorkload: state.totalAssignments * this.weights.historical_workload,
      recentWorkload: state.recentAssignments * this.weights.recent_workload,
      consecutiveAssignment: consecutive * this.weights.consecutive_assignment,
      roleWorkload: roleCount * this.weights.role_workload,
      cooldown: cooldown * this.weights.cooldown,
      leaderRotation: isLeader ? state.leaderAssignments * this.weights.leader_rotation : 0,
      total: 0,
    };
    score.total = Object.entries(score)
      .filter(([key]) => key !== 'total')
      .reduce((sum, [, value]) => sum + value, 0);
    void member;
    return score;
  }
}

export { DEFAULT_WEIGHTS };
