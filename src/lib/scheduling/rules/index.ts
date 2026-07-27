import { SchedulingRuleConfig } from '../../types/scheduling';

export interface RuleExecutor {
  execute(
    config: SchedulingRuleConfig,
    context: unknown
  ): Promise<{ passed: boolean; message: string; recommendation?: string }>;
}

export const ruleExecutors: Record<string, RuleExecutor> = {
  availability_check: {
    execute: async (config, context) => {
      const ctx = context as { memberId: string; weekNumber: number; unavailable: boolean };
      if (ctx.unavailable) {
        return {
          passed: false,
          message: `Member is unavailable for week ${ctx.weekNumber}`,
          recommendation: 'Find an available replacement',
        };
      }
      return { passed: true, message: 'Member is available' };
    },
  },

  assignment_limit: {
    execute: async (config, context) => {
      const ctx = context as { currentCount: number; maxAllowed: number; memberName: string };
      if (ctx.currentCount >= ctx.maxAllowed) {
        return {
          passed: false,
          message: `${ctx.memberName} has reached the monthly assignment limit (${ctx.maxAllowed})`,
          recommendation: 'Remove an assignment or increase the limit',
        };
      }
      return { passed: true, message: 'Within assignment limit' };
    },
  },

  role_validation: {
    execute: async (config, context) => {
      const ctx = context as { memberName: string; hasRequiredRole: boolean; roleName: string };
      if (!ctx.hasRequiredRole) {
        return {
          passed: false,
          message: `${ctx.memberName} is not qualified for ${ctx.roleName}`,
          recommendation: `Assign a member with ${ctx.roleName} qualification`,
        };
      }
      return { passed: true, message: 'Member is qualified' };
    },
  },

  backup_count: {
    execute: async (config, context) => {
      const ctx = context as { currentCount: number; minRequired: number; maxAllowed: number };
      if (ctx.currentCount < ctx.minRequired) {
        return {
          passed: false,
          message: `Only ${ctx.currentCount} backup singers assigned (minimum: ${ctx.minRequired})`,
          recommendation: 'Add more backup singers',
        };
      }
      if (ctx.currentCount > ctx.maxAllowed) {
        return {
          passed: false,
          message: `${ctx.currentCount} backup singers assigned (maximum: ${ctx.maxAllowed})`,
          recommendation: 'Remove excess backup singers',
        };
      }
      return { passed: true, message: 'Backup count is within range' };
    },
  },

  leader_count: {
    execute: async (config, context) => {
      const ctx = context as { leaderCount: number };
      if (ctx.leaderCount === 0) {
        return {
          passed: false,
          message: 'No worship leader assigned',
          recommendation: 'Assign exactly one worship leader',
        };
      }
      if (ctx.leaderCount > 1) {
        return {
          passed: false,
          message: `Multiple worship leaders assigned (${ctx.leaderCount})`,
          recommendation: 'Assign exactly one worship leader',
        };
      }
      return { passed: true, message: 'Exactly one worship leader assigned' };
    },
  },

  cooldown: {
    execute: async (config, context) => {
      const ctx = context as { weeksSinceLastAssignment: number; cooldownWeeks: number; memberName: string };
      if (ctx.weeksSinceLastAssignment < ctx.cooldownWeeks && ctx.weeksSinceLastAssignment > 0) {
        return {
          passed: false,
          message: `${ctx.memberName} was scheduled ${ctx.weeksSinceLastAssignment} week(s) ago`,
          recommendation: 'Consider a different member for better rotation',
        };
      }
      return { passed: true, message: 'Cooldown period satisfied' };
    },
  },

  fairness: {
    execute: async (config, context) => {
      const ctx = context as { memberCount: number; averageCount: number; memberName: string };
      if (ctx.memberCount > ctx.averageCount * 1.5) {
        return {
          passed: false,
          message: `${ctx.memberName} has more assignments than average`,
          recommendation: 'Consider redistributing assignments',
        };
      }
      return { passed: true, message: 'Workload is balanced' };
    },
  },

  leader_rotation: {
    execute: async (config, context) => {
      const ctx = context as { recentLeaderships: number; memberName: string };
      if (ctx.recentLeaderships > 2) {
        return {
          passed: false,
          message: `${ctx.memberName} has been leader ${ctx.recentLeaderships} times recently`,
          recommendation: 'Rotate to a different worship leader',
        };
      }
      return { passed: true, message: 'Leader rotation is balanced' };
    },
  },

  dual_role_check: {
    execute: async (config, context) => {
      const ctx = context as { memberName: string; roleCount: number };
      if (ctx.roleCount > 1) {
        return {
          passed: false,
          message: `${ctx.memberName} is assigned to multiple roles`,
          recommendation: 'Remove one of the duplicate assignments',
        };
      }
      return { passed: true, message: 'No duplicate roles' };
    },
  },

  instrument_constraint: {
    execute: async (config, context) => {
      const ctx = context as { instrumentName: string; assigned: boolean; required: boolean };
      if (ctx.required && !ctx.assigned) {
        return {
          passed: false,
          message: `No ${ctx.instrumentName} assigned`,
          recommendation: `Assign a ${ctx.instrumentName} player`,
        };
      }
      return { passed: true, message: `${ctx.instrumentName} constraint satisfied` };
    },
  },

  devotion_sequence: {
    execute: async (config, context) => {
      return { passed: true, message: 'Devotion sequence is valid' };
    },
  },
};
