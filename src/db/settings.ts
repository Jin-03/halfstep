import { useLiveQuery } from 'dexie-react-hooks';
import { db, type SettingKey } from './schema';

export interface SettingValues {
  /** 'auto' = 쓸 수 있는 첫 엔진, 그 밖에는 엔진 id */
  enginePref: string;
  migratedFromLocalStorage: boolean;
  lastBackupAt: number;
  persistGranted: boolean;
  /** 홈에 고정한 일. null이면 가장 최근에 손댄 일 */
  pinnedGoalId: string | null;
  /** 완료 축하(진동, 토스트, 색종이, 축하 창, 체크 효과) 켜기 */
  celebration: boolean;
}

const DEFAULTS: SettingValues = {
  enginePref: 'auto',
  migratedFromLocalStorage: false,
  lastBackupAt: 0,
  persistGranted: false,
  pinnedGoalId: null,
  celebration: true,
};

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
  const row = await db.settings.get(key);
  return (row?.value as SettingValues[K] | undefined) ?? DEFAULTS[key];
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void> {
  await db.settings.put({ key, value });
}

export function useSetting<K extends SettingKey>(key: K): SettingValues[K] | undefined {
  return useLiveQuery(() => getSetting(key), [key]);
}
