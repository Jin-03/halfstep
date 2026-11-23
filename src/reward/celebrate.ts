// 완료 축하: 무엇이 새로 끝났는지 감지하고, 진동을 주고, <Celebration />에 알린다.
// 웹 우선. 앱 단계에서 진동을 더 다듬으려면 buzz()만 @capacitor/haptics로 바꾸면 된다.

export type CelebrationLevel = 'step' | 'branch' | 'goal';

export interface CelebrationDetail {
  level: CelebrationLevel;
  goalId: string;
  goalTitle: string;
  /** 이번에 새로 완료된 단계 id (부모 포함) */
  stepIds: string[];
  /** branch: 새로 끝난 부모 단계 제목 */
  stepTitle?: string;
  /** goal: 리프 단계 수와 minutes 합 */
  stepCount?: number;
  minutes?: number;
  /** goal: 스스로 정한 보상 */
  reward?: string;
  /** 설정의 미리 보기: 축하·보상 기록을 저장하지 않는다 */
  preview?: boolean;
}

export const CELEBRATE_EVENT = 'halfstep:celebrate';

/** model/tree의 StepNode와 같은 모양 (리프만 doneAt을 가진다) */
export interface TreeNode {
  id: string;
  title?: string;
  doneAt: number | null;
  minutes?: number;
  children?: TreeNode[];
}

export interface GoalLike {
  id: string;
  title: string;
  reward?: string;
  /** 목표 완료 축하를 이미 보여 줬으면 값이 있음 → 다시 띄우지 않음 */
  celebratedAt?: number | null;
}

// 완료된 노드 id를 모으고, 이 목록 전체가 완료인지 돌려준다. (부모는 자식으로 계산)
function walk(nodes: TreeNode[], done: Set<string>, parents: Map<string, TreeNode>): boolean {
  let all = nodes.length > 0;
  for (const n of nodes) {
    const kids = n.children ?? [];
    if (kids.length) parents.set(n.id, n);
    const d = kids.length ? walk(kids, done, parents) : n.doneAt !== null;
    if (d) done.add(n.id);
    all = all && d;
  }
  return all;
}

function summarize(nodes: TreeNode[]): { count: number; minutes: number } {
  let count = 0, minutes = 0;
  const visit = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.children?.length) visit(n.children);
      else { count++; minutes += n.minutes ?? 0; }
    }
  };
  visit(nodes);
  return { count, minutes };
}

/** 변경 전후 트리를 비교해 축하 단계를 정한다. 새로 끝난 게 없으면 null. */
export function detectCompletion(before: TreeNode[], after: TreeNode[]) {
  const was = new Set<string>(), now = new Set<string>();
  const parents = new Map<string, TreeNode>();
  const wasAll = walk(before, was, new Map());
  const isAll = walk(after, now, parents);
  const stepIds = [...now].filter((id) => !was.has(id));
  if (!stepIds.length) return null;
  if (isAll && !wasAll) return { level: 'goal' as const, stepIds, parent: undefined };
  const parent = stepIds.map((id) => parents.get(id)).find(Boolean);
  return { level: parent ? ('branch' as const) : ('step' as const), stepIds, parent };
}

// Android Chrome에서만 실제로 진동한다. 데스크톱·iOS 브라우저는 조용히 무시.
function buzz(level: CelebrationLevel) {
  try {
    navigator.vibrate?.(level === 'goal' ? [20, 60, 20, 60, 40] : level === 'branch' ? [15, 40, 15] : 12);
  } catch {
    // 진동을 지원하지 않으면 넘어간다
  }
}

export function celebrate(detail: CelebrationDetail) {
  buzz(detail.level);
  window.dispatchEvent(new CustomEvent<CelebrationDetail>(CELEBRATE_EVENT, { detail }));
}

/**
 * 체크 동작에서만 호출한다 (실행 취소·가져오기에서는 호출하지 않음).
 * 반환값: 축하한 단계. 'goal'이면 축하 창을 닫을 때 goal.celebratedAt이 저장된다.
 */
export function celebrateChange(goal: GoalLike, before: TreeNode[], after: TreeNode[]) {
  const hit = detectCompletion(before, after);
  if (!hit) return null;

  // 목표 축하를 이미 본 목표는 묶음 축하로 낮춘다
  const level: CelebrationLevel = hit.level === 'goal' && goal.celebratedAt ? 'branch' : hit.level;
  const base = { goalId: goal.id, goalTitle: goal.title, stepIds: hit.stepIds };

  if (level === 'goal') {
    const { count, minutes } = summarize(after);
    celebrate({ ...base, level, stepCount: count, minutes, reward: goal.reward?.trim() || undefined });
  } else {
    celebrate({ ...base, level, stepTitle: hit.parent?.title ?? (hit.level === 'goal' ? goal.title : undefined) });
  }
  return level;
}
