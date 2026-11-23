/**
 * 사용자가 직접 체크할 때만 쓰는 감싸개. 쓰기 전후 트리를 비교해 축하한다.
 * 실행 취소·가져오기·마이그레이션은 이 함수를 거치지 않으므로 축하하지 않는다.
 */
import { db } from '../db/schema';
import { getSetting } from '../db/settings';
import { buildTree } from '../model/tree';
import { celebrateChange } from './celebrate';

const loadTree = async (goalId: string) => buildTree(await db.steps.where('goalId').equals(goalId).toArray());

export async function withCelebration<T>(goalId: string, write: () => Promise<T>): Promise<T> {
  const before = await loadTree(goalId);
  const result = await write();
  const [goal, after] = await Promise.all([db.goals.get(goalId), loadTree(goalId)]);
  if (goal && (await getSetting('celebration'))) celebrateChange(goal, before, after);
  return result;
}
