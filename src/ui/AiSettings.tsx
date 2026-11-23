import { useCallback, useEffect, useRef, useState } from 'react';
import { ENGINES } from '../ai';
import type { Availability, Engine } from '../ai/types';
import { setSetting, useSetting } from '../db/settings';
import { useActions } from './actions';
import { josa } from './format';

const STATUS_TEXT: Record<Availability['status'], string> = {
  ready: '사용 가능',
  'needs-download': '모델 받기 필요',
  downloading: '받는 중',
  unsupported: '사용 불가',
};

export function AiSettings() {
  const pref = useSetting('enginePref');
  const { run } = useActions();
  const [status, setStatus] = useState<Record<string, Availability>>({});
  const [progress, setProgress] = useState<{ id: string; ratio: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(ENGINES.map(async (e) => [e.id, await e.available()] as const));
    setStatus(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
  }, [refresh]);

  const download = async (e: Engine) => {
    if (!e.download) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ id: e.id, ratio: 0 });
    try {
      await run(`${e.label} 모델 받기`, null, () => e.download!((ratio) => setProgress({ id: e.id, ratio }), ctrl.signal), {
        skipUndo: true,
      });
    } finally {
      abort.current = null;
      setProgress(null);
      void refresh();
    }
  };

  const remove = async (e: Engine) => {
    if (!e.remove) return;
    try {
      await run(`${e.label} 모델 지우기`, null, () => e.remove!(), { skipUndo: true });
    } finally {
      void refresh();
    }
  };

  const ready = ENGINES.filter((e) => status[e.id]?.status === 'ready');
  const autoEngine = ready[0];

  return (
    <article className="settings">
      <h1>AI 설정</h1>
      <p className="hint">목표를 나누고, 단계를 쪼개고, 단계를 더 제안할 때 쓸 방법을 고르세요. 모든 AI는 기기 안에서 동작해요.</p>

      <fieldset className="engine-choice">
        <legend>나누는 방법</legend>
        <label className="engine-option">
          <input type="radio" name="engine" checked={pref === 'auto'} onChange={() => void setSetting('enginePref', 'auto')} />
          <span className="engine-body">
            <span className="engine-name">자동</span>
            <span className="engine-desc">
              쓸 수 있는 AI를 먼저 쓰고, 없으면 기본 규칙을 써요.
              {autoEngine && ` 지금은 ${josa(autoEngine.label, '을')} 써요.`}
            </span>
          </span>
        </label>
        {ENGINES.map((e) => {
          const a = status[e.id];
          const downloading = progress?.id === e.id;
          return (
            <label key={e.id} className="engine-option">
              <input type="radio" name="engine" checked={pref === e.id} onChange={() => void setSetting('enginePref', e.id)} />
              <span className="engine-body">
                <span className="engine-name">
                  {e.label}
                  {a && (
                    <span className={`engine-status s-${downloading ? 'downloading' : a.status}`}>
                      {STATUS_TEXT[downloading ? 'downloading' : a.status]}
                    </span>
                  )}
                </span>
                <span className="engine-desc">{e.description}</span>
                {a?.reason && a.status !== 'ready' && <span className="engine-desc">{a.reason}</span>}
                {downloading && (
                  <span className="download">
                    <span className="bar" role="progressbar" aria-label={`${e.label} 모델 받는 중`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
                      <span style={{ width: `${progress.ratio * 100}%` }} />
                    </span>
                    <span className="download-row">
                      {Math.round(progress.ratio * 100)}%
                      <button type="button" className="text-btn" onClick={(ev) => { ev.preventDefault(); abort.current?.abort(); }}>
                        멈추기
                      </button>
                    </span>
                  </span>
                )}
                {!downloading && a?.status === 'needs-download' && e.download && (
                  <button type="button" className="secondary small" onClick={(ev) => { ev.preventDefault(); void download(e); }}>
                    모델 받기
                  </button>
                )}
                {!downloading && a?.status === 'ready' && e.remove && (
                  <button type="button" className="text-btn small" onClick={(ev) => { ev.preventDefault(); void remove(e); }}>
                    모델 지우기 (저장 공간 비우기)
                  </button>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="hint small">
        모델은 받을 때만 인터넷을 써요. 목표와 단계 내용은 기기 밖으로 나가지 않아요. 휴대폰에서는 보통 기본 규칙으로 동작해요.
      </p>
    </article>
  );
}
