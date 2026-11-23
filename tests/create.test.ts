import { describe, expect, it } from 'vitest';
import type { StepDraft } from '../src/db/ops';
import { createGoal } from '../src/db/ops';
import { db } from '../src/db/schema';
import { decomposeByRules, GENERIC_PLAN, matchTemplate, rulesEngine, splitGeneric } from '../src/ai/rules';
import { countDrafts, parseOutline, splitTitleMinutes, toOutline } from '../src/model/outline';
import { TEMPLATES } from '../src/model/templates';
import { buildTree, progress } from '../src/model/tree';

describe('개요 텍스트 파싱', () => {
  it('줄마다 단계, 들여쓰기로 하위 단계', () => {
    const drafts = parseOutline(`주제 정하기
초안 쓰기
  서론
  본문
    예시 찾기
  결론
올리기`);
    expect(drafts.map((d) => d.title)).toEqual(['주제 정하기', '초안 쓰기', '올리기']);
    expect(drafts[1].children?.map((d) => d.title)).toEqual(['서론', '본문', '결론']);
    expect(drafts[1].children?.[1].children?.[0].title).toBe('예시 찾기');
    expect(drafts[0]).not.toHaveProperty('children');
  });

  it('탭·전각 공백 들여쓰기와 글머리표를 처리한다', () => {
    const drafts = parseOutline('- 준비\n\t* 신발\n\u3000• 물\n1. 달리기\n2) 스트레칭');
    expect(drafts.map((d) => d.title)).toEqual(['준비', '달리기', '스트레칭']);
    expect(drafts[0].children?.map((d) => d.title)).toEqual(['신발', '물']);
  });

  it('빈 줄과 앞뒤 공백, Windows 줄바꿈을 무시한다', () => {
    expect(parseOutline('\r\n  \r\n하나\r\n\r\n둘  \r\n').map((d) => d.title)).toEqual(['하나', '둘']);
    expect(parseOutline('')).toEqual([]);
  });

  it('첫 줄이 들여쓰기돼 있어도 최상위로 본다', () => {
    const drafts = parseOutline('    하나\n    둘\n      둘-1');
    expect(drafts.map((d) => d.title)).toEqual(['하나', '둘']);
    expect(drafts[1].children?.[0].title).toBe('둘-1');
  });

  it('들여쓰기가 줄어들면 맞는 깊이로 돌아간다', () => {
    const d = parseOutline('A\n    A1\n        A1a\n  B?\nC');
    // "B?"는 A(0)보다 깊고 A1(4)보다 얕으므로 A의 자식
    expect(d.map((x) => x.title)).toEqual(['A', 'C']);
    expect(d[0].children?.map((x) => x.title)).toEqual(['A1', 'B?']);
  });

  it('줄 끝의 시간을 읽는다', () => {
    expect(splitTitleMinutes('보고서 쓰기 (1시간 30분)')).toEqual({ title: '보고서 쓰기', minutes: 90 });
    expect(splitTitleMinutes('스트레칭 10분')).toEqual({ title: '스트레칭', minutes: 10 });
    expect(splitTitleMinutes('복습 [2시간]')).toEqual({ title: '복습', minutes: 120 });
    expect(splitTitleMinutes('5km 달리기')).toEqual({ title: '5km 달리기' });
    expect(splitTitleMinutes('30분')).toEqual({ title: '30분' });
    expect(splitTitleMinutes('3분 스피치 준비')).toEqual({ title: '3분 스피치 준비' });
  });

  it('toOutline → parseOutline 왕복이 같다', () => {
    for (const t of TEMPLATES) expect(parseOutline(toOutline(t.steps))).toEqual(t.steps);
  });
});

function walk(drafts: readonly StepDraft[], fn: (d: StepDraft, leaf: boolean) => void) {
  for (const d of drafts) {
    const leaf = !d.children?.length;
    fn(d, leaf);
    if (!leaf) walk(d.children!, fn);
  }
}

describe('템플릿', () => {
  it('8종, id가 겹치지 않는다', () => {
    expect(TEMPLATES).toHaveLength(8);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(8);
  });

  it('모든 리프에 예상 시간이 있고 제목이 비어 있지 않다', () => {
    for (const t of TEMPLATES) {
      expect(countDrafts(t.steps)).toBeGreaterThanOrEqual(5);
      walk(t.steps, (d, leaf) => {
        expect(d.title.trim()).not.toBe('');
        if (leaf) expect(d.minutes, `${t.id}/${d.title}`).toBeGreaterThan(0);
      });
    }
  });

  it('템플릿으로 목표를 만들 수 있다', async () => {
    await db.steps.clear();
    for (const t of TEMPLATES) {
      const id = await createGoal({ title: t.title, steps: t.steps, origin: { source: 'template' } });
      const rows = await db.steps.where('goalId').equals(id).toArray();
      expect(rows).toHaveLength(countDrafts(t.steps));
      expect(progress(buildTree(rows)).done).toBe(0);
    }
  });
});

describe('규칙 엔진', () => {
  it.each([
    ['정보처리기사 시험 합격하기', 'exam'],
    ['매일 30분 달리기', 'exercise'],
    ['블로그에 여행 후기 글 쓰기', 'writing'],
    ['방 청소하기', 'tidy'],
    ['오사카 여행 가기', 'travel'],
    ['다음 달 이사', 'moving'],
    ['팀 회의 발표 준비', 'presentation'],
    ['파이썬 코딩 배우기', 'skill'],
    ['PPT 만들기', 'presentation'],
  ])('"%s" → %s', (goal, id) => {
    expect(matchTemplate(goal)?.id).toBe(id);
  });

  it('맞는 템플릿이 없으면 유형별 계획, 유형도 없으면 일반 계획 (대상을 채워서)', () => {
    expect(matchTemplate('가족 사진 앨범 만들기')).toBeNull();
    expect(decomposeByRules({ kind: 'goal', goal: '가족 사진 앨범 만들기' })[0].title).toBe('가족 사진 앨범 완성된 모습 한 문장으로 적기');
    const generic = decomposeByRules({ kind: 'goal', goal: '동네 봉사활동 시작하기' });
    expect(generic[0].title).toBe('동네 봉사활동 끝냈을 때의 모습 한 문장으로 적기');
    expect(generic.slice(1)).toEqual(GENERIC_PLAN.slice(1));
  });

  it('결과는 복사본이라 고쳐도 템플릿이 바뀌지 않는다', () => {
    const r = decomposeByRules({ kind: 'goal', goal: '시험 공부' });
    r[0].title = '바뀜';
    expect(TEMPLATES[0].steps[0].title).toBe('시험 범위 파악하기');
  });

  it('쪼개기: 시간을 비율대로 나누고 5분 단위로 맞춘다', () => {
    const parts = splitGeneric(60);
    expect(parts).toHaveLength(4);
    expect(parts.map((p) => p.minutes)).toEqual([10, 25, 20, 5]);
    expect(splitGeneric().map((p) => p.minutes)).toEqual([5, 15, 15, 5]);
  });

  it('쪼개기: 단계가 다른 종류의 일이면 그 템플릿을 쓴다', () => {
    const r = decomposeByRules({ kind: 'split', goal: '이직 준비', step: '자기소개서 쓰기', path: [] });
    expect(r[0].title).toBe('주제를 한 문장으로 적기');
    // 목표와 같은 템플릿이면 단계 성격대로: 공부는 30분이 넘으면 25분 묶음
    const same = decomposeByRules({ kind: 'split', goal: '시험 공부', step: '시험 범위 공부', minutes: 40, path: [] });
    expect(same.map((d) => d.title)).toEqual(['오늘 할 분량 2묶음으로 나누기', '1번째 묶음 25분 하기', '2번째 묶음 25분 하기', '헷갈린 부분 표시하기']);
    // 맞는 패턴이 없으면 준비·시작·나머지·확인
    const plain = decomposeByRules({ kind: 'split', goal: 'x', step: '봉사 활동 가기', minutes: 40, path: [] });
    expect(plain.map((d) => d.title)).toEqual(['필요한 것 챙기기', '앞부분부터 시작하기', '나머지 끝내기', '확인하고 마무리하기']);
  });

  it('더 제안: 이미 있는 단계는 빼고 3개', () => {
    const existing = ['주제를 한 문장으로 적기', '자료 모으기'];
    const r = decomposeByRules({ kind: 'more', goal: '블로그 글 쓰기', existing });
    expect(r).toHaveLength(3);
    expect(r.map((d) => d.title)).toEqual(['목차 짜기', '초안 쓰기', '소리 내어 읽으며 고치기']);
    const r2 = decomposeByRules({ kind: 'more', goal: '블로그 글 쓰기', existing: ['목 차 짜기', ...existing] });
    expect(r2[0].title).toBe('초안 쓰기');
  });

  it('더 제안: 유형이 없는 목표는 이어서 할 단계부터, 유형이 있으면 그 뼈대에서 빠진 단계부터', () => {
    const r = decomposeByRules({ kind: 'more', goal: '동네 봉사활동 시작하기', existing: ['봉사 단체 찾기'] });
    expect(r.map((d) => d.title)).toEqual(['진행 상황 점검하기', '막힌 점 물어볼 사람 정하기', '다음에 할 일 적어 두기']);
    const made = decomposeByRules({ kind: 'more', goal: '가족 사진 앨범 만들기', existing: ['가족 사진 앨범 완성된 모습 한 문장으로 적기'] });
    expect(made[0].title).toBe('필요한 재료와 자료 모으기');
  });

  it('더 제안: 진행률이 높으면 마무리 단계부터', () => {
    const r = decomposeByRules({ kind: 'more', goal: '블로그 글 쓰기', existing: [], doneRatio: 0.8 });
    expect(r[0].title).toBe('빠진 것 없는지 마지막 점검하기');
  });

  it('엔진 인터페이스로 호출할 수 있다', async () => {
    expect(await rulesEngine.available()).toEqual({ status: 'ready' });
    expect((await rulesEngine.decompose({ kind: 'goal', goal: '운동' }))[0].title).toBe('시작 준비');
  });
});
