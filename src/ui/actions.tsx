/**
 * 화면의 모든 쓰기는 run()을 거친다: 실행 취소 기록, 오류 표시, 알림을 한곳에서 처리.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { HalfStepError } from '../db/ops';
import { undoStack } from '../model/undo';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** 이 알림에 실행 취소 버튼을 보여 줄지 */
  canUndo?: boolean;
  /** 이 알림에 다시 실행 버튼을 보여 줄지 (되돌린 직후) */
  canRedo?: boolean;
}

interface RunOptions {
  /** 완료 후 이 문구로 실행 취소 버튼이 있는 알림을 띄운다 (삭제처럼 되돌릴 일이 잦은 작업) */
  notify?: string;
  /** 실행 취소 기록을 남기지 않는다 (접기 같은 화면 상태) */
  skipUndo?: boolean;
}

interface Actions {
  run<T>(label: string, goalId: string | null, write: () => Promise<T>, opts?: RunOptions): Promise<T | undefined>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** 알림만 띄운다 */
  notify(text: string, kind?: Toast['kind']): void;
  toast: Toast | null;
  dismiss(): void;
  undoLabel: string | null;
  redoLabel: string | null;
}

const Ctx = createContext<Actions | null>(null);

export function useActions(): Actions {
  const a = useContext(Ctx);
  if (!a) throw new Error('ActionsProvider 밖에서 useActions를 썼습니다.');
  return a;
}

export function ActionsProvider({
  children,
  onUndone,
}: {
  children: ReactNode;
  /** 되돌리거나 다시 한 뒤 호출. 그 목표를 선택하는 데 쓴다 */
  onUndone?: (goalId: string, goalExists: boolean) => void;
}) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const undoLabel = useSyncExternalStore(undoStack.subscribe, () => undoStack.peekLabel());
  const redoLabel = useSyncExternalStore(undoStack.subscribe, () => undoStack.peekRedoLabel());

  const show = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: ++seq.current }), []);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.kind === 'error' ? 6000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const run = useCallback(
    async <T,>(label: string, goalId: string | null, write: () => Promise<T>, opts: RunOptions = {}) => {
      try {
        let result: T;
        if (opts.skipUndo) result = await write();
        else if (goalId) result = await undoStack.record(label, goalId, write);
        else result = (await undoStack.recordCreate(label, write as () => Promise<string>)) as T;
        if (opts.notify) show({ text: opts.notify, kind: 'info', canUndo: true });
        return result;
      } catch (err) {
        if (!(err instanceof HalfStepError)) console.error(err);
        show({
          text: err instanceof HalfStepError ? err.message : `${label}에 실패했어요. 다시 시도해 주세요.`,
          kind: 'error',
        });
        return undefined;
      }
    },
    [show],
  );

  const undo = useCallback(async () => {
    try {
      const r = await undoStack.undo();
      if (!r) return;
      show({ text: `되돌렸어요: ${r.label}`, kind: 'info', canRedo: true });
      onUndone?.(r.goalId, r.goalExists);
    } catch (err) {
      console.error(err);
      show({ text: '되돌리지 못했어요.', kind: 'error' });
    }
  }, [show, onUndone]);

  const redo = useCallback(async () => {
    try {
      const r = await undoStack.redo();
      if (!r) return;
      show({ text: `다시 했어요: ${r.label}`, kind: 'info' });
      onUndone?.(r.goalId, r.goalExists);
    } catch (err) {
      console.error(err);
      show({ text: '다시 하지 못했어요.', kind: 'error' });
    }
  }, [show, onUndone]);

  // Ctrl+Z 실행 취소, Ctrl+Shift+Z·Ctrl+Y 다시 실행 (⌘도 같음. 입력 중에는 브라우저 기본 동작에 맡김)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable]')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => show({ text, kind }), [show]);

  return (
    <Ctx.Provider value={{ run, undo, redo, notify, toast, dismiss, undoLabel, redoLabel }}>{children}</Ctx.Provider>
  );
}