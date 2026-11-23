import { useEffect, useState } from 'react';
import { decompose, type AiPhase } from '../ai';
import { AiWait } from './AiWait';
import { addStep, addSteps, deleteStep, indentStep, moveStep, outdentStep, toggleDone, updateStep } from '../db/ops';
import { isDone, isLeaf, progress, type StepNode } from '../model/tree';
import { useSetting } from '../db/settings';
import { withCelebration } from '../reward/complete';
import { useActions } from './actions';
import { AddStepInput } from './AddStepInput';
import { EditableText } from './EditableText';
import { formatMinutes } from './format';

interface TreeState {
  /** 편집 모드: 단계 메뉴(⋯)와 제목 고치기는 이때만 */
  editing: boolean;
  goalId: string;
  goalTitle: string;
  /** 목표의 메모 (더 쪼갤 때 AI에게 함께 준다) */
  goalNote?: string;
  /** 더 쪼개는 중인 단계 */
  splittingId: string | null;
  setSplittingId: (id: string | null) => void;
  /** 더 쪼개는 동안 AI가 하는 일 (기다림 안내) */
  splitPhase: AiPhase | null;
  setSplitPhase: (p: AiPhase | null) => void;
  nextId: string | null;
  /** 체크 효과를 보여 줄지 (설정의 축하 효과) */
  celebrate: boolean;
  /** 메뉴가 열린 단계 (한 번에 하나) */
  openId: string | null;
  setOpenId: (id: string | null) => void;
  /** 하위 단계 입력란이 열린 단계 */
  addingId: string | null;
  setAddingId: (id: string | null) => void;
}

export function StepTree({
  nodes,
  goalId,
  goalTitle,
  goalNote,
  nextId,
  editing,
}: {
  nodes: StepNode[];
  goalId: string;
  goalTitle: string;
  goalNote?: string;
  nextId: string | null;
  editing: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [splittingId, setSplittingId] = useState<string | null>(null);
  const [splitPhase, setSplitPhase] = useState<AiPhase | null>(null);
  const celebrate = useSetting('celebration') ?? true;

  // 편집을 끝내면 열린 메뉴와 하위 단계 입력란을 닫는다
  useEffect(() => {
    if (!editing) {
      setOpenId(null);
      setAddingId(null);
    }
  }, [editing]);

  const state: TreeState = { editing, goalId, goalTitle, goalNote, nextId, celebrate, openId, setOpenId, addingId, setAddingId, splittingId, setSplittingId, splitPhase, setSplitPhase };
  return (
    <ul className="tree" role="list">
      {nodes.map((n, i) => (
        <StepItem key={n.id} node={n} state={state} first={i === 0} last={i === nodes.length - 1} path={[]} />
      ))}
    </ul>
  );
}

function StepItem({
  node,
  state,
  first,
  last,
  path,
}: {
  node: StepNode;
  state: TreeState;
  first: boolean;
  last: boolean;
  /** 최상위부터 부모까지의 제목 */
  path: string[];
}) {
  const topLevel = path.length === 0;
  const { run, notify } = useActions();
  const { goalId } = state;
  const leaf = isLeaf(node);
  const done = isDone(node);
  const open = state.openId === node.id;
  const adding = state.addingId === node.id;
  const collapsed = !!node.collapsed && !leaf;
  const p = leaf ? null : progress(node.children);
  const [pop, setPop] = useState(false);

  const act = (label: string, write: () => Promise<unknown>, notify?: string) => {
    void run(label, goalId, write, { notify });
  };
  const splitting = state.splittingId === node.id;

  const split = async () => {
    state.setOpenId(null);
    state.setSplittingId(node.id);
    try {
      const result = await run(
        '더 쪼개기',
        goalId,
        () =>
          decompose({ kind: 'split', goal: state.goalTitle, note: state.goalNote, step: node.title, minutes: node.minutes, path }, undefined, {
            onPhase: state.setSplitPhase,
          }),
        { skipUndo: true },
      );
      if (!result) return;
      if (result.drafts.length === 0) {
        notify('더 나눌 방법을 찾지 못했어요. 하위 단계를 직접 추가해 보세요.');
        return;
      }
      await run('더 쪼개기', goalId, () => addSteps(goalId, node.id, result.drafts, result.origin), {
        notify: `단계 ${result.drafts.length}개로 나눴어요${result.fallbackReason ? ' (기본 규칙 사용)' : ''}`,
      });
    } finally {
      state.setSplittingId(null);
      state.setSplitPhase(null);
    }
  };

  return (
    <li className={`step ${done ? 'is-done' : ''} ${state.nextId === node.id ? 'is-next' : ''}`}>
      <div className={`row ${open ? 'is-open' : ''}`}>
        <label className="check">
          <input
            type="checkbox"
            checked={done}
            onChange={() => {
              if (done) return act('완료 취소', () => toggleDone(node.id));
              setPop(state.celebrate);
              act('완료', () => withCelebration(goalId, () => toggleDone(node.id)));
            }}
          />
          <span className={`check-mark${pop ? ' hs-check-pop' : ''}`} aria-hidden="true" onAnimationEnd={() => setPop(false)} />
          <span className="sr-only">{node.title} 완료</span>
        </label>
        {state.editing ? (
          <EditableText
            className="step-title"
            label="단계 제목"
            value={node.title}
            onSave={(t) => act('제목 수정', () => updateStep(node.id, { title: t }))}
          />
        ) : (
          <span className="step-title">{node.title}</span>
        )}
        {splitting ? <span className="meta" role="status">나누는 중…</span> : null}
        {leaf && !splitting && node.minutes ? <span className="meta">{formatMinutes(node.minutes)}</span> : null}
        {p ? (
          <button
            type="button"
            className="twisty"
            aria-expanded={!collapsed}
            aria-label={`하위 ${p.total}개 중 ${p.done}개 완료. ${collapsed ? '펼치기' : '접기'}`}
            onClick={() => void run('접기', goalId, () => updateStep(node.id, { collapsed: !collapsed }), { skipUndo: true })}
          >
            {p.done}/{p.total}
            <span aria-hidden="true" className="twisty-arrow">{collapsed ? '▸' : '▾'}</span>
          </button>
        ) : null}
        {state.editing && (
          <button
            type="button"
            className="more"
            aria-label={`${node.title} 메뉴`}
            aria-expanded={open}
            onClick={() => state.setOpenId(open ? null : node.id)}
          >
            <span aria-hidden="true">⋯</span>
          </button>
        )}
      </div>

      {open && (
        <div className="actions" role="group" aria-label={`${node.title} 작업`}>
          {leaf && (
            <button type="button" onClick={() => void split()}>
              더 쪼개기
            </button>
          )}
          <button type="button" onClick={() => { state.setAddingId(node.id); state.setOpenId(null); }}>
            하위 단계 추가
          </button>
          <button type="button" disabled={first} onClick={() => act('위로 이동', () => moveStep(node.id, 'up'))}>
            위로
          </button>
          <button type="button" disabled={last} onClick={() => act('아래로 이동', () => moveStep(node.id, 'down'))}>
            아래로
          </button>
          <button type="button" disabled={first} onClick={() => act('들여쓰기', () => indentStep(node.id))}>
            들여쓰기
          </button>
          <button type="button" disabled={topLevel} onClick={() => act('내어쓰기', () => outdentStep(node.id))}>
            내어쓰기
          </button>
          {leaf && (
            <MinutesField
              value={node.minutes}
              onSave={(m) => act('시간 수정', () => updateStep(node.id, { minutes: m }))}
            />
          )}
          <button
            type="button"
            className="danger"
            onClick={() => {
              state.setOpenId(null);
              act('단계 삭제', () => deleteStep(node.id), '단계를 삭제했어요');
            }}
          >
            삭제
          </button>
        </div>
      )}

      {splitting && <AiWait phase={state.splitPhase} />}

      {(!collapsed || adding) && (node.children.length > 0 || adding) && (
        <ul className="tree" role="list">
          {!collapsed &&
            node.children.map((c, i) => (
              <StepItem key={c.id} node={c} state={state} first={i === 0} last={i === node.children.length - 1} path={[...path, node.title]} />
            ))}
          {adding && (
            <li className="step adding">
              <AddStepInput
                autoFocus
                placeholder={`"${node.title}"의 하위 단계`}
                onCancel={() => state.setAddingId(null)}
                onAdd={(title) => run('하위 단계 추가', goalId, () => addStep(goalId, node.id, { title }))}
              />
              <button type="button" className="text-btn" onClick={() => state.setAddingId(null)}>
                닫기
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function MinutesField({ value, onSave }: { value?: number; onSave: (m: number | null) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  const save = () => {
    const n = Number(text);
    const next = text.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
    if (next !== (value ?? null)) onSave(next);
  };
  return (
    <label className="minutes-field">
      예상
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-label="예상 시간(분)"
        placeholder="—"
      />
      분
    </label>
  );
}
