/**
 * 결과 검사 (규칙·AI 공용). 어느 엔진이 낸 결과든 반걸음 기준에 맞게 다듬는다.
 * - 다짐뿐인 단계("열심히 하기")는 뺀다 (단계가 하나만 남으면 그대로 둔다)
 * - 목표 나누기: 첫 단계가 FIRST_STEP_MAX분보다 길면 그 단계를 성격에 맞게 더 작게 나눈다
 */
import type { StepDraft } from '../db/ops';
import { splitByPattern } from './rules';
import { FIRST_STEP_MAX, SPLIT_PATTERNS, VAGUE } from './rulesData';
import type { DecomposeRequest } from './types';

function dropVague(list: StepDraft[]): StepDraft[] {
  const kept = list
    .filter((d) => !VAGUE.test(d.title.trim()))
    .map((d) => (d.children?.length ? { ...d, children: dropVague(d.children) } : d))
    .map((d) => (d.children && d.children.length === 0 ? (({ children: _c, ...rest }) => rest)(d) : d));
  return kept.length > 0 ? kept : list;
}

/** 첫 번째 리프 (깊이 우선) */
function firstLeaf(list: StepDraft[]): StepDraft | undefined {
  const d = list[0];
  if (!d) return undefined;
  return d.children?.length ? firstLeaf(d.children) : d;
}

export function refine(drafts: StepDraft[], req: DecomposeRequest): StepDraft[] {
  const out = dropVague(structuredClone(drafts));
  if (req.kind === 'goal') {
    const leaf = firstLeaf(out);
    // 단계 성격에 맞는 패턴이 있을 때만 쪼갠다. 맞는 게 없으면 "필요한 것 챙기기 / 앞부분부터 시작하기" 같은
    // 뜻 없는 하위 단계가 붙으므로 그대로 둔다.
    if (leaf && (leaf.minutes ?? 0) > FIRST_STEP_MAX && SPLIT_PATTERNS.some((p) => p.match.test(leaf.title))) {
      leaf.children = splitByPattern(leaf.title, leaf.minutes);
      delete leaf.minutes;
    }
  }
  return out;
}
