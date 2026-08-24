'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  surveys: path.join(DATA_DIR, 'surveys.json'),
  responses: path.join(DATA_DIR, 'responses.json'),
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    // 윈도우 메모장이나 PowerShell로 저장하면 BOM이 붙는다. JSON.parse는 이를 못 읽는다.
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Writes go through a per-file promise chain so two concurrent submissions
// can never interleave a read-modify-write on the same file.
const queues = new Map();
function enqueue(file, job) {
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.then(job, job);
  queues.set(file, next.catch(() => {}));
  return next;
}

function writeJsonSync(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const cache = {
  surveys: readJson(FILES.surveys, null),
  responses: readJson(FILES.responses, null),
};

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/* ---------------- surveys ---------------- */

function getSurveys() {
  return cache.surveys || [];
}

function getSurvey(surveyId) {
  return getSurveys().find((s) => s.id === surveyId) || null;
}

function saveSurveys(list) {
  cache.surveys = list;
  return enqueue(FILES.surveys, () => writeJsonSync(FILES.surveys, list));
}

function upsertSurvey(survey) {
  const list = getSurveys().slice();
  const idx = list.findIndex((s) => s.id === survey.id);
  const now = new Date().toISOString();
  const next = { ...survey, updatedAt: now };
  if (idx >= 0) {
    next.createdAt = list[idx].createdAt || now;
    list[idx] = next;
  } else {
    next.createdAt = now;
    list.push(next);
  }
  saveSurveys(list);
  return next;
}

function deleteSurvey(surveyId) {
  saveSurveys(getSurveys().filter((s) => s.id !== surveyId));
  const kept = getResponses().filter((r) => r.surveyId !== surveyId);
  saveResponses(kept);
}

/* ---------------- responses ---------------- */

function getResponses() {
  return cache.responses || [];
}

function saveResponses(list) {
  cache.responses = list;
  return enqueue(FILES.responses, () => writeJsonSync(FILES.responses, list));
}

function addResponse(response) {
  const list = getResponses().slice();
  list.push(response);
  saveResponses(list);
  return response;
}

function responsesFor(surveyId) {
  return getResponses().filter((r) => r.surveyId === surveyId);
}

function countFor(surveyId) {
  return responsesFor(surveyId).length;
}

function clearResponses(surveyId) {
  saveResponses(getResponses().filter((r) => r.surveyId !== surveyId));
}

module.exports = {
  DATA_DIR,
  id,
  getSurveys,
  getSurvey,
  saveSurveys,
  upsertSurvey,
  deleteSurvey,
  getResponses,
  addResponse,
  responsesFor,
  countFor,
  clearResponses,
  _bootstrapped: cache.surveys !== null,
};
