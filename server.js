'use strict';

const path = require('path');
const os = require('os');
const crypto = require('crypto');
const express = require('express');

const store = require('./lib/store');
const { templateA, templateB, BLANK_QUESTION } = require('./lib/templates');
const { buildWorkbook, buildFileName } = require('./lib/excel');

const PORT = Number(process.env.PORT) || 6767;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'fki2026';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

const app = express();
app.use(express.json({ limit: '2mb' }));

// PUBLIC_DIR로 cloud/public을 가리키면 배포판 프론트엔드를 로컬 데이터로 검증할 수 있다.
const PUBLIC_DIR = path.resolve(__dirname, process.env.PUBLIC_DIR || 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/* ------------------------------------------------------------------ *
 * 최초 실행 시 A형·B형 기본 설문을 심는다.
 * ------------------------------------------------------------------ */
if (!store.getSurveys().length) {
  store.upsertSurvey(templateA());
  store.upsertSurvey(templateB());
}

/* ------------------------------------------------------------------ *
 * 관리자 인증 (메모리 토큰)
 * ------------------------------------------------------------------ */
const tokens = new Map();

function issueToken() {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const expires = token && tokens.get(token);
  if (!expires || expires < Date.now()) {
    tokens.delete(token);
    return res.status(401).json({ error: '관리자 인증이 필요합니다.' });
  }
  next();
}

/* ------------------------------------------------------------------ *
 * 실시간 응답 수 (SSE)
 * ------------------------------------------------------------------ */
const streams = new Set();

function countsSnapshot() {
  const counts = {};
  store.getSurveys().forEach((s) => {
    counts[s.id] = store.countFor(s.id);
  });
  return counts;
}

function broadcastCounts() {
  const payload = `data: ${JSON.stringify({ counts: countsSnapshot() })}\n\n`;
  streams.forEach((res) => {
    try {
      res.write(payload);
    } catch {
      streams.delete(res);
    }
  });
}

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ counts: countsSnapshot() })}\n\n`);
  streams.add(res);

  const beat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* 연결 정리는 close 핸들러가 담당 */
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(beat);
    streams.delete(res);
  });
});

/* ------------------------------------------------------------------ *
 * 응답자용 API
 * ------------------------------------------------------------------ */
// 배포판(Cloudflare)과 동일한 경량 카운트 엔드포인트.
app.get('/api/public/counts', (req, res) => {
  res.json({ counts: countsSnapshot() });
});

app.get('/api/public/surveys', (req, res) => {
  const list = store
    .getSurveys()
    .filter((s) => s.active !== false)
    .map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      intro: s.intro,
      questionCount: s.sections.reduce((n, sec) => n + sec.questions.length, 0),
      sectionCount: s.sections.length,
      count: store.countFor(s.id),
    }));
  res.json({ surveys: list });
});

app.get('/api/public/surveys/:id', (req, res) => {
  const survey = store.getSurvey(req.params.id);
  if (!survey || survey.active === false) {
    return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
  }
  res.json({ survey, count: store.countFor(survey.id) });
});

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value).every((v) => v == null || v === '');
  }
  return false;
}

app.post('/api/public/surveys/:id/responses', (req, res) => {
  const survey = store.getSurvey(req.params.id);
  if (!survey || survey.active === false) {
    return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
  }

  const answers = req.body?.answers || {};
  const missing = [];

  survey.sections.forEach((sec) => {
    sec.questions.forEach((question) => {
      if (!question.required) return;
      const value = answers[question.id];
      if (question.type === 'lecture') {
        const needScore = question.useScore !== false;
        const needRec = question.useRecommend !== false;
        const ok =
          value &&
          (!needScore || value.score != null && value.score !== '') &&
          (!needRec || !!value.recommend);
        if (!ok) missing.push(question.title);
        return;
      }
      if (isBlank(value)) missing.push(question.title);
    });
  });

  if (survey.collectName && !String(req.body?.respondent?.name || '').trim()) {
    missing.push('이름');
  }

  if (missing.length) {
    return res.status(400).json({ error: '필수 문항이 비어 있습니다.', missing });
  }

  const response = {
    id: store.id('res'),
    surveyId: survey.id,
    submittedAt: new Date().toISOString(),
    respondent: { name: String(req.body?.respondent?.name || '').trim() },
    answers,
  };

  store.addResponse(response);
  broadcastCounts();

  res.json({ ok: true, count: store.countFor(survey.id), outro: survey.outro || '' });
});

/* ------------------------------------------------------------------ *
 * 관리자 API
 * ------------------------------------------------------------------ */
app.post('/api/admin/login', (req, res) => {
  if (String(req.body?.password || '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
  }
  res.json({ token: issueToken() });
});

app.get('/api/admin/surveys', requireAdmin, (req, res) => {
  const surveys = store.getSurveys().map((s) => ({ ...s, count: store.countFor(s.id) }));
  res.json({ surveys });
});

app.post('/api/admin/surveys', requireAdmin, (req, res) => {
  const from = req.body?.from;
  let survey;
  if (from === 'A') survey = templateA();
  else if (from === 'B') survey = templateB();
  else {
    survey = {
      id: store.id('sv'),
      type: req.body?.type === 'A' ? 'A' : 'B',
      title: '새 설문',
      intro: '',
      outro: '응답해 주셔서 감사합니다.',
      active: true,
      collectName: false,
      sections: [{ id: store.id('sec'), title: '섹션 1', desc: '', questions: [] }],
    };
  }
  if (req.body?.title) survey.title = req.body.title;
  res.json({ survey: store.upsertSurvey(survey) });
});

app.put('/api/admin/surveys/:id', requireAdmin, (req, res) => {
  const existing = store.getSurvey(req.params.id);
  if (!existing) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

  const incoming = req.body?.survey;
  if (!incoming || !Array.isArray(incoming.sections)) {
    return res.status(400).json({ error: '설문 형식이 올바르지 않습니다.' });
  }

  // 문항/보기에 id가 없으면 채워 넣는다 (관리자 화면에서 새로 추가한 항목).
  incoming.sections.forEach((sec) => {
    if (!sec.id) sec.id = store.id('sec');
    sec.questions = Array.isArray(sec.questions) ? sec.questions : [];
    sec.questions.forEach((question) => {
      if (!question.id) question.id = store.id('q');
      if (!Array.isArray(question.options)) question.options = [];
    });
  });

  const survey = store.upsertSurvey({ ...existing, ...incoming, id: existing.id });
  broadcastCounts();
  res.json({ survey });
});

app.delete('/api/admin/surveys/:id', requireAdmin, (req, res) => {
  store.deleteSurvey(req.params.id);
  broadcastCounts();
  res.json({ ok: true });
});

app.get('/api/admin/surveys/:id/responses', requireAdmin, (req, res) => {
  const survey = store.getSurvey(req.params.id);
  if (!survey) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
  res.json({ responses: store.responsesFor(survey.id) });
});

app.delete('/api/admin/surveys/:id/responses', requireAdmin, (req, res) => {
  store.clearResponses(req.params.id);
  broadcastCounts();
  res.json({ ok: true });
});

app.get('/api/admin/surveys/:id/export.xlsx', requireAdmin, async (req, res) => {
  const survey = store.getSurvey(req.params.id);
  if (!survey) return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });

  const responses = store
    .responsesFor(survey.id)
    .slice()
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));

  const wb = await buildWorkbook(survey, responses);
  const fileName = buildFileName(survey);
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');

  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
      fileName
    )}`,
    'Cache-Control': 'no-store',
  });

  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/admin/question-types', requireAdmin, (req, res) => {
  res.json({ types: Object.keys(BLANK_QUESTION) });
});

/* ------------------------------------------------------------------ */
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => {
    (list || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

app.listen(PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '  FKI 한경협국제경영원 인재교육사업실 — 설문 시스템',
    '  ─────────────────────────────────────────────',
    `  응답자 화면 : http://localhost:${PORT}/`,
    `  관리자 화면 : http://localhost:${PORT}/admin  (비밀번호: ${ADMIN_PASSWORD})`,
  ];
  lanAddresses().forEach((ip) => lines.push(`  모바일 접속 : http://${ip}:${PORT}/`));
  lines.push('');
  console.log(lines.join('\n'));
});
