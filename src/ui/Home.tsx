import { useState } from 'react';
import { claimReward, setDone } from '../db/ops';
import { useGoalTree } from '../db/hooks';
import type { Goal } from '../db/schema';
import { setSetting } from '../db/settings';
import type { HomeState } from '../model/goals';
import { nextAction, progress, type StepNode } from '../model/tree';
import { withCelebration } from '../reward/complete';
import { useActions } from './actions';
import { formatMinutes, josa } from './format';
import { HalfMark } from './HalfMark';

/**
 * 홈: 지금 하는 일 하나의 다음 단계 하나만 크게 [결정 2026-11-23].
 * 홈에 보이는 일은 다 끝내거나 다른 일을 고를 때까지 바뀌지 않고, 다 끝내면 축하 페이지에서 다음 일을 고른다.
 */
export function Home({ state, activeCount, completedCount }: { state: HomeState; activeCount: number; completedCount: number }) {
  if (state.kind === 'finished') return <Finished goal={state.goal} next={state.next} />;
  if (state.kind === 'focus') return <Focus goal={state.goal} others={activeCount - 1} />;
  return (
    <section className="home">
      <div className="home-empty">
        <HalfMark size={56} ratio={completedCount > 0 ? 1 : 0.5} />
        <h1>{completedCount > 0 ? '진행 중인 일을 모두 끝냈어요.' : '큰 목표도 반걸음씩.'}</h1>
        <p>이루고 싶은 일을 적으면 지금 바로 할 수 있는 작은 단계로 나눠 드려요.</p>
        <a className="primary" href="#/new">
          새 목표 만들기
        </a>
      </div>
    </section>
  );
}

function Focus({ goal, others }: { goal: Goal; others: number }) {
  const tree = useGoalTree(goal.id);
  const { run } = useActions();
  if (!tree) return <p className="loading">불러오는 중…</p>;
  const next = nextAction(tree);
  const href = `#/goal/${encodeURIComponent(goal.id)}`;

  const complete = () => {
    if (!next) return;
    const p = progress(tree);
    const last = p.done + 1 === p.total;
    // 마지막 단계면 축하하고, 홈은 다음 일로 넘어가지 않고 축하 페이지가 된다
    void run('완료', goal.id, () => withCelebration(goal.id, () => setDone(next.node.id, true)), {
      notify: last ? `${josa(goal.title, '을')} 모두 끝냈어요. 보관함으로 옮겼어요.` : undefined,
    });
  };

  return (
    <section className="home">
      <div className="focus">
        <a className="focus-link" href={href} aria-label={`${goal.title} 열기. 다음 할 일: ${next?.node.title ?? '첫 단계 적기'}`}>
          <span className="focus-goal">{goal.title}</span>
          {next ? (
            <span className="focus-next" key={next.node.id}>
              {next.path.length > 0 && <span className="focus-path">{next.path.join(' › ')}</span>}
              <span className="focus-step">{next.node.title}</span>
              {next.node.minutes ? <span className="focus-meta">{formatMinutes(next.node.minutes)}</span> : null}
            </span>
          ) : (
            <span className="focus-next">
              <span className="focus-step">첫 단계를 적어 보세요</span>
              <span className="focus-meta">눌러서 이 일의 단계를 추가하세요.</span>
            </span>
          )}
        </a>
        {next && (
          <button type="button" className="primary focus-done" onClick={complete}>
            끝냈어요
          </button>
        )}
      </div>
      <div className="home-actions">
        <a className="secondary" href="#/new">
          <span aria-hidden="true">＋</span> 새로 만들기
        </a>
        {others > 0 && <a href="#/goals">다른 일로 바꾸기 (진행 중인 일 {others}개)</a>}
      </div>
    </section>
  );
}

/** 리프 단계 수와 예상 시간 합 */
function totals(nodes: readonly StepNode[]): { count: number; minutes: number } {
  let count = 0;
  let minutes = 0;
  const visit = (list: readonly StepNode[]) => {
    for (const n of list) {
      if (n.children.length) visit(n.children);
      else {
        count++;
        minutes += n.minutes ?? 0;
      }
    }
  };
  visit(nodes);
  return { count, minutes };
}

/** 홈에 보이던 일을 다 끝냈을 때: 다음 일로 저절로 넘어가지 않고 여기서 고른다 */
function Finished({ goal, next }: { goal: Goal; next: Goal[] }) {
  const tree = useGoalTree(goal.id);
  const [choosing, setChoosing] = useState(false);
  if (!tree) return <p className="loading">불러오는 중…</p>;
  const { count, minutes } = totals(tree);
  const claimed = !!goal.rewardClaimedAt;

  return (
    <section className="home">
      <div className="finished">
        <HalfMark size={56} ratio={1} />
        <p className="finished-kicker">끝까지 왔어요</p>
        <h1 className="finished-title">{goal.title}</h1>
        <p className="finished-stats">
          단계 {count}개{minutes ? ` · 약 ${formatMinutes(minutes)}` : ''}
        </p>
        {goal.reward && (
          <div className="finished-reward">
            <span className="finished-reward-label">나에게 주는 보상</span>
            <span className="finished-reward-text">{goal.reward}</span>
            {claimed ? (
              <span className="finished-claimed">받음</span>
            ) : (
              <button type="button" className="secondary small" onClick={() => void claimReward(goal.id).catch(console.error)}>
                보상 받기
              </button>
            )}
          </div>
        )}
        <div className="finished-actions">
          {next.length > 0 && (
            <button type="button" className="primary" aria-expanded={choosing} onClick={() => setChoosing((c) => !c)}>
              다음 일 고르기
            </button>
          )}
          {/* 고정을 비워 두면 새로 만든 일이 가장 최근 일이 되어 홈에 고정된다 */}
          <a className={next.length > 0 ? 'secondary' : 'primary'} href="#/new" onClick={() => void setSetting('pinnedGoalId', null)}>
            새 목표 만들기
          </a>
        </div>
        {choosing && (
          <ul className="finished-next" aria-label="진행 중인 일">
            {next.map((g) => (
              <li key={g.id}>
                <button type="button" className="finished-next-item" onClick={() => void setSetting('pinnedGoalId', g.id)}>
                  {g.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <a className="finished-link" href={`#/goal/${encodeURIComponent(goal.id)}`}>
          끝낸 일 다시 보기
        </a>
      </div>
    </section>
  );
}
