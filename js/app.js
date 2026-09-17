(function () {
  'use strict';

  var screens = {
    login: document.getElementById('screen-login'),
    quiz: document.getElementById('screen-quiz'),
    result: document.getElementById('screen-result')
  };

  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var btnStart = document.getElementById('btn-start');

  var quizTitleEl = document.getElementById('quiz-title');
  var quizTimerEl = document.getElementById('quiz-timer');
  var quizProgressEl = document.getElementById('quiz-progress');
  var quizSectionTitleEl = document.getElementById('quiz-section-title');
  var quizQuestionsEl = document.getElementById('quiz-questions');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var btnSubmit = document.getElementById('btn-submit');

  var resultTitleEl = document.getElementById('result-title');
  var resultBodyEl = document.getElementById('result-body');
  var btnRestart = document.getElementById('btn-restart');

  var resumeBanner = document.getElementById('resume-banner');
  var resumeText = document.getElementById('resume-text');
  var btnResume = document.getElementById('btn-resume');
  var btnStartFresh = document.getElementById('btn-start-fresh');

  var sidebarPanel = document.getElementById('quiz-sidebar');
  var sidebarGrid = document.getElementById('sidebar-grid');
  var sidebarSummary = document.getElementById('sidebar-summary');
  var btnToggleSidebar = document.getElementById('btn-toggle-sidebar');

  var SESSION_POINTER_KEY = 'quiz_active_session';

  var state = {
    fullName: '',
    className: '',
    packetCode: '',
    packet: null,
    sectionIndex: 0,
    answers: {},
    startTimestamp: 0,
    endTimestamp: 0,
    timerHandle: null,
    submitting: false,
    sidebarButtons: {},
    questionNumbers: {}
  };

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function draftKey(fullName, className, packetCode) {
    return 'quizdraft::' + packetCode.toLowerCase() + '::' + fullName.toLowerCase().trim() + '::' + className.toLowerCase().trim();
  }

  function loadDraft(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveDraft() {
    try {
      var key = draftKey(state.fullName, state.className, state.packetCode);
      localStorage.setItem(key, JSON.stringify({
        answers: state.answers,
        sectionIndex: state.sectionIndex,
        startTimestamp: state.startTimestamp,
        endTimestamp: state.endTimestamp,
        packetMeta: state.packetMeta
      }));
      localStorage.setItem(SESSION_POINTER_KEY, JSON.stringify({
        fullName: state.fullName,
        className: state.className,
        packetCode: state.packetCode
      }));
    } catch (e) { /* ignore storage errors (private mode, quota) */ }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(draftKey(state.fullName, state.className, state.packetCode));
      localStorage.removeItem(SESSION_POINTER_KEY);
    } catch (e) { /* ignore */ }
  }

  /** On page load, offer to resume the most recent unfinished attempt on this browser. */
  function checkForResumableSession() {
    var pointer;
    try {
      var raw = localStorage.getItem(SESSION_POINTER_KEY);
      pointer = raw ? JSON.parse(raw) : null;
    } catch (e) {
      pointer = null;
    }
    if (!pointer) return;

    var draft = loadDraft(draftKey(pointer.fullName, pointer.className, pointer.packetCode));
    if (!draft) {
      localStorage.removeItem(SESSION_POINTER_KEY);
      return;
    }

    var packetTitle = (draft.packetMeta && draft.packetMeta.title) || pointer.packetCode;
    resumeText.textContent = 'We found an unfinished attempt for ' + pointer.fullName + ' (' + pointer.className + ') on "' + packetTitle + '".';
    resumeBanner.hidden = false;

    document.getElementById('input-fullname').value = pointer.fullName;
    document.getElementById('input-class').value = pointer.className;
    document.getElementById('input-token').value = pointer.packetCode;

    btnResume.onclick = function () {
      loginForm.requestSubmit();
    };

    btnStartFresh.onclick = function () {
      try {
        localStorage.removeItem(draftKey(pointer.fullName, pointer.className, pointer.packetCode));
        localStorage.removeItem(SESSION_POINTER_KEY);
      } catch (e) { /* ignore */ }
      resumeBanner.hidden = true;
      document.getElementById('input-fullname').value = '';
      document.getElementById('input-class').value = '';
      document.getElementById('input-token').value = '';
    };
  }

  function fetchJson(url) {
    return fetch(url).then(function (res) { return res.json(); });
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function (res) { return res.json(); });
  }

  function setLoginError(message) {
    if (!message) {
      loginError.hidden = true;
      loginError.textContent = '';
      return;
    }
    loginError.hidden = false;
    loginError.textContent = message;
  }

  var ERROR_MESSAGES = {
    missing_fields: 'Please fill in every field.',
    invalid_code: 'That packet code was not recognized. Check it with your teacher.',
    inactive_code: 'That packet is not currently active. Ask your teacher to activate it.',
    already_submitted: 'You have already submitted this packet. Each packet can only be attempted once.',
    unknown_action: 'Something went wrong talking to the server. Please try again.',
    bad_request: 'Something went wrong talking to the server. Please try again.'
  };

  function friendlyError(code) {
    return ERROR_MESSAGES[code] || 'Something went wrong. Please try again.';
  }

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    setLoginError(null);

    var fullName = document.getElementById('input-fullname').value.trim();
    var className = document.getElementById('input-class').value.trim();
    var code = document.getElementById('input-token').value.trim();

    if (!fullName || !className || !code) {
      setLoginError(friendlyError('missing_fields'));
      return;
    }
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
      setLoginError('The site is not configured yet (missing Apps Script URL in js/config.js).');
      return;
    }

    btnStart.disabled = true;
    btnStart.textContent = 'Checking...';

    var query = 'action=validate' +
      '&code=' + encodeURIComponent(code) +
      '&fullName=' + encodeURIComponent(fullName) +
      '&class=' + encodeURIComponent(className);

    fetchJson(APPS_SCRIPT_URL + '?' + query)
      .then(function (data) {
        if (!data.success) {
          setLoginError(friendlyError(data.error));
          return;
        }
        state.fullName = fullName;
        state.className = className;
        state.packetCode = data.packetCode;
        state.packetMeta = data;

        return fetchJson('packets/' + data.jsonFile).then(function (packet) {
          beginQuiz(packet, data);
        });
      })
      .catch(function () {
        setLoginError('Could not reach the server. Check your internet connection and try again.');
      })
      .finally(function () {
        btnStart.disabled = false;
        btnStart.textContent = 'Start Review';
      });
  });

  function beginQuiz(packet, meta) {
    state.packet = packet;
    var existingDraft = loadDraft(draftKey(state.fullName, state.className, state.packetCode));

    if (existingDraft) {
      state.answers = existingDraft.answers || {};
      state.sectionIndex = existingDraft.sectionIndex || 0;
      state.startTimestamp = existingDraft.startTimestamp;
      state.endTimestamp = existingDraft.endTimestamp;
    } else {
      state.answers = {};
      state.sectionIndex = 0;
      state.startTimestamp = Date.now();
      state.endTimestamp = Date.now() + (meta.timeLimitMinutes * 60000);
      saveDraft();
    }

    quizTitleEl.textContent = packet.title || meta.title;
    showScreen('quiz');
    buildSidebar();
    renderSection();
    startTimer();
  }

  function buildSidebar() {
    sidebarGrid.innerHTML = '';
    state.sidebarButtons = {};
    state.questionNumbers = {};

    var overallNumber = 0;
    state.packet.sections.forEach(function (section, sectionIdx) {
      var label = document.createElement('div');
      label.className = 'sidebar-section-label';
      label.textContent = section.title.replace(/^Section \d+:\s*/, '');
      sidebarGrid.appendChild(label);

      section.questions.forEach(function (q) {
        overallNumber++;
        state.questionNumbers[q.id] = overallNumber;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-btn';
        btn.textContent = overallNumber;
        btn.title = 'Question ' + overallNumber;
        btn.addEventListener('click', function () {
          jumpToQuestion(q.id, sectionIdx);
        });
        sidebarGrid.appendChild(btn);
        state.sidebarButtons[q.id] = { el: btn, sectionIdx: sectionIdx };
      });
    });

    sidebarPanel.classList.toggle('collapsed', window.innerWidth < 760);
    updateSidebar();
  }

  function updateSidebar() {
    var answered = 0, total = 0;
    Object.keys(state.sidebarButtons).forEach(function (qid) {
      total++;
      var entry = state.sidebarButtons[qid];
      var isAnswered = !!(state.answers[qid] && state.answers[qid].toString().trim() !== '');
      if (isAnswered) answered++;
      entry.el.classList.toggle('answered', isAnswered);
      entry.el.classList.toggle('current', entry.sectionIdx === state.sectionIndex);
    });
    sidebarSummary.textContent = answered + ' / ' + total + ' answered';
  }

  function jumpToQuestion(questionId, sectionIdx) {
    collectSectionAnswers();
    if (state.sectionIndex !== sectionIdx) {
      state.sectionIndex = sectionIdx;
      renderSection();
    }
    var row = document.getElementById('qrow-' + questionId);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('jump-target');
      setTimeout(function () { row.classList.remove('jump-target'); }, 1400);
    }
  }

  btnToggleSidebar.addEventListener('click', function () {
    sidebarPanel.classList.toggle('collapsed');
  });

  function startTimer() {
    stopTimer();
    tickTimer();
    state.timerHandle = setInterval(tickTimer, 1000);
  }

  function stopTimer() {
    if (state.timerHandle) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
    }
  }

  function tickTimer() {
    var remainingMs = state.endTimestamp - Date.now();
    if (remainingMs <= 0) {
      quizTimerEl.textContent = '00:00';
      stopTimer();
      submitQuiz(true);
      return;
    }
    var totalSeconds = Math.floor(remainingMs / 1000);
    var mm = Math.floor(totalSeconds / 60);
    var ss = totalSeconds % 60;
    quizTimerEl.textContent = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    quizTimerEl.classList.toggle('low', totalSeconds <= 60);
  }

  function currentSection() {
    return state.packet.sections[state.sectionIndex];
  }

  function collectSectionAnswers() {
    var section = currentSection();
    section.questions.forEach(function (q) {
      if (section.type === 'mcq' || section.type === 'truefalse') {
        var checked = quizQuestionsEl.querySelector('input[name="' + q.id + '"]:checked');
        state.answers[q.id] = checked ? checked.value : '';
      } else {
        var field = document.getElementById('field-' + q.id);
        if (field) state.answers[q.id] = field.value;
      }
    });
    saveDraft();
    updateSidebar();
  }

  function renderSection() {
    var section = currentSection();
    var totalSections = state.packet.sections.length;

    quizProgressEl.textContent = 'Section ' + (state.sectionIndex + 1) + ' of ' + totalSections;
    quizSectionTitleEl.textContent = section.title;

    var html = '';
    section.questions.forEach(function (q) {
      var overallNumber = state.questionNumbers[q.id];
      html += '<div class="question" id="qrow-' + q.id + '">';
      html += '<div class="question-text">' + overallNumber + '. ' + escapeHtml(q.text) +
        (q.marks ? ' <span class="marks-hint">[' + q.marks + (q.marks === 1 ? ' mark' : ' marks') + ']</span>' : '') +
        '</div>';

      if (section.type === 'mcq') {
        html += '<div class="options">';
        Object.keys(q.options).forEach(function (letter) {
          var checkedAttr = state.answers[q.id] === letter ? 'checked' : '';
          html += '<label class="option-row">' +
            '<input type="radio" name="' + q.id + '" value="' + letter + '" ' + checkedAttr + '>' +
            '<span>' + letter + '. ' + escapeHtml(q.options[letter]) + '</span></label>';
        });
        html += '</div>';
      } else if (section.type === 'truefalse') {
        html += '<div class="options">';
        ['TRUE', 'FALSE'].forEach(function (val) {
          var checkedAttr = state.answers[q.id] === val ? 'checked' : '';
          html += '<label class="option-row">' +
            '<input type="radio" name="' + q.id + '" value="' + val + '" ' + checkedAttr + '>' +
            '<span>' + val + '</span></label>';
        });
        html += '</div>';
      } else if (section.type === 'essay') {
        html += '<textarea id="field-' + q.id + '" rows="4">' + escapeHtml(state.answers[q.id] || '') + '</textarea>';
      } else {
        html += '<input type="text" id="field-' + q.id + '" value="' + escapeHtml(state.answers[q.id] || '') + '">';
      }
      html += '</div>';
    });

    quizQuestionsEl.innerHTML = html;

    btnPrev.disabled = state.sectionIndex === 0;
    btnNext.hidden = state.sectionIndex === totalSections - 1;

    updateSidebar();
  }

  function escapeHtml(str) {
    return (str || '').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  quizQuestionsEl.addEventListener('input', function () { collectSectionAnswers(); });
  quizQuestionsEl.addEventListener('change', function () { collectSectionAnswers(); });

  btnPrev.addEventListener('click', function () {
    collectSectionAnswers();
    if (state.sectionIndex > 0) {
      state.sectionIndex--;
      renderSection();
    }
  });

  btnNext.addEventListener('click', function () {
    collectSectionAnswers();
    if (state.sectionIndex < state.packet.sections.length - 1) {
      state.sectionIndex++;
      renderSection();
    }
  });

  btnSubmit.addEventListener('click', function () {
    if (confirm('Submit your answers now? You will not be able to change them afterwards.')) {
      submitQuiz(false);
    }
  });

  function submitQuiz(isAutoSubmit) {
    if (state.submitting) return;
    state.submitting = true;
    stopTimer();
    collectSectionAnswers();

    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting...';

    var timeTakenSeconds = Math.round((Date.now() - state.startTimestamp) / 1000);

    postJson(APPS_SCRIPT_URL, {
      action: 'submit',
      fullName: state.fullName,
      class: state.className,
      packetCode: state.packetCode,
      answers: state.answers,
      timeTakenSeconds: timeTakenSeconds
    }).then(function (data) {
      if (!data.success) {
        if (data.error === 'already_submitted') {
          clearDraft();
          showScreen('login');
          setLoginError(friendlyError('already_submitted'));
          return;
        }
        alert(friendlyError(data.error) + (isAutoSubmit ? ' Your time ran out - please tell your teacher.' : ''));
        state.submitting = false;
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Quiz';
        startTimer();
        return;
      }

      clearDraft();
      showResult(data, isAutoSubmit);
    }).catch(function () {
      alert('Could not reach the server. Your answers are saved locally - please check your internet connection and press Submit again.');
      state.submitting = false;
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Submit Quiz';
      startTimer();
    });
  }

  function showResult(data, isAutoSubmit) {
    resultTitleEl.textContent = isAutoSubmit ? 'Time\'s up - submitted automatically' : 'Submitted!';

    var html = '<p class="score-line">Objective sections score: <strong>' + data.objectiveScore + ' / ' + data.objectiveMax + '</strong></p>';

    if (data.essaySectionStatus === 'Auto-Estimated') {
      html += '<p class="score-line">Structured questions (auto-estimated): <strong>' + data.essayScore + ' / ' + data.essayMax + '</strong></p>';
      html += '<div class="success-box">This structured-question score is an automatic estimate. Your teacher may review and adjust it.</div>';
    } else if (data.essaySectionStatus === 'Pending Review') {
      html += '<div class="success-box">Your structured-question answers (' + data.essayMax + ' marks available) have been sent to your teacher for manual grading.</div>';
    }

    resultBodyEl.innerHTML = html;
    showScreen('result');
  }

  btnRestart.addEventListener('click', function () {
    location.reload();
  });

  checkForResumableSession();

})();
