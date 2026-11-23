/** 목표 분류: 진행 중 / 완료, 그리고 홈에 보여 줄 "지금 하는 일" */
import type { Goal } from '../db/schema';
import type { Progress } from './tree';

export interface GoalSummary {
  progress: Progress;
  /** 가장 최근 완료 시각 (완료된 리프가 없으면 null) */
  lastDoneAt: number | null;
}

/** 단계가 하나 이상 있고 모두 끝났으면 완료. 단계가 없는 목표는 진행 중으로 본다 */
export function isCompleted(s: GoalSummary | undefined): boolean {
  return !!s && s.progress.total > 0 && s.progress.done === s.progress.total;
}

export function splitGoals(goals: readonly Goal[], summaries: ReadonlyMap<string, GoalSummary>) {
  const active: Goal[] = [];
  const completed: Goal[] = [];
  for (const g of goals) (isCompleted(summaries.get(g.id)) ? completed : active).push(g);
  // 진행 중: 최근에 손댄 순, 완료: 최근에 끝낸 순
  active.sort((a, b) => b.updatedAt - a.updatedAt);
  const doneAt = (g: Goal) => summaries.get(g.id)?.lastDoneAt ?? g.updatedAt;
  completed.sort((a, b) => doneAt(b) - doneAt(a));
  return { active, completed };
}

/**
 * 홈에 보여 줄 일: 고정한 일이 진행 중이면 그 일, 아니면 가장 최근에 손댄 진행 중인 일.
 * (고정한 일을 끝내거나 지우면 자연히 최근 일로 넘어가고, 다시 진행 중이 되면 돌아온다)
 */
export function currentGoal(
  goals: readonly Goal[],
  summaries: ReadonlyMap<string, GoalSummary>,
  pinnedId: string | null = null,
): Goal | null {
  const { active } = splitGoals(goals, summaries);
  return active.find((g) => g.id === pinnedId) ?? active[0] ?? null;
}
