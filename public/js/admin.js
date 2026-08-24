'use strict';

/* ============================================================
   관리자 — 설문 편집 / 문항·보기 추가 삭제 / 엑셀 추출
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const TYPE_LABEL = {
  scale: '척도 (5점)',
  single: '객관식 (단일선택)',
  multi: '객관식 (복수선택)',
  short: '주관식 (단답)',
  long: '주관식 (장문)',
  lecture: '강연평가 (점수 + 추천)',
};

const DEFAULT_SCALE = ['매우 만족', '만족', '보통', '불만족', '매우 불만족'];

const state = { token: null, surveys: [], draft: null, dirty: false };

/* ---------------- 유틸 ---------------- */

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function esc(text) {
  return String(text == null ? '' : text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error('세션이 만료되었습니다. 다시 로그인해 주세요.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || '요청에 실패했습니다.');
  return body;
}

function markDirty() {
  state.dirty = true;
  const hint = $('#saveHint');
  if (hint) hint.textContent = '저장하지 않은 변경이 있습니다';
}

/* ---------------- 로그인 ---------------- */

function showAdmin(on) {
  $('#screenGate').classList.toggle('is-active', !on);
  $('#screenAdmin').classList.toggle('is-active', on);
}

async function login() {
  const password = $('#pw').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    state.token = body.token;
    sessionStorage.setItem('fki_survey_token', body.token);
    showAdmin(true);
    await loadSurveys();
  } catch (err) {
    toast(err.message);
  }
}

function logout() {
  state.token = null;
  sessionStorage.removeItem('fki_survey_token');
  showAdmin(false);
}

/* ---------------- 목록 ---------------- */

async function loadSurveys(selectId) {
  const { surveys } = await api('/api/admin/surveys');
  state.surveys = surveys;

  $('#surveyList').innerHTML = surveys
    .map(
      (s) => `
      <button class="side__item ${state.draft && state.draft.id === s.id ? 'is-on' : ''}"
              data-open="${esc(s.id)}">
        <span class="tag">${esc(s.type)} 형${s.active === false ? ' · 비공개' : ''}</span>
        <span class="name">${esc(s.title)}</span>
        <span class="n">응답 <b>${s.count}</b>건</span>
      </button>`
    )
    .join('');

  const target = selectId || state.draft?.id;
  if (target && surveys.some((s) => s.id === target)) openSurvey(target);
  else if (!surveys.length) $('#editor').innerHTML = '<div class="empty">설문을 추가해 주세요.</div>';
}

function openSurvey(surveyId) {
  const found = state.surveys.find((s) => s.id === surveyId);
  if (!found) return;
  state.draft = JSON.parse(JSON.stringify(found));
  state.dirty = false;
  renderEditor();
  document.querySelectorAll('.side__item').forEach((el) => {
    el.classList.toggle('is-on', el.dataset.open === surveyId);
  });
}

/* ---------------- 편집 화면 ---------------- */

function renderEditor() {
  const survey = state.draft;
  const count = state.surveys.find((s) => s.id === survey.id)?.count ?? 0;
  const link = `${location.origin}/`;

  $('#editor').innerHTML = `
    <div class="panel">
      <p class="panel__title">기본 정보</p>
      <div class="grid2">
        <div class="span2">
          <label class="lab">설문 제목 (엑셀 파일명에 사용됩니다)</label>
          <input class="field field--sm" data-f="title" value="${esc(survey.title)}" />
        </div>
        <div>
          <label class="lab">유형</label>
          <select class="field field--sm" data-f="type">
            <option value="A" ${survey.type === 'A' ? 'selected' : ''}>A형 (강연별 평가·기명)</option>
            <option value="B" ${survey.type === 'B' ? 'selected' : ''}>B형 (표준 척도·익명)</option>
          </select>
        </div>
        <div style="display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap">
          <label class="toggle">
            <input type="checkbox" data-f="collectName" ${survey.collectName ? 'checked' : ''} />
            <span class="toggle__track"></span> 이름 받기
          </label>
          <label class="toggle">
            <input type="checkbox" data-f="active" ${survey.active !== false ? 'checked' : ''} />
            <span class="toggle__track"></span> 공개
          </label>
        </div>
        <div class="span2">
          <label class="lab">안내문 (첫 화면에 표시)</label>
          <textarea class="field field--sm" data-f="intro" style="min-height:96px">${esc(
            survey.intro || ''
          )}</textarea>
        </div>
        <div class="span2">
          <label class="lab">제출 완료 메시지</label>
          <input class="field field--sm" data-f="outro" value="${esc(survey.outro || '')}" />
        </div>
      </div>
    </div>

    <div class="panel">
      <p class="panel__title">응답 · 내보내기</p>
      <div class="actions" style="margin-bottom:14px">
        <button class="btn btn--sm" data-act="export">엑셀(xlsx) 다운로드</button>
        <button class="btn btn--ghost btn--sm" data-act="copyLink">응답 링크 복사</button>
        <button class="btn btn--danger btn--sm" data-act="clear">응답 전체 삭제</button>
        <button class="btn btn--danger btn--sm" data-act="delSurvey">설문 삭제</button>
      </div>
      <div class="link-row">
        누적 응답 <b style="color:var(--gold-hi)">${count}</b>건 &nbsp;·&nbsp; 응답 링크 ${esc(link)}
      </div>
    </div>

    <div class="panel">
      <p class="panel__title">문항 구성</p>
      <div id="sections">${survey.sections.map(sectionHtml).join('')}</div>
      <button class="rnd rnd--add" data-act="addSection">＋ 섹션 추가</button>
    </div>

    <div class="savebar">
      <span class="savebar__hint" id="saveHint">${state.dirty ? '저장하지 않은 변경이 있습니다' : '모든 변경이 저장되었습니다'}</span>
      <button class="btn" data-act="save">저장</button>
    </div>`;
}

function sectionHtml(section, si) {
  return `
    <div class="sec-card">
      <div class="sec-card__bar">
        <span class="sec-card__no">${si + 1}</span>
        <input class="field field--sm" data-sec="${si}" data-f="title"
               value="${esc(section.title)}" placeholder="섹션 제목" />
        <button class="rnd rnd--minus" data-act="delSection" data-sec="${si}" title="섹션 삭제">−</button>
      </div>
      <input class="field field--sm" data-sec="${si}" data-f="desc"
             value="${esc(section.desc || '')}" placeholder="섹션 설명 (선택)"
             style="margin-bottom:14px" />
      ${section.questions.map((q, qi) => questionHtml(q, si, qi, section.questions.length)).join('')}
      <button class="rnd rnd--add" data-act="addQuestion" data-sec="${si}">＋ 문항 추가</button>
    </div>`;
}

function questionHtml(question, si, qi, total) {
  const isChoice = ['scale', 'single', 'multi'].includes(question.type);

  const options = isChoice
    ? `
      <label class="lab">보기</label>
      ${question.options
        .map(
          (opt, oi) => `
        <div class="opt-row">
          <span class="idx">${oi + 1}</span>
          <input class="field field--sm" data-sec="${si}" data-q="${qi}" data-opt="${oi}"
                 value="${esc(opt)}" />
          <button class="rnd rnd--minus" data-act="delOption"
                  data-sec="${si}" data-q="${qi}" data-opt="${oi}" title="보기 삭제">−</button>
        </div>`
        )
        .join('')}
      <button class="rnd rnd--add" data-act="addOption" data-sec="${si}" data-q="${qi}">＋ 보기 추가</button>`
    : '';

  const lecture =
    question.type === 'lecture'
      ? `
      <div class="grid2" style="margin-top:12px">
        <div>
          <label class="lab">일자</label>
          <input class="field field--sm" data-sec="${si}" data-q="${qi}" data-f="meta.date"
                 value="${esc(question.meta?.date || '')}" placeholder="예) 4/2 (목)" />
        </div>
        <div>
          <label class="lab">교수 / 강사</label>
          <input class="field field--sm" data-sec="${si}" data-q="${qi}" data-f="meta.professor"
                 value="${esc(question.meta?.professor || '')}" placeholder="예) 김대식 교수 [KAIST]" />
        </div>
        <div class="span2" style="display:flex;gap:20px;flex-wrap:wrap">
          <label class="toggle">
            <input type="checkbox" data-sec="${si}" data-q="${qi}" data-f="useScore"
                   ${question.useScore !== false ? 'checked' : ''} />
            <span class="toggle__track"></span> 100점 만점 점수
          </label>
          <label class="toggle">
            <input type="checkbox" data-sec="${si}" data-q="${qi}" data-f="useRecommend"
                   ${question.useRecommend !== false ? 'checked' : ''} />
            <span class="toggle__track"></span> 추천 / 비추천
          </label>
        </div>
      </div>`
      : '';

  return `
    <div class="q-card">
      <div class="q-card__bar">
        <span class="q-card__no">${qi + 1}</span>
        <select class="field field--sm" data-sec="${si}" data-q="${qi}" data-f="type"
                style="width:auto;min-width:172px">
          ${Object.entries(TYPE_LABEL)
            .map(
              ([value, label]) =>
                `<option value="${value}" ${question.type === value ? 'selected' : ''}>${label}</option>`
            )
            .join('')}
        </select>
        <label class="toggle">
          <input type="checkbox" data-sec="${si}" data-q="${qi}" data-f="required"
                 ${question.required ? 'checked' : ''} />
          <span class="toggle__track"></span> 필수
        </label>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="rnd" data-act="moveQ" data-dir="-1" data-sec="${si}" data-q="${qi}"
                  ${qi === 0 ? 'disabled style="opacity:.3"' : ''} title="위로">↑</button>
          <button class="rnd" data-act="moveQ" data-dir="1" data-sec="${si}" data-q="${qi}"
                  ${qi === total - 1 ? 'disabled style="opacity:.3"' : ''} title="아래로">↓</button>
          <button class="rnd rnd--minus" data-act="delQuestion" data-sec="${si}" data-q="${qi}"
                  title="문항 삭제">−</button>
        </span>
      </div>

      <input class="field field--sm" data-sec="${si}" data-q="${qi}" data-f="title"
             value="${esc(question.title)}" placeholder="문항 내용" style="margin-bottom:9px" />
      <input class="field field--sm" data-sec="${si}" data-q="${qi}" data-f="desc"
             value="${esc(question.desc || '')}" placeholder="문항 설명 (선택)" style="margin-bottom:11px" />
      ${options}
      ${lecture}
    </div>`;
}

/* ---------------- 편집 바인딩 ---------------- */

function target(el) {
  const survey = state.draft;
  const si = el.dataset.sec;
  const qi = el.dataset.q;
  if (si == null) return survey;
  const section = survey.sections[Number(si)];
  if (qi == null) return section;
  return section.questions[Number(qi)];
}

// #editor는 계속 살아 있는 컨테이너라 위임 바인딩을 최초 1회만 건다.
// (renderEditor마다 걸면 리스너가 쌓여 클릭 한 번에 여러 번 실행된다.)
function bindEditor() {
  const root = $('#editor');

  // 텍스트/선택 입력은 재렌더 없이 모델만 갱신한다 (입력 중 포커스 유지).
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches('input, textarea, select')) return;
    if (!state.draft) return;

    if (el.dataset.opt != null) {
      target(el).options[Number(el.dataset.opt)] = el.value;
      return markDirty();
    }

    const field = el.dataset.f;
    if (!field) return;

    const obj = target(el);
    const value = el.type === 'checkbox' ? el.checked : el.value;

    if (field.startsWith('meta.')) {
      obj.meta = obj.meta || {};
      obj.meta[field.slice(5)] = value;
    } else {
      obj[field] = value;
    }

    markDirty();

    // 문항 유형이 바뀌면 보기 구성이 달라지므로 다시 그린다.
    if (field === 'type') {
      if (['scale', 'single', 'multi'].includes(value) && !obj.options.length) {
        obj.options = value === 'scale' ? DEFAULT_SCALE.slice() : ['보기 1', '보기 2'];
      }
      if (value === 'lecture') {
        obj.meta = obj.meta || { date: '', professor: '' };
        if (obj.useScore === undefined) obj.useScore = true;
        if (obj.useRecommend === undefined) obj.useRecommend = true;
      }
      renderEditor();
    }
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !state.draft) return;
    handleAction(btn.dataset.act, btn);
  });
}

bindEditor();

function handleAction(action, btn) {
  const survey = state.draft;
  const si = Number(btn.dataset.sec);
  const qi = Number(btn.dataset.q);
  const oi = Number(btn.dataset.opt);

  switch (action) {
    case 'addSection':
      survey.sections.push({ title: `섹션 ${survey.sections.length + 1}`, desc: '', questions: [] });
      break;

    case 'delSection':
      if (!confirm('이 섹션과 안의 문항을 모두 삭제할까요?')) return;
      survey.sections.splice(si, 1);
      break;

    case 'addQuestion':
      survey.sections[si].questions.push({
        type: survey.type === 'A' ? 'lecture' : 'scale',
        title: '새 문항',
        desc: '',
        required: true,
        options: survey.type === 'A' ? [] : DEFAULT_SCALE.slice(),
        ...(survey.type === 'A'
          ? { meta: { date: '', professor: '' }, useScore: true, useRecommend: true }
          : {}),
      });
      break;

    case 'delQuestion':
      if (!confirm('이 문항을 삭제할까요?')) return;
      survey.sections[si].questions.splice(qi, 1);
      break;

    case 'moveQ': {
      const list = survey.sections[si].questions;
      const to = qi + Number(btn.dataset.dir);
      if (to < 0 || to >= list.length) return;
      [list[qi], list[to]] = [list[to], list[qi]];
      break;
    }

    case 'addOption':
      survey.sections[si].questions[qi].options.push(
        `보기 ${survey.sections[si].questions[qi].options.length + 1}`
      );
      break;

    case 'delOption': {
      const question = survey.sections[si].questions[qi];
      if (question.options.length <= 1) return toast('보기는 최소 1개가 필요합니다');
      question.options.splice(oi, 1);
      break;
    }

    case 'save':
      return saveSurvey();

    case 'export':
      return window.open(
        `/api/admin/surveys/${survey.id}/export.xlsx?token=${encodeURIComponent(state.token)}`,
        '_blank'
      );

    case 'copyLink':
      navigator.clipboard
        ?.writeText(location.origin + '/')
        .then(() => toast('응답 링크를 복사했습니다'))
        .catch(() => toast(location.origin + '/'));
      return;

    case 'clear':
      if (!confirm('이 설문의 응답을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) return;
      return api(`/api/admin/surveys/${survey.id}/responses`, { method: 'DELETE' })
        .then(() => {
          toast('응답을 삭제했습니다');
          return loadSurveys(survey.id);
        })
        .catch((err) => toast(err.message));

    case 'delSurvey':
      if (!confirm('설문과 응답이 모두 삭제됩니다. 계속할까요?')) return;
      return api(`/api/admin/surveys/${survey.id}`, { method: 'DELETE' })
        .then(() => {
          state.draft = null;
          toast('설문을 삭제했습니다');
          $('#editor').innerHTML = '<div class="empty">왼쪽에서 설문을 선택하세요.</div>';
          return loadSurveys();
        })
        .catch((err) => toast(err.message));

    default:
      return;
  }

  markDirty();
  renderEditor();
}

async function saveSurvey() {
  try {
    await api(`/api/admin/surveys/${state.draft.id}`, {
      method: 'PUT',
      body: JSON.stringify({ survey: state.draft }),
    });
    state.dirty = false;
    toast('저장했습니다');
    await loadSurveys(state.draft.id);
  } catch (err) {
    toast(err.message);
  }
}

/* ---------------- 전역 이벤트 ---------------- */

$('#btnLogin').addEventListener('click', login);
$('#pw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
$('#btnLogout').addEventListener('click', logout);

$('#surveyList').addEventListener('click', (e) => {
  const item = e.target.closest('[data-open]');
  if (!item) return;
  if (state.dirty && !confirm('저장하지 않은 변경이 있습니다. 이동할까요?')) return;
  openSurvey(item.dataset.open);
});

document.querySelectorAll('[data-new]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const from = btn.dataset.new;
    try {
      const { survey } = await api('/api/admin/surveys', {
        method: 'POST',
        body: JSON.stringify(from === 'blank' ? { type: 'B' } : { from }),
      });
      await loadSurveys(survey.id);
      toast('새 설문을 만들었습니다');
    } catch (err) {
      toast(err.message);
    }
  });
});

window.addEventListener('beforeunload', (e) => {
  if (!state.dirty) return;
  e.preventDefault();
  e.returnValue = '';
});

/* 세션 복구 */
const saved = sessionStorage.getItem('fki_survey_token');
if (saved) {
  state.token = saved;
  api('/api/admin/surveys')
    .then(() => {
      showAdmin(true);
      return loadSurveys();
    })
    .catch(() => showAdmin(false));
}
