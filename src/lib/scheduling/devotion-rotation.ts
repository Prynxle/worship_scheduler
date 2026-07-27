import { DevotionSlot } from '../types/scheduling';
import { Member, DevotionRotation as DevotionRotationRecord } from '../types/database';

export class DevotionRotation {
  private church_id: string;
  private rotation: DevotionRotationRecord[];

  constructor(church_id: string, rotation: DevotionRotationRecord[]) {
    this.church_id = church_id;
    this.rotation = rotation;
  }

  getNextDevotionMembers(
    members: Member[],
    weekNumber: number,
    count: number = 4
  ): DevotionSlot[] {
    const eligible = this.getEligibleMembers(members, weekNumber);
    const sorted = this.sortByRotation(eligible);

    return sorted.slice(0, count).map((member, index) => ({
      member_id: member.id,
      member_name: member.full_name,
      position: this.getNextPosition(index),
      week_available: true,
      already_scheduled: false,
      confidence_score: this.calculateConfidence(member, index),
    }));
  }

  private getEligibleMembers(members: Member[], weekNumber: number): Member[] {
    return members.filter((member) => {
      if (member.status !== 'active') return false;

      const hasDevotionRole = member.roles?.some((r) => r.role?.name === 'Devotion');
      if (!hasDevotionRole) return false;

      const isUnavailable = member.availability?.some((a) => {
        if (a.type === 'weekly' && a.week_number === weekNumber) {
          return true;
        }
        return false;
      });
      if (isUnavailable) return false;

      return true;
    });
  }

  private sortByRotation(members: Member[]): Member[] {
    return members.sort((a, b) => {
      const aRotation = this.rotation.find((r) => r.member_id === a.id);
      const bRotation = this.rotation.find((r) => r.member_id === b.id);

      if (!aRotation) return -1;
      if (!bRotation) return 1;

      if (aRotation.last_used_at && bRotation.last_used_at) {
        return new Date(aRotation.last_used_at).getTime() - new Date(bRotation.last_used_at).getTime();
      }

      return aRotation.position - bRotation.position;
    });
  }

  private getNextPosition(index: number): number {
    const maxPosition = Math.max(...this.rotation.map((r) => r.position), 0);
    return maxPosition + index + 1;
  }

  private calculateConfidence(member: Member, rank: number): number {
    let score = 100;

    score -= rank * 10;

    if (member.last_scheduled_date) {
      const lastDate = new Date(member.last_scheduled_date);
      const now = new Date();
      const weeksSince = Math.floor(
        (now.getTime() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weeksSince < 2) {
        score -= 20;
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  async updateRotation(
    assignedMemberIds: string[]
  ): Promise<DevotionRotationRecord[]> {
    const updatedRotation = [...this.rotation];

    for (const memberId of assignedMemberIds) {
      const existing = updatedRotation.find((r) => r.member_id === memberId);
      if (existing) {
        existing.last_used_at = new Date().toISOString();
        existing.position = updatedRotation.length + 1;
      } else {
        updatedRotation.push({
          id: crypto.randomUUID(),
          church_id: this.church_id,
          member_id: memberId,
          position: updatedRotation.length + 1,
          last_used_at: new Date().toISOString(),
          is_active: true,
          created_at: new Date().toISOString(),
        });
      }
    }

    return updatedRotation;
  }
}
