import { useEffect, useMemo, useRef, useState } from 'react';
import { decompose as runDecompose, isAbort } from '../ai';
import { createGoal, type StepDraft } from '../db/ops';
import type { StepOrigin } from '../db/schema';
import { parseOutline, toOutline } from '../model/outline';
import { TEMPLATES } from '../model/templates';
import { useUserTemplates } from '../db/templates';
import { useActions } from './actions';
import { DraftPreview } from './DraftPreview';
import { josa } from './format';

type Method = 'auto' | 'template' | 'direct';

const METHODS: { id: Method; label: string }[] = [
  { id: 'auto', label: '자동으로 나누기' },
  { id: 'template', label: '템플릿' },
  { id: 'direct', label: '직접 적기' },
];

/** 템플릿 탭에서 고를 수 있는 것 (내 템플릿 + 기본 템플릿) */
interface Pickable {
  key: string;
  title: string;
  summary?: string;
  steps: StepDraft[];
}

const OUTLINE_HINT = `주제 정하기
초안 쓰기
  첫 문단 쓰기 15분
  본문 쓰기 45분
올리기 10분`;

/** 직접 적기로 옮겨 온 내용이 원래 어디서 왔는지. 고치지 않고 만들면 그 출처를 기록한다 */
interface EditedFrom {
  origin: StepOrigin;
  outline: string;
}

export function NewGoal({ onCreated, onCancel }: { onCreated: (goalId: string) => void; onCancel: () => void }) {
  const { run } = useActions();
  const [title, setTitle] = useState('');
  const [reward, setReward] = useState('');
  const [method, setMethod] = useState<Method>('auto');
  const [auto, setAuto] = useState<{ forTitle: string; drafts: StepDraft[]; origin: StepOrigin; engine: string; fallbackReason?: string; basis?: string; understood: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState<Pickable | null>(null);
  const userTemplates = useUserTemplates();
  const [outline, setOutline] = useState('');
  const [editedFrom, setEditedFrom] = useState<EditedFrom | null>(null);
  const abort = useRef<AbortController | null>(null);
  const templatePreview = useRef<HTMLDivElement>(null);

  // 휴대폰에서는 미리보기가 템플릿 목록 아래에 있으므로 고르면 보이는 곳으로 옮긴다.
  useEffect(() => {
    if (!template) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    templatePreview.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [template]);

  const directDrafts = useMemo(() => parseOutline(outline), [outline]);
  const autoStale = auto !== null && auto.forTitle !== title.trim();

  const decompose = async () => {
    const goal = title.trim();
    if (!goal) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    try {
      const r = await runDecompose({ kind: 'goal', goal }, ctrl.signal);
      setAuto({ forTitle: goal, drafts: r.drafts, origin: r.origin, engine: r.engineLabel, fallbackReason: r.fallbackReason, basis: r.basis, understood: r.understood });
    } catch (err) {
      if (!isAbort(err)) throw err;
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setBusy(false);
      }
    }
  };

  const stop = () => abort.current?.abort();

  useEffect(() => () => abort.current?.abort(), []);

  const pick = (t: Pickable) => {
    setTemplate(t);
    if (!title.trim()) setTitle(t.title);
  };

  const editAsText = (drafts: StepDraft[], from: StepOrigin) => {
    const text = toOutline(drafts);
    setOutline(text);
    setEditedFrom({ origin: from, outline: text });
    setMethod('direct');
  };

  // 지금 탭에서 만들 단계와 출처. 만들 수 없는 상태면 null
  const plan: { drafts: StepDraft[]; origin: StepOrigin } | null =
    method === 'auto'
      ? auto && !autoStale
        ? { drafts: auto.drafts, origin: auto.origin }
        : null
      : method === 'template'
        ? template && { drafts: template.steps, origin: { source: 'template' } }
        : { drafts: directDrafts, origin: editedFrom && editedFrom.outline === outline ? editedFrom.origin : { source: 'manual' } };

  const create = async () => {
    if (!title.trim() || !plan) return;
    const id = await run('목표 만들기', null, () =>
      createGoal({ title, reward, steps: plan.drafts, origin: plan.origin }),
    );
    if (id) onCreated(id);
  };

  return (
    <article className="new-goal-view">
      <h1>새 목표</h1>
      <label className="field">
        <span>무엇을 이루고 싶나요?</span>
        <input
          className="goal-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 블로그 글 한 편 쓰기"
          autoFocus
          enterKeyHint="next"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && method === 'auto') {
              e.preventDefault();
              void run('단계 나누기', null, decompose, { skipUndo: true });
            }
          }}
        />
      </label>

      <div className="method-tabs" role="tablist" aria-label="단계 만드는 방법">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`tab-${m.id}`}
            aria-selected={method === m.id}
            aria-controls={`panel-${m.id}`}
            onClick={() => setMethod(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <section className="method-panel" role="tabpanel" id={`panel-${method}`} aria-labelledby={`tab-${method}`}>
        {method === 'auto' && (
          <>
            <p className="hint">목표를 적고 나눠 보세요. 결과를 확인한 뒤 고쳐서 쓸 수도 있어요.</p>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={!title.trim() || busy}
                onClick={() => void run('단계 나누기', null, decompose, { skipUndo: true })}
              >
                {busy ? '나누는 중…' : auto && !autoStale ? '다시 나눠 보기' : '단계 나눠 보기'}
              </button>
              {busy && (
                <button type="button" className="text-btn" onClick={stop}>
                  멈추기
                </button>
              )}
            </div>
            {auto && autoStale && <p className="hint">목표가 바뀌었어요. 다시 나눠 보세요.</p>}
            {auto && !autoStale && (
              <>
                <DraftPreview drafts={auto.drafts} />
                <p className="hint small">
                  {auto.fallbackReason ? `${auto.fallbackReason} 대신 기본 규칙으로 나눴어요.` : `${josa(auto.engine, '으로')} 나눴어요.`}
                  {auto.basis && ` (${auto.basis})`}
                </p>
                {auto.understood && <p className="hint small">읽어 낸 정보: {auto.understood}</p>}
                <button type="button" className="text-btn" onClick={() => editAsText(auto.drafts, auto.origin)}>
                  고쳐서 쓰기
                </button>
              </>
            )}
          </>
        )}

        {method === 'template' && (
          <>
            {userTemplates && userTemplates.length > 0 && (
              <>
                <h2 className="list-heading">내 템플릿</h2>
                <TemplateGrid
                  items={userTemplates.map((t) => ({ key: `u:${t.id}`, title: t.title, summary: t.summary, steps: t.steps }))}
                  selected={template?.key}
                  onPick={pick}
                />
                <h2 className="list-heading">기본 템플릿</h2>
              </>
            )}
            <TemplateGrid
              items={TEMPLATES.map((t) => ({ key: `b:${t.id}`, title: t.title, summary: t.summary, steps: t.steps }))}
              selected={template?.key}
              onPick={pick}
            />
            <p className="hint small">
              <a href="#/settings/templates">템플릿 설정</a>에서 내 템플릿을 만들고 고칠 수 있어요.
            </p>
            {template && (
              <div ref={templatePreview}>
                <DraftPreview drafts={template.steps} />
                <button type="button" className="text-btn" onClick={() => editAsText(template.steps, { source: 'template' })}>
                  고쳐서 쓰기
                </button>
              </div>
            )}
          </>
        )}

        {method === 'direct' && (
          <>
            <p className="hint">한 줄에 한 단계씩 적으세요. 앞에 공백 두 칸을 넣으면 하위 단계, 끝에 "10분"을 붙이면 예상 시간이 돼요. 비워 두면 목표만 만들어요.</p>
            <textarea
              className="outline-input"
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              placeholder={OUTLINE_HINT}
              rows={8}
              aria-label="단계 목록"
              spellCheck={false}
            />
            <DraftPreview drafts={directDrafts} />
          </>
        )}
      </section>

      <label className="field new-goal-reward">
        <span>다 끝내면 나에게 줄 보상 (선택)</span>
        <input
          className="text-input"
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          placeholder="예: 좋아하는 빵 사 먹기"
          enterKeyHint="done"
        />
      </label>

      <footer className="new-goal-actions">
        <button type="button" className="primary" disabled={!title.trim() || !plan} onClick={() => void create()}>
          만들기
        </button>
        <button type="button" className="text-btn" onClick={onCancel}>
          취소
        </button>
      </footer>
    </article>
  );
}

function TemplateGrid({ items, selected, onPick }: { items: Pickable[]; selected?: string; onPick: (t: Pickable) => void }) {
  return (
    <ul className="template-list" role="list">
      {items.map((t) => (
        <li key={t.key}>
          <button type="button" aria-pressed={selected === t.key} onClick={() => onPick(t)}>
            <span className="template-title">{t.title}</span>
            {t.summary && <span className="template-summary">{t.summary}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
