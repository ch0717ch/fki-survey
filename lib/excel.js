'use strict';

const ExcelJS = require('exceljs');

const INK = 'FF0B0B0C';
const GOLD = 'FFC9A227';
const GOLD_SOFT = 'FFF6EEDA';
const PAPER = 'FFFAF9F7';

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function localDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

/** Windows/Excel 금지문자와 공백을 정리해 파일명 조각으로 쓸 수 있게 만든다. */
function slug(text) {
  return (
    String(text || '설문')
      .replace(/[\\/:*?"<>|\[\]]/g, '')
      .replace(/\s+/g, '')
      .trim() || '설문'
  );
}

/** 요구 규격: 설문명_유형_날짜.xlsx */
function buildFileName(survey) {
  return `${slug(survey.title)}_${survey.type}형_${stamp()}.xlsx`;
}

/** 척도 문항의 환산점수. 첫 보기(가장 긍정)가 만점이 되도록 뒤집는다. */
function scaleScore(question, value) {
  const idx = question.options.indexOf(value);
  if (idx < 0) return null;
  return question.options.length - idx;
}

function flatQuestions(survey) {
  const out = [];
  survey.sections.forEach((sec) => {
    sec.questions.forEach((question) => out.push({ section: sec, question }));
  });
  return out;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: GOLD }, size: 11, name: '맑은 고딕' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: GOLD } },
      bottom: { style: 'thin', color: { argb: GOLD } },
      left: { style: 'thin', color: { argb: GOLD } },
      right: { style: 'thin', color: { argb: GOLD } },
    };
  });
  row.height = 42;
}

function autoWidth(sheet, min = 10, max = 46) {
  sheet.columns.forEach((col) => {
    let width = min;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const text = cell.value == null ? '' : String(cell.value);
      // 한글은 대략 2배 폭을 차지한다.
      const len = text.split('').reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
      width = Math.max(width, Math.min(max, len + 2));
    });
    col.width = width;
  });
}

async function buildWorkbook(survey, responses) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FKI 한경협국제경영원 인재교육사업실';
  wb.created = new Date();

  const items = flatQuestions(survey);

  /* ---------- Sheet 1: 응답 원본 ---------- */
  const raw = wb.addWorksheet('응답 원본', {
    views: [{ state: 'frozen', xSplit: survey.collectName ? 3 : 2, ySplit: 1 }],
  });

  const header = ['번호', '제출일시'];
  if (survey.collectName) header.push('이름');

  const columnPlan = [];
  items.forEach(({ section, question }) => {
    const label = `[${section.title}] ${question.title}`;
    if (question.type === 'lecture') {
      if (question.useScore !== false) {
        header.push(`${label} - 점수(100)`);
        columnPlan.push({ question, field: 'score' });
      }
      if (question.useRecommend !== false) {
        header.push(`${label} - 추천여부`);
        columnPlan.push({ question, field: 'recommend' });
      }
    } else if (question.type === 'scale') {
      header.push(label);
      columnPlan.push({ question, field: 'value' });
      header.push(`${label} - 환산점수`);
      columnPlan.push({ question, field: 'score' });
    } else {
      header.push(label);
      columnPlan.push({ question, field: 'value' });
    }
  });

  styleHeader(raw.addRow(header));

  responses.forEach((response, i) => {
    const line = [i + 1, localDateTime(response.submittedAt)];
    if (survey.collectName) line.push(response.respondent?.name || '');

    columnPlan.forEach(({ question, field }) => {
      const answer = response.answers?.[question.id];
      if (answer == null || answer === '') return line.push('');

      if (question.type === 'lecture') {
        if (field === 'score') return line.push(answer.score == null ? '' : Number(answer.score));
        return line.push(answer.recommend || '');
      }
      if (question.type === 'scale') {
        if (field === 'score') {
          const s = scaleScore(question, answer);
          return line.push(s == null ? '' : s);
        }
        return line.push(answer);
      }
      if (Array.isArray(answer)) return line.push(answer.join(', '));
      return line.push(answer);
    });

    const row = raw.addRow(line);
    row.alignment = { vertical: 'top', wrapText: true };
    if (i % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
      });
    }
  });

  autoWidth(raw);

  /* ---------- Sheet 2: 문항별 요약 ---------- */
  const sum = wb.addWorksheet('문항별 요약', { views: [{ state: 'frozen', ySplit: 1 }] });
  styleHeader(sum.addRow(['영역', '문항', '유형', '응답수', '평균', '분포 / 상세']));

  items.forEach(({ section, question }) => {
    const answers = responses
      .map((r) => r.answers?.[question.id])
      .filter((v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0));

    let typeLabel = '주관식';
    let avg = '';
    let detail = '';

    if (question.type === 'scale') {
      typeLabel = '척도';
      const scores = answers.map((v) => scaleScore(question, v)).filter((n) => n != null);
      if (scores.length) avg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2));
      detail = question.options
        .map((opt) => {
          const n = answers.filter((v) => v === opt).length;
          const pct = answers.length ? Math.round((n / answers.length) * 100) : 0;
          return `${opt} ${n}명(${pct}%)`;
        })
        .join(' / ');
    } else if (question.type === 'lecture') {
      typeLabel = '강연평가';
      const scores = answers.map((a) => Number(a.score)).filter((n) => Number.isFinite(n));
      if (scores.length) avg = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
      const yes = answers.filter((a) => a.recommend === '추천').length;
      const no = answers.filter((a) => a.recommend === '비추천').length;
      const total = yes + no;
      detail = total
        ? `추천 ${yes}명 / 비추천 ${no}명 (추천율 ${Math.round((yes / total) * 100)}%)`
        : '추천 응답 없음';
      if (question.meta?.professor) detail = `${question.meta.professor} · ${detail}`;
    } else if (question.type === 'single' || question.type === 'multi') {
      typeLabel = question.type === 'multi' ? '복수선택' : '객관식';
      const flat = answers.flatMap((v) => (Array.isArray(v) ? v : [v]));
      detail = question.options
        .map((opt) => `${opt} ${flat.filter((v) => v === opt).length}명`)
        .join(' / ');
    } else {
      detail = `${answers.length}건 응답 (원본 시트 참고)`;
    }

    const row = sum.addRow([section.title, question.title, typeLabel, answers.length, avg, detail]);
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell(5).font = { bold: true, color: { argb: 'FF8A6D14' } };
  });

  autoWidth(sum, 10, 60);
  sum.getColumn(6).width = 60;

  /* ---------- Sheet 3: 주관식 모음 ---------- */
  const openItems = items.filter(({ question }) => question.type === 'long' || question.type === 'short');
  if (openItems.length) {
    const text = wb.addWorksheet('주관식 응답', { views: [{ state: 'frozen', ySplit: 1 }] });
    const head = ['번호', '제출일시'];
    if (survey.collectName) head.push('이름');
    head.push('문항', '응답 내용');
    styleHeader(text.addRow(head));

    let n = 0;
    responses.forEach((response, i) => {
      openItems.forEach(({ question }) => {
        const value = response.answers?.[question.id];
        if (!value) return;
        n += 1;
        const line = [i + 1, localDateTime(response.submittedAt)];
        if (survey.collectName) line.push(response.respondent?.name || '');
        line.push(question.title, value);
        const row = text.addRow(line);
        row.alignment = { vertical: 'top', wrapText: true };
        if (n % 2 === 0) {
          row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_SOFT } };
          });
        }
      });
    });

    autoWidth(text, 10, 40);
    text.getColumn(head.length).width = 70;
  }

  return wb;
}

module.exports = { buildWorkbook, buildFileName, stamp };
