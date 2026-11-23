# HalfStep(반걸음) 현재 상태 — 2026-11-09 기준 (4단계 + 화면 구조 개편까지 완료)

## 재작성 배경
작업 장소가 바뀌어 이전 PC("aries", `C:\Work\HalfStep`)의 코드를 가져올 수 없어 처음부터 다시 만드는 중.
이번에는 localStorage를 건너뛰고 처음부터 IndexedDB(Dexie)로 시작. 결과물은 zip으로 내려받아 사용자 PC에 저장.
새 대화에서 이어 갈 때는 최신 zip(또는 저장소)과 이 문서를 함께 올릴 것.

## 결정 사항 (변경 없음)
- 대상 플랫폼: Android만. 배포: Capacitor로 감싼 APK (웹 코드 공통)
- **지금은 웹 PWA로 개발**(휴대폰 홈 화면 설치·오프라인). 최종 목표는 Android 앱이며 같은 웹 코드를 Capacitor로 감싸 변환
- 웹(PWA) AI: Chrome 내장 AI(데스크톱 Chrome 전용, PC 확인용) → 기본 규칙. **휴대폰 PWA에서는 기본 규칙만 동작**
- 앱 AI(6단계): Gemini Nano(ML Kit GenAI, 지원 기종) → 기기 내 모델(MediaPipe/LiteRT-LM 또는 llama.cpp 중 선택, Qwen2.5 1.5B) → 기본 규칙
- **WebLLM은 제외** (2026-11-09 결정: 앱이 목표라 휴대폰 메모리 한계·확인 어려움 대비 이득이 적음)
- AI 요청은 가볍게: AI에게는 단계 제목만(최대 2단계 깊이) 받고, 예상 시간은 규칙으로 채움
- 저장소: IndexedDB(Dexie). 설계는 `claude/db-design.md`
- Android 빌드는 사용자 PC의 Android Studio에서 (Claude 환경에서는 검증 불가)

## 재작성 계획
1. 뼈대 + DB ← **완료**
2. 화면: 사이드바, 단계 트리, 체크·수정·이동·들여쓰기/내어쓰기·삭제, 실행 취소(30단계) ← **완료**
3. 목표 생성: 자동으로 나누기(규칙 엔진), 템플릿 8종, 직접 적기 + 더 쪼개기·단계 더 제안 ← **완료**
4. 웹 AI(Chrome 내장 AI) + 공통 지시문·파서 + AI 설정 + PWA ← **완료**
5. 내보내기/가져오기(v1·v2), 영구 저장, localStorage 마이그레이션, 배포 준비 ← **완료**
6. Android: Capacitor, Gemini Nano 엔진, 기기 내 모델 엔진(플러그인), APK 빌드(Android Studio 또는 GitHub Actions)

## 1단계 결과
- 스택: React 19.3, TypeScript 7.0, Vite 8.3, Dexie 4.4, dexie-react-hooks 4.4, Vitest 5.1(+fake-indexeddb)
- `src/db/schema.ts`: Dexie 정의(goals, steps, settings), 타입. source에 'ai-native' 추가
- `src/db/ops.ts`: 모든 쓰기 함수 — createGoal, updateGoal, deleteGoal, addSteps/addStep, updateStep, setDone, toggleDone, moveStep, deleteStep. 각 함수가 트랜잭션 안에서 불변식 1~6 보장
- `src/db/hooks.ts`: useGoals, useGoalTree (useLiveQuery)
- `src/model/tree.ts`: buildTree, isDone, progress, nextAction(경로 포함), remainingMinutes(시간 미입력 수 포함), childrenMap/descendantIds/leafIds
- 테스트: `npm test` 33개 통과. 불변식 2·3을 일부러 제거하면 해당 테스트가 실패하는 것도 확인. 실제 Chromium에서 생성·체크·새로고침 유지·이동·삭제 확인
- 이전 버전의 알려진 문제 2건(부모 done 되살아남, 쪼갠 단계 minutes 손실)은 설계상 해결, 테스트로 고정

## 2단계 결과
- `src/db/ops.ts`에 indentStep(위 형제의 마지막 자식으로), outdentStep(부모 바로 다음 자리로) 추가. 불변식 2·3 처리 포함
- `src/model/undo.ts`: UndoStack — record(목표 스냅샷 후 쓰기), recordCreate(새 목표, 되돌리면 삭제), 최대 30, 실패한 쓰기는 쌓지 않음. 접기는 기록 안 함
- `src/ui/actions.tsx`: 모든 화면 쓰기는 run()을 거침 → 실행 취소 기록, 오류 알림(HalfStepError는 메시지 그대로), 삭제 시 "실행 취소" 버튼 달린 알림, Ctrl+Z
- 화면 구성: `App.tsx`(레이아웃, 모바일은 서랍형 사이드바), `ui/Sidebar.tsx`(새 목표·목록·진행 수), `ui/GoalView.tsx`(제목·메모 직접 수정, 진행률, 다음 할 일 카드, 목표 삭제), `ui/StepTree.tsx`(체크, 제목 직접 수정, ⋯ 메뉴: 하위 추가·위/아래·들여/내어쓰기·예상 시간·삭제, 진행 수 버튼으로 접기), `ui/EditableText.tsx`, `ui/AddStepInput.tsx`, `ui/HalfMark.tsx`, `styles.css`
- 디자인: 회녹색 바탕, 잉크색 글씨, 완료=청록, 다음 할 일=황금색. 반쯤 채운 원(HalfMark)이 상징. 다크 모드, 터치 크기 44px, 안전 영역, 동작 줄이기 대응
- 테스트: `npm test` 49개 통과(들여쓰기/내어쓰기·실행 취소 16개 추가). 브라우저 시나리오(휴대폰 390px): 목표 생성, 단계 추가, 제목 수정, 들여쓰기, 시간 입력, 다음 할 일 완료, 접기, 삭제→알림 실행 취소, 상단 실행 취소, 하위 추가, 새로고침 유지, 빈 제목 무시, 목표 삭제→복구, 데스크톱 다크 모드 — 모두 통과, 콘솔 오류 없음

## 3단계 결과
- `src/ai/types.ts`: Engine 인터페이스(id, label, source, available, decompose). 요청 3종: goal(목표 나누기), split(단계 쪼개기: goal·step·minutes·path), more(더 제안: goal·existing)
- `src/ai/index.ts`: ENGINES = [rules], pickEngine()은 쓸 수 있는 첫 엔진. **4단계에서 chrome·webllm·native 엔진을 이 목록 앞에 추가하면 화면 수정 없이 연결됨**
- `src/ai/rules.ts`: 키워드 점수(맞은 키워드 길이 합)로 템플릿 선택, 없으면 일반 계획(GENERIC_PLAN). split은 단계가 목표와 다른 종류의 일이면 그 템플릿, 아니면 준비15/시작40/나머지35/확인10% 비율(5분 단위, 최소 5분). more는 이미 있는 제목을 빼고 3개(템플릿 목표는 템플릿에서 빠진 단계부터, 아니면 점검·질문·다음 할 일 같은 이어지는 단계부터)
- `src/model/templates.ts`: 8종 — 시험 준비, 운동 습관, 글 한 편, 방 정리, 여행 준비, 이사 준비, 발표 준비, 새 기술 배우기. 모든 리프에 예상 시간
- `src/model/outline.ts`: 직접 적기 형식. 한 줄 = 단계, 들여쓰기(공백·탭·전각 공백) = 하위, 글머리표(-, *, •, 1., 1)) 제거, 줄 끝 "10분"·"(1시간 30분)"·"[2시간]" = 예상 시간. toOutline과 왕복 일치
- `src/ui/NewGoal.tsx`: 사이드바 "새 목표" → 본문에 새 목표 화면. 탭 3개 모두 미리보기(단계 수·총 시간) 후 만들기. 자동/템플릿 결과는 "고쳐서 쓰기"로 직접 적기 탭에 옮겨 수정 가능(고치지 않으면 원래 source, 고치면 manual). 목표를 바꾸면 이전 나누기 결과로는 만들 수 없음
- 단계 ⋯ 메뉴에 "더 쪼개기"(리프만), 목표 화면에 "단계 더 제안받기". 엔진 호출은 기록하지 않고 실제로 단계를 더할 때만 실행 취소 기록 + 알림
- 테스트: `npm test` 75개 통과(개요 파싱·템플릿·규칙 엔진 26개 추가). 브라우저 시나리오: 세 방법으로 만들기와 저장된 source 확인, 고쳐서 쓰기, 낡은 미리보기 차단, 더 쪼개기 + 실행 취소, 더 제안받기, 취소 — 모두 통과, 콘솔 오류 없음

## 4단계 결과
- `src/ai/prompt.ts` (모든 AI 엔진 공용, 앱 엔진도 그대로 사용): SYSTEM_PROMPT, FEW_SHOT 1쌍, buildUserPrompt(goal/split/more), responseSchema(형식 강제용 JSON 스키마), parseSteps(코드 블록·앞뒤 설명·끝이 잘린 JSON 복구·문자열 배열·한국어/다른 키·번호/글머리표 목록, 머리말·맺음말 제거, 번호·따옴표·마침표 정리, 중복 제거, 개수 8/하위 5/제목 60자 제한, 하위 1개면 버림), **parseAnswer**(지시문을 되돌려 준 답·자리표시 제목·예시 베끼기 거르기, 더 제안의 기존 단계 중복 제거, 예상 시간 채우기), estimateMinutes(키워드 규칙, 기본 15분), withMinutes(쪼개기는 원래 시간에 맞춰 비율 배분)
- `src/ai/chrome.ts`: LanguageModel.availability/create/prompt. 한국어 출력 힌트(ko)가 unavailable이면 힌트 없이 사용(실제 Chromium 153에서 ko=unavailable 확인). responseConstraint로 형식 강제, 지원 안 하면 강제 없이 재시도. 모델 받기(진행률). 세션은 매번 닫음
- `src/ai/types.ts`: Engine에 description, available()→{status: ready|needs-download|downloading|unsupported, reason}, download?(진행률, signal). 엔진 id: rules|chrome|gemini-nano|native
- `src/ai/index.ts`: ENGINES=[chrome, rules]. decompose(req, signal)이 엔진 선택 → 실행 → 실패/60초 초과/읽을 수 없는 답이면 기본 규칙으로 넘어가며 fallbackReason 반환. 직접 고른 엔진을 못 쓰면 이유와 함께 규칙. 사용자가 멈추면 AbortError
- `src/db/settings.ts`: getSetting/setSetting/useSetting (enginePref: 'auto' 또는 엔진 id)
- `src/ui/AiSettings.tsx`: 사이드바 아래 "AI 설정". 자동/엔진별 선택, 상태 배지, 이유, 모델 받기·진행률·멈추기
- 새 목표 화면: 나누는 중 "멈추기", 결과 아래 "○○로 나눴어요" 또는 "(이유) 대신 기본 규칙으로 나눴어요". 쪼개기·더 제안 알림에 "(기본 규칙 사용)" 표시
- `src/ui/format.ts`: josa()로 조사 자동 선택(으로/로, 이/가, 을/를, 은/는)
- PWA: vite-plugin-pwa 2.0(generateSW, autoUpdate), 매니페스트(반걸음, standalone, 세로), 아이콘(192·512·maskable·apple-touch·favicon.svg — 짙은 바탕에 황금색 반원), `src/pwa.ts`가 서비스 워커 등록(Capacitor 앱 안에서는 등록 안 함)
- 테스트: `npm test` 110개 통과(AI 35개 추가: 망가진 답변 예시들, 가짜 LanguageModel로 성공·형식 강제 미지원·언어 미지원·모델 받기, 대체 동작: 자동/직접 선택/실패/빈 답/시간 초과/멈추기). 브라우저 시나리오: AI 없음, 가짜 AI로 나누기·쪼개기·더 제안(source=ai-chrome), 설정에서 규칙 강제, **실제 Chromium API로 모델 받기→실행→되돌려 주기 답 거르기→규칙 전환**, 멈추기, 실패 시 전환, 모델 받기 진행률, 매니페스트·서비스 워커·오프라인 새로고침 — 모두 통과, 콘솔 오류 없음
- 실제 Gemini Nano가 내는 답의 품질은 사용자 PC의 Chrome에서 확인 필요 (이 환경의 Chromium에는 모델이 없고 입력을 되돌려 줌)
- `npm audit`의 moderate 경고는 빌드 도구(workbox-build) 쪽 개발용 의존성

## 화면 구조 개편 (2026-11-09, 사용자 요청)
- 사이드바(휴대폰은 왼쪽 위 ☰ 서랍): 홈 / 진행 중인 일(개수) / 완료된 일 보관함(개수) / 설정: AI 설정·템플릿 설정·백업과 저장 공간 (보관함은 2026-11-09 사용자 요청으로 설정에서 빼서 진행 중인 일 아래로)
- **홈**: 가장 최근에 손댄(updatedAt) 진행 중인 일 하나의 다음 단계만 가운데에 크게. 누르면 그 일 페이지. 다른 일이 있으면 "진행 중인 일 n개 더 보기". 진행 중인 일이 없으면 새 목표 안내
- **진행 중인 일**: 제목만 있는 목록(최근에 손댄 순) + "새 목표" 버튼. 일 페이지는 그대로
- **완료된 일 보관함**: 단계가 하나 이상 있고 모두 끝난 일(계산값, DB 필드 없음). 최근 완료 순, 완료 날짜 표시. 단계를 해제하면 진행 중으로 돌아감
- **템플릿 설정**: 내 템플릿 만들기/고치기/삭제(두 번 눌러 확인), 기본 템플릿 "복사해서 고치기". 이름·한 줄 설명·자동 나누기 키워드·단계(직접 적기 형식). 새 목표의 템플릿 탭에 "내 템플릿"이 먼저 나오고, 기본 규칙 엔진이 키워드로 내 템플릿을 고름(점수가 같으면 내 템플릿 우선). 일 페이지의 "템플릿으로 저장"은 지금 단계 구조(리프 시간 포함, 완료 여부 제외)로 템플릿을 만들고 편집 화면으로 이동
- **주소(# 뒤) 기반 화면 전환** `src/router.ts`: #/ · #/goals · #/goal/<id> · #/new · #/archive · #/settings/ai · #/settings/templates[/<id|new>[?from=기본id]]. 휴대폰·앱의 뒤로 가기가 화면 사이를 오감. 새 목표를 만들면 새 목표 화면은 기록에서 대체되어 뒤로 가면 목록. 일 삭제 시 목록으로 이동, 실행 취소하면 그 일 페이지로
- DB **버전 2**: `templates` 테이블 추가(`id, updatedAt`). UserTemplate {id, title, summary?, keywords[], steps(초안 트리), createdAt, updatedAt}. 버전 1 데이터가 그대로 남는 것 테스트로 확인. 템플릿 변경은 목표 실행 취소와 별개
- 새 파일: `src/router.ts`, `src/db/templates.ts`, `src/model/goals.ts`(isCompleted, splitGoals, currentGoal), `src/ui/Home.tsx`, `src/ui/GoalLists.tsx`(ActiveGoals, Archive), `src/ui/TemplateSettings.tsx`(TemplateList, TemplateEditor). `useProgressByGoal` → `useGoalSummaries`(진행률 + 최근 완료 시각)
- 한국어 줄바꿈: 전체에 `word-break: keep-all`(띄어쓰기 단위로 줄바꿈)
- 시각 스타일(색·글꼴)은 유지
- 테스트: `npm test` 128개 통과(템플릿·분류·주소·DB 업그레이드 18개 추가). 브라우저 시나리오(휴대폰·데스크톱): 메뉴 이동, 홈 표시와 바뀜, 목록·보관함 이동, 모두 끝내면 보관함·해제하면 복귀, 템플릿 만들기·복사·삭제, 키워드로 자동 나누기, 템플릿 탭, 템플릿으로 저장, 뒤로 가기, 삭제→되돌리기, 없는 주소 — 모두 통과, 콘솔 오류 없음

## 홈 개선 (2026-11-09, 사용자 요청, 테스트 생략·빌드만 확인)
- 홈 카드에 **"끝냈어요"** 버튼: 누르면 그 단계를 완료하고 카드가 알아서 다음 단계로 바뀜(짧은 등장 애니메이션, 동작 줄이기 설정 존중). 마지막 단계면 "○○을 모두 끝냈어요. 보관함으로 옮겼어요." 알림(실행 취소 가능)과 함께 다음 진행 중인 일로 넘어감. 카드의 제목 부분을 누르면 일 페이지로 이동
- 홈 카드 아래 **"＋ 새로 만들기"** 버튼 → 새 목표 화면
- **홈에 고정**: 일 페이지 아래 "홈에 고정 / 홈 고정 해제". 설정 `pinnedGoalId`(settings 테이블, 실행 취소와 별개). 고정한 일이 진행 중이면 홈에 그 일, 끝내거나 지우면 가장 최근에 손댄 일로 넘어감(고정은 남아 있어 다시 진행 중이 되면 돌아옴). 홈 카드에 "홈에 고정한 일이에요. 고정 해제" 표시
- `currentGoal(goals, summaries, pinnedId)`
- 홈 카드는 할 일 내용만: 일 제목 → (상위 단계 경로) → 다음 단계 → 예상 시간 → 끝냈어요. 반걸음 마크는 카드에서 뺐고(빈 홈 화면에는 유지), "홈에 고정한 일이에요 · 고정 해제" 안내는 카드 아래로 옮김

## 일 페이지 편집 모드 (2026-11-09, 사용자 요청, 빌드만 확인)
- 단계 목록 위 오른쪽에 "편집" 버튼. 편집 모드에서만 단계 오른쪽 ⋯ 메뉴(더 쪼개기·하위 단계 추가·위/아래·들여/내어쓰기·예상 시간·삭제)와 단계 제목 눌러 고치기가 나옴. 편집 중에는 안내 문구와 "편집 끝내기" 버튼, 끝내면 열린 메뉴·입력란이 닫힘
- 평소 모드에서도 되는 것: 체크, 접기/펼치기(0/2 ▾), 아래 "단계 추가" 입력, "단계 더 제안받기", 목표 제목·메모 고치기
- 편집 모드 여부는 화면 상태(저장 안 함). 일 페이지에 들어갈 때마다 평소 모드
- 페이지 아래 "이 목표 삭제"도 편집 모드에서만 나옴. "홈에 고정"·"템플릿으로 저장"은 항상 보임

## 분해 개선 (2026-11-09 완료)
구조: "규칙이 목표를 분석 → (AI가 있으면) 분석 결과 한 줄 + 맞춤 예시로 AI에게 질문 → 규칙이 결과를 검사·보정". AI가 없으면 같은 분석으로 규칙이 계획을 만듦. 규칙 개선이 AI 경로와 규칙 경로 양쪽에 효과.

- `src/ai/rulesData.ts` (규칙 데이터, 대부분의 조정은 이 파일만): 목표 유형 10종(habit 습관, target 목표치 달성, buy 사기·고르기, admin 신청·처리, tidy 정리, learn 배우기, make 만들기, prepare 준비하기, communicate 연락·대화, general 일반)의 동사/낱말 패턴·계획 뼈대(자리표시 {대상} {활동} {횟수} {목표치})·AI 예시 목표, TYPE_ORDER, HABIT_WORDS(꾸준히·습관·루틴), NOUN_VERBS(조사·분석·신청처럼 '-기' 없는 동사), DEADLINE_STEP("○까지 일정을 달력에 나눠 적기" / "○ 안에 끝내도록 …"), TEMPLATE_TYPES(기본 템플릿이 어울리는 유형들), TEMPLATE_MIN_SCORE=3, SYNONYMS, ENDINGS, SPLIT_PATTERNS, VAGUE, FIRST_STEP_MAX=15, WRAP_UP_RATIO=0.6, MORE_EXTRAS, WRAP_UP. 모든 유형 뼈대의 첫 단계 ≤ 15분(테스트로 고정)
- `src/ai/analyze.ts`: analyzeGoal → {type, typeLabel, object(대상), activity(습관 활동), deadline, frequency, sessionMinutes, target}. 마감(M월 D일, 요일까지, 이번·다음 주/달(말), N일·주·개월 안, 오늘·내일·모레, 주말·월말·연말, 올해 안), 횟수(매일 N분, 하루 N분, 주 N회, 매주 ○요일, 매일, 매주, 꾸준히), 목표치(숫자+단위). 대상은 마지막 동사 낱말과 끝 조사를 떼고 14자 넘으면 마지막 두 낱말, 연락 유형은 "○에게"를 대상으로. describeAnalysis("대상 … · 마감 …"). templateScore(어미 떼기, 비슷한 말, 한 글자 키워드는 낱말 단위), templateFor(내 템플릿은 키워드 하나만 맞아도 / 기본 템플릿은 유형이 어울리거나·유형 미정이거나·점수 ≥3일 때 — 예: "여권 재발급 신청하기"는 여행 템플릿이 아니라 신청 유형), fillPlan, planFor(템플릿 → 유형 뼈대, 마감 있으면 두 번째에 일정 단계, 습관 1회 분량 반영, basis 반환)
- `src/ai/context.ts`: DecomposeContext {analysis, templates(내 템플릿 mine=true 먼저 + BUILTIN), example}. exampleFor: 맞는 템플릿 → 유형 예시 목표를 뼈대로 채운 답 → 기본(방 정리) 예시. makeContext(내 템플릿 불러오기), contextFor(동기)
- `src/ai/rules.ts` 재구성: rulesPlan(req, ctx) → {drafts, basis}. 쪼개기: 다른 템플릿 → splitByPattern(공부·읽기 등은 30분 넘으면 25분 묶음 2~4개, 쓰기·찾기·연락/신청·만들기·정리·정하기 패턴은 원래 시간 비율 배분, 시간 없으면 30분 가정) → 준비·시작·나머지·확인. 더 제안: doneRatio ≥ 0.6이면 WRAP_UP부터, 템플릿 목표는 템플릿에서 빠진 단계, 유형 목표는 뼈대에서 빠진 단계, 일반은 이어지는 단계부터
- `src/ai/refine.ts` (규칙·AI 공용 결과 검사): 다짐뿐인 단계 제거(하나만 남으면 유지), 목표 나누기에서 첫 리프가 15분 넘으면 splitByPattern으로 하위 단계 생성
- `src/ai/index.ts` decompose(): makeContext 한 번 → 모든 엔진에 req.context로 전달 → 결과를 refine. 결과에 basis(규칙 근거)와 understood(읽어 낸 정보) 추가
- AI 지시문(`prompt.ts`): 목표 아래 "종류: 사기·고르기 · 대상 … · 마감 …" 한 줄, 마감 있으면 일정 단계 지시, 더 제안은 진행률 ≥0.6이면 마무리 우선 지시. `chrome.ts`는 요청마다 맞춤 예시로 initialPrompts 구성
- 화면: 새 목표 미리보기 아래 "기본 규칙으로 나눴어요 (사기·고르기 유형)"·"읽어 낸 정보: …". 더 제안받기에 진행률 전달
- 내장 템플릿 '발표 준비하기'에 축사·연설·스피치 키워드 추가
- 테스트: `npm test` 156개 통과(분석 15사례·계획·템플릿 선택·쪼개기·결과 검사·지시문 연결 등 28개 추가, 바뀐 기대값 3개 수정). 화면 테스트는 생략

### 다음에 할 만한 것
- **실제 AI 효과 확인**(사용자 PC Chrome): 아래 목표로 "AI 설정 → Chrome 내장 AI"에서 나눠 보고 결과 공유 → 지시문·예시 조정
  다음 주까지 부모님 생신 선물 사기 / 토익 900점 받기 / 매일 20분 책 읽기 / 여권 재발급 신청하기 / 신발장 정리 / 11월 20일까지 블로그 글 쓰기 / 엑셀 함수 배우기 / 집주인에게 보일러 수리 요청하기 / 친구 결혼식 축사 준비 / 동네 봉사활동 시작하기
- 내 템플릿에 '어울리는 유형' 고르기 (지금은 키워드만)
- 나누기 전에 질문 1~2개(이미 한 것, 마감), 홈에서 큰 단계가 다음 할 일이 되면 쪼개기 제안

## 5단계 결과 (2026-11-09)
- `src/db/backup.ts`
  - 내보내기 v2 `{format:'halfstep', version:2, exportedAt, goals, steps, templates}` (설정은 포함 안 함). 내보낼 때 settings.lastBackupAt 갱신. 파일 이름 `halfstep-backup-YYYY-MM-DD.json`
  - parseBackup: v2 / v1(예전 앱의 트리 배열, `{goals:[...]}`도) 모두 읽음. v1은 title|text|name, children|steps|substeps|subSteps|items, done(true/false) → 리프 doneAt = 목표 updatedAt(실제 시각 미상), source 'legacy'. 고치기: 없는 부모 → 최상위, 자식 있는 단계 doneAt → null(불변식 1), 잘못된 source → manual, 잘못된 minutes·order 정리, 목표 없는 단계·제목 없는 것 제외(경고 문구로 알림). 거부: JSON 아님 / 반걸음 형식 아님 / 더 새 버전 / 가져올 것 없음
  - previewImport(새로 들어갈 것·건너뛸 것 개수) → applyImport(한 트랜잭션, 같은 id의 목표·템플릿은 건너뜀, 다른 목표와 단계 id가 겹치면 새 id로 바꾸고 부모 연결도 따라감)
  - migrateLegacyLocalStorage: 앱 시작 때 `halfstep:goals:v1`이 있으면 한 번 옮김(원본 유지), `halfstep:engine`(auto|chrome|rules) → enginePref, 망가져 있어도 표시만 하고 계속
- `src/db/storage.ts`: storageInfo(보호 여부·사용량·한도), requestPersist(→ settings.persistGranted), 앱 시작 때 ensurePersisted
- `src/ui/DataSettings.tsx` "백업과 저장 공간"(설정 메뉴, `#/settings/data`): 마지막 백업 시각(없거나 7일 넘으면 강조), "파일로 저장", 휴대폰은 "공유하기"(Web Share, 파일 공유 가능할 때만), 가져오기(파일 고르기 → 미리보기·경고 → 가져오기/취소), 저장 공간 보호 상태·보호 요청·사용량
- 배포: `vite.config.ts`의 base를 BASE_PATH 환경 변수로(기본 '/'), 매니페스트 start_url·scope를 './'로(어느 하위 주소든 맞음), navigateFallback 제거(#-라우팅이라 base 주소 하나면 됨). `.github/workflows/deploy.yml`: main에 올리면 npm ci → npm test → 빌드(저장소 이름으로 BASE_PATH 자동) → GitHub Pages 배포. README에 GitHub Pages(무료는 공개 저장소만)·Cloudflare Pages(비공개 가능) 안내
- 테스트: `npm test` 166개 통과(백업 10개 추가: 왕복 복원, 건너뛰기, 고치기, id 겹침, 거부, v1 트리, localStorage 옮기기). 하위 주소(/HalfStep/) 빌드에서 열기·서비스 워커 범위·오프라인 동작 확인
- 6단계 메모: Android 앱(WebView) 안에서는 `<a download>` 저장이 동작하지 않으므로 Capacitor Filesystem/Share 플러그인으로 바꿔야 함. 파일 고르기(input type=file)는 동작

## 설계에서 달라진 점
- 부모 체크 시 이미 완료된 리프의 완료 시각은 보존(통계용)
- 부모를 찾을 수 없는 단계는 최상위로 표시(데이터 손실 방지)
- minutes는 양수만 저장, 정수로 반올림
- 제목을 비워서 저장하면 오류 없이 원래 제목으로 돌아감(메모는 비울 수 있음)
