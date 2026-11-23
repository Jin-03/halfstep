# HalfStep DB 설계 (v1, IndexedDB + Dexie) — 2026-11-03 초안, 2026-11-09 구현 반영

결정: 저장소를 localStorage(JSON 통째 저장) → IndexedDB(Dexie)로 전환. 대상 플랫폼은 **Android(Chrome / 설치형 PWA)만**. iOS는 현 단계에서 고려하지 않음.

## 테이블

DB 이름 `halfstep`, Dexie `version(1)`

```ts
db.version(1).stores({
  goals:    'id, createdAt',
  steps:    'id, goalId, doneAt',
  settings: 'key',
});
```

### goals
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string (UUID) | PK |
| title | string | |
| note | string? | |
| createdAt | number (ms) | 사이드바 정렬(최신순) |
| updatedAt | number (ms) | 목표나 그 단계가 바뀔 때마다 갱신 |

### steps (트리를 평평하게 펼친 테이블)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string (UUID) | PK |
| goalId | string | FK → goals.id, 인덱스 |
| parentId | string \| null | null = 최상위. 인덱스 안 함(목표 단위로 통째 로드) |
| order | number | 형제 간 순서. 1000 간격으로 부여, 끝 추가 = max+1000, 이동 = 값 교환 |
| title | string | |
| minutes | number? | 리프에서만 의미 |
| doneAt | number \| null | 완료 시각. 리프에서만 값 있음. null은 인덱스에서 빠지므로 "완료된 것만" 조회가 자연스러움 |
| collapsed | boolean? | UI 상태 |
| source | 'ai-native' \| 'ai-gemini-nano' \| 'ai-chrome' \| 'rules' \| 'template' \| 'manual' \| 'legacy' | 생성 경로 |
| createdAt | number | |

### settings (key-value)
key: `enginePref`, `migratedFromLocalStorage`, `lastBackupAt`, `persistGranted`, `pinnedGoalId`(홈에 고정한 일, null=최근 일)

## 불변식 (모든 쓰기 함수가 지킴)
1. 자식이 있는 단계의 doneAt은 항상 null. 완료 여부는 자식에서 계산.
2. 리프에 자식이 생기면(쪼개기, 하위 추가) 그 단계의 doneAt → null.
3. 마지막 자식이 지워져 리프로 돌아가면 doneAt = null (예전 값이 되살아나지 않음).
4. 부모 체크 = 하위 모든 리프의 doneAt을 now 또는 null로 일괄 설정. 이미 완료된 리프의 완료 시각은 보존(2026-11-09 변경).
5. 삭제는 하위 전체 연쇄 삭제. 목표 삭제 = goalId의 steps 전체 삭제.
6. 모든 쓰기는 `db.transaction('rw', goals, steps, ...)` 안에서, goals.updatedAt 갱신 포함.

## 읽기
- `useLiveQuery`(dexie-react-hooks)로 goals와 steps 구독 → 메모리에서 parentId로 트리 조립 → 기존 tree.ts 계산(isDone, progress, nextAction, remainingMinutes) 재사용.
- 데이터 규모가 작아(수천 행 이하) steps 전체 로드로 시작. 커지면 goalId 단위 로드로 전환.
- 예: 이번 주 완료 = `steps.where('doneAt').between(weekStart, now)`.

## 실행 취소
- 메모리 스택(최대 30). 쓰기 전에 대상 목표의 goal 행 + 그 목표의 steps 전체를 스냅샷.
- 되돌리기 = 트랜잭션에서 해당 goalId의 steps 삭제 → 스냅샷 bulkPut, goal 행 복원(목표 삭제였으면 재생성).

## 마이그레이션 (최초 1회)
- settings.migratedFromLocalStorage 없음 + localStorage `halfstep:goals:v1` 존재 시 실행.
- 트리 순회로 평평화: order = 형제 index × 1000, 리프의 done=true → doneAt = goal.updatedAt(실제 시각 미상), 부모 doneAt = null, source = 'legacy'.
- `halfstep:engine` → settings.enginePref.
- 완료 후 플래그 저장. localStorage 원본은 백업으로 당분간 유지(삭제 안 함).

## 내보내기/가져오기 (2026-11-09 구현, src/db/backup.ts)
- 내보내기 v2: `{ format: 'halfstep', version: 2, exportedAt, goals: Goal[], steps: StepRow[], templates: UserTemplate[] }`
- 가져오기: v2와 기존 v1(트리 배열) 모두 허용. 이미 있는 goal id는 건너뜀.
- 내보낼 때 settings.lastBackupAt 갱신.

## 영구 저장 (Android)
- 앱 시작 시 `navigator.storage.persisted()` 확인 → 아니면 `navigator.storage.persist()` 요청. Android Chrome은 설치된 PWA 등 참여도가 높으면 자동 허용.
- AI 설정 화면에 저장 상태와 사용량(`navigator.storage.estimate()`) 표시.

## version(2) — 2026-11-09 구현
```ts
db.version(2).stores({ templates: 'id, updatedAt' });
```
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string (UUID) | PK |
| title | string | |
| summary | string? | 한 줄 설명 |
| keywords | string[] | 기본 규칙 엔진이 목표 문장에서 찾는 단어 |
| steps | {title, minutes?, children?}[] | 단계 초안 트리 |
| createdAt / updatedAt | number | 목록은 updatedAt 최신순 |

완료된 일 보관함은 DB 필드 없이 계산(단계 ≥1개이고 모두 완료).

## 나중에 추가 후보 (version(3)로 확장)
- activity 로그 테이블(완료·취소·쪼개기 이력, 연속 기록 통계)
- 목표 수동 보관(archivedAt, 완료 전에도 숨기기), 수동 정렬
