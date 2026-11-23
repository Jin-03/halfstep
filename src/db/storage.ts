/**
 * 저장 공간 보호. 브라우저는 공간이 부족하면 사이트 데이터를 지울 수 있는데,
 * "보호(persistent)"로 표시된 데이터는 사용자가 직접 지우기 전까지 남는다.
 * Android Chrome은 설치한 PWA처럼 자주 쓰는 사이트에는 보통 자동으로 허락한다.
 */
import { setSetting } from './settings';

export interface StorageInfo {
  /** 보호 여부. 확인할 수 없는 환경이면 null */
  persisted: boolean | null;
  /** 사용량·한도 (바이트). 모르면 null */
  usage: number | null;
  quota: number | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = navigator.storage;
  const persisted = s?.persisted ? await s.persisted().catch(() => null) : null;
  const est = s?.estimate ? await s.estimate().catch(() => null) : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null };
}

/** 보호를 요청한다. @returns 보호되었으면 true */
export async function requestPersist(): Promise<boolean> {
  const s = navigator.storage;
  if (!s?.persist) return false;
  const ok = (await s.persisted?.().catch(() => false)) || (await s.persist().catch(() => false));
  await setSetting('persistGranted', ok);
  return ok;
}

/** 앱 시작 때 한 번: 아직 보호되지 않았으면 조용히 요청 */
export async function ensurePersisted(): Promise<void> {
  try {
    await requestPersist();
  } catch {
    // 지원하지 않는 환경
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(1)}GB`;
}
