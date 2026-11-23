import type { StepDraft } from '../db/ops';
import { countDrafts } from '../model/outline';
import { formatMinutes } from './format';

function totalMinutes(drafts: readonly StepDraft[]): number {
  return drafts.reduce((n, d) => n + (d.children?.length ? totalMinutes(d.children) : (d.minutes ?? 0)), 0);
}

function List({ drafts }: { drafts: readonly StepDraft[] }) {
  return (
    <ul role="list">
      {drafts.map((d, i) => (
        <li key={i}>
          <span className="draft-title">{d.title}</span>
          {!d.children?.length && d.minutes ? <span className="meta">{formatMinutes(d.minutes)}</span> : null}
          {d.children?.length ? <List drafts={d.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** 만들기 전에 보여 주는 단계 미리보기 (읽기 전용) */
export function DraftPreview({ drafts }: { drafts: readonly StepDraft[] }) {
  if (drafts.length === 0) return null;
  const total = totalMinutes(drafts);
  return (
    <div className="draft-preview">
      <p className="draft-summary">
        단계 {countDrafts(drafts)}개{total > 0 && ` · 약 ${formatMinutes(total)}`}
      </p>
      <List drafts={drafts} />
    </div>
  );
}
