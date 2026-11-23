/**
 * 화면 위치를 주소의 # 뒤에 담는다. 휴대폰·앱의 뒤로 가기가 화면 사이를 오가게 하려는 것.
 *   #/                    홈
 *   #/goals               진행 중인 일
 *   #/goal/<id>           일 페이지
 *   #/new                 새 목표
 *   #/archive             완료된 일 보관함
 *   #/settings/ai         AI 설정
 *   #/settings/templates  템플릿 설정 (#/settings/templates/<id|new> 편집)
 *   #/settings/data       백업과 저장 공간
 *   #/settings/display    화면 설정 (축하 효과)
 */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'goals' }
  | { name: 'goal'; id: string }
  | { name: 'new' }
  | { name: 'archive' }
  | { name: 'ai' }
  | { name: 'data' }
  | { name: 'display' }
  | { name: 'templates' }
  | { name: 'template'; id: string | 'new'; from?: string };

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'goals':
      return { name: 'goals' };
    case 'goal':
      return parts[1] ? { name: 'goal', id: parts[1] } : { name: 'goals' };
    case 'new':
      return { name: 'new' };
    case 'archive':
      return { name: 'archive' };
    case 'settings':
      if (parts[1] === 'ai') return { name: 'ai' };
      if (parts[1] === 'data') return { name: 'data' };
      if (parts[1] === 'display') return { name: 'display' };
      if (parts[1] === 'templates') {
        if (!parts[2]) return { name: 'templates' };
        const from = params.get('from') ?? undefined;
        return { name: 'template', id: parts[2], ...(from ? { from } : {}) };
      }
      return { name: 'ai' };
    default:
      return { name: 'home' };
  }
}

export function routeToHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'goals':
      return '#/goals';
    case 'goal':
      return `#/goal/${encodeURIComponent(r.id)}`;
    case 'new':
      return '#/new';
    case 'archive':
      return '#/archive';
    case 'ai':
      return '#/settings/ai';
    case 'data':
      return '#/settings/data';
    case 'display':
      return '#/settings/display';
    case 'templates':
      return '#/settings/templates';
    case 'template':
      return `#/settings/templates/${encodeURIComponent(r.id)}${r.from ? `?from=${encodeURIComponent(r.from)}` : ''}`;
  }
}

export function navigate(r: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeToHash(r);
  if (location.hash === hash) return;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

function subscribe(fn: () => void) {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  return parseRoute(hash);
}

/** 사이드바에서 어느 메뉴에 속하는지 */
export function section(r: Route): 'home' | 'goals' | 'archive' | 'ai' | 'templates' | 'data' | 'display' {
  switch (r.name) {
    case 'goal':
    case 'new':
      return 'goals';
    case 'template':
      return 'templates';
    default:
      return r.name;
  }
}
