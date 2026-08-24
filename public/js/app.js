'use strict';

/* ============================================================
   응답자 화면 — 표지 → 유형 선택 → 섹션별 진행 → 제출
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const state = {
  surveys: [],
  survey: null,
  sectionIndex: 0,
  answers: {},
  respondent: { name: '' },
  counts: {},
  sending: false,
};

const NAME_KEY = '__respondent_name__';

/* ---------------- 공통 ---------------- */

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('is-active'));
  $(`#screen${name}`).classList.add('is-active');
  $('#topbar').hidden = name !== 'Form';
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

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

async function api(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || '요청에 실패했습니다.'), { body });
  return body;
}

/* ---------------- 실시간 응답 수 ---------------- */

function paintCounts() {
  const total = Object.values(state.counts).reduce((a, b) => a + b, 0);
  $('#liveTotal').textContent = total.toLocaleString('ko-KR');
  document.querySelectorAll('[data-count-for]').forEach((el) => {
    el.textContent = (state.counts[el.dataset.countFor] || 0).toLocaleString('ko-KR');
  });
  if (state.survey) {
    $('#doneCount').textContent = (state.counts[state.survey.id] || 0).toLocaleString('ko-KR');
  }
}

function connectLive() {
  let source;
  try {
    source = new EventSource('/api/stream');
  } catch {
    return pollLive();
  }
  source.onmessage = (event) => {
    try {
      state.counts = JSON.parse(event.data).counts || {};
      paintCounts();
    } catch {
      /* 형식이 깨진 프레임은 건너뛴다 */
    }
  };
  // SSE가 막힌 환경(일부 사내망 프록시)에서는 폴링으로 내려앉는다.
  source.onerror = () => {
    source.close();
    pollLive();
  };
}

function pollLive() {
  const tick = async () => {
    try {
      const { surveys } = await api('/api/public/surveys');
      state.counts = Object.fromEntries(surveys.map((s) => [s.id, s.count]));
      paintCounts();
    } catch {
      /* 다음 주기에 다시 시도 */
    }
  };
  tick();
  setInterval(tick, 6000);
}

/* ---------------- 유형 선택 ---------------- */

async function loadSurveys() {
  const { surveys } = await api('/api/public/surveys');
  state.surveys = surveys;
  state.counts = Object.fromEntries(surveys.map((s) => [s.id, s.count]));

  $('#surveyCards').innerHTML = surveys
    .map(
      (s) => `
      <button class="card" data-survey="${esc(s.id)}">
        <span class="card__tag">${esc(s.type)} 형</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.intro || '')}</p>
        <div class="card__meta">
          <span>문항 <b>${s.questionCount}</b>개</span>
          <span>단계 <b>${s.sectionCount}</b>단계</span>
          <span>응답 <b data-count-for="${esc(s.id)}">${s.count}</b>명</span>
        </div>
      </button>`
    )
    .join('');

  if (!surveys.length) {
    $('#surveyCards').innerHTML =
      '<p style="color:var(--muted);text-align:center">현재 진행 중인 설문이 없습니다.</p>';
  }

  paintCounts();
}

async function openSurvey(surveyId) {
  const { survey, count } = await api(`/api/public/surveys/${surveyId}`);
  state.survey = survey;
  state.sectionIndex = 0;
  state.answers = {};
  state.respondent = { name: '' };
  state.counts[survey.id] = count;

  $('#topbarTitle').textContent = survey.title;
  showScreen('Form');
  renderSection();
}

/* ---------------- 문항 렌더링 ---------------- */

function questionHtml(question, index) {
  const req = question.required ? '<span class="q__req">*</span>' : '';
  const desc = question.desc ? `<p class="q__desc">${esc(question.desc)}</p>` : '';
  return `
    <div class="q" data-qid="${esc(question.id)}">
      <p class="q__title">${req}<span>${esc(question.title)}</span></p>
      ${desc}
      <div class="q__body">${bodyHtml(question, index)}</div>
    </div>`;
}

function bodyHtml(question, index) {
  const saved = state.answers[question.id];

  if (question.type === 'scale' || question.type === 'single') {
    return `<div class="opts">${question.options
      .map(
        (opt, i) => `
        <label class="opt ${saved === opt ? 'is-on' : ''}">
          <input type="radio" name="q_${index}" value="${esc(opt)}" ${saved === opt ? 'checked' : ''} />
          <span class="opt__mark"></span>
          <span class="opt__text">${esc(opt)}</span>
        </label>`
      )
      .join('')}</div>`;
  }

  if (question.type === 'multi') {
    const list = Array.isArray(saved) ? saved : [];
    return `<div class="opts">${question.options
      .map(
        (opt) => `
        <label class="opt opt--multi ${list.includes(opt) ? 'is-on' : ''}">
          <input type="checkbox" value="${esc(opt)}" ${list.includes(opt) ? 'checked' : ''} />
          <span class="opt__mark"></span>
          <span class="opt__text">${esc(opt)}</span>
        </label>`
      )
      .join('')}</div>`;
  }

  if (question.type === 'short') {
    return `<input class="field" type="text" value="${esc(saved || '')}" placeholder="답변을 입력해 주세요" />`;
  }

  if (question.type === 'long') {
    return `<textarea class="field" placeholder="자유롭게 작성해 주세요">${esc(saved || '')}</textarea>`;
  }

  if (question.type === 'lecture') {
    const value = saved || {};
    const score = value.score;
    const meta = question.meta || {};
    const chips = [meta.date, meta.professor]
      .filter(Boolean)
      .map((t) => `<span class="chip">${esc(t)}</span>`)
      .join('');

    const scoreBlock =
      question.useScore === false
        ? ''
        : `
        <div class="lecture__label">강연에 대한 전반적인 만족도 (100점 만점)</div>
        <div class="score">
          <span class="score__num" data-score-view>${score == null ? '—' : score}</span>
          <span class="score__unit">/ 100</span>
        </div>
        <input class="slider" type="range" min="0" max="100" step="5"
               value="${score == null ? 80 : score}"
               style="--pct:${score == null ? 80 : score}%" data-score-input />
        <div class="slider__ends"><span>0</span><span>50</span><span>100</span></div>`;

    const recBlock =
      question.useRecommend === false
        ? ''
        : `
        <div class="lecture__label">강의 추천 여부</div>
        <div class="seg" data-rec>
          <button type="button" data-value="추천" class="${value.recommend === '추천' ? 'is-on' : ''}">추천</button>
          <button type="button" data-value="비추천" class="${
            value.recommend === '비추천' ? 'is-on' : ''
          }">비추천</button>
        </div>`;

    return `<div class="lecture">${
      chips ? `<div class="lecture__meta">${chips}</div>` : ''
    }${scoreBlock}${recBlock}</div>`;
  }

  return '';
}

function renderSection() {
  const survey = state.survey;
  const section = survey.sections[state.sectionIndex];
  const total = survey.sections.length;

  $('#formEyebrow').textContent = `${survey.type}형 · ${survey.title}`;
  $('#sectionTitle').textContent = section.title || '';
  $('#sectionDesc').textContent =
    state.sectionIndex === 0 && survey.intro ? survey.intro : section.desc || '';
  $('#topbarStep').textContent = `${state.sectionIndex + 1} / ${total}`;
  $('#progressFill').style.width = `${((state.sectionIndex + 1) / total) * 100}%`;

  let html = '';

  // 기명 설문(A형)은 첫 화면에서 이름을 먼저 받는다.
  if (survey.collectName && state.sectionIndex === 0) {
    html += `
      <div class="q" data-qid="${NAME_KEY}">
        <p class="q__title"><span class="q__req">*</span><span>이름</span></p>
        <div class="q__body">
          <input class="field" type="text" data-name-input
                 value="${esc(state.respondent.name)}" placeholder="성함을 입력해 주세요" />
        </div>
      </div>`;
  }

  html += section.questions.map((q, i) => questionHtml(q, i)).join('');
  $('#questionList').innerHTML = html;

  $('#btnPrev').hidden = state.sectionIndex === 0;
  $('#btnNext').textContent = state.sectionIndex === total - 1 ? '제출하기' : '다음';

  bindSection(section);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindSection(section) {
  const root = $('#questionList');

  root.querySelector('[data-name-input]')?.addEventListener('input', (e) => {
    state.respondent.name = e.target.value;
  });

  section.questions.forEach((question) => {
    const box = root.querySelector(`[data-qid="${question.id}"]`);
    if (!box) return;
    box.addEventListener('input', () => box.classList.remove('is-missing'));

    if (question.type === 'scale' || question.type === 'single') {
      box.querySelectorAll('.opt').forEach((label) => {
        label.addEventListener('click', () => {
          box.querySelectorAll('.opt').forEach((o) => o.classList.remove('is-on'));
          label.classList.add('is-on');
          box.classList.remove('is-missing');
          state.answers[question.id] = label.querySelector('input').value;
        });
      });
    }

    if (question.type === 'multi') {
      box.querySelectorAll('.opt').forEach((label) => {
        const input = label.querySelector('input');
        label.addEventListener('click', (e) => {
          if (e.target !== input) input.checked = !input.checked;
          label.classList.toggle('is-on', input.checked);
          state.answers[question.id] = Array.from(box.querySelectorAll('input:checked')).map(
            (i) => i.value
          );
          box.classList.remove('is-missing');
        });
      });
    }

    if (question.type === 'short' || question.type === 'long') {
      box.querySelector('.field')?.addEventListener('input', (e) => {
        state.answers[question.id] = e.target.value;
      });
    }

    if (question.type === 'lecture') {
      state.answers[question.id] = state.answers[question.id] || { score: null, recommend: null };
      const current = state.answers[question.id];

      const slider = box.querySelector('[data-score-input]');
      const view = box.querySelector('[data-score-view]');
      slider?.addEventListener('input', (e) => {
        const value = Number(e.target.value);
        current.score = value;
        view.textContent = value;
        e.target.style.setProperty('--pct', `${value}%`);
        box.classList.remove('is-missing');
      });

      box.querySelectorAll('[data-rec] button').forEach((btn) => {
        btn.addEventListener('click', () => {
          box.querySelectorAll('[data-rec] button').forEach((b) => b.classList.remove('is-on'));
          btn.classList.add('is-on');
          current.recommend = btn.dataset.value;
          box.classList.remove('is-missing');
        });
      });
    }
  });
}

/* ---------------- 검증 & 제출 ---------------- */

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateSection() {
  const survey = state.survey;
  const section = survey.sections[state.sectionIndex];
  const bad = [];

  if (survey.collectName && state.sectionIndex === 0 && !state.respondent.name.trim()) {
    bad.push(NAME_KEY);
  }

  section.questions.forEach((question) => {
    if (!question.required) return;
    const value = state.answers[question.id];

    if (question.type === 'lecture') {
      const needScore = question.useScore !== false;
      const needRec = question.useRecommend !== false;
      const ok = value && (!needScore || value.score != null) && (!needRec || !!value.recommend);
      if (!ok) bad.push(question.id);
      return;
    }
    if (isBlank(value)) bad.push(question.id);
  });

  document.querySelectorAll('.q').forEach((el) => el.classList.remove('is-missing'));
  bad.forEach((qid) => {
    document.querySelector(`.q[data-qid="${qid}"]`)?.classList.add('is-missing');
  });

  if (bad.length) {
    document
      .querySelector(`.q[data-qid="${bad[0]}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`필수 문항 ${bad.length}개가 남아 있습니다`);
    return false;
  }
  return true;
}

async function submit() {
  if (state.sending) return;
  state.sending = true;
  $('#btnNext').disabled = true;
  $('#btnNext').textContent = '제출 중…';

  try {
    const result = await api(`/api/public/surveys/${state.survey.id}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: state.answers, respondent: state.respondent }),
    });
    state.counts[state.survey.id] = result.count;
    $('#doneMessage').textContent = result.outro || '소중한 의견 감사합니다.';
    paintCounts();
    showScreen('Done');
  } catch (err) {
    toast(err.message);
  } finally {
    state.sending = false;
    $('#btnNext').disabled = false;
    $('#btnNext').textContent = '제출하기';
  }
}

/* ---------------- 이벤트 ---------------- */

$('#btnStart').addEventListener('click', async () => {
  try {
    await loadSurveys();
    showScreen('Pick');
  } catch (err) {
    toast(err.message);
  }
});

$('#surveyCards').addEventListener('click', (e) => {
  const card = e.target.closest('[data-survey]');
  if (card) openSurvey(card.dataset.survey).catch((err) => toast(err.message));
});

$('#btnPrev').addEventListener('click', () => {
  if (state.sectionIndex === 0) return;
  state.sectionIndex -= 1;
  renderSection();
});

$('#btnNext').addEventListener('click', () => {
  if (!validateSection()) return;
  if (state.sectionIndex === state.survey.sections.length - 1) return submit();
  state.sectionIndex += 1;
  renderSection();
});

document.querySelectorAll('[data-goto="cover"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.survey = null;
    showScreen('Cover');
  });
});

loadSurveys().catch(() => {});
connectLive();
