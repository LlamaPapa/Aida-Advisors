/**
 * Debug Pipeline Dashboard
 *
 * Simple web UI for monitoring the pipeline.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Debug Pipeline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid #30363d;
      margin-bottom: 20px;
    }
    h1 { font-size: 24px; display: flex; align-items: center; gap: 10px; }
    h1 span { font-size: 28px; }
    .status-badge {
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
    }
    .status-idle { background: #30363d; color: #8b949e; }
    .status-running { background: #1f6feb; color: white; animation: pulse 2s infinite; }
    .status-success { background: #238636; color: white; }
    .status-failed { background: #da3633; color: white; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

    .grid { display: grid; grid-template-columns: 1fr 400px; gap: 20px; }
    @media (max-width: 1000px) { .grid { grid-template-columns: 1fr; } }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      overflow: hidden;
    }
    .card-header {
      padding: 12px 16px;
      background: #21262d;
      border-bottom: 1px solid #30363d;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-body { padding: 16px; }

    .logs {
      height: 500px;
      overflow-y: auto;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 12px;
      line-height: 1.6;
      background: #0d1117;
      padding: 12px;
      border-radius: 4px;
    }
    .log-line { padding: 2px 0; }
    .log-time { color: #6e7681; margin-right: 8px; }
    .log-stdout { color: #7ee787; }
    .log-stderr { color: #f85149; }
    .log-info { color: #58a6ff; }

    .stage-indicator {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .stage {
      padding: 8px 16px;
      background: #21262d;
      border-radius: 4px;
      font-size: 13px;
      border: 2px solid transparent;
    }
    .stage.active { border-color: #58a6ff; background: #1f6feb33; }
    .stage.complete { border-color: #238636; background: #23863633; }
    .stage.failed { border-color: #da3633; background: #da363333; }

    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .stat {
      background: #21262d;
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 32px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; margin-top: 4px; }

    .history-item {
      padding: 12px;
      border-bottom: 1px solid #30363d;
      cursor: pointer;
      transition: background 0.2s;
    }
    .history-item:hover { background: #21262d; }
    .history-item:last-child { border-bottom: none; }
    .history-meta { display: flex; justify-content: space-between; font-size: 12px; color: #8b949e; margin-top: 4px; }

    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
    }
    .btn-primary { background: #238636; color: white; }
    .btn-primary:hover { background: #2ea043; }
    .btn-danger { background: #da3633; color: white; }
    .btn-danger:hover { background: #f85149; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .diff-view {
      background: #0d1117;
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 300px;
      overflow-y: auto;
    }
    .diff-add { color: #7ee787; background: #23863622; }
    .diff-del { color: #f85149; background: #da363322; }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; margin-bottom: 6px; font-size: 14px; }
    .form-group input {
      width: 100%;
      padding: 10px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #c9d1d9;
      font-size: 14px;
    }
    .form-group input:focus { outline: none; border-color: #58a6ff; }

    .fix-attempt {
      background: #21262d;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .fix-attempt-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .fix-attempt h4 { font-size: 14px; }
    .fix-files { font-size: 12px; color: #8b949e; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>🔧</span> Debug Pipeline</h1>
      <div id="globalStatus" class="status-badge status-idle">Idle</div>
    </header>

    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="statTotal">0</div>
        <div class="stat-label">Total Runs</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="statSuccess">0</div>
        <div class="stat-label">Successful</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="statFixes">0</div>
        <div class="stat-label">Auto-Fixes</div>
      </div>
    </div>

    <div class="stage-indicator" id="stages">
      <div class="stage" data-stage="building">Building</div>
      <div class="stage" data-stage="testing">Testing</div>
      <div class="stage" data-stage="analyzing">Analyzing</div>
      <div class="stage" data-stage="fixing">Fixing</div>
      <div class="stage" data-stage="verifying">Verifying</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-header">
          <span>Live Logs</span>
          <button class="btn btn-danger" id="btnStop" disabled onclick="stopPipeline()">Stop</button>
        </div>
        <div class="card-body">
          <div class="logs" id="logs">
            <div class="log-line log-info">Waiting for pipeline to start...</div>
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header">Run Pipeline</div>
          <div class="card-body">
            <div class="form-group">
              <label>Project Path</label>
              <input type="text" id="projectRoot" placeholder="/path/to/project" />
            </div>
            <div class="form-group">
              <label>App URL (for UI testing)</label>
              <input type="text" id="baseUrl" placeholder="http://localhost:5180" />
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn" id="btnExplore" onclick="exploreApp()" style="background: #238636; font-weight: bold;">Explore App</button>
              <button class="btn btn-primary" id="btnRun" onclick="runPipeline()">Build Check</button>
            </div>
            <div style="margin-top: 8px; font-size: 12px; color: #8b949e;">
              Explore = Click around and find bugs. Build Check = Compile code.
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;" id="exploreResultsCard">
          <div class="card-header">
            <span>Exploration Results</span>
            <span id="exploreStatus" class="status-badge status-idle">-</span>
          </div>
          <div class="card-body" id="exploreResults">
            <div style="color: #8b949e; font-size: 14px;">Click "Explore App" to have AI click through your app and find bugs</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">Fix Attempts</div>
          <div class="card-body" id="fixAttempts">
            <div style="color: #8b949e; font-size: 14px;">No fix attempts yet</div>
          </div>
        </div>

        <div class="card" style="margin-top: 20px;">
          <div class="card-header">History</div>
          <div class="card-body" style="padding: 0; max-height: 300px; overflow-y: auto;" id="history">
            <div style="padding: 16px; color: #8b949e; font-size: 14px;">No runs yet</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let eventSource = null;
    let currentRun = null;

    function connectSSE() {
      eventSource = new EventSource('/api/events');

      eventSource.addEventListener('state', (e) => {
        const state = JSON.parse(e.data);
        updateState(state);
      });

      eventSource.addEventListener('start', (e) => {
        const run = JSON.parse(e.data);
        currentRun = run;
        document.getElementById('logs').innerHTML = '';
        document.getElementById('fixAttempts').innerHTML = '<div style="color: #8b949e; font-size: 14px;">No fix attempts yet</div>';
        addLog('Pipeline started: ' + run.projectRoot, 'info');
        updateStatus('running', 'Running');
        document.getElementById('btnRun').disabled = true;
        document.getElementById('btnStop').disabled = false;
      });

      eventSource.addEventListener('stage', (e) => {
        const { stage } = JSON.parse(e.data);
        updateStage(stage);
      });

      eventSource.addEventListener('log', (e) => {
        const { message } = JSON.parse(e.data);
        const type = message.includes('[stderr]') ? 'stderr' :
                     message.includes('[stdout]') ? 'stdout' : 'info';
        addLog(message, type);
      });

      eventSource.addEventListener('update', (e) => {
        const run = JSON.parse(e.data);
        currentRun = run;
        updateFixAttempts(run.fixAttempts);
      });

      eventSource.addEventListener('complete', (e) => {
        const run = JSON.parse(e.data);
        currentRun = run;
        const status = run.success ? 'success' : 'failed';
        const label = run.success ? 'Success' : 'Failed';
        updateStatus(status, label);
        updateStage(run.status);
        document.getElementById('btnRun').disabled = false;
        document.getElementById('btnStop').disabled = true;
        addLog('Pipeline ' + (run.success ? 'SUCCEEDED' : 'FAILED') + ': ' + run.summary, 'info');
        fetchHistory();
      });

      eventSource.onerror = () => {
        setTimeout(connectSSE, 3000);
      };
    }

    function updateState(state) {
      document.getElementById('statTotal').textContent = state.stats.totalRuns;
      document.getElementById('statSuccess').textContent = state.stats.successfulRuns;
      document.getElementById('statFixes').textContent = state.stats.successfulFixes;

      if (state.isRunning && state.currentRun) {
        currentRun = state.currentRun;
        updateStatus('running', 'Running');
        updateStage(state.currentRun.status);
        document.getElementById('btnRun').disabled = true;
        document.getElementById('btnStop').disabled = false;
      } else {
        updateStatus('idle', 'Idle');
        document.getElementById('btnRun').disabled = false;
        document.getElementById('btnStop').disabled = true;
      }
    }

    function updateStatus(status, label) {
      const el = document.getElementById('globalStatus');
      el.className = 'status-badge status-' + status;
      el.textContent = label;
    }

    function updateStage(current) {
      document.querySelectorAll('.stage').forEach(el => {
        el.classList.remove('active', 'complete', 'failed');
        const stage = el.dataset.stage;
        const stages = ['building', 'testing', 'analyzing', 'fixing', 'verifying'];
        const currentIdx = stages.indexOf(current);
        const stageIdx = stages.indexOf(stage);

        if (current === 'complete' || (stageIdx < currentIdx && currentIdx >= 0)) {
          el.classList.add('complete');
        } else if (stage === current) {
          el.classList.add('active');
        } else if (current === 'failed') {
          el.classList.add('failed');
        }
      });
    }

    function addLog(message, type) {
      const logs = document.getElementById('logs');
      const time = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-line log-' + type;
      div.innerHTML = '<span class="log-time">' + time + '</span>' + escapeHtml(message);
      logs.appendChild(div);
      logs.scrollTop = logs.scrollHeight;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function updateFixAttempts(attempts) {
      const el = document.getElementById('fixAttempts');
      if (!attempts || attempts.length === 0) {
        el.innerHTML = '<div style="color: #8b949e; font-size: 14px;">No fix attempts yet</div>';
        return;
      }

      el.innerHTML = attempts.map(a => \`
        <div class="fix-attempt">
          <div class="fix-attempt-header">
            <h4>Attempt #\${a.attempt} - \${a.result.success ? '✅ Fixed' : '❌ Failed'}</h4>
            <span style="color: #8b949e; font-size: 12px;">\${a.commitHash ? a.commitHash.slice(0, 8) : ''}</span>
          </div>
          <div class="fix-files">\${a.filesChanged ? a.filesChanged.join(', ') : 'No files changed'}</div>
          <div style="margin-top: 8px; font-size: 12px; color: #8b949e;">
            \${a.analysis.hypotheses[0]?.description || 'No hypothesis'}
          </div>
        </div>
      \`).join('');
    }

    async function exploreApp() {
      const baseUrl = document.getElementById('baseUrl').value;
      if (!baseUrl) {
        alert('Please enter the App URL (e.g., http://localhost:5180)');
        return;
      }

      const resultsCard = document.getElementById('exploreResultsCard');
      const resultsEl = document.getElementById('exploreResults');
      const statusEl = document.getElementById('exploreStatus');

      resultsCard.style.display = 'block';
      resultsEl.innerHTML = '<div style="color: #58a6ff;">🔍 Opening app and clicking around... This may take a minute.</div>';
      statusEl.textContent = 'Running';
      statusEl.className = 'status-badge status-running';

      addLog('Starting exploration of ' + baseUrl, 'info');

      try {
        const res = await fetch('/api/explore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl, maxActions: 15 })
        });

        const data = await res.json();

        if (!res.ok) {
          statusEl.textContent = 'Error';
          statusEl.className = 'status-badge status-failed';
          resultsEl.innerHTML = '<div style="color: #f85149;">Error: ' + data.error + '</div>';
          addLog('Exploration failed: ' + data.error, 'stderr');
          return;
        }

        // Update status
        statusEl.textContent = data.success ? 'PASS' : 'ISSUES';
        statusEl.className = 'status-badge status-' + (data.success ? 'success' : 'failed');

        // Build results HTML
        let html = '<div style="font-size: 13px;">';

        // Summary
        html += '<div style="margin-bottom: 12px; padding: 10px; background: #21262d; border-radius: 4px;">';
        html += '<strong>' + data.summary + '</strong>';
        html += '</div>';

        // Actions performed
        if (data.actions && data.actions.length > 0) {
          html += '<div style="margin-bottom: 12px;"><strong>Actions (' + data.actions.length + '):</strong></div>';
          html += '<div style="max-height: 200px; overflow-y: auto;">';
          data.actions.forEach((a, i) => {
            const icon = a.success ? '✅' : '❌';
            html += '<div style="padding: 4px 0; border-bottom: 1px solid #30363d;">';
            html += icon + ' ' + a.description;
            if (a.error) html += '<br><span style="color: #f85149; font-size: 12px;">  ' + a.error + '</span>';
            html += '</div>';
          });
          html += '</div>';
        }

        // Errors found
        if (data.errorsFound && data.errorsFound.length > 0) {
          html += '<div style="margin: 12px 0;"><strong style="color: #f85149;">Errors Found (' + data.errorsFound.length + '):</strong></div>';
          data.errorsFound.forEach(e => {
            html += '<div style="padding: 4px 0; color: #f85149;">🚨 ' + e + '</div>';
          });
        }

        // Console errors
        if (data.consoleErrors && data.consoleErrors.length > 0) {
          html += '<div style="margin: 12px 0;"><strong style="color: #d29922;">Console Errors (' + data.consoleErrors.length + '):</strong></div>';
          data.consoleErrors.slice(0, 5).forEach(e => {
            html += '<div style="padding: 4px 0; color: #d29922; font-size: 12px;">⚠️ ' + e.slice(0, 100) + '</div>';
          });
          if (data.consoleErrors.length > 5) {
            html += '<div style="color: #8b949e;">...and ' + (data.consoleErrors.length - 5) + ' more</div>';
          }
        }

        // Success message
        if (data.success) {
          html += '<div style="margin-top: 12px; padding: 10px; background: #23863633; border-radius: 4px; color: #7ee787;">';
          html += '✅ No critical issues found!';
          html += '</div>';
        }

        html += '</div>';
        resultsEl.innerHTML = html;

        addLog('Exploration complete: ' + data.summary, data.success ? 'stdout' : 'stderr');

      } catch (err) {
        statusEl.textContent = 'Error';
        statusEl.className = 'status-badge status-failed';
        resultsEl.innerHTML = '<div style="color: #f85149;">Failed: ' + err.message + '</div>';
        addLog('Exploration error: ' + err.message, 'stderr');
      }
    }

    async function runPipeline() {
      const projectRoot = document.getElementById('projectRoot').value;
      if (!projectRoot) {
        alert('Please enter a project path');
        return;
      }

      try {
        // Use quick-run to auto-detect which scripts exist in the project
        const res = await fetch('/api/quick-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectRoot })
        });

        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          console.error('Response was not JSON:', text);
          alert('Server error: ' + (res.status === 404 ? 'API endpoint not found' : 'Invalid response from server'));
          return;
        }

        if (!res.ok) {
          alert('Error: ' + data.error);
        }
      } catch (err) {
        alert('Failed to start pipeline: ' + err.message);
      }
    }

    async function stopPipeline() {
      try {
        await fetch('/api/stop', { method: 'POST' });
      } catch (err) {
        alert('Failed to stop: ' + err.message);
      }
    }

    async function verifyUI() {
      const projectRoot = document.getElementById('projectRoot').value;
      const baseUrl = document.getElementById('baseUrl').value;

      if (!projectRoot) {
        alert('Please enter a project path');
        return;
      }
      if (!baseUrl) {
        alert('Please enter the app URL (e.g., http://localhost:5180)');
        return;
      }

      const resultsCard = document.getElementById('verifyResultsCard');
      const resultsEl = document.getElementById('verifyResults');
      const statusEl = document.getElementById('verifyStatus');

      resultsCard.style.display = 'block';
      resultsEl.innerHTML = '<div style="color: #58a6ff;">🔍 Analyzing code and generating tests...</div>';
      statusEl.textContent = 'Running';
      statusEl.className = 'status-badge status-running';

      addLog('Starting UI verification...', 'info');
      addLog('Analyzing code changes...', 'info');

      try {
        const res = await fetch('/api/verify-ui', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectRoot, baseUrl })
        });

        const data = await res.json();

        if (!res.ok) {
          statusEl.textContent = 'Error';
          statusEl.className = 'status-badge status-failed';
          resultsEl.innerHTML = '<div style="color: #f85149;">Error: ' + data.error + '</div>';
          addLog('Verification failed: ' + data.error, 'stderr');
          return;
        }

        // Update status
        statusEl.textContent = data.status.toUpperCase();
        statusEl.className = 'status-badge status-' + (data.status === 'pass' ? 'success' : data.status === 'fail' ? 'failed' : 'running');

        // Build results HTML
        let html = '<div style="font-size: 13px;">';

        // Summary
        html += '<div style="margin-bottom: 12px; padding: 10px; background: #21262d; border-radius: 4px;">';
        html += '<strong>Summary:</strong> ' + data.summary;
        html += '</div>';

        // Test Plan
        if (data.testPlan && data.testPlan.scenarios.length > 0) {
          html += '<div style="margin-bottom: 12px;"><strong>Test Plan (' + data.testPlan.scenarios.length + ' scenarios):</strong></div>';
          html += '<ul style="margin: 0; padding-left: 20px;">';
          data.testPlan.scenarios.forEach(s => {
            html += '<li style="margin-bottom: 4px;">' + s.name + ' <span style="color: #8b949e;">(' + s.type + ', ' + s.priority + ')</span></li>';
          });
          html += '</ul>';
        }

        // Test Results
        if (data.testResults && data.testResults.length > 0) {
          html += '<div style="margin: 12px 0;"><strong>Test Results:</strong></div>';
          data.testResults.forEach(r => {
            const icon = r.passed ? '✅' : '❌';
            html += '<div style="padding: 4px 0;">' + icon + ' ' + r.scenarioId + (r.error ? ': ' + r.error : '') + '</div>';
          });
        }

        // Flags
        if (data.flags && data.flags.length > 0) {
          html += '<div style="margin: 12px 0;"><strong>Flags (' + data.flags.length + '):</strong></div>';
          data.flags.forEach(f => {
            const color = f.severity === 'critical' ? '#f85149' : f.severity === 'warning' ? '#d29922' : '#8b949e';
            html += '<div style="padding: 4px 0; color: ' + color + ';">';
            html += (f.severity === 'critical' ? '🚨' : f.severity === 'warning' ? '⚠️' : 'ℹ️') + ' ' + f.message;
            if (f.suggestion) html += '<br><span style="color: #8b949e; font-size: 12px;">  → ' + f.suggestion + '</span>';
            html += '</div>';
          });
        }

        // Files changed
        if (data.implementation) {
          html += '<div style="margin: 12px 0; color: #8b949e; font-size: 12px;">';
          html += 'Files: ' + data.implementation.filesCreated.length + ' created, ' + data.implementation.filesModified.length + ' modified';
          html += '</div>';
        }

        html += '</div>';
        resultsEl.innerHTML = html;

        addLog('Verification complete: ' + data.status, data.status === 'pass' ? 'stdout' : 'stderr');

      } catch (err) {
        statusEl.textContent = 'Error';
        statusEl.className = 'status-badge status-failed';
        resultsEl.innerHTML = '<div style="color: #f85149;">Failed: ' + err.message + '</div>';
        addLog('Verification error: ' + err.message, 'stderr');
      }
    }

    async function fetchHistory() {
      try {
        const res = await fetch('/api/history');
        const history = await res.json();
        const el = document.getElementById('history');

        if (history.length === 0) {
          el.innerHTML = '<div style="padding: 16px; color: #8b949e; font-size: 14px;">No runs yet</div>';
          return;
        }

        el.innerHTML = history.slice(0, 10).map(run => \`
          <div class="history-item">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span>\${run.success ? '✅' : '❌'}</span>
              <span>\${run.projectId}</span>
            </div>
            <div class="history-meta">
              <span>\${run.fixAttempts.length} fixes</span>
              <span>\${run.duration ? (run.duration / 1000).toFixed(1) + 's' : ''}</span>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Failed to fetch history:', err);
      }
    }

    // Init
    connectSSE();
    fetchHistory();
  </script>
</body>
</html>`;
}
