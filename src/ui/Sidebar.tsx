import { section, type Route } from '../router';
import { HalfMark } from './HalfMark';

const MAIN = [
  { key: 'home', href: '#/', label: '홈' },
  { key: 'goals', href: '#/goals', label: '진행 중인 일' },
  { key: 'archive', href: '#/archive', label: '완료된 일 보관함' },
] as const;

const SETTINGS = [
  { key: 'ai', href: '#/settings/ai', label: 'AI 설정' },
  { key: 'templates', href: '#/settings/templates', label: '템플릿 설정' },
  { key: 'data', href: '#/settings/data', label: '백업과 저장 공간' },
  { key: 'display', href: '#/settings/display', label: '화면 설정' },
] as const;

export function Sidebar({
  route,
  counts,
  onNavigate,
}: {
  route: Route;
  counts: { active: number; completed: number };
  /** 메뉴를 누른 뒤 (휴대폰 서랍 닫기) */
  onNavigate: () => void;
}) {
  const current = section(route);
  const count = (key: string) => (key === 'goals' ? counts.active : key === 'archive' ? counts.completed : null);

  const link = (item: { key: string; href: string; label: string }) => {
    const n = count(item.key);
    return (
      <li key={item.key}>
        <a href={item.href} aria-current={current === item.key ? 'page' : undefined} onClick={onNavigate}>
          <span>{item.label}</span>
          {n ? <span className="nav-count">{n}</span> : null}
        </a>
      </li>
    );
  };

  return (
    <nav className="sidebar" aria-label="메뉴">
      <a className="brand" href="#/" onClick={onNavigate}>
        <HalfMark />
        <span>반걸음</span>
      </a>
      <ul className="nav" role="list">
        {MAIN.map(link)}
      </ul>
      <p className="nav-group" id="nav-settings">
        설정
      </p>
      <ul className="nav" role="list" aria-labelledby="nav-settings">
        {SETTINGS.map(link)}
      </ul>
    </nav>
  );
}
