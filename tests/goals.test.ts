import { describe, expect, it } from 'vitest';
import { currentGoal, isCompleted, splitGoals, type GoalSummary } from '../src/model/goals';

describe('진행 중 / 완료 구분', () => {
  const g = (id: string, updatedAt: number) => ({ id, title: id, createdAt: 0, updatedAt });
  const s = (done: number, total: number, lastDoneAt: number | null = null): GoalSummary => ({
    progress: { done, total, ratio: total ? done / total : 0 },
    lastDoneAt,
  });

  it('모든 단계를 끝낸 일만 완료, 단계가 없으면 진행 중', () => {
    expect(isCompleted(s(3, 3))).toBe(true);
    expect(isCompleted(s(2, 3))).toBe(false);
    expect(isCompleted(s(0, 0))).toBe(false);
    expect(isCompleted(undefined)).toBe(false);
  });

  it('진행 중은 최근에 손댄 순, 완료는 최근에 끝낸 순, 홈은 가장 최근 진행 중인 일', () => {
    const goals = [g('a', 10), g('b', 30), g('c', 20), g('d', 5), g('e', 1)];
    const sums = new Map([
      ['a', s(1, 2)],
      ['b', s(0, 3)],
      ['c', s(2, 2, 50)],
      ['d', s(1, 1, 70)],
    ]);
    const { active, completed } = splitGoals(goals, sums);
    expect(active.map((x) => x.id)).toEqual(['b', 'a', 'e']);
    expect(completed.map((x) => x.id)).toEqual(['d', 'c']);
    expect(currentGoal(goals, sums)?.id).toBe('b');
    expect(currentGoal([g('c', 1)], sums)).toBeNull();
  });
});
