"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

const baseNow = new Date("2026-05-17T08:00:00.000Z");

function timing(overrides = {}) {
  return {
    responseMs: 1200,
    timeToFirstInputMs: 300,
    typingDurationMs: 900,
    ...overrides,
  };
}

function apply(state, cardId, submitted, confidence, options = {}) {
  return Core.applyReview(state, cardId, submitted, confidence, timing(options.timing), {
    now: options.now || baseNow,
    isRetry: options.isRetry === true,
    isExtraPractice: options.isExtraPractice === true,
  });
}

function makeFluentState(now = baseNow) {
  const state = Core.createInitialState(now);
  const dueAt = Core.nextDueAt(now, 30);
  Object.entries(state.cards).forEach(([cardId, card]) => {
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
  state.sessions.push(
    { id: "2026-05-10-001", localDate: "2026-05-10", answers: 1, correct: 1, isExtraPractice: false, answerEvents: [] },
    { id: "2026-05-14-001", localDate: "2026-05-14", answers: 1, correct: 1, isExtraPractice: false, answerEvents: [] },
    { id: "2026-05-17-001", localDate: "2026-05-17", answers: 1, correct: 1, isExtraPractice: false, answerEvents: [] },
  );
  return state;
}

test("initial state seeds the canonical MVP cards due immediately", () => {
  const state = Core.createInitialState(baseNow);
  assert.equal(state.version, 1);
  assert.equal(state.settings.dailyMinutes, 5);
  assert.equal(Object.keys(state.cards).length, 50);
  assert.equal(Core.knownCardIds().length, 50);
  assert.equal(Core.computeMasterySnapshot(state, baseNow).dueCards, 50);
  assert.equal(Core.validateState(state).ok, true);
});

test("stored progress migrates from the previous 8 minute setting", () => {
  const state = Core.createInitialState(baseNow);
  state.settings.dailyMinutes = 8;

  const parsed = Core.parseStoredState(JSON.stringify(state));

  assert.equal(parsed.status, "valid");
  assert.equal(parsed.state.settings.dailyMinutes, 5);
  assert.equal(Core.validateState(parsed.state).ok, true);
});

test("answer checking requires full month names and exact month numbers", () => {
  const definitions = Core.makeCardDefinitions();
  assert.equal(Core.checkAnswer(definitions["number_to_name:4"], " april ").correct, true);
  assert.equal(Core.checkAnswer(definitions["number_to_name:4"], "Apr").correct, false);
  assert.equal(Core.checkAnswer(definitions["number_to_name:4"], "Aprel").correct, false);
  assert.equal(Core.checkAnswer(definitions["name_to_number:4"], "04").correct, true);
  assert.equal(Core.checkAnswer(definitions["name_to_number:4"], "4.0").correct, false);
  assert.equal(Core.checkAnswer(definitions["name_to_number:4"], "4abc").correct, false);
});

test("sequence checking accepts commas, spaces, and line breaks in exact order", () => {
  const definitions = Core.makeCardDefinitions();
  const full = definitions["ordinal_sequence:first_half"];
  assert.equal(Core.checkAnswer(full, "January February\nMarch, April May June").correct, true);
  assert.equal(Core.checkAnswer(full, "January February March May April June").correct, false);
  assert.equal(Core.checkAnswer(definitions["gap_fill:even_months"], "February, April June August October December").correct, true);
});

test("scheduler handles incorrect answers, retry correction, and retry guessed state", () => {
  let state = Core.createInitialState(baseNow);
  let result = apply(state, "number_to_name:4", "May", "Sure");
  state = result.state;
  assert.equal(result.retryNeeded, true);
  assert.equal(state.cards["number_to_name:4"].intervalDays, 0);
  assert.equal(state.cards["number_to_name:4"].lapses, 1);
  assert.equal(state.cards["number_to_name:4"].ease, 2.1);
  assert.equal(Core.cardLevel(state.cards["number_to_name:4"]), "weak");

  result = apply(state, "number_to_name:4", "April", "Sure", { isRetry: true });
  state = result.state;
  assert.equal(result.retryResolved, true);
  assert.equal(state.cards["number_to_name:4"].intervalDays, 1);
  assert.equal(state.cards["number_to_name:4"].reps, 0);
  assert.equal(Core.cardLevel(state.cards["number_to_name:4"]), "learning");

  result = apply(state, "number_to_name:5", "May", "Guessed", { isRetry: true });
  assert.equal(result.retryNeeded, true);
  assert.equal(result.state.cards["number_to_name:5"].intervalDays, 0);
  assert.equal(Core.cardLevel(result.state.cards["number_to_name:5"]), "weak");
});

test("scheduler applies deterministic confidence intervals and caps at 60 days", () => {
  let state = Core.createInitialState(baseNow);
  let result = apply(state, "number_to_name:4", "April", "Sure");
  state = result.state;
  assert.equal(state.cards["number_to_name:4"].reps, 1);
  assert.equal(state.cards["number_to_name:4"].intervalDays, 1);

  result = apply(state, "number_to_name:4", "April", "Sure", { now: new Date("2026-05-18T08:00:00.000Z") });
  state = result.state;
  assert.equal(state.cards["number_to_name:4"].intervalDays, 3);

  result = apply(state, "number_to_name:4", "April", "Sure", { now: new Date("2026-05-21T08:00:00.000Z") });
  state = result.state;
  assert.equal(state.cards["number_to_name:4"].intervalDays, 7);
  assert.equal(Core.cardLevel(state.cards["number_to_name:4"]), "fluent");

  state.cards["number_to_name:4"].intervalDays = 59;
  state.cards["number_to_name:4"].reps = 4;
  result = apply(state, "number_to_name:4", "April", "Sure", { now: new Date("2026-06-01T08:00:00.000Z") });
  assert.equal(result.state.cards["number_to_name:4"].intervalDays, 60);
});

test("guessed first attempts schedule one day but do not increment credited reps", () => {
  const state = Core.createInitialState(baseNow);
  const result = apply(state, "name_to_number:9", "9", "Guessed");
  const card = result.state.cards["name_to_number:9"];
  assert.equal(card.intervalDays, 1);
  assert.equal(card.reps, 0);
  assert.equal(card.ease, 2.2);
  assert.equal(Core.cardLevel(card), "weak");
});

test("slow recall is ignored before baseline and caps interval after calibration", () => {
  let state = Core.createInitialState(baseNow);
  let result = apply(state, "name_to_number:8", "8", "Unsure", {
    timing: { responseMs: 9000, timeToFirstInputMs: 5000, typingDurationMs: 4000 },
  });
  assert.equal(result.state.cards["name_to_number:8"].lastSlowRecall, false);

  state = result.state;
  state.settings.typingBaselineMsPerChar = 120;
  state.sessions.push(
    { id: "2026-05-10-001", localDate: "2026-05-10", answers: 1, correct: 1, isExtraPractice: false, answerEvents: [] },
    { id: "2026-05-11-001", localDate: "2026-05-11", answers: 1, correct: 1, isExtraPractice: false, answerEvents: [] },
  );
  state.cards["name_to_number:8"].reps = 3;
  state.cards["name_to_number:8"].intervalDays = 4;
  result = apply(state, "name_to_number:8", "8", "Unsure", {
    now: new Date("2026-05-24T08:00:00.000Z"),
    timing: { responseMs: 7000, timeToFirstInputMs: 3000, typingDurationMs: 4000 },
  });
  assert.equal(result.state.cards["name_to_number:8"].lastSlowRecall, true);
  assert.equal(result.state.cards["name_to_number:8"].intervalDays, 5);
});

test("extra practice records an event without changing SRS fields", () => {
  const state = Core.createInitialState(baseNow);
  const before = structuredClone(state.cards["number_to_name:1"]);
  const result = apply(state, "number_to_name:1", "January", "Sure", { isExtraPractice: true });
  assert.deepEqual(result.state.cards["number_to_name:1"], before);
  assert.equal(result.event.srsChanged, false);
  assert.equal(result.event.correct, true);
});

test("due cards keep historical level but do not count toward mastery readiness", () => {
  const state = makeFluentState(baseNow);
  state.cards["number_to_name:1"].dueAt = baseNow.toISOString();
  const snapshot = Core.computeMasterySnapshot(state, baseNow);
  assert.equal(Core.cardLevel(state.cards["number_to_name:1"]), "durable");
  assert.equal(snapshot.dueCards, 1);
  assert.equal(snapshot.durableCards, 50);
  assert.equal(snapshot.masteryPercent, 98);
  assert.equal(Core.graduationEligibility(state, baseNow).eligible, false);
});

test("session phase boundaries match the 5 minute session shape", () => {
  assert.equal(Core.sessionPhase(0), "start_check");
  assert.equal(Core.sessionPhase(14), "start_check");
  assert.equal(Core.sessionPhase(15), "warmup");
  assert.equal(Core.sessionPhase(59), "warmup");
  assert.equal(Core.sessionPhase(60), "main");
  assert.equal(Core.sessionPhase(199), "main");
  assert.equal(Core.sessionPhase(200), "fluency");
  assert.equal(Core.sessionPhase(269), "fluency");
  assert.equal(Core.sessionPhase(270), "sequence");
});

test("selector does not invent work when no due or mastered cards exist", () => {
  const state = Core.createInitialState(baseNow);
  Object.values(state.cards).forEach((card) => {
    card.dueAt = Core.nextDueAt(baseNow, 3);
  });
  const draft = Core.createSessionDraft(state, { now: baseNow });
  assert.equal(Core.selectNextCard(state, draft, baseNow), null);

  state.cards["number_to_name:1"].lastResult = "correct";
  state.cards["number_to_name:1"].lastConfidence = "Sure";
  state.cards["number_to_name:1"].lastSlowRecall = false;
  state.cards["number_to_name:1"].intervalDays = 7;
  state.cards["number_to_name:1"].reps = 3;
  assert.equal(Core.selectNextCard(state, draft, baseNow).cardId, "number_to_name:1");
});

test("initial due selection is deterministic and mixes prompt types", () => {
  function collectOrder() {
    let state = Core.createInitialState(baseNow);
    const draft = Core.createSessionDraft(state, { now: baseNow });
    const definitions = Core.makeCardDefinitions();
    const order = [];

    for (let index = 0; index < Core.CARD_TOTAL; index += 1) {
      const selection = Core.selectNextCard(state, draft, baseNow);
      assert.ok(selection, "expected another due card");
      order.push(selection.cardId);
      draft.shownCount += 1;
      const result = Core.applyReview(
        state,
        selection.cardId,
        Core.expectedAnswer(definitions[selection.cardId]),
        "Sure",
        timing(),
        { now: baseNow },
      );
      state = result.state;
      draft.answerEvents.push(result.event);
    }

    return order;
  }

  const order = collectOrder();
  assert.deepEqual(order, collectOrder());
  assert.ok(new Set(order.slice(0, 12).map((cardId) => Core.makeCardDefinitions()[cardId].group)).size > 1);

  const numberToNameMonths = order
    .filter((cardId) => cardId.startsWith("number_to_name:"))
    .map((cardId) => Number(cardId.split(":")[1]));
  assert.notDeepEqual(numberToNameMonths, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("in-progress session audit events persist and final completion replaces the draft record", () => {
  let state = Core.createInitialState(baseNow);
  const draft = Core.createSessionDraft(state, { now: baseNow });
  const result = Core.applyReview(state, "number_to_name:1", "January", "Sure", timing(), { now: baseNow });
  state = result.state;
  draft.answerEvents.push(result.event);
  state = Core.recordInProgressSession(state, draft, new Date("2026-05-17T08:01:00.000Z"));

  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].isInProgress, true);
  assert.equal(state.sessions[0].endedAt, null);
  assert.equal(state.sessions[0].answerEvents.length, 1);
  assert.equal(Core.validateState(state).ok, true);

  state = Core.completeSession(state, draft, new Date("2026-05-17T08:05:00.000Z"));
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].isInProgress, false);
  assert.equal(state.sessions[0].endedAt, "2026-05-17T08:05:00.000Z");
  assert.equal(Core.validateState(state).ok, true);
});

test("graduation eligibility requires card readiness and spaced practice days", () => {
  const state = makeFluentState(baseNow);
  const eligibility = Core.graduationEligibility(state, baseNow);
  assert.equal(eligibility.eligible, true);

  state.cards["previous_month:12"].lastResult = "incorrect";
  assert.equal(Core.graduationEligibility(state, baseNow).eligible, false);
});

test("graduation check enforces separate thresholds and guessed answers fail prompts", () => {
  const state = makeFluentState(baseNow);
  const definitions = Core.makeCardDefinitions();
  const promptIds = Core.buildGraduationPrompts();
  const responses = promptIds.map((cardId) => ({
    cardId,
    submitted: Core.expectedAnswer(definitions[cardId]),
    confidence: "Sure",
  }));
  responses[0].confidence = "Guessed";

  const graded = Core.gradeGraduationCheck(state, responses, {
    startedAt: baseNow,
    now: new Date("2026-05-24T08:00:00.000Z"),
  });

  assert.equal(graded.check.passed, false);
  assert.equal(graded.check.numberToNameCorrect, 11);
  assert.deepEqual(graded.check.failedCardIds, ["number_to_name:1"]);
  assert.equal(graded.check.promptResults.length, 31);
  assert.equal(graded.check.promptResults[0].correct, true);
  assert.equal(graded.check.promptResults[0].passed, false);
  assert.equal(graded.state.goal.status, "in_progress");
  assert.equal(Core.cardLevel(graded.state.cards["number_to_name:1"]), "weak");
  assert.equal(graded.state.cards["number_to_name:1"].dueAt, "2026-05-24T08:00:00.000Z");
});

test("graduation prompts shuffle and grading accepts shuffled response order", () => {
  const state = makeFluentState(baseNow);
  const definitions = Core.makeCardDefinitions();
  const canonical = Core.buildGraduationPrompts();
  const shuffled = Core.shuffleGraduationPrompts(() => 0);

  assert.notDeepEqual(shuffled, canonical);
  assert.deepEqual([...shuffled].sort(), [...canonical].sort());

  const responses = shuffled.map((cardId) => ({
    cardId,
    submitted: Core.expectedAnswer(definitions[cardId]),
    confidence: "Sure",
  }));
  const graded = Core.gradeGraduationCheck(state, responses, {
    startedAt: baseNow,
    now: new Date("2026-05-24T08:00:00.000Z"),
  });

  assert.equal(graded.check.passed, true);
  assert.deepEqual(
    graded.check.promptResults.map((result) => result.cardId),
    shuffled,
  );
});

test("passed graduation check records achievement without altering ready cards", () => {
  const state = makeFluentState(baseNow);
  const definitions = Core.makeCardDefinitions();
  const responses = Core.buildGraduationPrompts().map((cardId) => ({
    cardId,
    submitted: Core.expectedAnswer(definitions[cardId]),
    confidence: "Sure",
  }));

  const graded = Core.gradeGraduationCheck(state, responses, {
    startedAt: baseNow,
    now: new Date("2026-05-24T08:00:00.000Z"),
  });

  assert.equal(graded.check.passed, true);
  assert.equal(graded.state.goal.status, "achieved");
  assert.equal(graded.state.goal.graduatedAt, "2026-05-24T08:00:00.000Z");
  assert.equal(graded.state.cards["number_to_name:1"].intervalDays, 30);
});

test("storage validation blocks malformed or drifted data", () => {
  const state = Core.createInitialState(baseNow);
  const validRaw = JSON.stringify(state);
  assert.equal(Core.parseStoredState(validRaw).status, "valid");

  const wrongVersion = structuredClone(state);
  wrongVersion.version = 2;
  assert.equal(Core.parseStoredState(JSON.stringify(wrongVersion)).status, "invalid");

  const missingCard = structuredClone(state);
  delete missingCard.cards["number_to_name:1"];
  const parsed = Core.parseStoredState(JSON.stringify(missingCard));
  assert.equal(parsed.status, "invalid");
  assert.ok(parsed.errors.some((error) => error.includes("Missing known card number_to_name:1")));

  const nullDue = structuredClone(state);
  nullDue.cards["number_to_name:1"].dueAt = null;
  assert.equal(Core.parseStoredState(JSON.stringify(nullDue)).status, "invalid");

  const looseDate = structuredClone(state);
  looseDate.createdAt = "May 17, 2026";
  assert.equal(Core.parseStoredState(JSON.stringify(looseDate)).status, "invalid");

  const impossibleIso = structuredClone(state);
  impossibleIso.createdAt = "2026-02-31T00:00:00.000Z";
  assert.equal(Core.parseStoredState(JSON.stringify(impossibleIso)).status, "invalid");

  const impossibleLocalDate = structuredClone(state);
  const sessionDraft = Core.createSessionDraft(impossibleLocalDate, { now: baseNow });
  const inProgress = Core.recordInProgressSession(impossibleLocalDate, sessionDraft, baseNow);
  impossibleLocalDate.sessions = inProgress.sessions;
  impossibleLocalDate.sessions[0].localDate = "2026-02-31";
  assert.equal(Core.parseStoredState(JSON.stringify(impossibleLocalDate)).status, "invalid");

  const badEase = structuredClone(state);
  badEase.cards["number_to_name:1"].ease = 99;
  assert.equal(Core.parseStoredState(JSON.stringify(badEase)).status, "invalid");

  const badSession = structuredClone(state);
  badSession.sessions = [null];
  assert.equal(Core.parseStoredState(JSON.stringify(badSession)).status, "invalid");

  const badCheck = structuredClone(state);
  badCheck.goal.graduationChecks = [null];
  assert.equal(Core.parseStoredState(JSON.stringify(badCheck)).status, "invalid");
});

test("session completion stores per-answer scheduler events and updates baseline after two sessions", () => {
  let state = Core.createInitialState(baseNow);
  let draft = Core.createSessionDraft(state, { now: baseNow });
  for (const cardId of ["number_to_name:1", "number_to_name:2", "number_to_name:3"]) {
    const result = Core.applyReview(state, cardId, Core.expectedAnswer(Core.makeCardDefinitions()[cardId]), "Sure", timing(), {
      now: baseNow,
    });
    state = result.state;
    draft.answerEvents.push(result.event);
  }
  state = Core.completeSession(state, draft, new Date("2026-05-17T08:05:00.000Z"));

  draft = Core.createSessionDraft(state, { now: new Date("2026-05-18T08:00:00.000Z") });
  for (const cardId of ["number_to_name:4", "number_to_name:5", "number_to_name:6"]) {
    const result = Core.applyReview(state, cardId, Core.expectedAnswer(Core.makeCardDefinitions()[cardId]), "Sure", timing(), {
      now: new Date("2026-05-18T08:00:00.000Z"),
    });
    state = result.state;
    draft.answerEvents.push(result.event);
  }
  state = Core.completeSession(state, draft, new Date("2026-05-18T08:05:00.000Z"));

  assert.equal(state.sessions.length, 2);
  assert.equal(state.sessions[1].answerEvents.length, 3);
  assert.equal(typeof state.settings.typingBaselineMsPerChar, "number");
});
