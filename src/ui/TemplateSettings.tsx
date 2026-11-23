import { useEffect, useMemo, useState } from 'react';
import { createTemplate, deleteTemplate, updateTemplate, useUserTemplates } from '../db/templates';
import { db, type UserTemplate } from '../db/schema';
import { countDrafts, parseOutline, toOutline } from '../model/outline';
import { TEMPLATES } from '../model/templates';
import { navigate } from '../router';
import { useActions } from './actions';
import { DraftPreview } from './DraftPreview';

const editHref = (id: string, from?: string) =>
  `#/settings/templates/${encodeURIComponent(id)}${from ? `?from=${encodeURIComponent(from)}` : ''}`;

export function TemplateList() {
  const mine = useUserTemplates();
  return (
    <section className="list-page">
      <header className="page-head">
        <h1>템플릿 설정</h1>
        <a className="primary small" href={editHref('new')}>
          <span aria-hidden="true">＋</span> 새 템플릿
        </a>
      </header>
      <p className="hint">
        여기서 만든 템플릿은 새 목표의 템플릿 탭에서 불러올 수 있어요. 키워드를 넣어 두면 자동으로 나누기(기본 규칙)도 목표에 그 단어가 있을 때 이
        템플릿을 써요.
      </p>

      <h2 className="list-heading">내 템플릿</h2>
      {mine === undefined ? null : mine.length === 0 ? (
        <p className="empty">아직 없어요. 새로 만들거나, 기본 템플릿을 복사하거나, 일 페이지에서 "템플릿으로 저장"을 눌러 보세요.</p>
      ) : (
        <ul className="title-list" role="list">
          {mine.map((t) => (
            <li key={t.id}>
              <a href={editHref(t.id)}>
                <span>{t.title}</span>
                <span className="list-meta">
                  단계 {countDrafts(t.steps)}개{t.keywords.length > 0 && ` · 키워드: ${t.keywords.join(', ')}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <h2 className="list-heading">기본 템플릿</h2>
      <ul className="title-list" role="list">
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <a href={editHref('new', t.id)}>
              <span>{t.title}</span>
              <span className="list-meta">복사해서 고치기</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Draft {
  title: string;
  summary: string;
  keywords: string;
  outline: string;
}

const EMPTY: Draft = { title: '', summary: '', keywords: '', outline: '' };

function toDraft(t: Pick<UserTemplate, 'title' | 'summary' | 'keywords' | 'steps'>): Draft {
  return { title: t.title, summary: t.summary ?? '', keywords: t.keywords.join(', '), outline: toOutline(t.steps) };
}

/** 템플릿 편집. id='new'면 새로 만들기 (from=기본 템플릿 id면 그 내용으로 시작) */
export function TemplateEditor({ id, from }: { id: string; from?: string }) {
  const { run, notify } = useActions();
  const isNew = id === 'new';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (isNew) {
        const base = TEMPLATES.find((t) => t.id === from);
        if (alive) setDraft(base ? { ...toDraft(base), title: `${base.title} (내 버전)` } : EMPTY);
        return;
      }
      const t = await db.templates.get(id);
      if (!alive) return;
      if (t) setDraft(toDraft(t));
      else setMissing(true);
    })();
    return () => {
      alive = false;
    };
  }, [id, from, isNew]);

  const steps = useMemo(() => parseOutline(draft?.outline ?? ''), [draft?.outline]);

  if (missing) {
    return (
      <section className="list-page">
        <p className="empty">템플릿을 찾을 수 없어요.</p>
        <a href="#/settings/templates">템플릿 목록으로</a>
      </section>
    );
  }
  if (!draft) return <p className="loading">불러오는 중…</p>;

  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const input = {
    title: draft.title,
    summary: draft.summary,
    keywords: draft.keywords.split(/[,，、]/),
    steps,
  };

  const save = async () => {
    const ok = await run(
      '템플릿 저장',
      null,
      async () => {
        if (isNew) await createTemplate(input);
        else await updateTemplate(id, input);
        return true;
      },
      { skipUndo: true },
    );
    if (ok) {
      notify('템플릿을 저장했어요.');
      navigate({ name: 'templates' }, { replace: true });
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await run('템플릿 삭제', null, () => deleteTemplate(id), { skipUndo: true });
    notify('템플릿을 삭제했어요.');
    navigate({ name: 'templates' }, { replace: true });
  };

  return (
    <section className="template-editor">
      <h1>{isNew ? '새 템플릿' : '템플릿 고치기'}</h1>
      <label className="field">
        <span>이름</span>
        <input className="goal-input" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="예: 주간 보고서 쓰기" />
      </label>
      <label className="field">
        <span>한 줄 설명 (선택)</span>
        <input className="text-input" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="예: 자료 정리부터 제출까지" />
      </label>
      <label className="field">
        <span>자동 나누기 키워드 (선택)</span>
        <input className="text-input" value={draft.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="쉼표로 구분. 예: 보고서, 주간, 회의록" />
        <span className="field-hint">목표에 이 단어가 들어 있으면 자동으로 나누기(기본 규칙)가 이 템플릿을 써요.</span>
      </label>
      <label className="field">
        <span>단계</span>
        <span className="field-hint">한 줄에 한 단계. 앞에 공백 두 칸을 넣으면 하위 단계, 끝에 "10분"을 붙이면 예상 시간이 돼요.</span>
        <textarea className="outline-input" rows={10} value={draft.outline} onChange={(e) => set({ outline: e.target.value })} spellCheck={false} />
      </label>
      <DraftPreview drafts={steps} />

      <footer className="new-goal-actions">
        <button type="button" className="primary" disabled={!draft.title.trim() || steps.length === 0} onClick={() => void save()}>
          저장
        </button>
        <a className="text-btn" href="#/settings/templates">
          취소
        </a>
        {!isNew && (
          <button type="button" className="text-btn danger push-right" onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}>
            {confirmDelete ? '한 번 더 누르면 삭제돼요' : '삭제'}
          </button>
        )}
      </footer>
    </section>
  );
}
