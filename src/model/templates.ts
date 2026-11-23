/**
 * 기본 템플릿 8종. 규칙 엔진도 목표 문장의 키워드로 이 템플릿을 고른다.
 * 단계는 "지금 바로 시작할 수 있을 만큼 작게"를 기준으로, 리프마다 예상 시간을 붙인다.
 */
import type { StepDraft } from '../db/ops';

export interface Template {
  id: string;
  title: string;
  /** 목록에 보여 줄 한 줄 설명 */
  summary: string;
  /** 규칙 엔진이 목표 문장에서 찾는 단어 */
  keywords: string[];
  steps: StepDraft[];
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'exam',
    title: '시험 준비하기',
    summary: '범위 파악부터 마지막 복습까지',
    keywords: ['시험', '자격증', '토익', '토플', '중간고사', '기말', '수능', '고사', '암기', '복습'],
    steps: [
      {
        title: '시험 범위 파악하기',
        children: [
          { title: '시험 범위와 날짜 적어 두기', minutes: 10 },
          { title: '교재·자료 한곳에 모으기', minutes: 15 },
        ],
      },
      {
        title: '공부 계획 세우기',
        children: [
          { title: '범위를 하루 분량으로 나누기', minutes: 20 },
          { title: '달력에 공부 시간 적기', minutes: 10 },
        ],
      },
      {
        title: '1회독',
        children: [
          { title: '첫 단원 읽기', minutes: 40 },
          { title: '모르는 부분 표시하기', minutes: 10 },
        ],
      },
      { title: '기출·예상 문제 풀기', minutes: 60 },
      { title: '틀린 문제 다시 보기', minutes: 30 },
      { title: '시험 전날 요약본 훑어보기', minutes: 30 },
    ],
  },
  {
    id: 'exercise',
    title: '운동 습관 만들기',
    summary: '부담 없이 시작해 꾸준히 이어 가기',
    keywords: ['운동', '헬스', '달리기', '러닝', '조깅', '다이어트', '근력', '요가', '필라테스', '수영', '산책', '걷기', '체력'],
    steps: [
      {
        title: '시작 준비',
        children: [
          { title: '운동할 요일과 시간 정하기', minutes: 5 },
          { title: '운동복·신발 꺼내 두기', minutes: 5 },
        ],
      },
      { title: '10분만 가볍게 해 보기', minutes: 10 },
      { title: '끝나고 한 일 기록하기', minutes: 2 },
      { title: '이번 주 3번 채우기', minutes: 60 },
      { title: '다음 주 시간 조금 늘리기', minutes: 5 },
    ],
  },
  {
    id: 'writing',
    title: '글 한 편 쓰기',
    summary: '주제 정하기부터 올리기까지',
    keywords: ['글', '블로그', '에세이', '보고서', '리포트', '레포트', '논문', '기사', '원고', '포스팅', '작문', '자소서', '자기소개서'],
    steps: [
      { title: '주제를 한 문장으로 적기', minutes: 10 },
      {
        title: '자료 모으기',
        children: [
          { title: '참고할 글·자료 3개 찾기', minutes: 20 },
          { title: '쓸 내용 메모하기', minutes: 15 },
        ],
      },
      { title: '목차 짜기', minutes: 15 },
      {
        title: '초안 쓰기',
        children: [
          { title: '첫 문단만 쓰기', minutes: 15 },
          { title: '본문 쓰기', minutes: 45 },
          { title: '마무리 문단 쓰기', minutes: 15 },
        ],
      },
      { title: '소리 내어 읽으며 고치기', minutes: 20 },
      { title: '올리거나 제출하기', minutes: 10 },
    ],
  },
  {
    id: 'tidy',
    title: '방 정리하기',
    summary: '한 구역씩 비우고 제자리 찾기',
    keywords: ['정리', '청소', '내 방', '방 청소', '집안', '대청소', '옷장', '책상', '버리기', '수납'],
    steps: [
      { title: '쓰레기봉투 하나 준비하기', minutes: 2 },
      { title: '눈에 보이는 쓰레기 버리기', minutes: 10 },
      {
        title: '구역별로 정리하기',
        children: [
          { title: '책상 위 정리', minutes: 15 },
          { title: '옷 정리', minutes: 20 },
          { title: '바닥 물건 제자리에', minutes: 15 },
        ],
      },
      { title: '안 쓰는 물건 따로 모으기', minutes: 15 },
      { title: '바닥 청소하기', minutes: 15 },
    ],
  },
  {
    id: 'travel',
    title: '여행 준비하기',
    summary: '일정, 예약, 짐 싸기',
    keywords: ['여행', '휴가', '출장', '캠핑', '해외', '비행기', '숙소', '여권'],
    steps: [
      {
        title: '일정 정하기',
        children: [
          { title: '날짜와 예산 정하기', minutes: 15 },
          { title: '가고 싶은 곳 5군데 적기', minutes: 20 },
        ],
      },
      {
        title: '예약하기',
        children: [
          { title: '교통편 예약', minutes: 30 },
          { title: '숙소 예약', minutes: 30 },
        ],
      },
      { title: '여권·신분증 확인하기', minutes: 5 },
      { title: '짐 목록 만들기', minutes: 15 },
      { title: '짐 싸기', minutes: 45 },
    ],
  },
  {
    id: 'moving',
    title: '이사 준비하기',
    summary: '계약 확인부터 전입 신고까지',
    keywords: ['이사', '전세', '월세', '집 구하기', '자취', '입주'],
    steps: [
      { title: '이사 날짜와 계약 내용 확인하기', minutes: 15 },
      { title: '이사 업체 견적 3곳 받기', minutes: 40 },
      {
        title: '짐 줄이기',
        children: [
          { title: '버릴 물건 고르기', minutes: 30 },
          { title: '대형 폐기물 신고하기', minutes: 15 },
        ],
      },
      { title: '공과금·인터넷 이전 신청하기', minutes: 30 },
      { title: '방별로 짐 싸기', minutes: 120 },
      { title: '전입 신고하기', minutes: 20 },
    ],
  },
  {
    id: 'presentation',
    title: '발표 준비하기',
    summary: '핵심 메시지, 자료, 연습',
    keywords: ['발표', '프레젠테이션', 'ppt', '피피티', '슬라이드', '세미나', '강연', '면접', '축사', '연설', '스피치'],
    steps: [
      { title: '듣는 사람과 발표 시간 확인하기', minutes: 5 },
      { title: '핵심 메시지 한 문장 정하기', minutes: 10 },
      { title: '말할 순서 개요 짜기', minutes: 20 },
      {
        title: '자료 만들기',
        children: [
          { title: '슬라이드 뼈대 만들기', minutes: 30 },
          { title: '그림·도표 넣기', minutes: 40 },
        ],
      },
      { title: '소리 내어 한 번 연습하기', minutes: 20 },
      { title: '시간 재며 다시 연습하기', minutes: 20 },
    ],
  },
  {
    id: 'skill',
    title: '새 기술 배우기',
    summary: '작게 따라 하고 직접 만들어 보기',
    keywords: ['배우기', '배우', '익히', '코딩', '프로그래밍', '언어', '영어', '회화', '일본어', '기타 연습', '피아노', '그림', '강의', '독학', '연습'],
    steps: [
      { title: '배우고 싶은 이유와 목표 적기', minutes: 10 },
      { title: '입문 자료 하나 고르기', minutes: 20 },
      {
        title: '첫 주 기초 익히기',
        children: [
          { title: '첫 강의·첫 장 보기', minutes: 30 },
          { title: '따라 해 보기', minutes: 30 },
        ],
      },
      { title: '작은 결과물 하나 만들기', minutes: 60 },
      { title: '막힌 점 정리해 질문하기', minutes: 15 },
    ],
  },
];
