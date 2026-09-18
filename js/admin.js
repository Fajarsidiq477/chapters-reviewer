(function () {
  'use strict';

  var SESSION_KEY = 'admin_password';

  var screens = {
    gate: document.getElementById('screen-gate'),
    dashboard: document.getElementById('screen-dashboard')
  };

  var gateForm = document.getElementById('gate-form');
  var gateError = document.getElementById('gate-error');
  var btnGateUnlock = document.getElementById('btn-gate-unlock');

  var filterPacket = document.getElementById('filter-packet');
  var filterSearch = document.getElementById('filter-search');
  var btnRefresh = document.getElementById('btn-refresh');
  var btnLock = document.getElementById('btn-lock');
  var dashSummary = document.getElementById('dash-summary');
  var resultsTbody = document.getElementById('results-tbody');
  var emptyState = document.getElementById('empty-state');

  var navTabResults = document.getElementById('nav-tab-results');
  var navTabPackets = document.getElementById('nav-tab-packets');
  var viewResults = document.getElementById('view-results');
  var viewPackets = document.getElementById('view-packets');
  var packetsListView = document.getElementById('packets-list-view');
  var packetEditorView = document.getElementById('packet-editor-view');
  var packetsTbody = document.getElementById('packets-tbody');
  var inputNewPacketTitle = document.getElementById('input-new-packet-title');
  var btnNewPacket = document.getElementById('btn-new-packet');
  var newPacketError = document.getElementById('new-packet-error');
  var btnPacketBack = document.getElementById('btn-packet-back');
  var editorPacketCode = document.getElementById('editor-packet-code');
  var btnCopyCode = document.getElementById('btn-copy-code');
  var editorTitle = document.getElementById('editor-title');
  var editorActive = document.getElementById('editor-active');
  var editorTimeLimit = document.getElementById('editor-time-limit');
  var editorGradingMode = document.getElementById('editor-grading-mode');
  var editorQuestionLimit = document.getElementById('editor-question-limit');
  var editorStaticNote = document.getElementById('editor-static-note');
  var editorSaveError = document.getElementById('editor-save-error');
  var editorSaveFlash = document.getElementById('editor-save-flash');
  var editorQuestionsCard = document.getElementById('editor-questions-card');
  var editorQuestionsList = document.getElementById('editor-questions-list');
  var btnAddQuestion = document.getElementById('btn-add-question');
  var btnSavePacket = document.getElementById('btn-save-packet');

  var state = {
    adminPassword: '',
    results: [],
    packets: [],
    sortKey: 'timestamp',
    sortDir: 'desc'
  };

  var packetsState = { packets: [] };
  var editorState = null; // { packetCode, isStatic, meta, questions: [{id,type,text,options,correctAnswer,points,keywords}] } - flat list, each question owns its type

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function escapeHtml(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function postAdmin(action, extra) {
    var payload = { action: action, adminPassword: state.adminPassword };
    for (var k in extra) { if (extra.hasOwnProperty(k)) payload[k] = extra[k]; }
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  function formatDuration(seconds) {
    seconds = Number(seconds) || 0;
    var mm = Math.floor(seconds / 60);
    var ss = seconds % 60;
    return mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return escapeHtml(iso);
    return d.toLocaleString();
  }

  function packetTitle(code) {
    var match = state.packets.filter(function (p) { return p.packetCode === code; })[0];
    return match ? match.title : code;
  }

  function essayStatusBadge(status) {
    if (!status || status === 'N/A') return '<span class="badge badge-na">N/A</span>';
    if (status === 'Auto-Estimated') return '<span class="badge badge-keyword">Keyword</span>';
    if (status === 'AI-Graded') return '<span class="badge badge-ai">AI</span>';
    if (status.indexOf('partial') !== -1) return '<span class="badge badge-partial">AI (partial)</span>';
    return '<span class="badge badge-manual">Pending</span>';
  }

  function gradingSourceBadge(source) {
    var s = (source || '').toLowerCase();
    if (s === 'ai') return '<span class="badge badge-ai">AI</span>';
    if (s === 'keyword') return '<span class="badge badge-keyword">Keyword</span>';
    if (s.indexOf('override') !== -1) return '<span class="badge badge-manual">Manual override</span>';
    return '<span class="badge badge-manual">' + escapeHtml(source || 'Manual') + '</span>';
  }

  function loadResults() {
    return postAdmin('adminResults', { packetCode: filterPacket.value }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'unauthorized');
      state.results = data.results;
      state.packets = data.packets;
      populatePacketFilter();
      renderTable();
    });
  }

  function populatePacketFilter() {
    var current = filterPacket.value;
    var html = '<option value="">All packets</option>';
    state.packets.forEach(function (p) {
      html += '<option value="' + escapeHtml(p.packetCode) + '">' + escapeHtml(p.title) + '</option>';
    });
    filterPacket.innerHTML = html;
    filterPacket.value = current;
  }

  function getFiltered() {
    var q = filterSearch.value.trim().toLowerCase();
    var list = state.results;
    if (q) {
      list = list.filter(function (r) {
        return r.fullName.toLowerCase().indexOf(q) !== -1 || r.className.toLowerCase().indexOf(q) !== -1;
      });
    }
    var key = state.sortKey, dir = state.sortDir === 'asc' ? 1 : -1;
    list = list.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (key === 'timestamp') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return list;
  }

  function renderTable() {
    var list = getFiltered();
    resultsTbody.innerHTML = '';
    emptyState.hidden = list.length > 0;

    var totalFinal = 0, totalMax = 0;
    list.forEach(function (r, i) {
      totalFinal += r.finalScore;
      totalMax += (r.objectiveMax + r.essayMax);

      var hasEssays = r.essays.length > 0;
      var tr = document.createElement('tr');
      tr.className = 'result-row' + (hasEssays ? ' expandable' : '');
      tr.innerHTML =
        '<td>' + (hasEssays ? '<span class="expand-arrow">▸</span>' : '') + ' ' + escapeHtml(r.fullName) + '</td>' +
        '<td>' + escapeHtml(r.className) + '</td>' +
        '<td>' + escapeHtml(packetTitle(r.packetCode)) + '</td>' +
        '<td>' + r.objectiveScore + ' / ' + r.objectiveMax + '</td>' +
        '<td id="essay-cell-' + i + '">' + essayStatusBadge(r.essaySection) + (r.essayMax ? ' ' + r.essayScore + ' / ' + r.essayMax : '') + '</td>' +
        '<td id="final-cell-' + i + '"><strong>' + r.finalScore + '</strong> / ' + (r.objectiveMax + r.essayMax) + '</td>' +
        '<td>' + formatDuration(r.timeTakenSeconds) + '</td>' +
        '<td>' + formatDate(r.timestamp) + '</td>';
      resultsTbody.appendChild(tr);

      if (hasEssays) {
        var detailTr = document.createElement('tr');
        detailTr.className = 'essay-detail-row';
        detailTr.hidden = true;
        var detailTd = document.createElement('td');
        detailTd.colSpan = 8;
        detailTd.innerHTML = r.essays.map(function (essay) {
          return buildEssayItemHtml(i, essay);
        }).join('');
        detailTr.appendChild(detailTd);
        resultsTbody.appendChild(detailTr);

        tr.addEventListener('click', function () {
          detailTr.hidden = !detailTr.hidden;
          tr.classList.toggle('expanded', !detailTr.hidden);
        });

        r.essays.forEach(function (essay) {
          var saveBtn = detailTd.querySelector('#save-btn-' + i + '-' + essay.questionId);
          if (saveBtn) {
            saveBtn.addEventListener('click', function () {
              saveEssayScore(i, r, essay);
            });
          }
        });
      }
    });

    var pct = totalMax > 0 ? Math.round((totalFinal / totalMax) * 100) : 0;
    dashSummary.textContent = list.length + ' submission' + (list.length === 1 ? '' : 's') +
      (list.length > 0 ? ' — average ' + pct + '%' : '');
  }

  function buildEssayItemHtml(rowIndex, essay) {
    var scoreValue = (essay.scoreAwarded === null || essay.scoreAwarded === undefined) ? '' : essay.scoreAwarded;
    return '' +
      '<div class="essay-item">' +
      '<div class="essay-item-head"><span>' + escapeHtml(essay.questionId) + '</span>' +
      '<span id="source-' + rowIndex + '-' + essay.questionId + '">' + gradingSourceBadge(essay.gradingSource) + '</span></div>' +
      '<div class="essay-block"><span class="label">Student answer:</span>' + escapeHtml(essay.studentAnswer || '(no answer given)') + '</div>' +
      '<div class="essay-block"><span class="label">Model answer:</span>' + escapeHtml(essay.modelAnswer) + '</div>' +
      (essay.feedback ? '<div class="essay-block"><span class="label">Feedback:</span>' + escapeHtml(essay.feedback) + '</div>' : '') +
      '<div class="essay-grade-row">' +
      '<span class="label">Score:</span>' +
      '<input type="number" id="score-input-' + rowIndex + '-' + essay.questionId + '" value="' + scoreValue + '" min="0" max="' + essay.maxPoints + '" step="0.5">' +
      '<span>/ ' + essay.maxPoints + '</span>' +
      '<button type="button" class="btn-save" id="save-btn-' + rowIndex + '-' + essay.questionId + '">Save</button>' +
      '<span class="save-flash" id="flash-' + rowIndex + '-' + essay.questionId + '"></span>' +
      '</div>' +
      '</div>';
  }

  function saveEssayScore(rowIndex, result, essay) {
    var input = document.getElementById('score-input-' + rowIndex + '-' + essay.questionId);
    var flash = document.getElementById('flash-' + rowIndex + '-' + essay.questionId);
    var newScore = parseFloat(input.value);

    if (isNaN(newScore) || newScore < 0 || newScore > essay.maxPoints) {
      flash.className = 'save-flash err';
      flash.textContent = 'Enter 0-' + essay.maxPoints;
      return;
    }

    flash.className = 'save-flash';
    flash.textContent = 'Saving...';

    postAdmin('adminUpdateEssayScore', {
      fullName: result.fullName,
      class: result.className,
      packetCode: result.packetCode,
      questionId: essay.questionId,
      score: newScore
    }).then(function (data) {
      if (!data.success) {
        flash.className = 'save-flash err';
        flash.textContent = data.error === 'unauthorized' ? 'Session expired - reload and unlock again.' : 'Save failed.';
        return;
      }
      essay.scoreAwarded = newScore;
      essay.gradingSource = 'Manual (override)';
      result.essayScore = result.essays.reduce(function (sum, e) {
        return sum + (typeof e.scoreAwarded === 'number' ? e.scoreAwarded : 0);
      }, 0);
      result.finalScore = result.objectiveScore + result.essayScore;

      document.getElementById('source-' + rowIndex + '-' + essay.questionId).innerHTML = gradingSourceBadge(essay.gradingSource);
      document.getElementById('essay-cell-' + rowIndex).innerHTML = essayStatusBadge(result.essaySection) + (result.essayMax ? ' ' + result.essayScore + ' / ' + result.essayMax : '');
      document.getElementById('final-cell-' + rowIndex).innerHTML = '<strong>' + result.finalScore + '</strong> / ' + (result.objectiveMax + result.essayMax);

      flash.className = 'save-flash ok';
      flash.textContent = 'Saved';
      setTimeout(function () { flash.textContent = ''; }, 2500);
    }).catch(function () {
      flash.className = 'save-flash err';
      flash.textContent = 'Could not reach the server.';
    });
  }

  gateForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var password = document.getElementById('input-admin-password').value.trim();
    if (!password) return;

    state.adminPassword = password;
    btnGateUnlock.disabled = true;
    btnGateUnlock.textContent = 'Checking...';
    gateError.hidden = true;

    loadResults().then(function () {
      try { sessionStorage.setItem(SESSION_KEY, password); } catch (e2) { /* ignore */ }
      showScreen('dashboard');
    }).catch(function (err) {
      gateError.hidden = false;
      gateError.textContent = err.message === 'unauthorized' ? 'Incorrect password.' : 'Could not reach the server.';
    }).finally(function () {
      btnGateUnlock.disabled = false;
      btnGateUnlock.textContent = 'Unlock';
    });
  });

  btnRefresh.addEventListener('click', function () {
    loadResults();
  });

  btnLock.addEventListener('click', function () {
    state.adminPassword = '';
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    showScreen('gate');
  });

  filterPacket.addEventListener('change', function () {
    loadResults();
  });

  filterSearch.addEventListener('input', function () {
    renderTable();
  });

  document.querySelectorAll('#results-table th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      renderTable();
    });
  });

  // ---------- Packets management ----------

  function switchNav(name) {
    navTabResults.classList.toggle('active', name === 'results');
    navTabPackets.classList.toggle('active', name === 'packets');
    viewResults.hidden = name !== 'results';
    viewPackets.hidden = name !== 'packets';
    if (name === 'packets') {
      showPacketsList();
      loadPacketsList();
    }
  }

  navTabResults.addEventListener('click', function () { switchNav('results'); });
  navTabPackets.addEventListener('click', function () { switchNav('packets'); });

  function showPacketsList() {
    packetsListView.hidden = false;
    packetEditorView.hidden = true;
    editorState = null;
  }

  function showPacketEditor() {
    packetsListView.hidden = true;
    packetEditorView.hidden = false;
  }

  function loadPacketsList() {
    return postAdmin('adminListPackets', {}).then(function (data) {
      if (!data.success) throw new Error(data.error || 'unauthorized');
      packetsState.packets = data.packets;
      renderPacketsTable();
    });
  }

  function renderPacketsTable() {
    packetsTbody.innerHTML = '';
    packetsState.packets.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><code>' + escapeHtml(p.packetCode) + '</code></td>' +
        '<td>' + escapeHtml(p.title) + '</td>' +
        '<td>' + (p.active ? 'Yes' : 'No') + '</td>' +
        '<td>' + p.timeLimitMinutes + ' min</td>' +
        '<td>' + escapeHtml(p.gradingMode) + '</td>' +
        '<td>' + (p.isStatic ? 'Static file' : (p.questionCount + ' questions')) + '</td>' +
        '<td><button type="button" class="btn-secondary btn-edit-packet">Edit</button></td>';
      tr.querySelector('.btn-edit-packet').addEventListener('click', function () {
        openPacketEditor(p.packetCode);
      });
      packetsTbody.appendChild(tr);
    });
  }

  btnNewPacket.addEventListener('click', function () {
    var title = inputNewPacketTitle.value.trim();
    newPacketError.hidden = true;
    if (!title) {
      newPacketError.hidden = false;
      newPacketError.textContent = 'Enter a title for the new packet.';
      return;
    }
    btnNewPacket.disabled = true;
    postAdmin('adminCreatePacket', { title: title }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'create_failed');
      inputNewPacketTitle.value = '';
      return loadPacketsList().then(function () {
        openPacketEditor(data.packetCode);
      });
    }).catch(function (err) {
      newPacketError.hidden = false;
      newPacketError.textContent = 'Could not create packet: ' + err.message;
    }).finally(function () {
      btnNewPacket.disabled = false;
    });
  });

  btnPacketBack.addEventListener('click', function () {
    showPacketsList();
    renderPacketsTable();
  });

  function openPacketEditor(packetCode) {
    postAdmin('adminGetPacket', { packetCode: packetCode }).then(function (data) {
      if (!data.success) throw new Error(data.error || 'not_found');
      var p = data.packet;
      editorState = {
        packetCode: p.packetCode,
        isStatic: p.isStatic,
        meta: {
          title: p.title,
          active: p.active,
          timeLimitMinutes: p.timeLimitMinutes,
          gradingMode: p.gradingMode,
          questionLimit: p.questionLimit
        },
        questions: p.questions || []
      };
      renderPacketEditor();
      showPacketEditor();
    }).catch(function (err) {
      alert('Could not load packet: ' + err.message);
    });
  }

  function renderPacketEditor() {
    editorSaveError.hidden = true;
    editorSaveFlash.hidden = true;

    editorPacketCode.textContent = editorState.packetCode;
    editorTitle.value = editorState.meta.title;
    editorActive.value = editorState.meta.active ? 'true' : 'false';
    editorTimeLimit.value = editorState.meta.timeLimitMinutes;
    editorGradingMode.value = editorState.meta.gradingMode;
    editorQuestionLimit.value = editorState.meta.questionLimit || '';

    editorStaticNote.hidden = !editorState.isStatic;
    editorQuestionsCard.hidden = editorState.isStatic;
    editorQuestionsList.innerHTML = '';

    if (!editorState.isStatic) {
      editorState.questions.forEach(function (q, qIdx) {
        editorQuestionsList.appendChild(buildQuestionCard(q, qIdx));
      });
    }
  }

  btnCopyCode.addEventListener('click', function () {
    var code = editorState ? editorState.packetCode : '';
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).catch(function () { /* ignore */ });
    }
    btnCopyCode.textContent = 'Copied!';
    setTimeout(function () { btnCopyCode.textContent = 'Copy'; }, 1500);
  });

  var TYPE_LABELS = {
    mcq: 'Multiple Choice',
    truefalse: 'True / False',
    fill: 'Fill in the Blank',
    short: 'Scenario Short Answer',
    essay: 'Essay / Structured'
  };

  function makeBlankQuestion(type) {
    var q = { id: null, type: type, text: '', correctAnswer: '', points: 1, keywords: '' };
    if (type === 'mcq') q.options = { A: '', B: '', C: '', D: '' };
    if (type === 'truefalse') q.correctAnswer = 'TRUE';
    return q;
  }

  btnAddQuestion.addEventListener('click', function () {
    if (!editorState) return;
    editorState.questions.push(makeBlankQuestion('mcq'));
    renderPacketEditor();
  });

  function buildQuestionCard(q, qIdx) {
    var card = document.createElement('div');
    card.className = 'question-card';

    var headRow = document.createElement('div');
    headRow.className = 'question-card-head';

    var typeSelect = document.createElement('select');
    typeSelect.className = 'question-type-select';
    Object.keys(TYPE_LABELS).forEach(function (type) {
      var opt = document.createElement('option');
      opt.value = type;
      opt.textContent = TYPE_LABELS[type];
      if (q.type === type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', function (e) {
      var newType = e.target.value;
      if (newType === 'mcq' && !q.options) q.options = { A: '', B: '', C: '', D: '' };
      if (newType === 'truefalse' && ['TRUE', 'FALSE'].indexOf(q.correctAnswer) === -1) q.correctAnswer = 'TRUE';
      q.type = newType;
      renderPacketEditor();
    });
    headRow.appendChild(typeSelect);

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-delete-question';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', function () {
      editorState.questions.splice(qIdx, 1);
      renderPacketEditor();
    });
    headRow.appendChild(delBtn);
    card.appendChild(headRow);

    var textArea = document.createElement('textarea');
    textArea.rows = 2;
    textArea.placeholder = 'Question text';
    textArea.value = q.text;
    textArea.addEventListener('input', function (e) { q.text = e.target.value; });
    card.appendChild(textArea);

    if (q.type === 'mcq') {
      if (!q.options) q.options = { A: '', B: '', C: '', D: '' };
      var mcqGroupName = 'mcq-correct-' + qIdx;
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(function (letter) {
        if (!(letter in q.options)) return;
        card.appendChild(buildMcqOptionRow(q, letter, mcqGroupName));
      });
      var addOptBtn = document.createElement('button');
      addOptBtn.type = 'button';
      addOptBtn.className = 'btn-secondary';
      var nextLetter = ['A', 'B', 'C', 'D', 'E', 'F'].filter(function (l) { return !(l in q.options); })[0];
      if (nextLetter) {
        addOptBtn.textContent = '+ Option ' + nextLetter;
        addOptBtn.addEventListener('click', function () {
          q.options[nextLetter] = '';
          renderPacketEditor();
        });
        card.appendChild(addOptBtn);
      }
    } else if (q.type === 'truefalse') {
      var tfRow = document.createElement('div');
      tfRow.className = 'question-field-row';
      ['TRUE', 'FALSE'].forEach(function (val) {
        var label = document.createElement('label');
        label.style.margin = '0';
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'tf-' + qIdx;
        radio.checked = q.correctAnswer === val;
        radio.addEventListener('change', function () { q.correctAnswer = val; });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(' ' + val));
        tfRow.appendChild(label);
      });
      card.appendChild(tfRow);
    } else if (q.type === 'fill' || q.type === 'short') {
      var row = document.createElement('div');
      row.className = 'question-field-row';
      row.innerHTML = '<label>Correct answer:</label><input type="text">' +
        '<label>Points:</label><input type="text" class="points-input" inputmode="numeric">';
      var inputs = row.querySelectorAll('input');
      inputs[0].value = q.correctAnswer;
      inputs[0].addEventListener('input', function (e) { q.correctAnswer = e.target.value; });
      inputs[1].value = q.points;
      inputs[1].addEventListener('input', function (e) { q.points = e.target.value; });
      card.appendChild(row);
    } else if (q.type === 'essay') {
      var modelLabel = document.createElement('label');
      modelLabel.textContent = 'Model answer / marking guide';
      card.appendChild(modelLabel);
      var modelArea = document.createElement('textarea');
      modelArea.rows = 2;
      modelArea.value = q.correctAnswer;
      modelArea.addEventListener('input', function (e) { q.correctAnswer = e.target.value; });
      card.appendChild(modelArea);

      var essayRow = document.createElement('div');
      essayRow.className = 'question-field-row';
      essayRow.innerHTML = '<label>Marks:</label><input type="text" class="points-input" inputmode="numeric">' +
        '<label>Keywords (comma-separated, for Auto grading):</label><input type="text">';
      var essayInputs = essayRow.querySelectorAll('input');
      essayInputs[0].value = q.points;
      essayInputs[0].addEventListener('input', function (e) { q.points = e.target.value; });
      essayInputs[1].value = q.keywords;
      essayInputs[1].addEventListener('input', function (e) { q.keywords = e.target.value; });
      card.appendChild(essayRow);
    }

    return card;
  }

  function buildMcqOptionRow(q, letter, groupName) {
    var row = document.createElement('div');
    row.className = 'option-edit-row';
    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.checked = (q.correctAnswer || '').toUpperCase() === letter;
    radio.title = 'Mark ' + letter + ' as the correct answer';
    radio.addEventListener('change', function () { q.correctAnswer = letter; });

    var label = document.createElement('span');
    label.className = 'option-letter';
    label.textContent = letter;

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Option ' + letter + ' text';
    input.value = q.options[letter];
    input.addEventListener('input', function (e) { q.options[letter] = e.target.value; });

    row.appendChild(radio);
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  btnSavePacket.addEventListener('click', function () {
    if (!editorState) return;
    editorSaveError.hidden = true;
    editorSaveFlash.hidden = true;

    var meta = {
      title: editorTitle.value.trim(),
      active: editorActive.value === 'true',
      timeLimitMinutes: Number(editorTimeLimit.value) || 30,
      gradingMode: editorGradingMode.value,
      questionLimit: Number(editorQuestionLimit.value) || 0
    };
    if (!meta.title) {
      editorSaveError.hidden = false;
      editorSaveError.textContent = 'Title is required.';
      return;
    }

    var payload = { packetCode: editorState.packetCode, meta: meta };
    if (!editorState.isStatic) {
      payload.questions = editorState.questions;
    }

    btnSavePacket.disabled = true;
    btnSavePacket.textContent = 'Saving...';
    postAdmin('adminSavePacket', payload).then(function (data) {
      if (!data.success) throw new Error(data.error || 'save_failed');
      return loadPacketsList().then(function () { return openPacketEditor(editorState.packetCode); }).then(function () {
        editorSaveFlash.hidden = false;
        editorSaveFlash.textContent = 'Saved.';
      });
    }).catch(function (err) {
      editorSaveError.hidden = false;
      editorSaveError.textContent = 'Could not save: ' + err.message;
    }).finally(function () {
      btnSavePacket.disabled = false;
      btnSavePacket.textContent = 'Save Packet';
    });
  });

  (function tryAutoUnlock() {
    var saved;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch (e) { saved = null; }
    if (!saved) return;
    state.adminPassword = saved;
    loadResults().then(function () {
      showScreen('dashboard');
    }).catch(function () {
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e2) { /* ignore */ }
      state.adminPassword = '';
    });
  })();

})();
