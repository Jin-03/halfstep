import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Goal, type StepRow } from './schema';
import { buildTree, progress, type StepNode } from '../model/tree';
import type { GoalSummary } from '../model/goals';

/** 목표 목록 (최신순). 로딩 중에는 undefined */
export function useGoals(): Goal[] | undefined {
  return useLiveQuery(() => db.goals.orderBy('createdAt').reverse().toArray(), []);
}

/** 한 목표의 단계 트리. 로딩 중에는 undefined */
export function useGoalTree(goalId: string | null): StepNode[] | undefined {
  return useLiveQuery(
    async () => (goalId ? buildTree(await db.steps.where('goalId').equals(goalId).toArray()) : []),
    [goalId],
  );
}

/** 목표별 진행률과 최근 완료 시각. 로딩 중에는 undefined */
export function useGoalSummaries(): Map<string, GoalSummary> | undefined {
  return useLiveQuery(async () => {
    const rows = await db.steps.toArray();
    const byGoal = new Map<string, StepRow[]>();
    for (const r of rows) {
      const list = byGoal.get(r.goalId);
      if (list) list.push(r);
      else byGoal.set(r.goalId, [r]);
    }
    return new Map(
      [...byGoal].map(([id, list]) => {
        const lastDoneAt = list.reduce<number | null>((m, r) => (r.doneAt !== null && (m === null || r.doneAt > m) ? r.doneAt : m), null);
        return [id, { progress: progress(buildTree(list)), lastDoneAt }];
      }),
    );
  }, []);
}
