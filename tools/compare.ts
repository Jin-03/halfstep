/**
 * 개발용 모델 비교 페이지. 실제 앱과 같은 지시문·답 해석·결과 검사(refine)를 쓴다.
 * 결과는 window.__cmp 에도 남긴다.
 */
import type { StepDraft } from '../src/db/ops';
import { chromeEngine } from '../src/ai/chrome';
import { makeContext } from '../src/ai/context';
import { refine } from '../src/ai/refine';
import { rulesPlan } from '../src/ai/rules';
import type { DecomposeRequest } from '../src/ai/types';
import { askModel, isModelCached, loadModel, webgpuStatus } from '../src/ai/webllm';

const GOALS = [
  '다음 주까지 부모님 생신 선물 사기',
  '토익 900점 받기',
  '매일 20분 책 읽기',
  '여권 재발급 신청하기',
  '신발장 정리',
  '11월 20일까지 블로그 글 쓰기',
  '엑셀 함수 배우기',
  '집주인에게 보일러 수리 요청하기',
  '친구 결혼식 축사 준비',
  '동네 봉사활동 시작하기',
  // 2026-11-23 추가: 기본 규칙을 다듬을 때 쓰지 않은 목표
  '이번 주말까지 중고 노트북 팔기',
  '고양이 입양 준비하기',
  '운전면허 필기시험 합격하기',
  '이력서 고쳐서 회사 3곳 지원하기',
  '일주일 식비 5만 원으로 줄이기',
  '아침 6시에 일어나는 습관 만들기',
  '연말정산 서류 챙기기',
  '베란다 화분 분갈이하기',
  '유튜브 첫 영상 올리기',
  '기타로 노래 한 곡 치기',
];

/**
 * 비교할 요청. 앞의 20개는 목표 나누기(점수 기준: 4B 31/40, Chrome 내장 AI 36/40).
 * 2026-11-23 추가: 메모가 있는 목표(같은 목표를 메모 없이 나눈 결과와 견줘 메모가 도움이 되는지 본다),
 * 더 쪼개기, 단계 더 제안.
 */
interface Case {
  /** 표에 보이는 이름 (결과 JSON에서도 이 이름으로 찾는다) */
  label: string;
  req: DecomposeRequest;
}
const CASES: Case[] = [
  ...GOALS.map((goal): Case => ({ label: goal, req: { kind: 'goal', goal } })),
  ...[
    ['이번 주말까지 중고 노트북 팔기', '사진은 이미 찍어 뒀어요. 당근에 올릴 거예요.'],
    ['토익 900점 받기', '지금 750점이고 시험은 3월이에요. 평일 하루 1시간 공부할 수 있어요.'],
    ['아침 6시에 일어나는 습관 만들기', '평일에만 하고 싶어요. 지금은 8시쯤 일어나요.'],
    ['11월 20일까지 블로그 글 쓰기', '주제는 이미 정했어요. 여행 후기예요.'],
  ].map(([goal, note]): Case => ({ label: `[메모] ${goal}`, req: { kind: 'goal', goal, note } })),
  ...[
    { goal: '토익 900점 받기', path: [], step: '기출문제 한 회 풀기', minutes: 120 },
    { goal: '고양이 입양 준비하기', path: ['필요한 용품 사기'], step: '화장실과 모래 고르기', minutes: 30 },
    { goal: '유튜브 첫 영상 올리기', path: [], step: '영상 편집하기', minutes: 90 },
  ].map((r): Case => ({ label: `[쪼개기] ${r.goal} > ${r.step}`, req: { kind: 'split', ...r } })),
  ...[
    { goal: '여권 재발급 신청하기', existing: ['여권 사진 찍기', '구비 서류 확인하기'], doneRatio: 0.2 },
    { goal: '친구 결혼식 축사 준비', existing: ['축사에 넣을 일화 적기', '초안 쓰기', '소리 내어 읽어 보기'], doneRatio: 0.7 },
    { goal: '베란다 화분 분갈이하기', existing: ['새 화분 사기', '분갈이 흙 사기'], doneRatio: 0 },
  ].map((r): Case => ({ label: `[더 제안] ${r.goal}`, req: { kind: 'more', ...r } })),
];

const CANDIDATES = [
  { id: 'Qwen3.5-0.8B-q4f16_1-MLC', checked: false },
  { id: 'Qwen3.5-2B-q4f16_1-MLC', checked: true },
  { id: 'Qwen3.5-4B-q4f16_1-MLC', checked: true },
  { id: 'Qwen3-0.6B-q4f16_1-MLC', checked: false },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', checked: false },
  { id: 'Qwen3-4B-q4f16_1-MLC', checked: false },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', checked: false },
];

interface GoalResult {
  goal: string;
  ms: number;
  ok: boolean;
  drafts: StepDraft[];
  raw?: string;
  finishReason?: string | null;
  error?: string;
}
interface RunResult {
  id: string;
  cachedBefore?: boolean;
  loadMs?: number;
  storageDeltaMB?: number;
  error?: string;
  goals: GoalResult[];
}
const results: { env: Record<string, unknown>; runs: RunResult[]; done: boolean; busy: boolean } = {
  env: {},
  runs: [],
  done: false,
  busy: false,
};
(window as unknown as { __cmp: typeof results }).__cmp = results;

const $ = (id: string) => document.getElementById(id)!;
const status = (t: string) => {
  $('status').textContent = t;
  results.env.lastStatus = t;
};

async function storageMB(): Promise<number> {
  const e = await navigator.storage.estimate();
  return (e.usage ?? 0) / 1024 / 1024;
}

async function requestFor(c: Case): Promise<DecomposeRequest> {
  return { ...c.req, context: await makeContext(c.req) };
}

async function runRules(): Promise<RunResult> {
  const run: RunResult = { id: '기본 규칙', goals: [] };
  for (const c of CASES) {
    const goal = c.label;
    const req = await requestFor(c);
    const t = performance.now();
    const drafts = refine(rulesPlan(req, req.context!).drafts, req);
    run.goals.push({ goal, ms: Math.round(performance.now() - t), ok: drafts.length > 0, drafts });
  }
  return run;
}

async function runChrome(): Promise<RunResult> {
  const run: RunResult = { id: 'Chrome 내장 AI', goals: [] };
  const a = await chromeEngine.available();
  if (a.status !== 'ready') {
    run.error = `${a.status}: ${a.reason ?? ''}`;
    return run;
  }
  for (const [i, c] of CASES.entries()) {
    const goal = c.label;
    status(`Chrome 내장 AI: ${i + 1}/${CASES.length} ${goal}`);
    const req = await requestFor(c);
    const t = performance.now();
    try {
      const d = await chromeEngine.decompose(req);
      const drafts = d.length ? refine(d, req) : [];
      run.goals.push({ goal, ms: Math.round(performance.now() - t), ok: drafts.length > 0, drafts });
    } catch (err) {
      run.goals.push({ goal, ms: Math.round(performance.now() - t), ok: false, drafts: [], error: String(err) });
    }
  }
  return run;
}

async function runModel(id: string): Promise<RunResult> {
  const run: RunResult = { id, goals: [] };
  try {
    run.cachedBefore = await isModelCached(id);
    const before = await storageMB();
    const t0 = performance.now();
    const model = await loadModel(id, (p, text) => status(`${id}: ${Math.round(p * 100)}% ${text}`));
    run.loadMs = Math.round(performance.now() - t0);
    run.storageDeltaMB = Math.round((await storageMB()) - before);
    for (const [i, c] of CASES.entries()) {
      const goal = c.label;
      status(`${id}: ${i + 1}/${CASES.length} ${goal}`);
      const req = await requestFor(c);
      const t = performance.now();
      try {
        const a = await askModel(model, req);
        const drafts = a.drafts.length ? refine(a.drafts, req) : [];
        run.goals.push({ goal, ms: Math.round(performance.now() - t), ok: drafts.length > 0, drafts, raw: a.raw, finishReason: a.finishReason });
      } catch (err) {
        run.goals.push({ goal, ms: Math.round(performance.now() - t), ok: false, drafts: [], error: String(err) });
      }
      render();
    }
    await model.unload();
  } catch (err) {
    run.error = String(err);
  }
  return run;
}

function draftsHtml(list: StepDraft[]): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<ul>${list
    .map((d) => `<li>${esc(d.title)}${d.minutes ? ` <span class="meta">${d.minutes}분</span>` : ''}${d.children?.length ? draftsHtml(d.children) : ''}</li>`)
    .join('')}</ul>`;
}

function render() {
  const runs = results.runs;
  if (!runs.length) return;
  const head = `<tr><th>목표</th>${runs
    .map((r) => {
      const ok = r.goals.filter((g) => g.ok).length;
      const avg = r.goals.length ? Math.round(r.goals.reduce((s, g) => s + g.ms, 0) / r.goals.length / 100) / 10 : 0;
      return `<th>${r.id}<div class="meta">읽힌 답 ${ok}/${r.goals.length} · 평균 ${avg}초${r.loadMs !== undefined ? ` · 불러오기 ${Math.round(r.loadMs / 1000)}초` : ''}${r.storageDeltaMB ? ` · +${r.storageDeltaMB}MB` : ''}</div>${r.error ? `<div class="fail">${r.error}</div>` : ''}</th>`;
    })
    .join('')}</tr>`;
  const rows = CASES.map(({ label: goal }) => {
    const cells = runs
      .map((r) => {
        const g = r.goals.find((x) => x.goal === goal);
        if (!g) return '<td></td>';
        if (!g.ok) return `<td class="fail">읽지 못함 (${(g.ms / 1000).toFixed(1)}초)${g.error ? `<div class="meta">${g.error}</div>` : ''}</td>`;
        return `<td>${draftsHtml(g.drafts)}<div class="meta">${(g.ms / 1000).toFixed(1)}초</div></td>`;
      })
      .join('');
    return `<tr><th>${goal}</th>${cells}</tr>`;
  }).join('');
  $('out').innerHTML = `<table>${head}${rows}</table>`;
}

async function guarded(fn: () => Promise<void>) {
  if (results.busy) return;
  results.busy = true;
  results.done = false;
  try {
    await fn();
    status('끝');
  } catch (err) {
    status(`오류: ${String(err)}`);
  } finally {
    results.busy = false;
    results.done = true;
    render();
  }
}

async function baselines() {
  results.runs = results.runs.filter((r) => r.id !== '기본 규칙' && r.id !== 'Chrome 내장 AI');
  results.runs.unshift(await runRules());
  render();
  results.runs.splice(1, 0, await runChrome());
  render();
}

/** 개발 도구에서 부르기 쉽게 */
async function runModels(ids: string[]) {
  for (const id of ids) {
    results.runs = results.runs.filter((r) => r.id !== id);
    const r: RunResult = await runModel(id);
    results.runs.push(r);
    render();
  }
}
Object.assign(window, { cmpRunModels: (ids: string[]) => guarded(() => runModels(ids)), cmpBaselines: () => guarded(baselines) });

async function init() {
  const gpu = await webgpuStatus();
  results.env = { ua: navigator.userAgent, gpu, date: new Date().toISOString() };
  $('env').textContent = `WebGPU: ${gpu.ok ? `있음 (shader-f16 ${gpu.f16 ? '지원' : '미지원'})` : gpu.reason}`;
  for (const c of CANDIDATES) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${c.id}" ${c.checked ? 'checked' : ''}/> ${c.id} `;
    $('models').append(label, document.createElement('br'));
  }
  $('run').onclick = () =>
    guarded(async () => {
      await baselines();
      const ids = [...document.querySelectorAll<HTMLInputElement>('#models input:checked')].map((i) => i.value);
      await runModels(ids);
    });
  $('base').onclick = () => guarded(baselines);
  $('save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }));
    a.download = `model-compare-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
}
void init();
