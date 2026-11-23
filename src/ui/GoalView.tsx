import { useState } from 'react';
import { decompose } from '../ai';
import { addStep, addSteps, deleteGoal, setDone, updateGoal } from '../db/ops';
import { useGoalTree } from '../db/hooks';
import type { Goal } from '../db/schema';
import type { StepNode } from '../model/tree';
import { nextAction, progress, remainingMinutes } from '../model/tree';
import { useActions } from './actions';
import { templateFromGoal } from '../db/templates';
import { navigate } from '../router';
import { withCelebration } from '../reward/complete';
import { setSetting, useSetting } from '../db/settings';
import { AddStepInput } from './AddStepInput';
import { EditableText } from './EditableText';
import { formatMinutes } from './format';
import { HalfMark } from './HalfMark';
import { StepTree } from './StepTree';

export function GoalView({ goal }: { goal: Goal }) {
  const tree = useGoalTree(goal.id);
  const { run, notify } = useActions();
  const [suggesting, setSuggesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const pinnedId = useSetting('pinnedGoalId');
  const isPinned = pinnedId === goal.id;
  if (!tree) return <p className="loading">불러오는 중…</p>;

  const p = progress(tree);
  const next = nextAction(tree);
  const rem = remainingMinutes(tree);
  const add = (title: string) => run('단계 추가', goal.id, () => addStep(goal.id, null, { title }));

  const suggestMore = async () => {
    setSuggesting(true);
    try {
      // 엔진 호출은 기록하지 않고, 실제로 단계를 더할 때만 실행 취소 기록을 남긴다.
      const result = await run(
        '단계 더 제안',
        goal.id,
        () => decompose({ kind: 'more', goal: goal.title, existing: allTitles(tree), doneRatio: progress(tree).ratio }),
        { skipUndo: true },
      );
      if (!result) return;
      if (result.drafts.length === 0) {
        notify('더 제안할 단계가 없어요.');
        return;
      }
      await run('단계 더 제안', goal.id, () => addSteps(goal.id, null, result.drafts, result.origin), {
        notify: `단계 ${result.drafts.length}개를 더했어요${result.fallbackReason ? ' (기본 규칙 사용)' : ''}`,
      });
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <article className="goal">
      <header className="goal-head">
        <EditableText
          className="goal-title"
          label="목표 제목"
          value={goal.title}
          onSave={(t) => void run('목표 이름 수정', goal.id, () => updateGoal(goal.id, { title: t }))}
        />
        <EditableText
          className="goal-note"
          label="메모"
          multiline
          allowEmpty
          placeholder="메모 추가"
          value={goal.note ?? ''}
          onSave={(t) => void run('메모 수정', goal.id, () => updateGoal(goal.id, { note: t }))}
        />
        <div className="goal-reward">
          <span className="goal-reward-label">{goal.rewardClaimedAt ? '받은 보상' : '다 끝내면'}</span>
          <EditableText
            label="다 끝내면 나에게 줄 보상"
            allowEmpty
            placeholder="나에게 줄 보상 정하기"
            value={goal.reward ?? ''}
            onSave={(t) => void run('보상 수정', goal.id, () => updateGoal(goal.id, { reward: t }))}
          />
        </div>
        {p.total > 0 && (
          <div className="progress">
            <div
              className="bar"
              role="progressbar"
              aria-label="진행률"
              aria-valuemin={0}
              aria-valuemax={p.total}
              aria-valuenow={p.done}
            >
              <span style={{ width: `${p.ratio * 100}%` }} />
            </div>
            <p className="progress-text">
              {p.done}/{p.total}단계
              {rem.minutes > 0 && ` · 남은 시간 약 ${formatMinutes(rem.minutes)}`}
              {rem.unknown > 0 && ` · 시간 미정 ${rem.unknown}개`}
            </p>
          </div>
        )}
      </header>

      {p.total > 0 && (
        <section className={`next ${next ? '' : 'is-complete'}`} aria-label="다음 할 일">
          <HalfMark size={28} ratio={next ? 0.5 : 1} />
          {next ? (
            <div className="next-body">
              {next.path.length > 0 && <p className="next-path">{next.path.join(' › ')}</p>}
              <p className="next-title">{next.node.title}</p>
              {next.node.minutes ? <p className="next-meta">{formatMinutes(next.node.minutes)}</p> : null}
              <button type="button" className="primary" onClick={() => void run('완료', goal.id, () => withCelebration(goal.id, () => setDone(next.node.id, true)))}>
                끝냈어요
              </button>
            </div>
          ) : (
            <div className="next-body">
              <p className="next-title">모든 단계를 끝냈어요.</p>
              <p className="next-meta">더 할 일이 생기면 아래에 단계를 추가하세요.</p>
            </div>
          )}
        </section>
      )}

      <section className={`steps ${editing ? 'is-editing' : ''}`} aria-label="단계">
        {tree.length > 0 && (
          <div className="steps-head">
            {editing && <span className="editing-note">편집 중 · 단계를 눌러 이름을 고치고, ⋯로 옮기거나 지울 수 있어요</span>}
            <button type="button" className={editing ? 'primary small' : 'secondary small'} aria-pressed={editing} onClick={() => setEditing(!editing)}>
              {editing ? '편집 끝내기' : '편집'}
            </button>
          </div>
        )}
        {tree.length === 0 && (
          <p className="empty">첫 단계를 적어 보세요. 지금 바로 시작할 수 있을 만큼 작게요.</p>
        )}
        <StepTree nodes={tree} goalId={goal.id} goalTitle={goal.title} nextId={next?.node.id ?? null} editing={editing} />
        <AddStepInput placeholder="단계 추가" onAdd={add} autoFocus={tree.length === 0} />
        <button type="button" className="text-btn suggest-btn" disabled={suggesting} onClick={() => void suggestMore()}>
          {suggesting ? '제안하는 중…' : '단계 더 제안받기'}
        </button>
      </section>

      <footer className="goal-foot">
        <button
          type="button"
          className="text-btn"
          aria-pressed={isPinned}
          onClick={() => {
            void setSetting('pinnedGoalId', isPinned ? null : goal.id);
            notify(isPinned ? '홈 고정을 해제했어요.' : '홈에 이 일을 고정했어요.');
          }}
        >
          {isPinned ? '홈 고정 해제' : '홈에 고정'}
        </button>
        {tree.length > 0 && (
          <button
            type="button"
            className="text-btn"
            onClick={async () => {
              const id = await run('템플릿으로 저장', null, () => templateFromGoal(goal.id), { skipUndo: true });
              if (id) {
                notify('템플릿으로 저장했어요. 키워드를 넣어 두면 자동 나누기에도 쓰여요.');
                navigate({ name: 'template', id });
              }
            }}
          >
            템플릿으로 저장
          </button>
        )}
        {/* 삭제는 편집 모드에서만 */}
        {editing && (
          <button
            type="button"
            className="text-btn danger"
            onClick={async () => {
              await run('목표 삭제', goal.id, () => deleteGoal(goal.id), { notify: '목표를 삭제했어요' });
              navigate({ name: 'goals' }, { replace: true });
            }}
          >
            이 목표 삭제
          </button>
        )}
      </footer>
    </article>
  );
}

function allTitles(nodes: readonly StepNode[]): string[] {
  return nodes.flatMap((n) => [n.title, ...allTitles(n.children)]);
}
