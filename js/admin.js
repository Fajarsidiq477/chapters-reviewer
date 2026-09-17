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

  var state = {
    adminPassword: '',
    results: [],
    packets: [],
    sortKey: 'timestamp',
    sortDir: 'desc'
  };

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
