'use strict';

const { id } = require('./store');

const SCALE_SATISFACTION = ['매우 만족', '만족', '보통', '불만족', '매우 불만족'];

function q(type, title, extra = {}) {
  return {
    id: id('q'),
    type,
    title,
    desc: '',
    required: true,
    options: [],
    ...extra,
  };
}

function scale(title) {
  return q('scale', title, { options: SCALE_SATISFACTION.slice() });
}

function section(title, desc, questions) {
  return { id: id('sec'), title, desc, questions };
}

/**
 * A형 — 간결형 / 강연별 평가
 * 원본: [제 1기 K-Insight 아카데미 과정] 강의평가서 (HWP)
 * 강연 단위로 100점 만점 점수 + 추천/비추천을 받고 주관식 3종으로 마무리한다.
 */
function templateA() {
  return {
    id: id('sv'),
    type: 'A',
    title: '[제1기 K-Insight 아카데미 과정] 강의평가서',
    intro:
      '본원에서는 향후 더 나은 교육을 위해 아래와 같이 본 과정의 강의내용 및 운영에 대한 사항을 평가받고자 하니 정성껏 답변해주시면 감사하겠습니다.',
    outro: '수고 많으셨습니다.',
    active: true,
    collectName: true,
    sections: [
      section('강연 만족도 평가', '강연별로 만족도 점수와 추천 여부를 남겨주세요.', [
        q('lecture', 'AGI시대 경영의 대전환과 산업구조변화', {
          meta: { date: '4/2 (목)', professor: '김대식 교수 [KAIST]' },
          useScore: true,
          useRecommend: true,
        }),
        q('lecture', '토큰경제의 미래', {
          meta: { date: '', professor: '오태민 교수' },
          useScore: true,
          useRecommend: true,
        }),
      ]),
      section('의견', '좋았던 점과 아쉬웠던 점을 자유롭게 적어주세요.', [
        q('long', '좋은 점', { required: false }),
        q('long', '아쉬운 점', { required: false }),
      ]),
      section('제안 사항', '교육 관련하여 제안 및 요청사항이 있으시면 기재 부탁드립니다.', [
        q('long', '제안 및 요청사항', { required: false }),
      ]),
    ],
  };
}

/**
 * B형 — 표준 통합형
 * 모아폼(KT) 9문항과 구글폼(대한제분) 18문항을 크로스워크해 만든 통합 문항표.
 * 척도는 전 문항 '매우 만족~매우 불만족' 5점으로 통일했다.
 */
function templateB() {
  return {
    id: id('sv'),
    type: 'B',
    title: '교육과정 만족도조사',
    intro:
      '본 설문은 익명으로 실시되며, 응답 결과는 향후 교육과정 개발을 위한 자료로만 활용됩니다. 정성껏 응답해 주시기 바랍니다.\n(소요 시간: 약 2분)',
    outro: '소중한 의견 감사합니다.',
    active: true,
    collectName: false,
    sections: [
      section('과정평가', '', [
        scale('교육의 학습목표와 교육내용이 일치하였습니까?'),
        scale('교육 내용을 쉽게 이해할 수 있었습니까?'),
        scale('교육시간은 적정(또는 엄수)하였습니까?'),
        scale('학습내용이 현업에 활용될 것으로 기대하십니까?'),
        scale('교육에 대한 전반적인 만족도는 어떻습니까?'),
      ]),
      section('강사평가', '', [
        scale('강사의 교육자료는 잘 준비되었습니까?'),
        scale('강사는 교육내용에 대한 지식과 전문성을 갖추고 있었습니까?'),
        scale('강의스킬과 내용 전달력은 어떠하였습니까?'),
        scale('강사는 충분한 교육 열의를 가지고 있었습니까?'),
        scale('흥미유발·집중을 위한 요소는 어떠하였습니까?'),
      ]),
      section('시설평가', '', [
        scale('교육시설은 강의를 듣기에 적절하였습니까?'),
        scale('교육기자재는 강의를 듣기에 적절하였습니까?'),
        scale('강의실의 온도·습도 등 환경은 쾌적하였습니까?'),
        scale('식사(중식)는 만족하셨습니까?'),
        scale('다과·음료 등 제공되는 간식은 만족하셨습니까?'),
      ]),
      section('주관식 의견', '', [
        q('long', '교육과정에서 좋았던 점을 자유롭게 기술해주세요.', { required: false }),
        q('long', '이번 교육과정에서 보완해야 할 점을 자유롭게 기술해주세요.', { required: false }),
        q('long', '향후 수강하고 싶은 교육 분야나 주제가 있다면 기술해주세요.', { required: false }),
      ]),
    ],
  };
}

const BLANK_QUESTION = {
  scale: () => scale('새 문항'),
  single: () => q('single', '새 문항', { options: ['보기 1', '보기 2'] }),
  multi: () => q('multi', '새 문항', { options: ['보기 1', '보기 2'] }),
  short: () => q('short', '새 문항', { required: false }),
  long: () => q('long', '새 문항', { required: false }),
  lecture: () =>
    q('lecture', '새 강연', {
      meta: { date: '', professor: '' },
      useScore: true,
      useRecommend: true,
    }),
};

module.exports = { templateA, templateB, SCALE_SATISFACTION, BLANK_QUESTION, section, q };
