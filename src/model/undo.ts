/**
 * 실행 취소·다시 실행 스택 (메모리, 각각 최대 30).
 * 쓰기 직전에 대상 목표의 goal 행과 steps 전체를 스냅샷하고,
 * 되돌릴 때 그 목표의 steps를 지운 뒤 스냅샷으로 복원한다. (celebratedAt, rewardClaimedAt은 지금 값 유지)
 * 되돌리기 직전 상태는 다시 실행 스택에 쌓고, 새 쓰기가 생기면 다시 실행 스택을 비운다.
 */
import { db, type Goal, type StepRow } from '../db/schema';

export const UNDO_LIMIT = 30;

interface Snapshot {
  label: string;
  goalId: string;
  /** 그 시점의 목표 행. 목표가 없던 시점(새로 만들기 전)이면 null → 복원하면 목표 삭제 */
  goal: Goal | null;
  steps: StepRow[];
}

export interface UndoResult {
  label: string;
  goalId: string;
  /** 복원한 뒤 목표가 있는지 */
  goalExists: boolean;
}

type Listener = () => void;

export class UndoStack {
  private stack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<Listener>();

  /** 기존 목표에 대한 쓰기를 실행하고, 성공하면 쓰기 전 상태를 스택에 쌓는다. */
  async record<T>(label: string, goalId: string, write: () => Promise<T>): Promise<T> {
    const before = await snapshot(label, goalId);
    const result = await write();
    this.push(before);
    return result;
  }

  /** 새 목표 만들기. 되돌리면 그 목표를 삭제한다. */
  async recordCreate(label: string, create: () => Promise<string>): Promise<string> {
    const goalId = await create();
    this.push({ label, goalId, goal: null, steps: [] });
    return goalId;
  }

  /** 새 쓰기: 실행 취소에 쌓고 다시 실행은 비운다 */
  private push(snap: Snapshot) {
    pushLimited(this.stack, snap);
    this.redoStack = [];
    this.emit();
  }

  /** 가장 최근 쓰기를 되돌린다. @returns 되돌린 작업의 이름과 목표 id, 없으면 null */
  undo(): Promise<UndoResult | null> {
    return this.move(this.stack, this.redoStack);
  }

  /** 가장 최근에 되돌린 작업을 다시 한다. @returns 다시 한 작업의 이름과 목표 id, 없으면 null */
  redo(): Promise<UndoResult | null> {
    return this.move(this.redoStack, this.stack);
  }

  /** from에서 꺼낸 스냅샷으로 복원하고, 복원 직전 상태를 to에 쌓는다 */
  private async move(from: Snapshot[], to: Snapshot[]): Promise<UndoResult | null> {
    const snap = from.pop();
    if (!snap) return null;
    const current = await snapshot(snap.label, snap.goalId);
    await restore(snap);
    pushLimited(to, current);
    this.emit();
    return { label: snap.label, goalId: snap.goalId, goalExists: snap.goal !== null };
  }

  get size(): number {
    return this.stack.length;
  }

  peekLabel(): string | null {
    return this.stack.at(-1)?.label ?? null;
  }

  peekRedoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  clear(): void {
    this.stack = [];
    this.redoStack = [];
    this.emit();
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function pushLimited(stack: Snapshot[], snap: Snapshot) {
  stack.push(snap);
  if (stack.length > UNDO_LIMIT) stack.shift();
}

async function snapshot(label: string, goalId: string): Promise<Snapshot> {
  return db.transaction('r', db.goals, db.steps, async () => ({
    label,
    goalId,
    goal: (await db.goals.get(goalId)) ?? null,
    steps: await db.steps.where('goalId').equals(goalId).toArray(),
  }));
}

function restore(snap: Snapshot): Promise<void> {
  return db.transaction('rw', db.goals, db.steps, async () => {
    const current = await db.goals.get(snap.goalId);
    await db.steps.where('goalId').equals(snap.goalId).delete();
    if (snap.goal) {
      // 축하·보상 기록은 되돌리지 않는다: 되돌린 뒤 다시 끝내도 축하 창이 또 뜨지 않게
      const { celebratedAt, rewardClaimedAt } = current ?? snap.goal;
      const { celebratedAt: _c, rewardClaimedAt: _r, ...rest } = snap.goal;
      await db.goals.put({
        ...rest,
        ...(celebratedAt ? { celebratedAt } : {}),
        ...(rewardClaimedAt ? { rewardClaimedAt } : {}),
      });
      await db.steps.bulkPut(snap.steps);
    } else {
      await db.goals.delete(snap.goalId);
    }
  });
}

export const undoStack = new UndoStack();
