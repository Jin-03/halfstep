import { setDone } from '../db/ops';
import { useGoalTree } from '../db/hooks';
import type { Goal } from '../db/schema';
import { setSetting } from '../db/settings';
import { nextAction, progress } from '../model/tree';
import { withCelebration } from '../reward/complete';
import { useActions } from './actions';
import { formatMinutes, josa } from './format';
import { HalfMark } from './HalfMark';

/** 홈: 지금 하는 일의 다음 단계 하나만 크게 */
export function Home({
  current,
  pinned,
  activeCount,
  completedCount,
}: {
  current: Goal | null;
  /** current가 고정한 일인지 */
  pinned: boolean;
  activeCount: number;
  completedCount: number;
}) {
  if (!current) {
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
  return <Focus goal={current} pinned={pinned} others={activeCount - 1} />;
}

function Focus({ goal, pinned, others }: { goal: Goal; pinned: boolean; others: number }) {
  const tree = useGoalTree(goal.id);
  const { run } = useActions();
  if (!tree) return <p className="loading">불러오는 중…</p>;
  const next = nextAction(tree);
  const href = `#/goal/${encodeURIComponent(goal.id)}`;

  const complete = () => {
    if (!next) return;
    const p = progress(tree);
    const last = p.done + 1 === p.total;
    // 끝내면 화면이 알아서 다음 단계로 바뀐다 (마지막 단계면 보관함으로 옮겨지고 다음 일이 나온다)
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
        {pinned && (
          <p className="focus-pin">
            홈에 고정한 일이에요.{' '}
            <button type="button" className="link-btn" onClick={() => void setSetting('pinnedGoalId', null)}>
              고정 해제
            </button>
          </p>
        )}
        <a className="secondary" href="#/new">
          <span aria-hidden="true">＋</span> 새로 만들기
        </a>
        {others > 0 && <a href="#/goals">진행 중인 일 {others}개 더 보기</a>}
      </div>
    </section>
  );
}
