/**
 * 규칙 엔진의 데이터. 규칙을 고치거나 늘릴 때는 대부분 이 파일만 바꾸면 된다.
 *
 * 단계 제목 속 자리표시:
 *   {대상}  목표의 대상 (예: "부모님 생신 선물 사기" → "부모님 생신 선물"). 없으면 자리표시와 뒤 공백이 지워진다
 *   {활동}  습관 목표의 활동 (예: "매일 30분 달리기" → "달리기")
 *   {횟수}  습관 목표의 횟수 (예: "매일", "주 3회")
 *   {이번 주} 습관 목표의 이번 주 할 일 (예: "이번 주 매일 해 보기", "이번 주 3번 해 보기", "이번 주 토요일에 해 보기")
 *   {목표치} 목표 수치 (예: "900점")
 * 자리표시 바로 뒤에는 조사를 붙이지 않는다 (받침에 따라 달라지므로).
 */
import type { StepDraft } from '../db/ops';

export type GoalType =
  | 'habit'
  | 'target'
  | 'sell'
  | 'buy'
  | 'admin'
  | 'tidy'
  | 'learn'
  | 'make'
  | 'prepare'
  | 'communicate'
  | 'general';

export interface GoalTypeRule {
  label: string;
  /** 목표의 마지막 낱말(동사)에서 찾는 말 */
  verbs: RegExp;
  /** 문장 전체에서 찾는 말 (verbs가 안 맞을 때) */
  words?: RegExp;
  /** 규칙 엔진이 쓰는 계획 뼈대 */
  plan: StepDraft[];
}

export const GOAL_TYPES: Record<GoalType, GoalTypeRule> = {
  habit: {
    label: '습관',
    verbs: /^$/, // 횟수 표현("매일", "주 3회")이나 HABIT_WORDS로 판단
    words: /습관|꾸준히|루틴|매일|날마다|매주/,
    plan: [
      // 활동 이름("부모님께 전화하기", "아침 6시에 일어나기")을 넣으면 문장이 어색해지므로 넣지 않는다.
      // 목표 문장이 바로 위에 보이므로 무엇을 하는지는 알 수 있다.
      { title: '언제 어디서 할지 정하기', minutes: 5 },
      { title: '필요한 것 미리 준비해 두기', minutes: 5 },
      { title: '첫 1회 해 보기', minutes: 15 },
      { title: '끝나고 한 일 기록하기', minutes: 2 },
      { title: '{이번 주}', minutes: 60 },
      { title: '일주일 뒤 돌아보고 조정하기', minutes: 10 },
    ],
  },
  target: {
    label: '목표치 달성',
    verbs: /받기|달성|합격|통과|줄이기|늘리기|빼기|찌우기|모으기|올리기|넘기기/,
    // 점수·체중·금액·저축처럼 종류가 다양하므로 "연습" 같은 특정 활동을 가정하지 않는다
    plan: [
      { title: '{대상} 지금 수준 확인하기', minutes: 15 },
      { title: '{목표치} 목표와 지금의 차이 적기', minutes: 5 },
      { title: '차이를 줄일 방법 3가지 적기', minutes: 15 },
      { title: '가장 쉬운 방법 하나 오늘 해 보기', minutes: 20 },
      { title: '일주일 뒤 다시 확인하기', minutes: 10 },
    ],
  },
  sell: {
    label: '팔기',
    verbs: /팔기|판매|처분|내놓기|넘기기/,
    words: /중고|매물/,
    plan: [
      { title: '{대상} 상태 확인하고 사진 찍기', minutes: 15 },
      { title: '비슷한 매물 시세 찾아보기', minutes: 15 },
      { title: '가격 정하기', minutes: 5 },
      { title: '판매 글 올리기', minutes: 15 },
      { title: '문의에 답하고 거래 약속 잡기', minutes: 10 },
      { title: '거래하고 마무리하기', minutes: 30 },
    ],
  },
  buy: {
    label: '사기·고르기',
    verbs: /사기|구매|구입|장만|고르기|선택|알아보기|바꾸기|교체/,
    plan: [
      { title: '{대상} 예산 정하기', minutes: 5 },
      { title: '꼭 필요한 조건 3가지 적기', minutes: 10 },
      { title: '{대상} 후보 3개 찾기', minutes: 20 },
      { title: '후기와 가격 비교하기', minutes: 20 },
      { title: '하나 골라 주문하기', minutes: 10 },
      { title: '받았는지 확인하기', minutes: 5 },
    ],
  },
  admin: {
    label: '신청·처리',
    verbs: /신청|제출|등록|발급|갱신|신고|접수|처리|납부|해지|가입|예약|청구|환불|지원|응시/,
    plan: [
      { title: '{대상} 필요한 서류와 정보 확인하기', minutes: 10 },
      { title: '신청 방법과 기한 알아보기', minutes: 10 },
      { title: '서류 준비하기', minutes: 20 },
      { title: '작성해서 제출하기', minutes: 20 },
      { title: '처리 결과 확인하기', minutes: 5 },
    ],
  },
  tidy: {
    label: '정리',
    verbs: /정리|청소|치우기|비우기|버리기|수납|닦기/,
    plan: [
      { title: '{대상} 정리할 구역 하나 정하기', minutes: 5 },
      { title: '쓰레기봉투와 상자 준비하기', minutes: 5 },
      { title: '버릴 것 골라내기', minutes: 15 },
      { title: '남길 것 제자리에 두기', minutes: 20 },
      { title: '버릴 것 내놓기', minutes: 10 },
    ],
  },
  learn: {
    label: '배우기',
    verbs: /배우기|익히기|공부|독학|연습|외우기|마스터|입문|연주/,
    plan: [
      { title: '{대상} 배우려는 이유와 목표 적기', minutes: 10 },
      { title: '입문 자료 하나 고르기', minutes: 15 },
      { title: '첫 25분 따라 해 보기', minutes: 25 },
      { title: '막힌 점 메모하기', minutes: 5 },
      { title: '이번 주 연습 일정 정하기', minutes: 10 },
      { title: '작은 결과물 하나 만들어 보기', minutes: 45 },
    ],
  },
  make: {
    label: '만들기',
    verbs: /쓰기|작성|만들기|제작|그리기|개발|디자인|편집|촬영|녹음|짜기|굽기|요리/,
    plan: [
      { title: '{대상} 완성된 모습 한 문장으로 적기', minutes: 10 },
      { title: '필요한 재료와 자료 모으기', minutes: 20 },
      { title: '뼈대 먼저 만들기', minutes: 30 },
      { title: '세부 채우기', minutes: 45 },
      { title: '다시 보고 고치기', minutes: 20 },
      { title: '마무리하고 공유하기', minutes: 10 },
    ],
  },
  prepare: {
    label: '준비하기',
    verbs: /준비|계획|대비/,
    words: /여행|이사|파티|행사|결혼|생일|생신|출장|캠핑|모임|면접|시험/,
    plan: [
      { title: '{대상} 날짜와 예산 정하기', minutes: 10 },
      { title: '해야 할 일 목록 만들기', minutes: 15 },
      { title: '예약하거나 주문할 것 처리하기', minutes: 30 },
      { title: '준비물 챙기기', minutes: 20 },
      { title: '전날 최종 점검하기', minutes: 10 },
    ],
  },
  communicate: {
    label: '연락·대화',
    verbs: /연락|전화|말하기|부탁|사과|상담|만나기|면담|대화|문의|답장|인사|요청|건의|설득/,
    plan: [
      { title: '{대상} 하고 싶은 말 세 줄로 적기', minutes: 10 },
      { title: '연락할 시간 정하기', minutes: 5 },
      { title: '연락하기', minutes: 15 },
      { title: '이야기한 내용 메모하기', minutes: 5 },
    ],
  },
  general: {
    label: '일반',
    verbs: /^$/,
    // 어떤 목표에도 문장이 어색하지 않도록 {대상}을 넣지 않는다
    plan: [
      { title: '해야 할 일 떠오르는 대로 적기', minutes: 10 },
      { title: '그중 가장 쉬운 일 하나 고르기', minutes: 5 },
      {
        title: '필요한 것 확인하기',
        children: [
          { title: '필요한 자료와 도구 적기', minutes: 10 },
          { title: '도움받을 사람이나 곳 찾기', minutes: 10 },
        ],
      },
      { title: '고른 일 15분 해 보기', minutes: 15 },
      { title: '다음에 할 일 정하기', minutes: 5 },
      { title: '일주일 뒤 진행 상황 점검하기', minutes: 10 },
    ],
  },
};

/** 유형을 고르는 순서 (앞쪽이 우선). habit은 횟수 표현이 있을 때 먼저 본다 */
export const TYPE_ORDER: GoalType[] = ['target', 'sell', 'buy', 'admin', 'tidy', 'learn', 'make', 'communicate', 'prepare'];

/**
 * 목표치 동사 중 숫자가 있어야 목표치로 보는 것.
 * "식비 5만 원으로 줄이기"는 목표치, "유튜브 첫 영상 올리기"는 아니다.
 */
export const TARGET_NEEDS_NUMBER = /줄이기|늘리기|빼기|찌우기|모으기|올리기|넘기기/;

/** 동사가 무엇이든 습관으로 보는 말. 활동 이름에서는 지운다 */
export const HABIT_WORDS = /꾸준히|습관적으로|습관|루틴으로|루틴/;

/** "조사", "분석"처럼 '-기'로 끝나지 않지만 동사로 쓰이는 낱말 */
export const NOUN_VERBS = /(조사|분석|검토|정리|준비|신청|공부|연습|운동|청소|요청|문의|상담|계획|작성|제출|구매|등록|예약|발표|여행|이사)$/;

/** 마감이 있을 때 계획의 첫 단계 뒤에 넣는 단계 */
export const DEADLINE_STEP = (label: string): StepDraft => ({
  title: label.endsWith('안') ? `${label}에 끝내도록 일정을 달력에 나눠 적기` : `${label}까지 일정을 달력에 나눠 적기`,
  minutes: 10,
});

/** 기본 템플릿이 어울리는 유형. 목표 유형이 여기 있으면 키워드가 약하게 맞아도 템플릿을 쓴다 */
export const TEMPLATE_TYPES: Record<string, GoalType[]> = {
  exam: ['learn', 'prepare', 'target'],
  exercise: ['habit', 'target'],
  writing: ['make'],
  tidy: ['tidy'],
  travel: ['prepare'],
  moving: ['prepare'],
  presentation: ['prepare', 'make'],
  skill: ['learn'],
};

/** 목표 유형과 다른 기본 템플릿은 키워드 점수가 이 이상일 때만 쓴다 */
export const TEMPLATE_MIN_SCORE = 3;

/** 템플릿 키워드를 맞출 때 같은 말로 보는 낱말 (왼쪽 → 오른쪽) */
export const SYNONYMS: Record<string, string> = {
  헬스: '운동',
  트레이닝: '운동',
  웨이트: '운동',
  러닝: '달리기',
  조깅: '달리기',
  리포트: '보고서',
  레포트: '보고서',
  프레젠테이션: '발표',
  피피티: 'ppt',
  이전: '이사',
  집들이: '이사',
  청소: '정리',
  대청소: '정리',
  자격증: '시험',
  수능: '시험',
  토익: '시험',
  블로그: '글',
  포스팅: '글',
};

/** 낱말 끝에서 떼어 내는 조사·어미 (긴 것부터) */
export const ENDINGS = [
  '에서는', '으로는', '하려고', '하는데', '해서', '하고', '하기', '하는', '했던', '할', '한',
  '에서', '으로', '까지', '부터', '에게', '처럼',
  '을', '를', '이', '가', '은', '는', '에', '로', '와', '과', '도', '만', '의',
];

/**
 * 단계 성격에 따른 쪼개기 패턴. 단계 제목에서 match가 맞으면 parts로 나눈다.
 * parts의 숫자는 시간 비율. {단계}는 원래 단계 제목.
 */
export interface SplitPattern {
  match: RegExp;
  parts: [string, number][];
  /** 예상 시간이 이보다 길면 시간 묶음(25분 단위)으로 나눈다 (공부·읽기처럼 분량이 있는 일) */
  chunkOver?: number;
}

export const SPLIT_PATTERNS: SplitPattern[] = [
  {
    match: /공부|읽기|복습|풀기|외우기|연습|강의|듣기/,
    chunkOver: 30,
    parts: [
      ['오늘 할 분량 정하기', 0.15],
      ['앞부분 25분 하기', 0.55],
      ['헷갈린 부분 표시하기', 0.3],
    ],
  },
  {
    match: /쓰기|작성|정리해|요약/,
    parts: [
      ['쓸 내용 세 줄로 개요 잡기', 0.2],
      ['초안 쓰기', 0.55],
      ['다시 읽고 고치기', 0.25],
    ],
  },
  {
    match: /찾기|알아보기|조사|검색|비교/,
    parts: [
      ['검색어나 기준 정하기', 0.15],
      ['후보 모으기', 0.5],
      ['비교해서 고르기', 0.35],
    ],
  },
  {
    match: /연락|전화|문의|예약|신청|요청|보내기/,
    parts: [
      ['필요한 정보 확인하기', 0.3],
      ['연락하거나 신청하기', 0.5],
      ['결과 기록하기', 0.2],
    ],
  },
  {
    match: /만들기|제작|그리기|짜기|준비하기/,
    parts: [
      ['재료와 도구 꺼내 두기', 0.15],
      ['뼈대 만들기', 0.4],
      ['나머지 채우기', 0.35],
      ['확인하고 마무리하기', 0.1],
    ],
  },
  {
    // "정리"는 물건·장소일 때만 (예: "개념 정리", "내용 정리"는 여기가 아님)
    match: /청소|치우기|비우기|(방|책상|옷장|신발장|서랍|냉장고|창고|베란다|주방|부엌|화장실|짐|물건|옷|신발|책장|가방)\s*정리/,
    parts: [
      ['한 구역만 정하기', 0.1],
      ['그 구역 치우기', 0.6],
      ['버릴 것 내놓기', 0.3],
    ],
  },
  {
    match: /정하기|고르기|결정/,
    parts: [
      ['기준 두 가지 적기', 0.3],
      ['후보 비교하기', 0.5],
      ['하나로 정하기', 0.2],
    ],
  },
];

/** 행동이 아닌 다짐뿐인 단계 (결과 검사에서 뺀다) */
export const VAGUE = /^(열심히|꾸준히|최선을 다해|최선 다하기|노력하기|노력|잘하기|힘내기|화이팅|파이팅)(\s*하기)?$/;

/** 첫 단계가 이보다 길면 더 작게 나눈다 */
export const FIRST_STEP_MAX = 15;

/** 더 제안받기: 진행률이 이 이상이면 마무리 단계부터 */
export const WRAP_UP_RATIO = 0.6;

export const MORE_EXTRAS: StepDraft[] = [
  { title: '진행 상황 점검하기', minutes: 10 },
  { title: '막힌 점 물어볼 사람 정하기', minutes: 5 },
  { title: '다음에 할 일 적어 두기', minutes: 5 },
  { title: '끝내면 스스로 보상하기', minutes: 5 },
];

export const WRAP_UP: StepDraft[] = [
  { title: '빠진 것 없는지 마지막 점검하기', minutes: 10 },
  { title: '결과 정리해서 남겨 두기', minutes: 10 },
  { title: '끝내면 스스로 보상하기', minutes: 5 },
];
