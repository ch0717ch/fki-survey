/**
 * Cloudflare Pages Functions — 설문 API
 *
 * 로컬 Express 서버(server.js)와 동일한 엔드포인트를 제공하되,
 * 저장소를 Supabase Postgres로 바꾼 버전.
 *
 * 필요한 환경변수 (Pages > Settings > Environment variables):
 *   SUPABASE_URL              https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY service_role 키 — 절대 브라우저로 내보내지 않는다
 *   ADMIN_PASSWORD            관리자 비밀번호
 *   AUTH_SECRET               토큰 서명용 임의 문자열
 */

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

/* ------------------------------------------------------------------ *
 * 응답 헬퍼
 * ------------------------------------------------------------------ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

function newId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

/* ------------------------------------------------------------------ *
 * Supabase REST (PostgREST)
 * ------------------------------------------------------------------ */

async function sb(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
  }

  // Prefer: return=minimal 이면 201/204 어느 쪽이든 본문이 비어 온다.
  // 빈 본문에 res.json()을 걸면 "Unexpected end of JSON input"으로 터진다.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** DB 컬럼(snake_case) → 앱 모델(camelCase) */
function toModel(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    intro: row.intro || '',
    outro: row.outro || '',
    active: row.active,
    collectName: row.collect_name,
    sections: row.sections || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(survey) {
  return {
    id: survey.id,
    type: survey.type === 'A' ? 'A' : 'B',
    title: survey.title || '제목 없음',
    intro: survey.intro || '',
    outro: survey.outro || '',
    active: survey.active !== false,
    collect_name: !!survey.collectName,
    sections: survey.sections || [],
  };
}

async function loadSurveys(env) {
  const rows = await sb(env, 'surveys?select=*&order=created_at.asc');
  return rows.map(toModel);
}

async function loadSurvey(env, id) {
  const rows = await sb(env, `surveys?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows.length ? toModel(rows[0]) : null;
}

async function loadCounts(env) {
  const rows = await sb(env, 'rpc/survey_counts', { method: 'POST', body: '{}' });
  return Object.fromEntries(rows.map((r) => [r.survey_id, r.n]));
}

/* ------------------------------------------------------------------ *
 * 관리자 토큰 — HMAC 서명 (Worker는 상태를 못 들고 있으므로 무상태 토큰)
 * ------------------------------------------------------------------ */

function b64url(bytes) {
  let bin = '';
  new Uint8Array(bytes).forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.AUTH_SECRET || 'fki-default-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signToken(env) {
  const payload = b64url(new TextEncoder().encode(String(Date.now() + TOKEN_TTL_MS)));
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${b64url(sig)}`;
}

async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const key = await hmacKey(env);
  const expected = b64url(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  );
  // 길이가 다르면 즉시 실패, 같으면 상수 시간 비교.
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return false;

  const expires = Number(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  return Number.isFinite(expires) && expires > Date.now();
}

async function isAdmin(env, request, url) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  return verifyToken(env, token);
}

/* ------------------------------------------------------------------ *
 * 필수 문항 검증 (server.js와 동일 규칙)
 * ------------------------------------------------------------------ */

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value).every((v) => v == null || v === '');
  return false;
}

function findMissing(survey, answers, respondentName) {
  const missing = [];
  survey.sections.forEach((section) => {
    (section.questions || []).forEach((question) => {
      if (!question.required) return;
      const value = answers[question.id];

      if (question.type === 'lecture') {
        const needScore = question.useScore !== false;
        const needRec = question.useRecommend !== false;
        const ok =
          value &&
          (!needScore || (value.score != null && value.score !== '')) &&
          (!needRec || !!value.recommend);
        if (!ok) missing.push(question.title);
        return;
      }
      if (isBlank(value)) missing.push(question.title);
    });
  });
  if (survey.collectName && !String(respondentName || '').trim()) missing.push('이름');
  return missing;
}

/* ------------------------------------------------------------------ *
 * 라우팅
 * ------------------------------------------------------------------ */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = request.method.toUpperCase();

  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return fail('Supabase 환경변수가 설정되지 않았습니다.', 500);
    }
    return await route(segments, method, request, env, url);
  } catch (err) {
    console.error(err);
    return fail(`서버 오류: ${err.message}`, 500);
  }
}

async function route(seg, method, request, env, url) {
  /* ---------------- 응답자용 ---------------- */

  // GET /api/public/counts
  if (seg[0] === 'public' && seg[1] === 'counts' && method === 'GET') {
    return json({ counts: await loadCounts(env) });
  }

  // GET /api/public/surveys
  if (seg[0] === 'public' && seg[1] === 'surveys' && seg.length === 2 && method === 'GET') {
    const [surveys, counts] = await Promise.all([loadSurveys(env), loadCounts(env)]);
    return json({
      surveys: surveys
        .filter((s) => s.active !== false)
        .map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          intro: s.intro,
          questionCount: s.sections.reduce((n, sec) => n + (sec.questions || []).length, 0),
          sectionCount: s.sections.length,
          count: counts[s.id] || 0,
        })),
    });
  }

  // GET /api/public/surveys/:id
  if (seg[0] === 'public' && seg[1] === 'surveys' && seg.length === 3 && method === 'GET') {
    const survey = await loadSurvey(env, seg[2]);
    if (!survey || survey.active === false) return fail('설문을 찾을 수 없습니다.', 404);
    const counts = await loadCounts(env);
    return json({ survey, count: counts[survey.id] || 0 });
  }

  // POST /api/public/surveys/:id/responses
  if (
    seg[0] === 'public' &&
    seg[1] === 'surveys' &&
    seg[3] === 'responses' &&
    method === 'POST'
  ) {
    const survey = await loadSurvey(env, seg[2]);
    if (!survey || survey.active === false) return fail('설문을 찾을 수 없습니다.', 404);

    const body = await request.json().catch(() => ({}));
    const answers = body.answers || {};
    const name = String(body.respondent?.name || '').trim();

    const missing = findMissing(survey, answers, name);
    if (missing.length) return json({ error: '필수 문항이 비어 있습니다.', missing }, 400);

    await sb(env, 'responses', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: newId('res'),
        survey_id: survey.id,
        submitted_at: new Date().toISOString(),
        respondent: { name },
        answers,
      }),
    });

    const counts = await loadCounts(env);
    return json({ ok: true, count: counts[survey.id] || 0, outro: survey.outro || '' });
  }

  /* ---------------- 관리자 ---------------- */

  // POST /api/admin/login
  if (seg[0] === 'admin' && seg[1] === 'login' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (String(body.password || '') !== String(env.ADMIN_PASSWORD || '')) {
      return fail('비밀번호가 올바르지 않습니다.', 401);
    }
    return json({ token: await signToken(env) });
  }

  if (seg[0] !== 'admin') return fail('알 수 없는 경로입니다.', 404);
  if (!(await isAdmin(env, request, url))) return fail('관리자 인증이 필요합니다.', 401);

  // GET /api/admin/surveys
  if (seg[1] === 'surveys' && seg.length === 2 && method === 'GET') {
    const [surveys, counts] = await Promise.all([loadSurveys(env), loadCounts(env)]);
    return json({ surveys: surveys.map((s) => ({ ...s, count: counts[s.id] || 0 })) });
  }

  // POST /api/admin/surveys — 템플릿에서 생성
  if (seg[1] === 'surveys' && seg.length === 2 && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const survey = buildTemplate(body.from, body.type);
    if (body.title) survey.title = body.title;
    const rows = await sb(env, 'surveys', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(toRow(survey)),
    });
    return json({ survey: toModel(rows[0]) });
  }

  // PUT /api/admin/surveys/:id
  if (seg[1] === 'surveys' && seg.length === 3 && method === 'PUT') {
    const existing = await loadSurvey(env, seg[2]);
    if (!existing) return fail('설문을 찾을 수 없습니다.', 404);

    const body = await request.json().catch(() => ({}));
    const incoming = body.survey;
    if (!incoming || !Array.isArray(incoming.sections)) {
      return fail('설문 형식이 올바르지 않습니다.');
    }

    // 관리자 화면에서 새로 추가한 섹션·문항에 id를 채워 넣는다.
    incoming.sections.forEach((section) => {
      if (!section.id) section.id = newId('sec');
      section.questions = Array.isArray(section.questions) ? section.questions : [];
      section.questions.forEach((question) => {
        if (!question.id) question.id = newId('q');
        if (!Array.isArray(question.options)) question.options = [];
      });
    });

    const rows = await sb(env, `surveys?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(toRow({ ...existing, ...incoming, id: existing.id })),
    });
    return json({ survey: toModel(rows[0]) });
  }

  // DELETE /api/admin/surveys/:id
  if (seg[1] === 'surveys' && seg.length === 3 && method === 'DELETE') {
    await sb(env, `surveys?id=eq.${encodeURIComponent(seg[2])}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  // GET /api/admin/surveys/:id/responses
  if (seg[1] === 'surveys' && seg[3] === 'responses' && method === 'GET') {
    const rows = await sb(
      env,
      `responses?select=*&survey_id=eq.${encodeURIComponent(seg[2])}&order=submitted_at.asc`
    );
    return json({
      responses: rows.map((r) => ({
        id: r.id,
        surveyId: r.survey_id,
        submittedAt: r.submitted_at,
        respondent: r.respondent || {},
        answers: r.answers || {},
      })),
    });
  }

  // DELETE /api/admin/surveys/:id/responses
  if (seg[1] === 'surveys' && seg[3] === 'responses' && method === 'DELETE') {
    await sb(env, `responses?survey_id=eq.${encodeURIComponent(seg[2])}`, { method: 'DELETE' });
    return json({ ok: true });
  }

  return fail('알 수 없는 경로입니다.', 404);
}

/* ------------------------------------------------------------------ *
 * 기본 템플릿 (lib/templates.js의 Worker 판)
 * ------------------------------------------------------------------ */

const SCALE = ['매우 만족', '만족', '보통', '불만족', '매우 불만족'];

function q(type, title, extra = {}) {
  return { id: newId('q'), type, title, desc: '', required: true, options: [], ...extra };
}

function sec(title, desc, questions) {
  return { id: newId('sec'), title, desc, questions };
}

function buildTemplate(from, type) {
  if (from === 'A') {
    return {
      id: newId('sv'),
      type: 'A',
      title: '[제1기 K-Insight 아카데미 과정] 강의평가서',
      intro:
        '본원에서는 향후 더 나은 교육을 위해 아래와 같이 본 과정의 강의내용 및 운영에 대한 사항을 평가받고자 하니 정성껏 답변해주시면 감사하겠습니다.',
      outro: '수고 많으셨습니다.',
      active: true,
      collectName: true,
      sections: [
        sec('강연 만족도 평가', '강연별로 만족도 점수와 추천 여부를 남겨주세요.', [
          q('lecture', '강연 1', { meta: { date: '', professor: '' }, useScore: true, useRecommend: true }),
        ]),
        sec('의견', '좋았던 점과 아쉬웠던 점을 자유롭게 적어주세요.', [
          q('long', '좋은 점', { required: false }),
          q('long', '아쉬운 점', { required: false }),
        ]),
        sec('제안 사항', '교육 관련하여 제안 및 요청사항이 있으시면 기재 부탁드립니다.', [
          q('long', '제안 및 요청사항', { required: false }),
        ]),
      ],
    };
  }

  if (from === 'B') {
    const scale = (t) => q('scale', t, { options: SCALE.slice() });
    return {
      id: newId('sv'),
      type: 'B',
      title: '교육과정 만족도조사',
      intro:
        '본 설문은 익명으로 실시되며, 응답 결과는 향후 교육과정 개발을 위한 자료로만 활용됩니다. 정성껏 응답해 주시기 바랍니다.\n(소요 시간: 약 2분)',
      outro: '소중한 의견 감사합니다.',
      active: true,
      collectName: false,
      sections: [
        sec('과정평가', '', [
          scale('교육의 학습목표와 교육내용이 일치하였습니까?'),
          scale('교육 내용을 쉽게 이해할 수 있었습니까?'),
          scale('교육시간은 적정(또는 엄수)하였습니까?'),
          scale('학습내용이 현업에 활용될 것으로 기대하십니까?'),
          scale('교육에 대한 전반적인 만족도는 어떻습니까?'),
        ]),
        sec('강사평가', '', [
          scale('강사의 교육자료는 잘 준비되었습니까?'),
          scale('강사는 교육내용에 대한 지식과 전문성을 갖추고 있었습니까?'),
          scale('강의스킬과 내용 전달력은 어떠하였습니까?'),
          scale('강사는 충분한 교육 열의를 가지고 있었습니까?'),
          scale('흥미유발·집중을 위한 요소는 어떠하였습니까?'),
        ]),
        sec('시설평가', '', [
          scale('교육시설은 강의를 듣기에 적절하였습니까?'),
          scale('교육기자재는 강의를 듣기에 적절하였습니까?'),
          scale('강의실의 온도·습도 등 환경은 쾌적하였습니까?'),
          scale('식사(중식)는 만족하셨습니까?'),
          scale('다과·음료 등 제공되는 간식은 만족하셨습니까?'),
        ]),
        sec('주관식 의견', '', [
          q('long', '교육과정에서 좋았던 점을 자유롭게 기술해주세요.', { required: false }),
          q('long', '이번 교육과정에서 보완해야 할 점을 자유롭게 기술해주세요.', { required: false }),
          q('long', '향후 수강하고 싶은 교육 분야나 주제가 있다면 기술해주세요.', { required: false }),
        ]),
      ],
    };
  }

  return {
    id: newId('sv'),
    type: type === 'A' ? 'A' : 'B',
    title: '새 설문',
    intro: '',
    outro: '응답해 주셔서 감사합니다.',
    active: true,
    collectName: false,
    sections: [sec('섹션 1', '', [])],
  };
}
