"use strict";

(function bootMonthsLearnerApp() {
  const Core = window.MonthsLearnerCore;
  const root = document.getElementById("app");
  const urlParams = new URLSearchParams(window.location.search);
  const graduationTestMode = urlParams.has("graduationTest");
  const storageKey = graduationTestMode ? `${Core.STORAGE_KEY}.graduationTest` : Core.STORAGE_KEY;

  let state = null;
  let view = "home";
  let storageProblem = null;
  let invalidStoredRaw = null;
  let activeSession = null;
  let activeCard = null;
  let feedback = null;
  let toast = null;
  let promptShownAt = 0;
  let firstInputAt = null;
  let timerHandle = null;
  let autoAdvanceHandle = null;
  let sureFlashHandle = null;
  let enterSubmitPending = false;
  let graduation = null;
  const CORRECT_FEEDBACK_MS = 900;

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

    if (graduationTestMode) {
      state = createGraduationTestState(new Date());
      saveState();
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

  function createGraduationTestState(now) {
    const readyState = Core.createInitialState(now);
    const dueAt = Core.nextDueAt(now, 30);
    Object.values(readyState.cards).forEach((card) => {
      card.dueAt = dueAt;
      card.intervalDays = 30;
      card.reps = 4;
      card.lastResult = "correct";
      card.lastConfidence = "Sure";
      card.lastSlowRecall = false;
      card.lastAnsweredAt = now.toISOString();
      card.lastResponseMs = 1000;
      card.lastTimeToFirstInputMs = 200;
      card.lastTypingDurationMs = 800;
    });

    let seededState = readyState;
    [8, 4, 0].forEach((daysAgo) => {
      const started = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 8, 0, 0, 0);
      const draft = Core.createSessionDraft(seededState, { now: started });
      draft.elapsedSeconds = 60;
      seededState = Core.completeSession(seededState, draft, new Date(started.getTime() + 60000));
      const latest = seededState.sessions[seededState.sessions.length - 1];
      latest.answers = 1;
      latest.correct = 1;
      latest.averageResponseMs = 1000;
    });

    return Core.recomputeGoalStatus(seededState, now);
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

  function completedSessionCount() {
    return state.sessions.filter((session) => session.isInProgress !== true).length;
  }

  function plural(value, singular, pluralValue) {
    return value === 1 ? singular : pluralValue;
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

  function trendLine(label = "Last 7 sessions mastery trend") {
    const recent = Core.recentSessionSummaries(state);
    if (recent.length === 0) {
      return '<p class="compact">No mastery trend yet.</p>';
    }
    const plotted = recent.map((session, index) => {
      const x = recent.length === 1 ? 50 : Math.round((index / (recent.length - 1)) * 100);
      const y = Math.round(92 - session.masteryPercent * 0.84);
      return { x, y };
    });
    const points = plotted.map((point) => `${point.x},${point.y}`).join(" ");
    return `
      <div class="trend" aria-label="${escapeHtml(label)}">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
          <polyline points="${points}" />
          ${plotted.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" />`).join("")}
        </svg>
      </div>
    `;
  }

  function progressTrendPanel() {
    const recent = Core.recentSessionSummaries(state);
    if (recent.length === 0) {
      return "";
    }
    const first = recent[0];
    const latest = recent[recent.length - 1];
    const change = latest.masteryPercent - first.masteryPercent;
    const changeText =
      change > 0
        ? `up ${change} ${plural(change, "point", "points")}`
        : change < 0
          ? `down ${Math.abs(change)} ${plural(Math.abs(change), "point", "points")}`
          : "steady";
    return `
      <section class="panel progress-trend-panel" aria-labelledby="trend-heading">
        <div class="panel-heading">
          <h2 id="trend-heading">Progress over time</h2>
          <span class="status-pill">Last ${recent.length} ${plural(recent.length, "session", "sessions")}</span>
        </div>
        ${trendLine("Mastery over recent sessions")}
        <p class="compact">Mastery is ${changeText} across the saved sessions shown here.</p>
      </section>
    `;
  }

  function sessionSummaryBand(session) {
    const accuracy = session.answers ? percent(session.correct, session.answers) : 0;
    return `
      <section class="summary-band" aria-label="Session summary">
        <div><strong>${accuracy}%</strong><span>accuracy</span></div>
        <div><strong>${session.answers}</strong><span>reviewed</span></div>
        <div><strong>${formatMs(session.averageResponseMs)}</strong><span>average pace</span></div>
        <div><strong>${session.relearnedCards}</strong><span>relearned</span></div>
      </section>
    `;
  }

  function sessionProgressPanel(session) {
    const snapshot = session.masterySnapshot;
    return `
      <section class="panel">
        <h2>${snapshot.masteryPercent}% mastery</h2>
        ${progressBar(snapshot)}
        <p>Today: ${snapshot.becameFluent} ${plural(snapshot.becameFluent, "card", "cards")} became fluent, ${snapshot.becameWeak} ${plural(snapshot.becameWeak, "needs", "need")} review again.</p>
        <p>Next due: ${snapshot.nextDueAt ? formatDate(snapshot.nextDueAt) : "No scheduled review yet"}.</p>
      </section>
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
      graduationTestMode
        ? '<button class="primary-button" data-action="start-graduation">Take graduation check</button>'
        : achieved && snapshot.dueCards === 0
        ? '<button class="primary-button" data-action="settings">Review progress</button>'
        : `<button class="primary-button" data-action="start-session">${achieved ? "Start maintenance" : "Start practice"}</button>`;
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Months of the Year Learner</p>
            <h1>${graduationTestMode ? "Graduation test mode" : achieved ? "Maintenance review" : "Today's 5 minute practice"}</h1>
          </div>
          <button class="ghost-button" data-action="settings">Settings</button>
        </header>
        ${monthStrip()}
        <section class="start-band">
          <div>
            <p class="timer-readout">5:00</p>
            <p class="compact">${snapshot.dueCards} cards due now. ${snapshot.overdueCards} overdue.</p>
            ${graduatedAt}
          </div>
          <div class="action-row">
            ${primaryAction}
            ${
              eligibility.eligible && !graduationTestMode
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

  function clearAutoAdvance() {
    if (autoAdvanceHandle) {
      window.clearTimeout(autoAdvanceHandle);
      autoAdvanceHandle = null;
    }
    toast = null;
  }

  function clearSureFlash() {
    if (sureFlashHandle) {
      window.clearTimeout(sureFlashHandle);
      sureFlashHandle = null;
    }
    enterSubmitPending = false;
  }

  function renderTimerOnly() {
    const node = document.querySelector("[data-timer]");
    if (node && activeSession) node.textContent = remainingTime();
    const phase = document.querySelector("[data-phase]");
    if (phase && activeSession) phase.textContent = drillPhaseLabel(Core.sessionPhase(activeSession.elapsedSeconds));
  }

  function drillPhaseLabel(phase) {
    if (phase === "start_check") return "Get ready";
    if (phase === "warmup") return "Starting practice";
    if (phase === "main") return "Practice";
    if (phase === "fluency") return "Mixed practice";
    if (phase === "sequence") return "Month order";
    return "Practice";
  }

  function cardKindLabel(definition, isRetry) {
    if (isRetry) return "Try again";
    if (!definition) return "Complete";
    if (definition.group === "neighbor") return "Before/after";
    if (definition.group === "sequence") return "Month order";
    if (definition.group === "cycle") return "Cycle practice";
    return "Month number";
  }

  function flashSureButton() {
    const button = document.querySelector('[data-confidence="Sure"]');
    if (!button) return;
    button.classList.add("keyboard-flash");
    if (sureFlashHandle) {
      window.clearTimeout(sureFlashHandle);
    }
    sureFlashHandle = window.setTimeout(() => {
      button.classList.remove("keyboard-flash");
      sureFlashHandle = null;
    }, 220);
  }

  function submitSureFromKeyboard() {
    if (enterSubmitPending || !activeCard || feedback || toast) return;
    enterSubmitPending = true;
    flashSureButton();
    window.setTimeout(() => {
      enterSubmitPending = false;
      submitAnswer("Sure");
    }, 120);
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
      finishSession();
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
    toast = null;
    clearSureFlash();
    promptShownAt = performance.now();
    firstInputAt = null;
    render();
    const input = document.querySelector("#answer-input");
    if (input) input.focus();
  }

  function submitAnswer(confidence) {
    const input = document.querySelector("#answer-input");
    if (!input || !activeCard || feedback || toast) return;
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

    if (applied.event.correct) {
      feedback = null;
      toast = applied.event;
      render();
      autoAdvanceHandle = window.setTimeout(() => {
        autoAdvanceHandle = null;
        toast = null;
        loadNextCard();
      }, CORRECT_FEEDBACK_MS);
      return;
    }

    feedback = applied.event;
    render();
    const nextButton = document.querySelector("[data-action='next-card']");
    if (nextButton) nextButton.focus({ preventScroll: true });
  }

  function finishSession() {
    if (!activeSession) return;
    stopTimer();
    clearAutoAdvance();
    clearSureFlash();
    activeSession.elapsedSeconds = Math.round((Date.now() - new Date(activeSession.startedAt).getTime()) / 1000);
    state = Core.completeSession(state, activeSession, new Date());
    saveState();
    activeSession = null;
    activeCard = null;
    feedback = null;
    toast = null;
    view = "summary";
    render();
  }

  function renderDrill() {
    if (!activeCard) {
      throw new Error("Drill view requires an active card. Finish the session when no work remains.");
    }
    const definitions = Core.makeCardDefinitions();
    const snapshot = Core.computeMasterySnapshot(state, new Date());
    const eventCount = activeSession.answerEvents.length;
    const correct = activeSession.answerEvents.filter((event) => event.correct).length;
    const accuracy = eventCount ? percent(correct, eventCount) : 0;
    const canStop = snapshot.dueCards === 0 && activeSession.retryQueue.length === 0;
    const answerArea = feedback ? renderFeedback() : renderPrompt(activeCard.definition);
    const toastMarkup = toast ? renderCorrectToast() : "";
    const groupLabel = cardKindLabel(definitions[activeCard.cardId], activeCard.isRetry);

    return `
      <main class="drill-shell">
        <header class="drill-status">
          <div><strong data-timer>${remainingTime()}</strong><span>remaining</span></div>
          <div><strong>${snapshot.dueCards}</strong><span>due</span></div>
          <div><strong>${accuracy}%</strong><span>accuracy</span></div>
          <div><strong data-phase>${drillPhaseLabel(Core.sessionPhase(activeSession.elapsedSeconds))}</strong><span>activity</span></div>
        </header>
        <section class="prompt-surface" aria-live="polite">
          <div class="prompt-meta">
            <span>${activeSession.isExtraPractice ? "Extra practice" : "Daily session"}</span>
            <span>${groupLabel}</span>
          </div>
          ${answerArea}
          ${toastMarkup}
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

  function renderPrompt(definition) {
    return `
      ${renderPromptInstruction(definition)}
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

  function promptInstruction(definition) {
    if (!definition) return "";
    if (definition.id === "gap_fill:even_months") return "Type the missing months in order.";
    if (definition.id === "ordinal_sequence:full") return "Type all 12 months in order.";
    if (definition.id === "ordinal_sequence:first_half") return "Type months 1 to 6 in order.";
    if (definition.id === "ordinal_sequence:second_half") return "Type months 7 to 12 in order.";
    return "";
  }

  function renderPromptInstruction(definition) {
    const instruction = promptInstruction(definition);
    return instruction ? `<p class="prompt-instruction">${escapeHtml(instruction)}</p>` : "";
  }

  function confidenceHelp(confidence) {
    if (confidence === "Sure") return "I knew it.";
    if (confidence === "Unsure") return "I think this is right.";
    return "I am guessing.";
  }

  function renderFeedback() {
    return `
      ${renderPromptInstruction(activeCard ? activeCard.definition : null)}
      <h1 class="prompt-text">${escapeHtml(feedback.prompt)}</h1>
      <label class="answer-label" for="answer-input">Answer</label>
      <input id="answer-input" class="answer-input" type="text" value="${escapeHtml(feedback.submitted || "")}" disabled />
      <div class="correction-row" aria-live="polite">
        <span class="feedback-label incorrect-label">Incorrect</span>
        <span class="correction-line">Correct answer: <strong>${escapeHtml(feedback.expected)}</strong></span>
        <button class="primary-button" data-action="next-card">Continue</button>
      </div>
    `;
  }

  function renderCorrectToast() {
    return `
      <div class="correct-toast" role="status" aria-live="polite">
        <span class="correct-ring correct-ring-primary" aria-hidden="true"></span>
        <span class="correct-ring correct-ring-secondary" aria-hidden="true"></span>
        <span class="correct-label">Correct!</span>
      </div>
    `;
  }

  function alignCorrectToastToInput() {
    const toastNode = document.querySelector(".correct-toast");
    if (!toastNode) return;
    const inputNode = document.querySelector("#answer-input");
    const surfaceNode = toastNode.closest(".prompt-surface");
    if (!inputNode || !surfaceNode) return;

    const inputRect = inputNode.getBoundingClientRect();
    const surfaceRect = surfaceNode.getBoundingClientRect();
    const inputCenterY = inputRect.top + inputRect.height / 2 - surfaceRect.top;
    toastNode.style.setProperty("--correct-settle-y", `${Math.round(inputCenterY)}px`);
  }

  function renderSummary() {
    const latest = state.sessions[state.sessions.length - 1];
    const eligibility = Core.graduationEligibility(state, new Date());
    const achieved = state.goal.status === "achieved";
    const sessionCount = completedSessionCount();
    const sessionNoun = plural(sessionCount, "session", "sessions");
    return `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">${latest.isExtraPractice ? "Extra practice" : "Daily session"}</p>
            <h1>${achieved ? "Goal achieved" : "Session complete"}</h1>
            <p class="summary-lede">You completed ${sessionCount} ${sessionNoun}! Every answer updated your practice plan and moved you closer to knowing the months without help.</p>
          </div>
          <button class="ghost-button" data-action="home">Home</button>
        </header>
        ${sessionSummaryBand(latest)}
        ${sessionProgressPanel(latest)}
        ${progressTrendPanel()}
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
          ${renderPromptInstruction(definition)}
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
    alignCorrectToastToInput();
  }

  function routeAction(action) {
    if (action === "settings") {
      view = "settings";
      render();
    } else if (action === "home") {
      stopTimer();
      clearAutoAdvance();
      clearSureFlash();
      activeSession = null;
      activeCard = null;
      feedback = null;
      toast = null;
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
        if (event.target.id === "answer-input") {
          submitSureFromKeyboard();
        }
      }
    }
  });

  loadState();
  if (view !== "invalid-storage" && view !== "storage-error") {
    view = "home";
  }
  render();
})();
