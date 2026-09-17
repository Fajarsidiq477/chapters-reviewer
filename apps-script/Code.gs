/**
 * Chapter Review Quiz - backend for a Google Sheet acting as the quiz database.
 * Deploy this as a Web App (container-bound to the Sheet) and paste the
 * deployment URL into js/config.js on the GitHub Pages site.
 *
 * Sheet tabs expected (see setupSheets() and /setup/*.csv):
 *   Config          PacketCode | PacketTitle | JSONFile | Active | TimeLimitMinutes | GradingMode | QuestionLimit
 *   AnswerKeys      PacketCode | QuestionID | Section | Type | CorrectAnswer | Points | Keywords
 *   Results         Timestamp | FullName | Class | PacketCode | ObjectiveScore | ObjectiveMax | EssaySection | EssayMax | EssayScore | FinalScore | TimeTakenSeconds
 *   EssayResponses  Timestamp | FullName | Class | PacketCode | QuestionID | StudentAnswer | ModelAnswer | MaxPoints | ScoreAwarded | GradingSource | Feedback
 *   ActiveSessions  FullName | Class | PacketCode | SelectedQuestionIds | AssignedAt
 *
 * QuestionLimit (Config, optional): if set (>0) and less than the packet's total
 * question count, each student is randomly assigned that many questions the first
 * time they validate their code, sampled proportionally across sections so a short
 * review still touches every question type. The assignment is stored in
 * ActiveSessions so it stays identical across a resume and is what grading uses
 * (not whatever the client sends back), regardless of QuestionLimit.
 *
 * GradingMode (Config) now accepts a third value, 'ai': essay/structured answers
 * are graded by Gemini, called with the STUDENT's own free API key (sent once in
 * their submit request, never stored) so no teacher API key/billing is needed.
 * The model answer stays server-side as before - only the grading call leaves the
 * server, using UrlFetchApp, not the browser, so the answer key is never exposed
 * to the client. See gradeEssayWithGemini() and GEMINI_MODEL below.
 *
 * Admin dashboard (admin.html on the site): reads results via the 'adminResults'
 * action and can overwrite one essay score via 'adminUpdateEssayScore', both
 * gated by an ADMIN_PASSWORD you set yourself in Project Settings > Script
 * Properties (never put the password in this file). See checkAdminPassword().
 */

var GEMINI_MODEL = 'gemini-3.6-flash'; // update if Google renames/retires this free-tier model

var SHEET_NAMES = {
  CONFIG: 'Config',
  ANSWER_KEYS: 'AnswerKeys',
  RESULTS: 'Results',
  ESSAY_RESPONSES: 'EssayResponses',
  ACTIVE_SESSIONS: 'ActiveSessions'
};

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'validate') {
    return jsonOutput(validateToken(e.parameter));
  }
  return jsonOutput({ success: false, error: 'unknown_action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ success: false, error: 'bad_request' });
  }
  if (body.action === 'submit') {
    return jsonOutput(submitQuiz(body));
  }
  if (body.action === 'adminResults') {
    return jsonOutput(adminGetResults(body));
  }
  if (body.action === 'adminUpdateEssayScore') {
    return jsonOutput(adminUpdateEssayScore(body));
  }
  return jsonOutput({ success: false, error: 'unknown_action' });
}

/**
 * Checks a submitted password against the ADMIN_PASSWORD script property.
 * Set this once via the Apps Script editor: Project Settings (gear icon) >
 * Script Properties > Add property. Never commit the password into Code.gs.
 */
function checkAdminPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!stored) return false;
  return norm(password) === stored;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function norm(value) {
  return (value === undefined || value === null) ? '' : value.toString().trim();
}

function normLower(value) {
  return norm(value).toLowerCase();
}

/** Reads Config tab into an array of row objects. */
function readConfigRows() {
  var sheet = getSheet(SHEET_NAMES.CONFIG);
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!norm(r[0])) continue;
    out.push({
      packetCode: norm(r[0]),
      title: norm(r[1]),
      jsonFile: norm(r[2]),
      active: (r[3] === true) || (normLower(r[3]) === 'true'),
      timeLimitMinutes: Number(r[4]) || 30,
      gradingMode: ['auto', 'ai'].indexOf(normLower(r[5])) !== -1 ? normLower(r[5]) : 'manual',
      questionLimit: Number(r[6]) || 0
    });
  }
  return out;
}

function findConfigByCode(code) {
  var rows = readConfigRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].packetCode.toLowerCase() === code.toLowerCase()) return rows[i];
  }
  return null;
}

/** Checks the Results tab for an existing submission by this student for this packet. */
function hasExistingSubmission(fullName, className, packetCode) {
  var sheet = getSheet(SHEET_NAMES.RESULTS);
  var rows = sheet.getDataRange().getValues();
  var fn = normLower(fullName), cl = normLower(className), pc = normLower(packetCode);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[1]) === fn && normLower(r[2]) === cl && normLower(r[3]) === pc) return true;
  }
  return false;
}

/** Looks up a previously-assigned question subset for this student+packet, if any. Returns an array of ids, or null. */
function getAssignedQuestionIds(fullName, className, packetCode) {
  var sheet = getSheet(SHEET_NAMES.ACTIVE_SESSIONS);
  var rows = sheet.getDataRange().getValues();
  var fn = normLower(fullName), cl = normLower(className), pc = normLower(packetCode);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[0]) === fn && normLower(r[1]) === cl && normLower(r[2]) === pc) {
      var ids = norm(r[3]).split(',').map(function (id) { return id.trim(); }).filter(Boolean);
      return ids.length > 0 ? ids : null;
    }
  }
  return null;
}

function recordAssignedQuestionIds(fullName, className, packetCode, ids) {
  var sheet = getSheet(SHEET_NAMES.ACTIVE_SESSIONS);
  sheet.appendRow([fullName, className, packetCode, ids.join(','), new Date()]);
}

function shuffle(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

/**
 * Randomly samples `limit` question ids out of this packet's AnswerKeys rows,
 * proportionally across each Section value so short reviews still cover every
 * question type. Returns null if limit is 0/unset or >= the total question count
 * (meaning: no limiting needed, use every question).
 */
function sampleQuestionIds(packetCode, limit) {
  var keyRows = readAnswerKeyRows(packetCode);
  if (!limit || limit <= 0 || limit >= keyRows.length) return null;

  var bySection = {};
  var sectionOrder = [];
  keyRows.forEach(function (k) {
    if (!bySection[k.section]) {
      bySection[k.section] = [];
      sectionOrder.push(k.section);
    }
    bySection[k.section].push(k.questionId);
  });

  var total = keyRows.length;
  var targets = sectionOrder.map(function (section) {
    var groupSize = bySection[section].length;
    return { section: section, raw: (limit * groupSize) / total, count: 0 };
  });
  targets.forEach(function (t) { t.count = Math.floor(t.raw); });

  var assigned = targets.reduce(function (sum, t) { return sum + t.count; }, 0);
  var remainder = limit - assigned;
  targets.sort(function (a, b) { return (b.raw - b.count) - (a.raw - a.count); });
  for (var i = 0; i < remainder && i < targets.length; i++) {
    targets[i].count++;
  }

  var selected = [];
  targets.forEach(function (t) {
    var pool = shuffle(bySection[t.section].slice());
    var take = Math.min(t.count, pool.length);
    selected = selected.concat(pool.slice(0, take));
  });

  return selected;
}

function validateToken(params) {
  var code = norm(params.code);
  var fullName = norm(params.fullName);
  var className = norm(params.class);

  if (!code || !fullName || !className) {
    return { success: false, error: 'missing_fields' };
  }

  var config = findConfigByCode(code);
  if (!config) {
    return { success: false, error: 'invalid_code' };
  }
  if (!config.active) {
    return { success: false, error: 'inactive_code' };
  }
  if (hasExistingSubmission(fullName, className, config.packetCode)) {
    return { success: false, error: 'already_submitted' };
  }

  var selectedQuestionIds = null;
  if (config.questionLimit > 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      selectedQuestionIds = getAssignedQuestionIds(fullName, className, config.packetCode);
      if (!selectedQuestionIds) {
        selectedQuestionIds = sampleQuestionIds(config.packetCode, config.questionLimit);
        if (selectedQuestionIds) {
          recordAssignedQuestionIds(fullName, className, config.packetCode, selectedQuestionIds);
        }
      }
    } finally {
      lock.releaseLock();
    }
  }

  return {
    success: true,
    packetCode: config.packetCode,
    title: config.title,
    jsonFile: config.jsonFile,
    timeLimitMinutes: config.timeLimitMinutes,
    gradingMode: config.gradingMode,
    selectedQuestionIds: selectedQuestionIds
  };
}

/** Loose match for short-recall answers: normalizes punctuation/case and checks containment or word overlap. */
function looseMatch(student, correct) {
  var a = normLower(student).replace(/[^a-z0-9\s]/g, '').trim();
  var b = normLower(correct).replace(/[^a-z0-9\s]/g, '').trim();
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;

  var aWords = a.split(/\s+/).filter(function (w) { return w.length > 2; });
  var bWords = b.split(/\s+/).filter(function (w) { return w.length > 2; });
  if (bWords.length === 0) return false;
  var common = 0;
  for (var i = 0; i < bWords.length; i++) {
    if (aWords.indexOf(bWords[i]) !== -1) common++;
  }
  return (common / bWords.length) >= 0.6;
}

/** Best-effort keyword-overlap score for auto-graded essay answers. */
function keywordScore(student, keywordsStr, maxPoints) {
  var keywords = norm(keywordsStr).split(',').map(function (k) { return k.trim().toLowerCase(); }).filter(Boolean);
  if (keywords.length === 0) return 0;
  var text = normLower(student);
  if (!text) return 0;
  var matched = 0;
  for (var i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) !== -1) matched++;
  }
  var ratio = matched / keywords.length;
  return Math.round(ratio * maxPoints * 2) / 2; // round to nearest 0.5
}

/**
 * Grades one essay answer using Gemini, called with the student's own API key.
 * Retries automatically on HTTP 503/429 (Google's own error text says these are
 * "usually temporary") with short backoff, since free-tier keys hit these under
 * load fairly often. Fails fast (no retry) on anything else - a bad key or a
 * malformed response won't be fixed by trying again. Throws after exhausting
 * retries - caller must catch and fall back to manual review.
 */
function gradeEssayWithGemini(apiKey, modelAnswer, maxPoints, studentAnswer) {
  var backoffMs = [0, 1000, 2500];
  var lastError;
  for (var attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt]) Utilities.sleep(backoffMs[attempt]);
    try {
      return gradeEssayWithGeminiOnce(apiKey, modelAnswer, maxPoints, studentAnswer);
    } catch (err) {
      lastError = err;
      if (!err.retryable) throw err;
    }
  }
  throw lastError;
}

function gradeEssayWithGeminiOnce(apiKey, modelAnswer, maxPoints, studentAnswer) {
  var prompt = 'You are grading a student\'s short written answer for an ICT (IGCSE-style) class.\n' +
    'Marking guide / model answer: ' + modelAnswer + '\n' +
    'Maximum marks available: ' + maxPoints + '\n' +
    'Student\'s answer: ' + (studentAnswer || '(no answer given)') + '\n\n' +
    'Award a score out of ' + maxPoints + ' based on how well the student\'s answer covers the key points in the marking guide. Give partial credit for partially correct answers. ' +
    'Respond with ONLY JSON in this exact shape: {"score": <number from 0 to ' + maxPoints + '>, "feedback": "<one short sentence explaining the score>"}';

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    var code = res.getResponseCode();
    var httpErr = new Error('Gemini API HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
    httpErr.retryable = (code === 503 || code === 429);
    throw httpErr;
  }

  var data = JSON.parse(res.getContentText());
  var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini API returned no content (possibly blocked by safety filters)');

  var parsed = JSON.parse(text);
  var score = Number(parsed.score);
  if (isNaN(score)) throw new Error('Gemini API returned a non-numeric score');
  score = Math.max(0, Math.min(maxPoints, score));

  return { score: Math.round(score * 2) / 2, feedback: norm(parsed.feedback).slice(0, 500) };
}

function readAnswerKeyRows(packetCode) {
  var sheet = getSheet(SHEET_NAMES.ANSWER_KEYS);
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[0]) !== normLower(packetCode)) continue;
    out.push({
      questionId: norm(r[1]),
      section: norm(r[2]),
      type: normLower(r[3]),
      correctAnswer: norm(r[4]),
      points: Number(r[5]) || 0,
      keywords: norm(r[6])
    });
  }
  return out;
}

function submitQuiz(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var fullName = norm(body.fullName);
    var className = norm(body.class);
    var packetCode = norm(body.packetCode);
    var answers = body.answers || {};
    var timeTakenSeconds = Number(body.timeTakenSeconds) || 0;
    var geminiApiKey = norm(body.geminiApiKey);

    if (!fullName || !className || !packetCode) {
      return { success: false, error: 'missing_fields' };
    }
    if (hasExistingSubmission(fullName, className, packetCode)) {
      return { success: false, error: 'already_submitted' };
    }

    var config = findConfigByCode(packetCode);
    if (!config) {
      return { success: false, error: 'invalid_code' };
    }

    var keyRows = readAnswerKeyRows(packetCode);
    if (config.questionLimit > 0) {
      var assignedIds = getAssignedQuestionIds(fullName, className, packetCode);
      if (assignedIds) {
        var assignedSet = {};
        assignedIds.forEach(function (id) { assignedSet[id] = true; });
        keyRows = keyRows.filter(function (k) { return assignedSet[k.questionId]; });
      }
    }
    var objectiveScore = 0, objectiveMax = 0;
    var essayMax = 0, hasEssay = false, essayCount = 0;
    var essayRowsToWrite = [];
    var essayScoreTotal = 0;
    var aiGradedCount = 0;

    for (var i = 0; i < keyRows.length; i++) {
      var key = keyRows[i];
      var studentAnswer = norm(answers[key.questionId]);

      if (key.type === 'mcq' || key.type === 'truefalse') {
        objectiveMax += key.points;
        if (normLower(studentAnswer) === normLower(key.correctAnswer)) {
          objectiveScore += key.points;
        }
      } else if (key.type === 'fill' || key.type === 'short') {
        objectiveMax += key.points;
        if (looseMatch(studentAnswer, key.correctAnswer)) {
          objectiveScore += key.points;
        }
      } else if (key.type === 'essay') {
        hasEssay = true;
        essayCount++;
        essayMax += key.points;
        var scoreAwarded = '';
        var gradingSource = 'Manual';
        var feedback = '';

        if (config.gradingMode === 'auto') {
          scoreAwarded = keywordScore(studentAnswer, key.keywords, key.points);
          gradingSource = 'Keyword';
          essayScoreTotal += scoreAwarded;
        } else if (config.gradingMode === 'ai') {
          if (geminiApiKey) {
            try {
              var graded = gradeEssayWithGemini(geminiApiKey, key.correctAnswer, key.points, studentAnswer);
              scoreAwarded = graded.score;
              feedback = graded.feedback;
              gradingSource = 'AI';
              essayScoreTotal += scoreAwarded;
              aiGradedCount++;
            } catch (aiErr) {
              feedback = 'AI grading failed: ' + aiErr.message;
              gradingSource = 'Manual (AI failed)';
            }
          } else {
            feedback = 'No API key was provided.';
            gradingSource = 'Manual (no API key)';
          }
        }

        essayRowsToWrite.push([
          new Date(), fullName, className, packetCode,
          key.questionId, studentAnswer, key.correctAnswer, key.points,
          scoreAwarded, gradingSource, feedback
        ]);
      }
    }

    if (essayRowsToWrite.length > 0) {
      var essaySheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
      essaySheet.getRange(essaySheet.getLastRow() + 1, 1, essayRowsToWrite.length, 11).setValues(essayRowsToWrite);
    }

    var essaySectionStatus = 'N/A';
    if (hasEssay) {
      if (config.gradingMode === 'auto') {
        essaySectionStatus = 'Auto-Estimated';
      } else if (config.gradingMode === 'ai') {
        if (aiGradedCount === essayCount) essaySectionStatus = 'AI-Graded';
        else if (aiGradedCount > 0) essaySectionStatus = 'AI-Graded (partial - some pending review)';
        else essaySectionStatus = 'Pending Review';
      } else {
        essaySectionStatus = 'Pending Review';
      }
    }

    var resultsSheet = getSheet(SHEET_NAMES.RESULTS);
    resultsSheet.appendRow([
      new Date(), fullName, className, packetCode,
      objectiveScore, objectiveMax, essaySectionStatus, essayMax,
      '', '', timeTakenSeconds
    ]);
    var lastRow = resultsSheet.getLastRow();
    // EssayScore (col I / 9): live SUMIFS against EssayResponses so manual grades update automatically.
    resultsSheet.getRange(lastRow, 9).setFormula(
      '=IFERROR(SUMIFS(EssayResponses!I:I, EssayResponses!B:B, B' + lastRow + ', EssayResponses!C:C, C' + lastRow + ', EssayResponses!D:D, D' + lastRow + '),0)'
    );
    // FinalScore (col J / 10) = ObjectiveScore (E) + EssayScore (I).
    resultsSheet.getRange(lastRow, 10).setFormula('=E' + lastRow + '+I' + lastRow);

    return {
      success: true,
      objectiveScore: objectiveScore,
      objectiveMax: objectiveMax,
      essaySectionStatus: essaySectionStatus,
      essayScore: hasEssay && (config.gradingMode === 'auto' || aiGradedCount > 0) ? essayScoreTotal : null,
      essayMax: essayMax
    };
  } finally {
    lock.releaseLock();
  }
}

/** Returns every Results row (optionally filtered to one packet), each with its essay Q&A attached, for the admin dashboard. */
function adminGetResults(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }

  var packetFilter = norm(body.packetCode);

  var essaySheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
  var essayRows = essaySheet.getDataRange().getValues();
  var essayByKey = {};
  for (var i = 1; i < essayRows.length; i++) {
    var er = essayRows[i];
    if (!norm(er[1])) continue;
    var key = normLower(er[1]) + '|' + normLower(er[2]) + '|' + normLower(er[3]);
    if (!essayByKey[key]) essayByKey[key] = [];
    essayByKey[key].push({
      questionId: norm(er[4]),
      studentAnswer: norm(er[5]),
      modelAnswer: norm(er[6]),
      maxPoints: Number(er[7]) || 0,
      scoreAwarded: er[8] === '' ? null : Number(er[8]),
      gradingSource: norm(er[9]),
      feedback: norm(er[10])
    });
  }

  var resultsSheet = getSheet(SHEET_NAMES.RESULTS);
  var resultRows = resultsSheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < resultRows.length; i++) {
    var r = resultRows[i];
    if (!norm(r[1])) continue;
    var packetCode = norm(r[3]);
    if (packetFilter && normLower(packetCode) !== normLower(packetFilter)) continue;

    var key = normLower(r[1]) + '|' + normLower(r[2]) + '|' + normLower(packetCode);
    results.push({
      timestamp: (r[0] instanceof Date) ? r[0].toISOString() : norm(r[0]),
      fullName: norm(r[1]),
      className: norm(r[2]),
      packetCode: packetCode,
      objectiveScore: Number(r[4]) || 0,
      objectiveMax: Number(r[5]) || 0,
      essaySection: norm(r[6]),
      essayMax: Number(r[7]) || 0,
      essayScore: Number(r[8]) || 0,
      finalScore: Number(r[9]) || 0,
      timeTakenSeconds: Number(r[10]) || 0,
      essays: essayByKey[key] || []
    });
  }
  results.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  var packets = readConfigRows().map(function (c) { return { packetCode: c.packetCode, title: c.title }; });

  return { success: true, results: results, packets: packets };
}

/** Overwrites one essay question's ScoreAwarded (and marks it as a manual override) from the admin dashboard. */
function adminUpdateEssayScore(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }

  var fullName = norm(body.fullName);
  var className = norm(body.class);
  var packetCode = norm(body.packetCode);
  var questionId = norm(body.questionId);
  var score = Number(body.score);

  if (!fullName || !className || !packetCode || !questionId || isNaN(score)) {
    return { success: false, error: 'missing_fields' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (normLower(r[1]) === normLower(fullName) && normLower(r[2]) === normLower(className) &&
        normLower(r[3]) === normLower(packetCode) && norm(r[4]) === questionId) {
        sheet.getRange(i + 1, 9).setValue(score);
        sheet.getRange(i + 1, 10).setValue('Manual (override)');
        return { success: true };
      }
    }
    return { success: false, error: 'not_found' };
  } finally {
    lock.releaseLock();
  }
}

/** Run this once from the Apps Script editor (Run > setupSheets) to create the tabs with headers. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var specs = [
    { name: SHEET_NAMES.CONFIG, headers: ['PacketCode', 'PacketTitle', 'JSONFile', 'Active', 'TimeLimitMinutes', 'GradingMode', 'QuestionLimit'] },
    { name: SHEET_NAMES.ANSWER_KEYS, headers: ['PacketCode', 'QuestionID', 'Section', 'Type', 'CorrectAnswer', 'Points', 'Keywords'] },
    { name: SHEET_NAMES.RESULTS, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'ObjectiveScore', 'ObjectiveMax', 'EssaySection', 'EssayMax', 'EssayScore', 'FinalScore', 'TimeTakenSeconds'] },
    { name: SHEET_NAMES.ESSAY_RESPONSES, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'QuestionID', 'StudentAnswer', 'ModelAnswer', 'MaxPoints', 'ScoreAwarded', 'GradingSource', 'Feedback'] },
    { name: SHEET_NAMES.ACTIVE_SESSIONS, headers: ['FullName', 'Class', 'PacketCode', 'SelectedQuestionIds', 'AssignedAt'] }
  ];
  specs.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) sheet = ss.insertSheet(spec.name);
    if (sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
      sheet.setFrozenRows(1);
    }
  });
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    var isEmpty = defaultSheet.getDataRange().getA1Notation() === 'A1' && defaultSheet.getRange(1, 1).getValue() === '';
    if (isEmpty) ss.deleteSheet(defaultSheet);
  }
}
