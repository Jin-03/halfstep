import { describe, expect, it } from 'vitest';
import { homeState, isCompleted, splitGoals, type GoalSummary } from '../src/model/goals';

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

  it('진행 중은 최근에 손댄 순, 완료는 최근에 끝낸 순', () => {
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
  });

  it('홈: 고정한 일을 끝낼 때까지 그대로, 끝내면 축하 페이지, 고정이 없으면 최근 일을 고정', () => {
    const goals = [g('a', 10), g('b', 30), g('c', 20)];
    const sums = new Map([['a', s(1, 2)], ['b', s(0, 3)], ['c', s(2, 2, 50)]]);
    // 고정이 없으면 가장 최근에 손댄 진행 중인 일을 보여 주고 고정하게 한다
    expect(homeState(goals, sums, null)).toMatchObject({ kind: 'focus', goal: { id: 'b' }, autoPin: true });
    // 고정한 일은 더 최근에 손댄 일이 있어도 그대로
    expect(homeState(goals, sums, 'a')).toMatchObject({ kind: 'focus', goal: { id: 'a' }, autoPin: false });
    // 고정한 일을 다 끝냈으면 다음 일로 넘어가지 않는다
    const done = homeState(goals, sums, 'c');
    expect(done).toMatchObject({ kind: 'finished', goal: { id: 'c' } });
    expect(done.kind === 'finished' && done.next.map((x) => x.id)).toEqual(['b', 'a']);
    // 고정한 일이 지워졌으면 고정이 없는 것으로
    expect(homeState(goals, sums, 'gone')).toMatchObject({ kind: 'focus', goal: { id: 'b' }, autoPin: true });
    expect(homeState([g('c', 1)], sums, null)).toEqual({ kind: 'empty' });
  });
});
