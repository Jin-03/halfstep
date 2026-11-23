/**
 * 서비스 워커 등록 (오프라인 실행, 홈 화면 설치).
 * Capacitor로 감싼 Android 앱에서는 파일이 앱 안에 있으므로 등록하지 않는다.
 */
import { registerSW } from 'virtual:pwa-register';

export function isNativeApp(): boolean {
  return !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
}

export function setupPwa(): void {
  if (isNativeApp() || !('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
