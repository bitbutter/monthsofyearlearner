"use strict";

(function bootMonthsLearnerApp() {
  const Core = window.MonthsLearnerCore;
  const root = document.getElementById("app");
  const storageKey = Core.STORAGE_KEY;

  let state = null;
  let view = "home";
  let storageProblem = null;
  let invalidStoredRaw = null;
  let activeSession = null;
  let activeCard = null;
  let feedback = null;
  let promptShownAt = 0;
  let firstInputAt = null;
  let timerHandle = null;
  let graduation = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "Not yet";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function formatMs(value) {
    if (!value) return "0.0s";
    return `${(value / 1000).toFixed(1)}s`;
  }

  function percent(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function assertStorageAvailable() {
    try {
      const testKey = `${storageKey}.test`;
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      storageProblem = error;
      return false;
    }
  }

  function loadState() {
    if (!assertStorageAvailable()) {
      view = "storage-error";
      render();
      return;
    }

    const raw = window.localStorage.getItem(storageKey);
    const parsed = Core.parseStoredState(raw);
    if (parsed.status === "missing") {
      state = Core.createInitialState(new Date());
      saveState();
      return;
    }
    if (parsed.status === "invalid") {
      invalidStoredRaw = raw;
      storageProblem = parsed.errors;
      view = "invalid-storage";
      return;
    }
    state = Core.recomputeGoalStatus(parsed.state, new Date());
    saveState();
  }

  function saveState() {
    const validation = Core.validateState(state);
    if (!validation.ok) {
      storageProblem = validation.errors;
      view = "invalid-storage";
      invalidStoredRaw = JSON.stringify(state, null, 2);
      render();
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function clearProgress() {
    const confirmed = window.confirm(`Clear local progress for ${storageKey}? This deletes only this learner's stored progress.`);
    if (!confirmed) return;
    window.localStorage.removeItem(storageKey);
    state = Core.createInitialState(new Date());
    saveState();
    invalidStoredRaw = null;
    storageProblem = null;
    view = "home";
    render();
  }

  function downloadRawExport() {
    const raw = invalidStoredRaw ?? JSON.stringify(state, null, 2);
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${storageKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function copyRawExport() {
    const raw = invalidStoredRaw ?? JSON.stringify(state, null, 2);
    navigator.clipboard.writeText(raw);
  }

  function monthStrip() {
    return `
      <ol class="month-strip" aria-label="Months of the year">
        ${Core.MONTHS.map((month, index) => `<li><span>${index + 1}</span>${month}</li>`).join("")}
      </ol>
    `;
  }

  function progressBar(snapshot) {
    const total = Math.max(1, snapshot.totalCards);
    const segments = [
      ["new", snapshot.newCards, "New"],
      ["weak", snapshot.weakCards, "Needs review"],
      ["learning", snapshot.learningCards, "Learning"],
      ["fluent", snapshot.fluentCards, "Fluent"],
      ["durable", snapshot.durableCards, "Durable"],
    ];
    return `
      <div class="segmented" role="img" aria-label="Card levels">
        ${segments
          .map(([kind, count, label]) => {
            const width = Math.max(2, Math.round((count / total) * 100));
            return `<span class="segment ${kind}" style="width:${width}%;" title="${label}: ${count}"></span>`;
          })
          .join("")}
      </div>
      <div class="level-counts">
        ${segments.map(([_kind, count, label]) => `<span>${label}: <strong>${count}</strong></span>`).join("")}
      </div>
    `;
  }

  function masteryPanel() {
    const snapshot = Core.computeMasterySnapshot(state, new Date());
    const eligibility = Core.graduationEligibility(state, new Date());
    return `
      <section class="panel progress-panel" aria-labelledby="progress-heading">
        <div class="panel-heading">
          <h2 id="progress-heading">${snapshot.masteryPercent}% mastery</h2>
          <span class="status-pill">${state.goal.status.replaceAll("_", " ")}</span>
        </div>
        ${progressBar(snapshot)}
        ${trendLine()}
        <div class="metric-grid">
          <div><strong>${snapshot.dueCards}</strong><span>due now</span></div>
          <div><strong>${snapshot.overdueCards}</strong><span>overdue</span></div>
          <div><strong>${snapshot.conversionFluencyPercent}%</strong><span>conversion fluency</span></div>
          <div><strong>${snapshot.sequenceFluencyPercent}%</strong><span>sequence fluency</span></div>
        </div>
        <p class="compact">Graduation readiness: ${eligibility.conversionReady}/24 conversions, ${eligibility.neighborReady}/18 neighbor target, ${eligibility.sequenceReady}/4 sequences, ${eligibility.practiceDayCount} practice days.</p>
      </section>
    `;
  }

  function trendLine() {
    const recent = Core.recentSessionSummaries(state);
    if (recent.length === 0) {
      return '<p class="compact">No mastery trend yet.</p>';
    }
    const points = recent
      .map((session, index) => {
        const x = recent.length === 1 ? 50 : Math.round((index / (recent.length - 1)) * 100);
        const y = 100 - session.masteryPercent;
        return `${x},${y}`;
      })
      .join(" ");
    return `
      <div class="trend" aria-label="Last 7 sessions mastery trend">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
          <polyline points="${points}" />
        </svg>
      </div>
    `;
  }

  function lastSessionPanel() {
    const latest = state.sessions[state.sessions.length - 1];
    if (!latest) {
      return `
        <section class="panel">
          <h2>Last session</h2>
          <p>No session yet.</p>
        </section>
      `;
    }
    const accuracy = latest.answers ? percent(latest.correct, latest.answers) : 0;
    return `
      <section class="panel">
        <h2>Last session</h2>
        <dl class="data-list">
          <div><dt>Date</dt><dd>${escapeHtml(latest.localDate)}</dd></div>
          <div><dt>Accuracy</dt><dd>${accuracy}%</dd></div>
          <div><dt>Answers</dt><dd>${latest.answers}</dd></div>
          <div><dt>Average pace</dt><dd>${formatMs(latest.averageResponseMs)}</dd></div>
        </dl>
      </section>
    `;
  }

  function renderHome() {
    const snapshot = Core.computeMasterySnapshot(state, new Date());
    const eligibility = Core.graduationEligibility(state, new Date());
    const achieved = state.goal.status === "achieved";
    const graduatedAt = state.goal.graduatedAt ? `<p class="success-line">Goal achieved on ${formatDate(state.goal.graduatedAt)}.</p>` : "";
    const primaryAction =
      achieved && snapshot.dueCards === 0
        ? '<button class="primary-button" data-action="settings">Review progress</button>'
        : `<button class="primary-button" data-action="start-session">${achieved ? "Start maintenance" : "Start practice"}</button>`;
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Months of the Year Learner</p>
            <h1>${achieved ? "Maintenance review" : "Today's 8 minute practice"}</h1>
          </div>
          <button class="ghost-button" data-action="settings">Settings</button>
        </header>
        ${monthStrip()}
        <section class="start-band">
          <div>
            <p class="timer-readout">8:00</p>
            <p class="compact">${snapshot.dueCards} cards due now. ${snapshot.overdueCards} overdue.</p>
            ${graduatedAt}
          </div>
          <div class="action-row">
            ${primaryAction}
            ${
              eligibility.eligible
                ? '<button class="secondary-button" data-action="start-graduation">Take graduation check</button>'
                : ""
            }
          </div>
        </section>
        <div class="two-column">
          ${masteryPanel()}
          ${lastSessionPanel()}
        </div>
      </main>
    `;
  }

  function startSession(isExtraPractice) {
    activeSession = Core.createSessionDraft(state, { now: new Date(), isExtraPractice });
    activeCard = null;
    feedback = null;
    view = "drill";
    startTimer();
    loadNextCard();
  }

  function startTimer() {
    stopTimer();
    timerHandle = window.setInterval(() => {
      if (!activeSession) return;
      activeSession.elapsedSeconds = Math.round((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000);
      if (activeSession.elapsedSeconds >= activeSession.plannedSeconds) {
        finishSession();
      } else if (view === "drill") {
        renderTimerOnly();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function renderTimerOnly() {
    const node = document.querySelector("[data-timer]");
    if (node && activeSession) node.textContent = remainingTime();
    const phase = document.querySelector("[data-phase]");
    if (phase && activeSession) phase.textContent = Core.sessionPhase(activeSession.elapsedSeconds);
  }

  function remainingTime() {
    const remaining = Math.max(0, activeSession.plannedSeconds - activeSession.elapsedSeconds);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function retryContains(cardId) {
    return activeSession.retryQueue.some((entry) => entry.cardId === cardId);
  }

  function loadNextCard() {
    if (!activeSession) return;
    const selection = Core.selectNextCard(state, activeSession, new Date());
    if (!selection) {
      activeCard = null;
      activeSession.noWork = true;
      feedback = null;
      render();
      return;
    }
    activeCard = {
      cardId: selection.cardId,
      isRetry: selection.isRetry,
      phase: selection.phase,
      definition: Core.makeCardDefinitions()[selection.cardId],
    };
    activeSession.shownCount += 1;
    feedback = null;
    promptShownAt = performance.now();
    firstInputAt = null;
    render();
    const input = document.querySelector("#answer-input");
    if (input) input.focus();
  }

  function submitAnswer(confidence) {
    const input = document.querySelector("#answer-input");
    if (!input || !activeCard || feedback) return;
    const submitted = input.value;
    const nowPerf = performance.now();
    const responseMs = Math.round(nowPerf - promptShownAt);
    const timeToFirstInputMs = firstInputAt === null ? responseMs : Math.round(firstInputAt - promptShownAt);
    const typingDurationMs = firstInputAt === null ? 0 : Math.max(0, Math.round(nowPerf - firstInputAt));
    const applied = Core.applyReview(
      state,
      activeCard.cardId,
      submitted,
      confidence,
      { responseMs, timeToFirstInputMs, typingDurationMs },
      { now: new Date(), isRetry: activeCard.isRetry, isExtraPractice: activeSession.isExtraPractice },
    );

    state = applied.state;
    activeSession.answerEvents.push(applied.event);

    if (applied.retryResolved) {
      activeSession.retryQueue = activeSession.retryQueue.filter((entry) => entry.cardId !== activeCard.cardId);
    }
    if (applied.retryNeeded && !retryContains(activeCard.cardId)) {
      activeSession.retryQueue.push({ cardId: activeCard.cardId, eligibleAfter: activeSession.shownCount + 3 });
    }
    if (applied.retryNeeded && retryContains(activeCard.cardId)) {
      activeSession.retryQueue = activeSession.retryQueue.map((entry) =>
        entry.cardId === activeCard.cardId ? { cardId: entry.cardId, eligibleAfter: activeSession.shownCount + 3 } : entry,
      );
    }

    state = Core.recordInProgressSession(state, activeSession, new Date());
    saveState();

    feedback = applied.event;
    render();
    const nextButton = document.querySelector("[data-action='next-card']");
    if (nextButton) nextButton.focus();
  }

  function finishSession() {
    if (!activeSession) return;
    stopTimer();
    activeSession.elapsedSeconds = Math.round((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000);
    state = Core.completeSession(state, activeSession, new Date());
    saveState();
    activeSession = null;
    activeCard = null;
    feedback = null;
    view = "summary";
    render();
  }

  function renderDrill() {
    const definitions = Core.makeCardDefinitions();
    const snapshot = Core.computeMasterySnapshot(state, new Date());
    const eventCount = activeSession.answerEvents.length;
    const correct = activeSession.answerEvents.filter((event) => event.correct).length;
    const accuracy = eventCount ? percent(correct, eventCount) : 0;
    const canStop = snapshot.dueCards === 0 && activeSession.retryQueue.length === 0;
    const answerArea = activeCard === null ? renderNoWork() : feedback ? renderFeedback() : renderPrompt(activeCard.definition);
    const groupLabel = activeCard === null ? "complete" : activeCard.isRetry ? "Retry" : definitions[activeCard.cardId].group;

    return `
      <main class="drill-shell">
        <header class="drill-status">
          <div><strong data-timer>${remainingTime()}</strong><span>remaining</span></div>
          <div><strong>${snapshot.dueCards}</strong><span>due</span></div>
          <div><strong>${accuracy}%</strong><span>accuracy</span></div>
          <div><strong data-phase>${Core.sessionPhase(activeSession.elapsedSeconds)}</strong><span>phase</span></div>
        </header>
        <section class="prompt-surface" aria-live="polite">
          <div class="prompt-meta">
            <span>${activeSession.isExtraPractice ? "Extra practice" : "Daily session"}</span>
            <span>${groupLabel}</span>
          </div>
          ${answerArea}
        </section>
        <footer class="drill-footer">
          ${
            canStop
              ? '<button class="secondary-button" data-action="finish-session">Finish session</button>'
              : '<span class="compact">Session continues until the timer ends or due work is complete.</span>'
          }
        </footer>
      </main>
    `;
  }

  function renderNoWork() {
    return `
      <div class="feedback correct">
        <p class="feedback-label">Complete</p>
        <h1>No due review is waiting.</h1>
        <p class="compact">The app will not schedule new or learning cards just to fill time.</p>
        <button class="primary-button" data-action="finish-session">Finish session</button>
      </div>
    `;
  }

  function renderPrompt(definition) {
    return `
      <h1 class="prompt-text">${escapeHtml(definition.prompt)}</h1>
      <label class="answer-label" for="answer-input">Answer</label>
      <input id="answer-input" class="answer-input" type="text" autocomplete="off" inputmode="text" />
      <div class="confidence-row" aria-label="Submit with confidence">
        ${Core.CONFIDENCES.map(
          (confidence) => `
            <button class="confidence-button" data-confidence="${confidence}">
              <strong>${confidence}</strong>
              <span>${confidenceHelp(confidence)}</span>
            </button>
          `,
        ).join("")}
      </div>
    `;
  }

  function confidenceHelp(confidence) {
    if (confidence === "Sure") return "I knew it.";
    if (confidence === "Unsure") return "I think this is right.";
    return "I am guessing.";
  }

  function renderFeedback() {
    return `
      <div class="feedback ${feedback.correct ? "correct" : "incorrect"}">
        <p class="feedback-label">${feedback.correct ? "Correct" : "Needs review"}</p>
        <h1>${feedback.correct && feedback.confidence !== "Guessed" ? "Keep going." : "Correct it before spacing resumes."}</h1>
        <dl class="data-list">
          <div><dt>Expected</dt><dd>${escapeHtml(feedback.expected)}</dd></div>
          <div><dt>Your answer</dt><dd>${escapeHtml(feedback.submitted || "(blank)")}</dd></div>
          <div><dt>Confidence</dt><dd>${escapeHtml(feedback.confidence)}</dd></div>
          <div><dt>Next interval</dt><dd>${feedback.nextIntervalDays} day${feedback.nextIntervalDays === 1 ? "" : "s"}</dd></div>
        </dl>
        <button class="primary-button" data-action="next-card">Next prompt</button>
      </div>
    `;
  }

  function renderSummary() {
    const latest = state.sessions[state.sessions.length - 1];
    const snapshot = latest.masterySnapshot;
    const accuracy = latest.answers ? percent(latest.correct, latest.answers) : 0;
    const eligibility = Core.graduationEligibility(state, new Date());
    const achieved = state.goal.status === "achieved";
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">${latest.isExtraPractice ? "Extra practice" : "Daily session"}</p>
            <h1>${achieved ? "Goal achieved" : "Session summary"}</h1>
          </div>
          <button class="ghost-button" data-action="home">Home</button>
        </header>
        <section class="summary-band">
          <div><strong>${accuracy}%</strong><span>accuracy</span></div>
          <div><strong>${latest.answers}</strong><span>reviewed</span></div>
          <div><strong>${formatMs(latest.averageResponseMs)}</strong><span>average pace</span></div>
          <div><strong>${latest.relearnedCards}</strong><span>relearned</span></div>
        </section>
        <section class="panel">
          <h2>${snapshot.masteryPercent}% mastery</h2>
          ${progressBar(snapshot)}
          <p>Today: ${snapshot.becameFluent} cards became fluent, ${snapshot.becameWeak} need review again.</p>
          <p>Next due: ${snapshot.nextDueAt ? formatDate(snapshot.nextDueAt) : "No scheduled review yet"}.</p>
        </section>
        <div class="action-row">
          <button class="primary-button" data-action="practice-again">Practice again</button>
          ${
            eligibility.eligible
              ? '<button class="secondary-button" data-action="start-graduation">Take graduation check</button>'
              : ""
          }
          <button class="ghost-button" data-action="settings">Review progress</button>
        </div>
      </main>
    `;
  }

  function renderSettings() {
    const snapshot = Core.computeMasterySnapshot(state, new Date());
    const latest = state.sessions[state.sessions.length - 1];
    const latestCheck = state.goal.graduationChecks[state.goal.graduationChecks.length - 1];
    const recent = Core.recentSessionSummaries(state);
    const recentEvents = state.sessions.flatMap((session) => session.answerEvents || []).slice(-12).reverse();
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Settings and diagnostics</p>
            <h1>Progress data</h1>
          </div>
          <button class="ghost-button" data-action="home">Home</button>
        </header>
        <section class="panel">
          <h2>Storage</h2>
          <dl class="data-list">
            <div><dt>Key</dt><dd>${storageKey}</dd></div>
            <div><dt>Schema</dt><dd>${state.version}</dd></div>
            <div><dt>Created</dt><dd>${formatDate(state.createdAt)}</dd></div>
            <div><dt>Goal</dt><dd>${state.goal.status.replaceAll("_", " ")}</dd></div>
            <div><dt>Graduated</dt><dd>${formatDate(state.goal.graduatedAt)}</dd></div>
            <div><dt>Latest check</dt><dd>${latestCheck ? (latestCheck.passed ? "passed" : "failed") : "not taken"}</dd></div>
          </dl>
          <div class="action-row">
            <button class="secondary-button" data-action="export-json">Export raw JSON</button>
            <button class="danger-button" data-action="clear-progress">Clear local progress</button>
          </div>
        </section>
        <section class="panel">
          <h2>Diagnostics</h2>
          <dl class="data-list">
            <div><dt>Total sessions</dt><dd>${state.sessions.length}</dd></div>
            <div><dt>Total practice time</dt><dd>${Math.round(state.sessions.reduce((sum, session) => sum + session.elapsedSeconds, 0) / 60)} minutes</dd></div>
            <div><dt>Total answers</dt><dd>${state.sessions.reduce((sum, session) => sum + session.answers, 0)}</dd></div>
            <div><dt>Lifetime accuracy</dt><dd>${lifetimeAccuracy()}%</dd></div>
            <div><dt>Last session</dt><dd>${latest ? `${latest.localDate}, ${latest.answers} answers, ${percent(latest.correct, latest.answers)}%, ${formatMs(latest.averageResponseMs)} pace` : "none"}</dd></div>
            <div><dt>Levels</dt><dd>${snapshot.newCards} new, ${snapshot.weakCards} weak, ${snapshot.learningCards} learning, ${snapshot.fluentCards} fluent, ${snapshot.durableCards} durable</dd></div>
            <div><dt>Due now</dt><dd>${snapshot.dueCards}</dd></div>
            <div><dt>Next due</dt><dd>${snapshot.nextDueAt ? formatDate(snapshot.nextDueAt) : "none"}</dd></div>
            <div><dt>Typing baseline</dt><dd>${Core.typingBaselineStatus(state)}</dd></div>
          </dl>
          <h3>Weak cards</h3>
          <p class="code-line">${escapeHtml(snapshot.weakCardIds.join(", ") || "none")}</p>
          <h3>Due cards</h3>
          <p class="code-line">${escapeHtml(snapshot.dueCardIds.join(", ") || "none")}</p>
          <h3>Overdue cards</h3>
          <p class="code-line">${escapeHtml(snapshot.overdueCardIds.join(", ") || "none")}</p>
        </section>
        <section class="panel">
          <h2>Last 7 sessions</h2>
          ${recent.length ? renderSessionTable(recent) : "<p>No sessions yet.</p>"}
        </section>
        <section class="panel">
          <h2>Recent answer events</h2>
          ${recentEvents.length ? renderEventTable(recentEvents) : "<p>No answer events yet.</p>"}
        </section>
      </main>
    `;
  }

  function lifetimeAccuracy() {
    const answers = state.sessions.reduce((sum, session) => sum + session.answers, 0);
    const correct = state.sessions.reduce((sum, session) => sum + session.correct, 0);
    return percent(correct, answers);
  }

  function renderSessionTable(sessions) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Answers</th><th>Accuracy</th><th>Pace</th><th>Mastery</th><th>Kind</th></tr></thead>
          <tbody>
            ${sessions
              .map(
                (session) =>
                  `<tr><td>${escapeHtml(session.localDate)}</td><td>${session.answers}</td><td>${session.accuracy}%</td><td>${formatMs(session.averageResponseMs)}</td><td>${session.masteryPercent}%</td><td>${session.isInProgress ? "in progress" : session.isExtraPractice ? "extra" : "daily"}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderEventTable(events) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Card</th><th>Confidence</th><th>Correct</th><th>Previous due</th><th>Next due</th><th>Interval</th></tr></thead>
          <tbody>
            ${events
              .map(
                (event) =>
                  `<tr><td>${escapeHtml(event.cardId)}</td><td>${event.confidence}</td><td>${event.correct ? "yes" : "no"}</td><td>${formatDate(event.previousDueAt)}</td><td>${formatDate(event.nextDueAt)}</td><td>${event.previousIntervalDays} -> ${event.nextIntervalDays}</td></tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function startGraduation() {
    const eligibility = Core.graduationEligibility(state, new Date());
    if (!eligibility.eligible) {
      state = Core.recomputeGoalStatus(state, new Date());
      saveState();
      view = "home";
      render();
      return;
    }
    graduation = {
      startedAt: new Date().toISOString(),
      promptIds: Core.buildGraduationPrompts(),
      index: 0,
      responses: [],
      firstInputAt: null,
      promptShownAt: performance.now(),
      result: null,
    };
    view = "graduation";
    render();
    const input = document.querySelector("#graduation-input");
    if (input) input.focus();
  }

  function renderGraduation() {
    if (graduation.result) {
      return renderGraduationResult();
    }
    const definitions = Core.makeCardDefinitions();
    const cardId = graduation.promptIds[graduation.index];
    const definition = definitions[cardId];
    return `
      <main class="drill-shell">
        <header class="drill-status">
          <div><strong>${graduation.index + 1}</strong><span>of ${graduation.promptIds.length}</span></div>
          <div><strong>Untimed</strong><span>graduation check</span></div>
        </header>
        <section class="prompt-surface">
          <div class="prompt-meta"><span>No feedback until the end</span><span>${definition.group}</span></div>
          <h1 class="prompt-text">${escapeHtml(definition.prompt)}</h1>
          <label class="answer-label" for="graduation-input">Answer</label>
          <input id="graduation-input" class="answer-input" type="text" autocomplete="off" />
          <div class="confidence-row" aria-label="Submit graduation answer with confidence">
            ${Core.CONFIDENCES.map(
              (confidence) => `
                <button class="confidence-button" data-graduation-confidence="${confidence}">
                  <strong>${confidence}</strong>
                  <span>${confidenceHelp(confidence)}</span>
                </button>
              `,
            ).join("")}
          </div>
        </section>
      </main>
    `;
  }

  function submitGraduation(confidence) {
    const input = document.querySelector("#graduation-input");
    if (!input) return;
    const cardId = graduation.promptIds[graduation.index];
    graduation.responses.push({ cardId, submitted: input.value, confidence });
    graduation.index += 1;
    if (graduation.index >= graduation.promptIds.length) {
      const graded = Core.gradeGraduationCheck(state, graduation.responses, {
        startedAt: graduation.startedAt,
        now: new Date(),
      });
      state = graded.state;
      saveState();
      graduation.result = graded.check;
    }
    graduation.promptShownAt = performance.now();
    graduation.firstInputAt = null;
    render();
    const nextInput = document.querySelector("#graduation-input");
    if (nextInput) nextInput.focus();
  }

  function renderGraduationResult() {
    const check = graduation.result;
    if (check.passed) {
      return `
        <main class="app-shell">
          <section class="congrats">
            <p class="eyebrow">Completed ${formatDate(check.endedAt)}</p>
            <h1>You know the months of the year.</h1>
            <p>You can convert month numbers to names, month names to numbers, and type the full order.</p>
            <div class="summary-band">
              <div><strong>${check.singleAnswerCorrect}/${check.singleAnswerTotal}</strong><span>single answers</span></div>
              <div><strong>${check.neighborCorrect}/6</strong><span>neighbors</span></div>
              <div><strong>${check.sequenceCorrect ? "passed" : "failed"}</strong><span>full order</span></div>
            </div>
            <div class="action-row">
              <button class="primary-button" data-action="home">Continue with maintenance</button>
              <button class="secondary-button" data-action="settings">Review progress</button>
            </div>
          </section>
        </main>
      `;
    }
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Graduation check</p>
            <h1>Repair these routes</h1>
          </div>
          <button class="ghost-button" data-action="home">Home</button>
        </header>
        <section class="panel">
          <dl class="data-list">
            <div><dt>Number to name</dt><dd>${check.numberToNameCorrect}/12</dd></div>
            <div><dt>Name to number</dt><dd>${check.nameToNumberCorrect}/12</dd></div>
            <div><dt>Neighbor prompts</dt><dd>${check.neighborCorrect}/6</dd></div>
            <div><dt>Full sequence</dt><dd>${check.sequenceCorrect ? "passed" : "failed"}</dd></div>
            <div><dt>Failed cards</dt><dd>${escapeHtml(check.failedCardIds.join(", "))}</dd></div>
          </dl>
          <button class="primary-button" data-action="start-session">Practice missed material</button>
        </section>
      </main>
    `;
  }

  function renderInvalidStorage() {
    const errors = Array.isArray(storageProblem) ? storageProblem : [String(storageProblem)];
    return `
      <main class="app-shell">
        <section class="panel blocking">
          <p class="eyebrow">Storage problem</p>
          <h1>Progress data needs attention.</h1>
          <p>Normal practice is blocked while ${storageKey} is invalid.</p>
          <ul class="error-list">${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>
          <div class="action-row">
            <button class="secondary-button" data-action="export-json">Export raw JSON</button>
            <button class="secondary-button" data-action="copy-json">Copy raw JSON</button>
            <button class="danger-button" data-action="clear-progress">Clear local progress</button>
          </div>
        </section>
      </main>
    `;
  }

  function renderStorageError() {
    return `
      <main class="app-shell">
        <section class="panel blocking">
          <p class="eyebrow">Storage unavailable</p>
          <h1>Progress cannot be saved.</h1>
          <p>The app needs readable and writable localStorage for ${storageKey}.</p>
          <pre>${escapeHtml(storageProblem && storageProblem.message ? storageProblem.message : storageProblem)}</pre>
        </section>
      </main>
    `;
  }

  function render() {
    if (view === "storage-error") {
      root.innerHTML = renderStorageError();
    } else if (view === "invalid-storage") {
      root.innerHTML = renderInvalidStorage();
    } else if (view === "settings") {
      root.innerHTML = renderSettings();
    } else if (view === "drill") {
      root.innerHTML = renderDrill();
    } else if (view === "summary") {
      root.innerHTML = renderSummary();
    } else if (view === "graduation") {
      root.innerHTML = renderGraduation();
    } else {
      root.innerHTML = renderHome();
    }
  }

  function routeAction(action) {
    if (action === "settings") {
      view = "settings";
      render();
    } else if (action === "home") {
      stopTimer();
      activeSession = null;
      activeCard = null;
      feedback = null;
      graduation = null;
      state = Core.recomputeGoalStatus(state, new Date());
      saveState();
      view = "home";
      render();
    } else if (action === "start-session") {
      startSession(false);
    } else if (action === "practice-again") {
      startSession(true);
    } else if (action === "finish-session") {
      finishSession();
    } else if (action === "next-card") {
      loadNextCard();
    } else if (action === "clear-progress") {
      clearProgress();
    } else if (action === "export-json") {
      downloadRawExport();
    } else if (action === "copy-json") {
      copyRawExport();
    } else if (action === "start-graduation") {
      startGraduation();
    }
  }

  root.addEventListener("click", (event) => {
    const confidenceButton = event.target.closest("[data-confidence]");
    if (confidenceButton) {
      submitAnswer(confidenceButton.dataset.confidence);
      return;
    }
    const graduationButton = event.target.closest("[data-graduation-confidence]");
    if (graduationButton) {
      submitGraduation(graduationButton.dataset.graduationConfidence);
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      routeAction(actionButton.dataset.action);
    }
  });

  root.addEventListener("input", (event) => {
    if ((event.target.id === "answer-input" || event.target.id === "graduation-input") && firstInputAt === null) {
      firstInputAt = performance.now();
      if (graduation) {
        graduation.firstInputAt = firstInputAt;
      }
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.target.id === "answer-input" || event.target.id === "graduation-input") {
      if (event.key === "Enter") {
        event.preventDefault();
      }
    }
  });

  loadState();
  if (view !== "invalid-storage" && view !== "storage-error") {
    view = "home";
  }
  render();
})();
