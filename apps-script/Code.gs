/**
 * Chapter Review Quiz - backend for a Google Sheet acting as the quiz database.
 * Deploy this as a Web App (container-bound to the Sheet) and paste the
 * deployment URL into js/config.js on the GitHub Pages site.
 *
 * Sheet tabs expected (see setupSheets() and /setup/*.csv):
 *   Config          PacketCode | PacketTitle | JSONFile | Active | TimeLimitMinutes | GradingMode
 *   AnswerKeys      PacketCode | QuestionID | Section | Type | CorrectAnswer | Points | Keywords
 *   Results         Timestamp | FullName | Class | PacketCode | ObjectiveScore | ObjectiveMax | EssaySection | EssayMax | EssayScore | FinalScore | TimeTakenSeconds
 *   EssayResponses  Timestamp | FullName | Class | PacketCode | QuestionID | StudentAnswer | ModelAnswer | MaxPoints | ScoreAwarded | AutoEstimated
 */

var SHEET_NAMES = {
  CONFIG: 'Config',
  ANSWER_KEYS: 'AnswerKeys',
  RESULTS: 'Results',
  ESSAY_RESPONSES: 'EssayResponses'
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
  return jsonOutput({ success: false, error: 'unknown_action' });
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
      gradingMode: normLower(r[5]) === 'auto' ? 'auto' : 'manual'
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

  return {
    success: true,
    packetCode: config.packetCode,
    title: config.title,
    jsonFile: config.jsonFile,
    timeLimitMinutes: config.timeLimitMinutes,
    gradingMode: config.gradingMode
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
    var objectiveScore = 0, objectiveMax = 0;
    var essayMax = 0, hasEssay = false;
    var essayRowsToWrite = [];
    var essayScoreTotal = 0;

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
        essayMax += key.points;
        var scoreAwarded = '';
        var autoEstimated = false;
        if (config.gradingMode === 'auto') {
          scoreAwarded = keywordScore(studentAnswer, key.keywords, key.points);
          autoEstimated = true;
          essayScoreTotal += scoreAwarded;
        }
        essayRowsToWrite.push([
          new Date(), fullName, className, packetCode,
          key.questionId, studentAnswer, key.correctAnswer, key.points,
          scoreAwarded, autoEstimated
        ]);
      }
    }

    if (essayRowsToWrite.length > 0) {
      var essaySheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
      essaySheet.getRange(essaySheet.getLastRow() + 1, 1, essayRowsToWrite.length, 10).setValues(essayRowsToWrite);
    }

    var essaySectionStatus = !hasEssay ? 'N/A' : (config.gradingMode === 'auto' ? 'Auto-Estimated' : 'Pending Review');

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
      essayScore: hasEssay && config.gradingMode === 'auto' ? essayScoreTotal : null,
      essayMax: essayMax
    };
  } finally {
    lock.releaseLock();
  }
}

/** Run this once from the Apps Script editor (Run > setupSheets) to create the tabs with headers. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var specs = [
    { name: SHEET_NAMES.CONFIG, headers: ['PacketCode', 'PacketTitle', 'JSONFile', 'Active', 'TimeLimitMinutes', 'GradingMode'] },
    { name: SHEET_NAMES.ANSWER_KEYS, headers: ['PacketCode', 'QuestionID', 'Section', 'Type', 'CorrectAnswer', 'Points', 'Keywords'] },
    { name: SHEET_NAMES.RESULTS, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'ObjectiveScore', 'ObjectiveMax', 'EssaySection', 'EssayMax', 'EssayScore', 'FinalScore', 'TimeTakenSeconds'] },
    { name: SHEET_NAMES.ESSAY_RESPONSES, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'QuestionID', 'StudentAnswer', 'ModelAnswer', 'MaxPoints', 'ScoreAwarded', 'AutoEstimated'] }
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
