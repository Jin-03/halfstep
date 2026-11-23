/**
 * 직접 적기용 개요 텍스트 ↔ 단계 초안.
 *
 * 한 줄에 단계 하나. 들여쓰기(공백 2칸 또는 탭)로 하위 단계를 만든다.
 * 줄 앞의 "-", "*", "•", "1.", "1)" 같은 표시는 지운다.
 * 줄 끝의 "(10분)", "10분", "1시간", "1시간 30분"은 예상 시간으로 읽는다.
 */
import type { StepDraft } from '../db/ops';

const BULLET = /^(?:[-*•·]|\d{1,3}[.)])\s+/;
const TIME = /\s*[([]?\s*(?:(\d{1,3})\s*시간)?\s*(?:(\d{1,4})\s*분)?\s*[)\]]?\s*$/;

/** "보고서 쓰기 (1시간 30분)" → { title: '보고서 쓰기', minutes: 90 } */
export function splitTitleMinutes(line: string): { title: string; minutes?: number } {
  const m = line.match(TIME);
  if (!m || (!m[1] && !m[2])) return { title: line.trim() };
  const title = line.slice(0, m.index).trim();
  if (!title) return { title: line.trim() };
  const minutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
  return minutes > 0 ? { title, minutes } : { title };
}

function indentOf(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else if (ch === '\u3000') n += 2; // 전각 공백
    else break;
  }
  return n;
}

export function parseOutline(text: string): StepDraft[] {
  const root: StepDraft[] = [];
  // 들여쓰기 깊이 스택: [들여쓰기 칸 수, 그 깊이의 목록]
  const stack: { indent: number; list: StepDraft[] }[] = [{ indent: -1, list: root }];

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const body = raw.trim().replace(BULLET, '').trim();
    if (!body) continue;
    const indent = indentOf(raw);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parentList = stack[stack.length - 1].list;
    const draft: StepDraft = splitTitleMinutes(body);
    parentList.push(draft);
    // 이 줄보다 깊게 들여쓴 줄은 이 단계의 하위 단계가 된다.
    draft.children = [];
    stack.push({ indent, list: draft.children });
  }
  return prune(root);
}

/** 빈 children 배열 정리 */
function prune(list: StepDraft[]): StepDraft[] {
  return list.map((d) => {
    const { children, ...rest } = d;
    return children && children.length ? { ...rest, children: prune(children) } : rest;
  });
}

/** 단계 초안 → 개요 텍스트 (공백 2칸 들여쓰기) */
export function toOutline(drafts: readonly StepDraft[], depth = 0): string {
  return drafts
    .map((d) => {
      const time = d.minutes ? ` (${d.minutes}분)` : '';
      const line = `${'  '.repeat(depth)}${d.title}${time}`;
      return d.children?.length ? `${line}\n${toOutline(d.children, depth + 1)}` : line;
    })
    .join('\n');
}

/** 초안 트리의 단계 수 */
export function countDrafts(drafts: readonly StepDraft[]): number {
  return drafts.reduce((n, d) => n + 1 + countDrafts(d.children ?? []), 0);
}
