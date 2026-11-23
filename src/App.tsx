import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGoalSummaries, useGoals } from './db/hooks';
import type { Goal } from './db/schema';
import { homeState, splitGoals } from './model/goals';
import { setSetting, useSetting } from './db/settings';
import { claimReward, markCelebrated } from './db/ops';
import { Celebration } from './reward/Celebration';
import { navigate, useRoute, type Route } from './router';
import { dismissUpdate, reloadToUpdate, useUpdateAvailable } from './pwa';
import { ActionsProvider, useActions } from './ui/actions';
import { AiSettings } from './ui/AiSettings';
import { DataSettings } from './ui/DataSettings';
import { DisplaySettings } from './ui/DisplaySettings';
import { ActiveGoals, Archive } from './ui/GoalLists';
import { GoalView } from './ui/GoalView';
import { HalfMark } from './ui/HalfMark';
import { Home } from './ui/Home';
import { NewGoal } from './ui/NewGoal';
import { Sidebar } from './ui/Sidebar';
import { TemplateEditor, TemplateList } from './ui/TemplateSettings';
import './styles.css';

export default function App() {
  // 되돌린 뒤: 되살아난 목표의 페이지로
  const onUndone = useCallback((goalId: string, goalExists: boolean) => {
    if (goalExists) navigate({ name: 'goal', id: goalId });
  }, []);
  return (
    <ActionsProvider onUndone={onUndone}>
      <Shell />
    </ActionsProvider>
  );
}

const TITLES: Record<Route['name'], string> = {
  home: '반걸음',
  goals: '진행 중인 일',
  goal: '진행 중인 일',
  new: '새 목표',
  archive: '완료된 일 보관함',
  ai: 'AI 설정',
  templates: '템플릿 설정',
  template: '템플릿 설정',
  data: '백업과 저장 공간',
  display: '화면 설정',
};

function Shell() {
  const route = useRoute();
  const goals = useGoals();
  const summaries = useGoalSummaries();
  const { undo, redo, undoLabel, redoLabel, toast, dismiss } = useActions();
  const updateAvailable = useUpdateAvailable();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const split = useMemo(() => (goals && summaries ? splitGoals(goals, summaries) : null), [goals, summaries]);

  // 화면이 바뀌면 서랍을 닫고 맨 위로
  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }, [route.name, 'id' in route ? route.id : null]);

  useEffect(() => {
    document.title = route.name === 'home' ? '반걸음' : `${TITLES[route.name]} · 반걸음`;
  }, [route.name]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  if (!goals || !summaries || !split) return <p className="loading">불러오는 중…</p>;

  return (
    <div className={`app ${drawerOpen ? 'drawer-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-label="메뉴 열기"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <span className="topbar-title">
          {route.name === 'home' && <HalfMark size={18} />} {TITLES[route.name]}
        </span>
        <div className="history-btns">
          <button
            type="button"
            className="undo-btn"
            disabled={!undoLabel}
            onClick={() => void undo()}
            aria-label={undoLabel ? `실행 취소: ${undoLabel}` : '실행 취소 (되돌릴 작업이 없어요)'}
            title={undoLabel ? `실행 취소: ${undoLabel} (Ctrl+Z)` : '되돌릴 작업이 없어요'}
          >
            <span aria-hidden="true">↶</span>
            <span className="history-text">실행 취소</span>
          </button>
          <button
            type="button"
            className="undo-btn"
            disabled={!redoLabel}
            onClick={() => void redo()}
            aria-label={redoLabel ? `다시 실행: ${redoLabel}` : '다시 실행 (다시 할 작업이 없어요)'}
            title={redoLabel ? `다시 실행: ${redoLabel} (Ctrl+Shift+Z)` : '다시 할 작업이 없어요'}
          >
            <span aria-hidden="true">↷</span>
            <span className="history-text">다시 실행</span>
          </button>
        </div>
      </header>

      <div className="backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <Sidebar
        route={route}
        counts={{ active: split.active.length, completed: split.completed.length }}
        onNavigate={() => setDrawerOpen(false)}
      />

      <main className={`main main-${route.name}`}>
        <Page route={route} goals={goals} active={split.active} completed={split.completed} summaries={summaries} />
      </main>

      <div className="toast-area" aria-live="polite">
        {updateAvailable && (
          <div className="toast update" role="status">
            <span>새 버전이 있어요</span>
            <button type="button" onClick={reloadToUpdate}>
              새로고침
            </button>
            <button type="button" className="toast-close" aria-label="나중에" title="나중에" onClick={dismissUpdate}>
              ×
            </button>
          </div>
        )}
        {toast && (
          <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
            <span>{toast.text}</span>
            {toast.canUndo && (
              <button
                type="button"
                onClick={() => {
                  dismiss();
                  void undo();
                }}
              >
                실행 취소
              </button>
            )}
            {toast.canRedo && (
              <button
                type="button"
                onClick={() => {
                  dismiss();
                  void redo();
                }}
              >
                다시 실행
              </button>
            )}
            <button type="button" className="toast-close" aria-label="알림 닫기" onClick={dismiss}>
              ×
            </button>
          </div>
        )}
      </div>

      <Celebration
        onClaimReward={(id) => void claimReward(id).catch(console.error)}
        onDismissGoal={(id) => void markCelebrated(id).catch(console.error)}
      />
    </div>
  );
}

function Page({
  route,
  goals,
  active,
  completed,
  summaries,
}: {
  route: Route;
  goals: Goal[];
  active: Goal[];
  completed: Goal[];
  summaries: Parameters<typeof Archive>[0]['summaries'];
}) {
  switch (route.name) {
    case 'home':
      return <HomePage goals={goals} active={active} completed={completed} summaries={summaries} />;
    case 'goals':
      return <ActiveGoals goals={active} />;
    case 'goal': {
      const goal = goals.find((g) => g.id === route.id);
      return goal ? <GoalView key={goal.id} goal={goal} /> : <GoalGone />;
    }
    case 'new':
      return (
        <NewGoal
          onCreated={(id) => navigate({ name: 'goal', id }, { replace: true })}
          onCancel={() => (history.length > 1 ? history.back() : navigate({ name: 'goals' }))}
        />
      );
    case 'archive':
      return <Archive goals={completed} summaries={summaries} />;
    case 'ai':
      return <AiSettings />;
    case 'templates':
      return <TemplateList />;
    case 'data':
      return <DataSettings />;
    case 'display':
      return <DisplaySettings />;
    case 'template':
      return <TemplateEditor key={`${route.id}:${route.from ?? ''}`} id={route.id} from={route.from} />;
  }
}

function HomePage({
  goals,
  active,
  completed,
  summaries,
}: {
  goals: Goal[];
  active: Goal[];
  completed: Goal[];
  summaries: Parameters<typeof Archive>[0]['summaries'];
}) {
  const pinned = useSetting('pinnedGoalId');
  const state = useMemo(() => (pinned === undefined ? null : homeState(goals, summaries, pinned)), [goals, summaries, pinned]);
  // 고정한 일이 없으면 지금 보여 주는 일을 고정한다. 그 뒤로는 다 끝내거나 다른 일을 고를 때까지 바뀌지 않는다.
  const autoPinId = state?.kind === 'focus' && state.autoPin ? state.goal.id : null;
  useEffect(() => {
    if (autoPinId) void setSetting('pinnedGoalId', autoPinId);
  }, [autoPinId]);
  if (!state) return null;
  return <Home state={state} activeCount={active.length} completedCount={completed.length} />;
}

/** 삭제된 목표의 주소로 들어왔을 때 */
function GoalGone() {
  return (
    <section className="list-page">
      <p className="empty">이 일을 찾을 수 없어요. 삭제되었을 수 있어요.</p>
      <a href="#/goals">진행 중인 일 목록으로</a>
    </section>
  );
}
