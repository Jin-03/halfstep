import type { Goal } from '../db/schema';
import type { GoalSummary } from '../model/goals';

const goalHref = (g: Goal) => `#/goal/${encodeURIComponent(g.id)}`;

/** 진행 중인 일: 제목만 */
export function ActiveGoals({ goals }: { goals: Goal[] }) {
  return (
    <section className="list-page">
      <header className="page-head">
        <h1>진행 중인 일</h1>
        <a className="primary small" href="#/new">
          <span aria-hidden="true">＋</span> 새 목표
        </a>
      </header>
      {goals.length === 0 ? (
        <p className="empty">진행 중인 일이 없어요. 새 목표를 만들어 보세요.</p>
      ) : (
        <ul className="title-list" role="list">
          {goals.map((g) => (
            <li key={g.id}>
              <a href={goalHref(g)}>{g.title}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const dateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

/** 완료된 일 보관함 */
export function Archive({ goals, summaries }: { goals: Goal[]; summaries: ReadonlyMap<string, GoalSummary> }) {
  return (
    <section className="list-page">
      <header className="page-head">
        <h1>완료된 일 보관함</h1>
      </header>
      <p className="hint">모든 단계를 끝낸 일이 여기로 옮겨져요. 단계를 다시 해제하면 진행 중인 일로 돌아가요.</p>
      {goals.length === 0 ? (
        <p className="empty">아직 끝낸 일이 없어요.</p>
      ) : (
        <ul className="title-list" role="list">
          {goals.map((g) => {
            const at = summaries.get(g.id)?.lastDoneAt;
            return (
              <li key={g.id}>
                <a href={goalHref(g)}>
                  <span>{g.title}</span>
                  {at ? <span className="list-meta">{dateFmt.format(at)} 완료</span> : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
