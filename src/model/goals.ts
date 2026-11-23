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
 * 홈의 상태 [결정 2026-11-23]. 홈에 보이는 일은 다 끝내거나 사용자가 다른 일을 고를 때까지 바뀌지 않는다.
 * - focus: 고정한 일(진행 중)의 다음 단계. 고정이 없으면 가장 최근에 손댄 일을 보여 주고 autoPin으로 고정하게 한다
 * - finished: 고정한 일을 다 끝냄. 다음 일로 넘어가지 않고 축하 페이지에서 다음 일을 고른다
 * - empty: 진행 중인 일이 없음
 * 고정한 일이 지워졌으면 고정이 없는 것으로 본다.
 */
export type HomeState =
  | { kind: 'focus'; goal: Goal; autoPin: boolean }
  | { kind: 'finished'; goal: Goal; next: Goal[] }
  | { kind: 'empty' };

export function homeState(
  goals: readonly Goal[],
  summaries: ReadonlyMap<string, GoalSummary>,
  pinnedId: string | null,
): HomeState {
  const { active } = splitGoals(goals, summaries);
  const pinned = pinnedId ? goals.find((g) => g.id === pinnedId) : undefined;
  if (pinned) {
    if (isCompleted(summaries.get(pinned.id))) return { kind: 'finished', goal: pinned, next: active };
    return { kind: 'focus', goal: pinned, autoPin: false };
  }
  const first = active[0];
  return first ? { kind: 'focus', goal: first, autoPin: true } : { kind: 'empty' };
}
