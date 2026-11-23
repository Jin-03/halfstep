/**
 * 서비스 워커 등록 (오프라인 실행, 홈 화면 설치).
 * Capacitor로 감싼 Android 앱에서는 파일이 앱 안에 있으므로 등록하지 않는다.
 *
 * 새 버전은 자동으로 바꾸지 않는다. 새 버전을 받으면 안내를 띄우고,
 * 사용자가 “새로고침”을 누를 때 바꾼다(쓰던 내용이 끊기지 않도록).
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/** 켜 둔 채로 오래 쓰는 경우를 위해 새 버전을 확인하는 간격 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let needRefresh = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function setNeedRefresh(v: boolean) {
  needRefresh = v;
  listeners.forEach((l) => l());
}

export function isNativeApp(): boolean {
  return !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

export function setupPwa(): void {
  if (isNativeApp() || !('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => setNeedRefresh(true),
    onRegisteredSW: (_url, reg) => {
      if (!reg) return;
      setInterval(() => {
        if (navigator.onLine) void reg.update().catch(() => {});
      }, CHECK_INTERVAL_MS);
    },
  });
}

/** 새 버전이 준비됐는지 */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => needRefresh,
  );
}

/** 새 버전으로 바꾸고 화면을 다시 연다 */
export function reloadToUpdate(): void {
  if (applyUpdate) void applyUpdate(true);
  else location.reload();
}

/** “나중에”: 이번에는 안내를 닫는다. 앱을 다시 열면 새 버전이 적용된다. */
export function dismissUpdate(): void {
  setNeedRefresh(false);
}
