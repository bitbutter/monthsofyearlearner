"use strict";

const MonthsLearnerCore = (function buildMonthsLearnerCore() {
  const STORAGE_KEY = "monthsOfYearLearner.v1";
  const SCHEMA_VERSION = 1;
  const DAILY_MINUTES = 5;
  const MONTHS = Object.freeze([
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]);
  const CONFIDENCES = Object.freeze(["Sure", "Unsure", "Guessed"]);
  const CARD_TOTAL = 50;

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    assert(!Number.isNaN(date.getTime()), `Invalid date: ${value}`);
    return date;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function toLocalDateKey(value) {
    const date = asDate(value);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localDateToDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    assert(match, `Invalid local date: ${value}`);
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  }

  function getTimeZoneName() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    } catch (_error) {
      return "unknown";
    }
  }

  function startOfLocalDay(value) {
    const date = asDate(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  function nextDueAt(now, days) {
    const date = asDate(now);
    const due = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 6, 0, 0, 0);
    return due.toISOString();
  }

  function isDue(dueAt, now) {
    return asDate(dueAt).getTime() <= asDate(now).getTime();
  }

  function isOverdue(dueAt, now) {
    return asDate(dueAt).getTime() < startOfLocalDay(now).getTime();
  }

  function sameOrFutureLocalDate(a, b) {
    return localDateToDate(a).getTime() >= localDateToDate(b).getTime();
  }

  function monthName(month) {
    assert(Number.isInteger(month) && month >= 1 && month <= 12, `Invalid month number: ${month}`);
    return MONTHS[month - 1];
  }

  function normalizeMonthName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseMonthNumber(value) {
    const text = String(value || "").trim();
    if (!/^\d+$/.test(text)) {
      return null;
    }
    const number = Number.parseInt(text, 10);
    if (!Number.isInteger(number) || number < 1 || number > 12) {
      return null;
    }
    return number;
  }

  function sequenceTokens(value) {
    return String(value || "")
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function makeCardDefinitions(options = {}) {
    const wrapSequencePrompts = options.wrapSequencePrompts === true;
    const definitions = {};

    for (let month = 1; month <= 12; month += 1) {
      definitions[`number_to_name:${month}`] = {
        id: `number_to_name:${month}`,
        type: "number_to_name",
        group: "conversion",
        month,
        prompt: `What is month ${month}?`,
        expectedMonths: [month],
      };
      definitions[`name_to_number:${month}`] = {
        id: `name_to_number:${month}`,
        type: "name_to_number",
        group: "conversion",
        month,
        prompt: `What number is ${monthName(month)}?`,
        expectedNumber: month,
      };
    }

    for (let month = 1; month <= 11; month += 1) {
      definitions[`next_month:${month}`] = {
        id: `next_month:${month}`,
        type: "next_month",
        group: "neighbor",
        month,
        prompt: `What month comes after ${monthName(month)}?`,
        expectedMonths: [month + 1],
      };
    }

    for (let month = 2; month <= 12; month += 1) {
      definitions[`previous_month:${month}`] = {
        id: `previous_month:${month}`,
        type: "previous_month",
        group: "neighbor",
        month,
        prompt: `What month comes before ${monthName(month)}?`,
        expectedMonths: [month - 1],
      };
    }

    definitions["ordinal_sequence:full"] = {
      id: "ordinal_sequence:full",
      type: "ordinal_sequence",
      group: "sequence",
      prompt: "Type months 1 to 12 in order.",
      expectedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    };
    definitions["ordinal_sequence:first_half"] = {
      id: "ordinal_sequence:first_half",
      type: "ordinal_sequence",
      group: "sequence",
      prompt: "Type months 1 to 6 in order.",
      expectedMonths: [1, 2, 3, 4, 5, 6],
    };
    definitions["ordinal_sequence:second_half"] = {
      id: "ordinal_sequence:second_half",
      type: "ordinal_sequence",
      group: "sequence",
      prompt: "Type months 7 to 12 in order.",
      expectedMonths: [7, 8, 9, 10, 11, 12],
    };
    definitions["gap_fill:even_months"] = {
      id: "gap_fill:even_months",
      type: "gap_fill",
      group: "sequence",
      prompt: "January, ___, March, ___, May, ___, July, ___, September, ___, November, ___",
      expectedMonths: [2, 4, 6, 8, 10, 12],
    };

    if (wrapSequencePrompts) {
      definitions["cycle_next_month:12"] = {
        id: "cycle_next_month:12",
        type: "next_month",
        group: "cycle",
        month: 12,
        prompt: "Cycle practice: what month comes after December?",
        expectedMonths: [1],
      };
      definitions["cycle_previous_month:1"] = {
        id: "cycle_previous_month:1",
        type: "previous_month",
        group: "cycle",
        month: 1,
        prompt: "Cycle practice: what month comes before January?",
        expectedMonths: [12],
      };
    }

    return definitions;
  }

  function knownCardIds(options = {}) {
    return Object.keys(makeCardDefinitions(options));
  }

  function expectedAnswer(definition) {
    if (definition.expectedNumber) {
      return String(definition.expectedNumber);
    }
    return definition.expectedMonths.map(monthName).join(", ");
  }

  function checkAnswer(definition, submitted) {
    assert(definition && definition.id, "Missing card definition");
    const rawSubmitted = String(submitted || "");

    if (definition.expectedNumber) {
      const parsed = parseMonthNumber(rawSubmitted);
      return {
        correct: parsed === definition.expectedNumber,
        expected: expectedAnswer(definition),
        submitted: rawSubmitted,
      };
    }

    if (definition.expectedMonths.length === 1) {
      const expectedName = normalizeMonthName(monthName(definition.expectedMonths[0]));
      return {
        correct: normalizeMonthName(rawSubmitted) === expectedName,
        expected: expectedAnswer(definition),
        submitted: rawSubmitted,
      };
    }

    const tokens = sequenceTokens(rawSubmitted);
    const expected = definition.expectedMonths.map((month) => normalizeMonthName(monthName(month)));
    const correct =
      tokens.length === expected.length &&
      tokens.every((token, index) => normalizeMonthName(token) === expected[index]);
    return {
      correct,
      expected: expectedAnswer(definition),
      submitted: rawSubmitted,
    };
  }

  function newCard(definition, dueAt) {
    const card = {
      type: definition.type,
      dueAt,
      intervalDays: 0,
      ease: 2.3,
      reps: 0,
      lapses: 0,
      lastResult: null,
      lastConfidence: null,
      lastSlowRecall: false,
      lastAnsweredAt: null,
      lastResponseMs: null,
      lastTimeToFirstInputMs: null,
      lastTypingDurationMs: null,
    };

    if (Number.isInteger(definition.month)) {
      card.month = definition.month;
    }

    return card;
  }

  function createInitialState(now = new Date()) {
    const createdAt = asDate(now).toISOString();
    const definitions = makeCardDefinitions();
    const cards = {};
    Object.values(definitions).forEach((definition) => {
      cards[definition.id] = newCard(definition, createdAt);
    });

    return {
      version: SCHEMA_VERSION,
      createdAt,
      settings: {
        dailyMinutes: DAILY_MINUTES,
        wrapSequencePrompts: false,
        typingBaselineMsPerChar: null,
      },
      goal: {
        status: "in_progress",
        graduatedAt: null,
        graduationChecks: [],
      },
      cards,
      sessions: [],
    };
  }

  function validateIsoDate(value, label, errors, options = {}) {
    if (value === null && options.allowNull === true) {
      return;
    }
    const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const parsed = typeof value === "string" ? new Date(value) : null;
    if (
      typeof value !== "string" ||
      !isoInstant.test(value) ||
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString() !== value
    ) {
      errors.push(`${label} must be an ISO timestamp${options.allowNull === true ? " or null" : ""}`);
    }
  }

  function validateLocalDate(value, label, errors) {
    const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match) {
      errors.push(`${label} must be a browser-local YYYY-MM-DD date`);
      return;
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
    const roundTrip = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    if (roundTrip !== value) {
      errors.push(`${label} must be a browser-local YYYY-MM-DD date`);
    }
  }

  function validateNumber(value, label, errors, options = {}) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${label} must be a number`);
      return;
    }
    if (options.integer === true && !Number.isInteger(value)) {
      errors.push(`${label} must be an integer`);
    }
    if (options.minimum !== undefined && value < options.minimum) {
      errors.push(`${label} must be at least ${options.minimum}`);
    }
    if (options.maximum !== undefined && value > options.maximum) {
      errors.push(`${label} must be at most ${options.maximum}`);
    }
  }

  function validateString(value, label, errors) {
    if (typeof value !== "string") {
      errors.push(`${label} must be a string`);
    }
  }

  function validateCard(cardId, card, definition, errors) {
    if (!card || typeof card !== "object" || Array.isArray(card)) {
      errors.push(`${cardId} must be an object`);
      return;
    }
    if (card.type !== definition.type) {
      errors.push(`${cardId}.type must be ${definition.type}`);
    }
    if (Number.isInteger(definition.month) && card.month !== definition.month) {
      errors.push(`${cardId}.month must be ${definition.month}`);
    }
    validateIsoDate(card.dueAt, `${cardId}.dueAt`, errors);
    validateIsoDate(card.lastAnsweredAt, `${cardId}.lastAnsweredAt`, errors, { allowNull: true });
    validateNumber(card.intervalDays, `${cardId}.intervalDays`, errors, { minimum: 0, maximum: 60 });
    validateNumber(card.ease, `${cardId}.ease`, errors, { minimum: 1.3, maximum: 2.8 });
    validateNumber(card.reps, `${cardId}.reps`, errors, { integer: true, minimum: 0 });
    validateNumber(card.lapses, `${cardId}.lapses`, errors, { integer: true, minimum: 0 });
    ["lastResponseMs", "lastTimeToFirstInputMs", "lastTypingDurationMs"].forEach((field) => {
      if (card[field] !== null && (typeof card[field] !== "number" || Number.isNaN(card[field]))) {
        errors.push(`${cardId}.${field} must be a number or null`);
      } else if (typeof card[field] === "number" && card[field] < 0) {
        errors.push(`${cardId}.${field} must be at least 0`);
      }
    });
    if (card.lastResult !== null && card.lastResult !== "correct" && card.lastResult !== "incorrect") {
      errors.push(`${cardId}.lastResult must be correct, incorrect, or null`);
    }
    if (card.lastConfidence !== null && !CONFIDENCES.includes(card.lastConfidence)) {
      errors.push(`${cardId}.lastConfidence must be Sure, Unsure, Guessed, or null`);
    }
    if (typeof card.lastSlowRecall !== "boolean") {
      errors.push(`${cardId}.lastSlowRecall must be a boolean`);
    }
  }

  function validateAnswerEvent(event, label, knownIds, errors) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!knownIds.includes(event.cardId)) {
      errors.push(`${label}.cardId must be a known card id`);
    }
    ["prompt", "expected", "submitted", "outcome"].forEach((field) => validateString(event[field], `${label}.${field}`, errors));
    if (typeof event.correct !== "boolean") errors.push(`${label}.correct must be a boolean`);
    if (!CONFIDENCES.includes(event.confidence)) errors.push(`${label}.confidence must be Sure, Unsure, or Guessed`);
    validateNumber(event.responseMs, `${label}.responseMs`, errors, { minimum: 0 });
    validateNumber(event.timeToFirstInputMs, `${label}.timeToFirstInputMs`, errors, { minimum: 0 });
    validateNumber(event.typingDurationMs, `${label}.typingDurationMs`, errors, { minimum: 0 });
    validateIsoDate(event.previousDueAt, `${label}.previousDueAt`, errors);
    validateIsoDate(event.nextDueAt, `${label}.nextDueAt`, errors);
    validateNumber(event.previousIntervalDays, `${label}.previousIntervalDays`, errors, { minimum: 0, maximum: 60 });
    validateNumber(event.nextIntervalDays, `${label}.nextIntervalDays`, errors, { minimum: 0, maximum: 60 });
    if (typeof event.retry !== "boolean") errors.push(`${label}.retry must be a boolean`);
    if (typeof event.slowRecall !== "boolean") errors.push(`${label}.slowRecall must be a boolean`);
    if (typeof event.srsChanged !== "boolean") errors.push(`${label}.srsChanged must be a boolean`);
    validateString(event.previousLevel, `${label}.previousLevel`, errors);
    validateString(event.nextLevel, `${label}.nextLevel`, errors);
    validateIsoDate(event.answeredAt, `${label}.answeredAt`, errors);
  }

  function validateMasterySnapshot(snapshot, label, errors) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      errors.push(`${label} must be an object`);
      return;
    }
    [
      "totalCards",
      "newCards",
      "weakCards",
      "learningCards",
      "fluentCards",
      "durableCards",
      "fluentNotDueCards",
      "durableNotDueCards",
      "dueCards",
      "overdueCards",
      "masteryPercent",
      "conversionFluencyPercent",
      "sequenceFluencyPercent",
      "becameFluent",
      "becameWeak",
    ].forEach((field) => validateNumber(snapshot[field], `${label}.${field}`, errors, { integer: true, minimum: 0 }));
    if (!Array.isArray(snapshot.weakCardIds)) errors.push(`${label}.weakCardIds must be an array`);
    if (!Array.isArray(snapshot.dueCardIds)) errors.push(`${label}.dueCardIds must be an array`);
    if (!Array.isArray(snapshot.overdueCardIds)) errors.push(`${label}.overdueCardIds must be an array`);
    validateIsoDate(snapshot.nextDueAt, `${label}.nextDueAt`, errors, { allowNull: true });
  }

  function validateSession(session, index, knownIds, errors) {
    const label = `sessions[${index}]`;
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      errors.push(`${label} must be an object`);
      return;
    }
    validateString(session.id, `${label}.id`, errors);
    validateLocalDate(session.localDate, `${label}.localDate`, errors);
    validateString(session.timeZone, `${label}.timeZone`, errors);
    validateIsoDate(session.startedAt, `${label}.startedAt`, errors);
    validateIsoDate(session.endedAt, `${label}.endedAt`, errors, { allowNull: session.isInProgress === true });
    validateNumber(session.plannedSeconds, `${label}.plannedSeconds`, errors, { integer: true, minimum: 1 });
    validateNumber(session.elapsedSeconds, `${label}.elapsedSeconds`, errors, { integer: true, minimum: 0 });
    if (typeof session.isExtraPractice !== "boolean") errors.push(`${label}.isExtraPractice must be a boolean`);
    if (session.isInProgress !== undefined && typeof session.isInProgress !== "boolean") {
      errors.push(`${label}.isInProgress must be a boolean`);
    }
    validateNumber(session.answers, `${label}.answers`, errors, { integer: true, minimum: 0 });
    validateNumber(session.correct, `${label}.correct`, errors, { integer: true, minimum: 0 });
    if (typeof session.answers === "number" && typeof session.correct === "number" && session.correct > session.answers) {
      errors.push(`${label}.correct cannot exceed answers`);
    }
    validateNumber(session.averageResponseMs, `${label}.averageResponseMs`, errors, { integer: true, minimum: 0 });
    validateNumber(session.relearnedCards, `${label}.relearnedCards`, errors, { integer: true, minimum: 0 });
    validateMasterySnapshot(session.masterySnapshot, `${label}.masterySnapshot`, errors);
    if (!Array.isArray(session.answerEvents)) {
      errors.push(`${label}.answerEvents must be an array`);
    } else {
      session.answerEvents.forEach((event, eventIndex) =>
        validateAnswerEvent(event, `${label}.answerEvents[${eventIndex}]`, knownIds, errors),
      );
    }
  }

  function validatePromptResult(result, label, knownIds, errors) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!knownIds.includes(result.cardId)) errors.push(`${label}.cardId must be a known card id`);
    ["prompt", "expected", "submitted", "section"].forEach((field) => validateString(result[field], `${label}.${field}`, errors));
    if (!CONFIDENCES.includes(result.confidence)) errors.push(`${label}.confidence must be Sure, Unsure, or Guessed`);
    if (typeof result.correct !== "boolean") errors.push(`${label}.correct must be a boolean`);
    if (typeof result.passed !== "boolean") errors.push(`${label}.passed must be a boolean`);
  }

  function validateGraduationCheck(check, index, knownIds, errors) {
    const label = `goal.graduationChecks[${index}]`;
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      errors.push(`${label} must be an object`);
      return;
    }
    validateIsoDate(check.startedAt, `${label}.startedAt`, errors);
    validateIsoDate(check.endedAt, `${label}.endedAt`, errors);
    [
      "singleAnswerCorrect",
      "singleAnswerTotal",
      "numberToNameCorrect",
      "nameToNumberCorrect",
      "neighborCorrect",
    ].forEach((field) => validateNumber(check[field], `${label}.${field}`, errors, { integer: true, minimum: 0 }));
    [
      "sequenceCorrect",
      "numberToNamePassed",
      "nameToNumberPassed",
      "neighborPassed",
      "singleAnswerPassed",
      "sequencePassed",
      "passed",
    ].forEach((field) => {
      if (typeof check[field] !== "boolean") errors.push(`${label}.${field} must be a boolean`);
    });
    if (!Array.isArray(check.failedCardIds)) {
      errors.push(`${label}.failedCardIds must be an array`);
    } else {
      check.failedCardIds.forEach((cardId, cardIndex) => {
        if (!knownIds.includes(cardId)) errors.push(`${label}.failedCardIds[${cardIndex}] must be a known card id`);
      });
    }
    if (check.promptResults !== undefined) {
      if (!Array.isArray(check.promptResults)) {
        errors.push(`${label}.promptResults must be an array`);
      } else {
        check.promptResults.forEach((result, resultIndex) =>
          validatePromptResult(result, `${label}.promptResults[${resultIndex}]`, knownIds, errors),
        );
      }
    }
  }

  function validateState(value) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, errors: ["Root value must be an object"] };
    }
    if (value.version !== SCHEMA_VERSION) {
      errors.push(`version must be ${SCHEMA_VERSION}`);
    }
    validateIsoDate(value.createdAt, "createdAt", errors);
    if (!value.settings || typeof value.settings !== "object") {
      errors.push("settings must be an object");
    } else {
      if (value.settings.dailyMinutes !== DAILY_MINUTES) {
        errors.push(`settings.dailyMinutes must be ${DAILY_MINUTES}`);
      }
      if (typeof value.settings.wrapSequencePrompts !== "boolean") {
        errors.push("settings.wrapSequencePrompts must be a boolean");
      }
      if (
        value.settings.typingBaselineMsPerChar !== null &&
        (typeof value.settings.typingBaselineMsPerChar !== "number" ||
          Number.isNaN(value.settings.typingBaselineMsPerChar) ||
          value.settings.typingBaselineMsPerChar <= 0)
      ) {
        errors.push("settings.typingBaselineMsPerChar must be a positive number or null");
      }
    }

    if (!value.goal || typeof value.goal !== "object") {
      errors.push("goal must be an object");
    } else {
      if (!["in_progress", "eligible_for_check", "achieved"].includes(value.goal.status)) {
        errors.push("goal.status is invalid");
      }
      validateIsoDate(value.goal.graduatedAt, "goal.graduatedAt", errors, { allowNull: true });
      if (!Array.isArray(value.goal.graduationChecks)) {
        errors.push("goal.graduationChecks must be an array");
      } else {
        value.goal.graduationChecks.forEach((check, index) =>
          validateGraduationCheck(check, index, knownCardIds(), errors),
        );
      }
    }

    const definitions = makeCardDefinitions();
    const expectedIds = Object.keys(definitions).sort();
    if (!value.cards || typeof value.cards !== "object" || Array.isArray(value.cards)) {
      errors.push("cards must be an object");
    } else {
      const actualIds = Object.keys(value.cards).sort();
      const missing = expectedIds.filter((id) => !actualIds.includes(id));
      const unknown = actualIds.filter((id) => !expectedIds.includes(id));
      missing.forEach((id) => errors.push(`Missing known card ${id}`));
      unknown.forEach((id) => errors.push(`Unknown card ${id}`));
      expectedIds.forEach((id) => {
        if (value.cards[id]) {
          validateCard(id, value.cards[id], definitions[id], errors);
        }
      });
    }

    if (!Array.isArray(value.sessions)) {
      errors.push("sessions must be an array");
    } else {
      value.sessions.forEach((session, index) => validateSession(session, index, expectedIds, errors));
    }

    return { ok: errors.length === 0, errors };
  }

  function migrateStoredState(value) {
    const migrated = clone(value);
    if (
      migrated &&
      migrated.version === SCHEMA_VERSION &&
      migrated.settings &&
      migrated.settings.dailyMinutes === 8
    ) {
      migrated.settings.dailyMinutes = DAILY_MINUTES;
    }
    return migrated;
  }

  function parseStoredState(raw) {
    if (raw === null || raw === undefined) {
      return { status: "missing", state: null, errors: [] };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { status: "invalid", state: null, errors: [`Stored JSON could not be parsed: ${error.message}`] };
    }
    const migrated = migrateStoredState(parsed);
    const validation = validateState(migrated);
    if (!validation.ok) {
      return { status: "invalid", state: migrated, errors: validation.errors };
    }
    return { status: "valid", state: migrated, errors: [] };
  }

  function cardLevel(card) {
    if (!card.lastResult) {
      return "new";
    }
    if (card.lastResult === "incorrect" || card.lastConfidence === "Guessed" || card.lastSlowRecall) {
      return "weak";
    }
    if (card.lastResult === "correct" && card.lastConfidence === "Sure" && card.intervalDays >= 21) {
      return "durable";
    }
    if (card.lastResult === "correct" && card.lastConfidence === "Sure" && card.intervalDays >= 7) {
      return "fluent";
    }
    return "learning";
  }

  function isFluentOrDurableNotDue(card, now) {
    const level = cardLevel(card);
    return (level === "fluent" || level === "durable") && !isDue(card.dueAt, now);
  }

  function computeMasterySnapshot(state, now = new Date(), events = []) {
    const definitions = makeCardDefinitions();
    const snapshot = {
      totalCards: Object.keys(state.cards).length,
      newCards: 0,
      weakCards: 0,
      learningCards: 0,
      fluentCards: 0,
      durableCards: 0,
      fluentNotDueCards: 0,
      durableNotDueCards: 0,
      dueCards: 0,
      overdueCards: 0,
      masteryPercent: 0,
      conversionFluencyPercent: 0,
      sequenceFluencyPercent: 0,
      becameFluent: 0,
      becameWeak: 0,
      weakCardIds: [],
      dueCardIds: [],
      overdueCardIds: [],
      nextDueAt: null,
    };

    let conversionReady = 0;
    let conversionTotal = 0;
    let sequenceReady = 0;
    let sequenceTotal = 0;
    let nextDueTime = null;

    Object.entries(state.cards).forEach(([cardId, card]) => {
      const level = cardLevel(card);
      const levelField = `${level}Cards`;
      snapshot[levelField] += 1;

      const due = isDue(card.dueAt, now);
      const overdue = isOverdue(card.dueAt, now);
      if (due) {
        snapshot.dueCards += 1;
        snapshot.dueCardIds.push(cardId);
      }
      if (overdue) {
        snapshot.overdueCards += 1;
        snapshot.overdueCardIds.push(cardId);
      }
      if (level === "weak") {
        snapshot.weakCardIds.push(cardId);
      }
      if (level === "fluent" && !due) {
        snapshot.fluentNotDueCards += 1;
      }
      if (level === "durable" && !due) {
        snapshot.durableNotDueCards += 1;
      }

      const dueTime = asDate(card.dueAt).getTime();
      if (dueTime > asDate(now).getTime() && (nextDueTime === null || dueTime < nextDueTime)) {
        nextDueTime = dueTime;
      }

      const definition = definitions[cardId];
      if (definition.group === "conversion" || definition.group === "neighbor") {
        conversionTotal += 1;
        if (isFluentOrDurableNotDue(card, now)) {
          conversionReady += 1;
        }
      }
      if (definition.group === "sequence") {
        sequenceTotal += 1;
        if (isFluentOrDurableNotDue(card, now)) {
          sequenceReady += 1;
        }
      }
    });

    events.forEach((event) => {
      if (event.previousLevel !== "fluent" && event.nextLevel === "fluent") {
        snapshot.becameFluent += 1;
      }
      if (event.previousLevel !== "weak" && event.nextLevel === "weak") {
        snapshot.becameWeak += 1;
      }
    });

    snapshot.masteryPercent = Math.round(
      ((snapshot.fluentNotDueCards + snapshot.durableNotDueCards) / snapshot.totalCards) * 100,
    );
    snapshot.conversionFluencyPercent = conversionTotal ? Math.round((conversionReady / conversionTotal) * 100) : 0;
    snapshot.sequenceFluencyPercent = sequenceTotal ? Math.round((sequenceReady / sequenceTotal) * 100) : 0;
    snapshot.nextDueAt = nextDueTime === null ? null : new Date(nextDueTime).toISOString();

    return snapshot;
  }

  function creditedInterval(confidence, reps, previousIntervalDays, ease) {
    if (confidence === "Sure") {
      if (reps === 1) return 1;
      if (reps === 2) return 3;
      if (reps === 3) return 7;
      return Math.round(previousIntervalDays * ease);
    }
    if (confidence === "Unsure") {
      if (reps === 1) return 1;
      if (reps === 2) return 2;
      if (reps === 3) return 4;
      return Math.round(previousIntervalDays * 1.5);
    }
    return 1;
  }

  function answerCharacterCount(value) {
    return String(value || "").replace(/[\s,]/g, "").length;
  }

  function deriveTypingBaseline(state) {
    const samples = [];
    state.sessions
      .filter((session) => session.isInProgress !== true)
      .forEach((session) => {
      (session.answerEvents || []).forEach((event) => {
        const chars = answerCharacterCount(event.submitted);
        if (
          event.correct === true &&
          event.confidence === "Sure" &&
          typeof event.typingDurationMs === "number" &&
          event.typingDurationMs > 0 &&
          chars > 0
        ) {
          samples.push(event.typingDurationMs / chars);
        }
      });
    });
    if (samples.length < 5) {
      return null;
    }
    const total = samples.reduce((sum, value) => sum + value, 0);
    return Math.round(total / samples.length);
  }

  function typingBaselineStatus(state) {
    if (state.settings.typingBaselineMsPerChar !== null) {
      return "calibrated";
    }
    const normalSessions = state.sessions.filter((session) => !session.isExtraPractice && session.isInProgress !== true).length;
    if (normalSessions === 0) {
      return "unset";
    }
    return "collecting baseline";
  }

  function isSlowRecall(state, submitted, confidence, timing, correct) {
    if (!correct || confidence === "Sure") {
      return false;
    }
    const normalSessions = state.sessions.filter((session) => !session.isExtraPractice && session.isInProgress !== true).length;
    if (normalSessions < 2) {
      return false;
    }
    const baseline = state.settings.typingBaselineMsPerChar || deriveTypingBaseline(state);
    if (!baseline) {
      return false;
    }
    const chars = Math.max(1, answerCharacterCount(submitted));
    const expectedTypingMs = baseline * chars;
    const responseMs = Number(timing.responseMs || 0);
    const timeToFirstInputMs = Number(timing.timeToFirstInputMs || 0);
    return timeToFirstInputMs >= 2500 && responseMs > expectedTypingMs + 2500;
  }

  function applyReview(state, cardId, submitted, confidence, timing = {}, options = {}) {
    assert(CONFIDENCES.includes(confidence), `Invalid confidence: ${confidence}`);
    const definitions = makeCardDefinitions();
    const definition = definitions[cardId];
    assert(definition, `Unknown card: ${cardId}`);
    assert(state.cards[cardId], `State is missing card: ${cardId}`);

    const now = asDate(options.now || new Date());
    const nowIso = now.toISOString();
    const nextState = clone(state);
    const card = nextState.cards[cardId];
    const previousCard = clone(card);
    const previousLevel = cardLevel(previousCard);
    const check = checkAnswer(definition, submitted);
    const previousDueAt = previousCard.dueAt;
    const previousIntervalDays = previousCard.intervalDays;
    const extraPractice = options.isExtraPractice === true;
    const retry = options.isRetry === true;
    const responseMs = Number(timing.responseMs || 0);
    const timeToFirstInputMs = Number(timing.timeToFirstInputMs || 0);
    const typingDurationMs = Number(timing.typingDurationMs || 0);
    const slowRecall = isSlowRecall(state, submitted, confidence, timing, check.correct);
    let outcome = "incorrect";
    let retryNeeded = false;
    let retryResolved = false;

    if (!extraPractice) {
      if (!check.correct) {
        card.intervalDays = 0;
        card.dueAt = nowIso;
        card.lapses += 1;
        card.ease = clamp(Number((card.ease - 0.2).toFixed(2)), 1.3, 2.8);
        card.lastResult = "incorrect";
        card.lastSlowRecall = false;
        retryNeeded = true;
        outcome = "incorrect";
      } else if (retry) {
        if (confidence === "Guessed") {
          card.intervalDays = 0;
          card.dueAt = nowIso;
          card.lastResult = "correct";
          card.lastSlowRecall = slowRecall;
          retryNeeded = true;
          outcome = "correct_retry_guessed";
        } else {
          card.intervalDays = 1;
          card.dueAt = nextDueAt(now, 1);
          card.lastResult = "correct";
          card.lastSlowRecall = slowRecall;
          retryResolved = true;
          outcome = confidence === "Sure" ? "correct_retry_sure" : "correct_retry_unsure";
        }
      } else if (confidence === "Guessed") {
        card.intervalDays = 1;
        card.dueAt = nextDueAt(now, 1);
        card.ease = clamp(Number((card.ease - 0.1).toFixed(2)), 1.3, 2.8);
        card.lastResult = "correct";
        card.lastSlowRecall = slowRecall;
        outcome = "correct_guessed";
      } else {
        card.reps += 1;
        let intervalDays = creditedInterval(confidence, card.reps, previousIntervalDays, card.ease);
        if (slowRecall) {
          intervalDays = Math.min(intervalDays, Math.max(1, previousIntervalDays + 1));
        }
        card.intervalDays = clamp(intervalDays, 1, 60);
        card.dueAt = nextDueAt(now, card.intervalDays);
        card.lastResult = "correct";
        card.lastSlowRecall = slowRecall;
        outcome = confidence === "Sure" ? "correct_sure" : "correct_unsure";
      }

      card.lastConfidence = confidence;
      card.lastAnsweredAt = nowIso;
      card.lastResponseMs = responseMs;
      card.lastTimeToFirstInputMs = timeToFirstInputMs;
      card.lastTypingDurationMs = typingDurationMs;
    } else {
      outcome = `extra_${check.correct ? "correct" : "incorrect"}_${confidence.toLowerCase()}`;
    }

    const nextLevel = extraPractice ? previousLevel : cardLevel(card);
    const event = {
      cardId,
      prompt: definition.prompt,
      expected: check.expected,
      submitted: check.submitted,
      correct: check.correct,
      confidence,
      responseMs,
      timeToFirstInputMs,
      typingDurationMs,
      previousDueAt,
      nextDueAt: extraPractice ? previousDueAt : card.dueAt,
      previousIntervalDays,
      nextIntervalDays: extraPractice ? previousIntervalDays : card.intervalDays,
      outcome,
      retry,
      slowRecall: extraPractice ? false : card.lastSlowRecall,
      srsChanged: !extraPractice,
      previousLevel,
      nextLevel,
      answeredAt: nowIso,
    };

    return {
      state: nextState,
      event,
      result: check,
      retryNeeded,
      retryResolved,
    };
  }

  function makeSessionId(state, now = new Date()) {
    const localDate = toLocalDateKey(now);
    const countForDate = state.sessions.filter((session) => session.localDate === localDate).length + 1;
    return `${localDate}-${String(countForDate).padStart(3, "0")}`;
  }

  function createSessionDraft(state, options = {}) {
    const now = asDate(options.now || new Date());
    return {
      id: makeSessionId(state, now),
      localDate: toLocalDateKey(now),
      timeZone: getTimeZoneName(),
      startedAt: now.toISOString(),
      plannedSeconds: DAILY_MINUTES * 60,
      elapsedSeconds: 0,
      isExtraPractice: options.isExtraPractice === true,
      answerEvents: [],
      retryQueue: [],
      shownCount: 0,
    };
  }

  function summarizeSessionDraft(state, sessionDraft, now = new Date(), isInProgress = true) {
    const endedAt = isInProgress ? null : asDate(now);
    const currentAt = asDate(now);
    const startedAt = asDate(sessionDraft.startedAt);
    const events = sessionDraft.answerEvents || [];
    const elapsedSeconds =
      typeof sessionDraft.elapsedSeconds === "number"
        ? sessionDraft.elapsedSeconds
        : Math.max(0, Math.round((currentAt.getTime() - startedAt.getTime()) / 1000));
    const correct = events.filter((event) => event.correct).length;
    const responseTotal = events.reduce((sum, event) => sum + Number(event.responseMs || 0), 0);
    return {
      id: sessionDraft.id,
      localDate: sessionDraft.localDate,
      timeZone: sessionDraft.timeZone,
      startedAt: sessionDraft.startedAt,
      endedAt: endedAt ? endedAt.toISOString() : null,
      plannedSeconds: sessionDraft.plannedSeconds,
      elapsedSeconds,
      isExtraPractice: sessionDraft.isExtraPractice === true,
      isInProgress,
      answers: events.length,
      correct,
      averageResponseMs: events.length ? Math.round(responseTotal / events.length) : 0,
      relearnedCards: events.filter(
        (event) => event.retry && event.correct && (event.confidence === "Sure" || event.confidence === "Unsure"),
      ).length,
      masterySnapshot: computeMasterySnapshot(state, currentAt, events),
      answerEvents: events,
    };
  }

  function upsertSessionRecord(state, session) {
    const nextState = clone(state);
    const existingIndex = nextState.sessions.findIndex((existing) => existing.id === session.id);
    if (existingIndex >= 0) {
      nextState.sessions[existingIndex] = session;
    } else {
      nextState.sessions.push(session);
    }
    return nextState;
  }

  function recordInProgressSession(state, sessionDraft, now = new Date()) {
    return upsertSessionRecord(state, summarizeSessionDraft(state, sessionDraft, now, true));
  }

  function completeSession(state, sessionDraft, now = new Date()) {
    let nextState = clone(state);
    const endedAt = asDate(now);
    const session = summarizeSessionDraft(nextState, sessionDraft, endedAt, false);
    nextState = upsertSessionRecord(nextState, session);
    const baseline = deriveTypingBaseline(nextState);
    if (
      !session.isExtraPractice &&
      nextState.sessions.filter((existing) => !existing.isExtraPractice && existing.isInProgress !== true).length >= 2 &&
      baseline !== null
    ) {
      nextState.settings.typingBaselineMsPerChar = baseline;
    }
    return recomputeGoalStatus(nextState, endedAt);
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function shuffledTieBreak(a, b, seed) {
    if (!seed) {
      return a.localeCompare(b);
    }
    const diff = hashString(`${a}:${seed}`) - hashString(`${b}:${seed}`);
    return diff || a.localeCompare(b);
  }

  function duePriorityCompare(state, now, a, b) {
    const cardA = state.cards[a];
    const cardB = state.cards[b];
    const dueDiff = asDate(cardA.dueAt).getTime() - asDate(cardB.dueAt).getTime();
    if (dueDiff !== 0) return dueDiff;
    if (cardB.lapses !== cardA.lapses) return cardB.lapses - cardA.lapses;
    const confidenceWeight = { Guessed: 3, Unsure: 2, Sure: 1, null: 0 };
    return confidenceWeight[cardB.lastConfidence] - confidenceWeight[cardA.lastConfidence];
  }

  function promptMixKey(definition) {
    if (definition.id === "gap_fill:even_months") return "gap_fill";
    if (definition.group === "sequence") return definition.id;
    return definition.type;
  }

  function interleaveCardIds(cardIds, definitions, shuffleSeed) {
    const buckets = new Map();
    cardIds.forEach((cardId) => {
      const key = promptMixKey(definitions[cardId]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(cardId);
    });

    const bucketKeys = Array.from(buckets.keys()).sort((a, b) => shuffledTieBreak(a, b, shuffleSeed));
    bucketKeys.forEach((key) => buckets.get(key).sort((a, b) => shuffledTieBreak(a, b, shuffleSeed)));

    const mixed = [];
    while (bucketKeys.some((key) => buckets.get(key).length > 0)) {
      bucketKeys.forEach((key) => {
        const bucket = buckets.get(key);
        if (bucket.length > 0) mixed.push(bucket.shift());
      });
    }
    return mixed;
  }

  function sortedDueCardIds(state, now = new Date(), shuffleSeed = "") {
    const definitions = makeCardDefinitions();
    const dueIds = Object.keys(state.cards)
      .filter((cardId) => isDue(state.cards[cardId].dueAt, now))
      .sort((a, b) => duePriorityCompare(state, now, a, b) || shuffledTieBreak(a, b, shuffleSeed));

    const result = [];
    let bucket = [];
    dueIds.forEach((cardId) => {
      if (bucket.length > 0 && duePriorityCompare(state, now, bucket[0], cardId) !== 0) {
        result.push(...interleaveCardIds(bucket, definitions, shuffleSeed));
        bucket = [];
      }
      bucket.push(cardId);
    });
    if (bucket.length > 0) {
      result.push(...interleaveCardIds(bucket, definitions, shuffleSeed));
    }

    return result;
  }

  function sessionPhase(elapsedSeconds) {
    if (elapsedSeconds < 15) return "start_check";
    if (elapsedSeconds < 60) return "warmup";
    if (elapsedSeconds < 200) return "main";
    if (elapsedSeconds < 270) return "fluency";
    return "sequence";
  }

  function selectNextCard(state, sessionDraft, now = new Date()) {
    const definitions = makeCardDefinitions();
    const retryQueue = sessionDraft.retryQueue || [];
    const retryIds = retryQueue.map((entry) => entry.cardId);
    const eligibleRetry = retryQueue.find((entry) => sessionDraft.shownCount >= entry.eligibleAfter);
    const dueIds = sortedDueCardIds(state, now, sessionDraft.id).filter((cardId) => !retryIds.includes(cardId));
    const phase = sessionPhase(sessionDraft.elapsedSeconds || 0);

    if (eligibleRetry) {
      return { cardId: eligibleRetry.cardId, isRetry: true, phase };
    }
    if (phase === "fluency") {
      const sprintDue = dueIds.find((cardId) => {
        const group = definitions[cardId].group;
        return group === "conversion" || group === "neighbor";
      });
      if (sprintDue) return { cardId: sprintDue, isRetry: false, phase };
    }
    if (phase === "sequence") {
      const sequenceDue = dueIds.find((cardId) => definitions[cardId].group === "sequence");
      if (sequenceDue) return { cardId: sequenceDue, isRetry: false, phase };
    }
    if (phase === "warmup") {
      const weakDue = dueIds.find((cardId) => cardLevel(state.cards[cardId]) === "weak");
      if (weakDue) return { cardId: weakDue, isRetry: false, phase };
      const easyDue = dueIds.find((cardId) => state.cards[cardId].reps > 0);
      if (easyDue) return { cardId: easyDue, isRetry: false, phase };
    }
    if (dueIds.length > 0) {
      return { cardId: dueIds[0], isRetry: false, phase };
    }
    if (retryQueue.length > 0) {
      return { cardId: retryQueue[0].cardId, isRetry: true, phase };
    }

    const maintenanceIds = Object.keys(state.cards)
      .filter((cardId) => {
        const definition = definitions[cardId];
        const level = cardLevel(state.cards[cardId]);
        return (definition.group === "conversion" || definition.group === "neighbor") && (level === "fluent" || level === "durable");
      })
      .sort((a, b) => shuffledTieBreak(a, b, sessionDraft.id));
    if (maintenanceIds.length > 0) {
      const index = sessionDraft.shownCount % maintenanceIds.length;
      return { cardId: maintenanceIds[index], isRetry: false, phase };
    }

    return null;
  }

  function graduationPracticeDates(state) {
    return Array.from(
      new Set(
        state.sessions
          .filter((session) => !session.isExtraPractice && session.isInProgress !== true && session.answers > 0)
          .map((session) => session.localDate),
      ),
    ).sort();
  }

  function daysBetweenLocalDates(start, end) {
    const startDate = localDateToDate(start);
    const endDate = localDateToDate(end);
    return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  }

  function graduationEligibility(state, now = new Date()) {
    const definitions = makeCardDefinitions();
    const conversionIds = Object.keys(definitions).filter((id) => definitions[id].group === "conversion");
    const neighborIds = Object.keys(definitions).filter((id) => definitions[id].group === "neighbor");
    const sequenceIds = Object.keys(definitions).filter((id) => definitions[id].group === "sequence");
    const weakIds = Object.keys(state.cards).filter((id) => cardLevel(state.cards[id]) === "weak");
    const dueRequiredIds = [...conversionIds, ...neighborIds, ...sequenceIds].filter((id) => isDue(state.cards[id].dueAt, now));
    const conversionReady = conversionIds.filter((id) => isFluentOrDurableNotDue(state.cards[id], now)).length;
    const neighborReady = neighborIds.filter((id) => isFluentOrDurableNotDue(state.cards[id], now)).length;
    const sequenceReady = sequenceIds.filter((id) => isFluentOrDurableNotDue(state.cards[id], now)).length;
    const dates = graduationPracticeDates(state);
    const spacingOk = dates.length >= 3 && daysBetweenLocalDates(dates[0], dates[dates.length - 1]) >= 7;
    const eligible =
      conversionReady === 24 &&
      neighborReady >= 18 &&
      sequenceReady === 4 &&
      weakIds.length === 0 &&
      dueRequiredIds.length === 0 &&
      spacingOk;

    return {
      eligible,
      conversionReady,
      conversionRequired: 24,
      neighborReady,
      neighborRequired: 18,
      sequenceReady,
      sequenceRequired: 4,
      weakIds,
      dueRequiredIds,
      practiceDayCount: dates.length,
      firstPracticeDate: dates[0] || null,
      latestPracticeDate: dates[dates.length - 1] || null,
      spacingOk,
    };
  }

  function recomputeGoalStatus(state, now = new Date()) {
    const nextState = clone(state);
    const weakCount = Object.values(nextState.cards).filter((card) => cardLevel(card) === "weak").length;
    if (nextState.goal.status === "achieved" && weakCount <= 6) {
      return nextState;
    }
    if (nextState.goal.status === "achieved" && weakCount > 6) {
      nextState.goal.status = "in_progress";
      return nextState;
    }
    nextState.goal.status = graduationEligibility(nextState, now).eligible ? "eligible_for_check" : "in_progress";
    return nextState;
  }

  function buildGraduationPrompts() {
    return [
      ...Array.from({ length: 12 }, (_value, index) => `number_to_name:${index + 1}`),
      ...Array.from({ length: 12 }, (_value, index) => `name_to_number:${index + 1}`),
      "next_month:1",
      "next_month:4",
      "next_month:8",
      "previous_month:3",
      "previous_month:7",
      "previous_month:12",
      "ordinal_sequence:full",
    ];
  }

  function shuffleGraduationPrompts(random = Math.random) {
    assert(typeof random === "function", "shuffleGraduationPrompts requires a random function");
    const promptIds = buildGraduationPrompts();
    for (let index = promptIds.length - 1; index > 0; index -= 1) {
      const value = random();
      assert(Number.isFinite(value) && value >= 0 && value < 1, `Invalid shuffle random value: ${value}`);
      const swapIndex = Math.floor(value * (index + 1));
      [promptIds[index], promptIds[swapIndex]] = [promptIds[swapIndex], promptIds[index]];
    }
    return promptIds;
  }

  function gradeGraduationCheck(state, responses, options = {}) {
    const definitions = makeCardDefinitions();
    const now = asDate(options.now || new Date());
    const startedAt = asDate(options.startedAt || now);
    const nextState = clone(state);
    const promptIds = buildGraduationPrompts();
    assert(responses.length === promptIds.length, `Graduation check requires ${promptIds.length} responses`);
    const requiredPromptIds = new Set(promptIds);
    const seenPromptIds = new Set();
    const responsesByCardId = new Map();

    const failedCardIds = [];
    const promptResults = [];
    let numberToNameCorrect = 0;
    let nameToNumberCorrect = 0;
    let neighborCorrect = 0;
    let sequenceCorrect = false;
    let singleAnswerCorrect = 0;

    responses.forEach((response, index) => {
      const cardId = response.cardId;
      assert(requiredPromptIds.has(cardId), `Graduation response ${index} has unknown prompt ${cardId}`);
      assert(!seenPromptIds.has(cardId), `Graduation response ${index} duplicates ${cardId}`);
      seenPromptIds.add(cardId);
      responsesByCardId.set(cardId, response);
      assert(CONFIDENCES.includes(response.confidence), `Invalid confidence: ${response.confidence}`);
      const definition = definitions[cardId];
      const checked = checkAnswer(definition, response.submitted);
      const passedPrompt = checked.correct && response.confidence !== "Guessed";
      promptResults.push({
        cardId,
        prompt: definition.prompt,
        expected: checked.expected,
        submitted: checked.submitted,
        confidence: response.confidence,
        correct: checked.correct,
        passed: passedPrompt,
        section: definition.group === "sequence" ? "sequence" : definition.type,
      });
      if (!passedPrompt) {
        failedCardIds.push(cardId);
      }
      if (definition.group === "conversion") {
        if (passedPrompt) {
          singleAnswerCorrect += 1;
          if (definition.type === "number_to_name") numberToNameCorrect += 1;
          if (definition.type === "name_to_number") nameToNumberCorrect += 1;
        }
      } else if (definition.group === "neighbor") {
        if (passedPrompt) {
          singleAnswerCorrect += 1;
          neighborCorrect += 1;
        }
      } else if (definition.id === "ordinal_sequence:full") {
        sequenceCorrect = passedPrompt;
      }
    });
    assert(seenPromptIds.size === requiredPromptIds.size, "Graduation check responses must cover every prompt");

    const numberToNamePassed = numberToNameCorrect === 12;
    const nameToNumberPassed = nameToNumberCorrect === 12;
    const neighborPassed = neighborCorrect >= 5;
    const singleAnswerPassed = singleAnswerCorrect >= 29;
    const sequencePassed = sequenceCorrect;
    const passed =
      numberToNamePassed &&
      nameToNumberPassed &&
      neighborPassed &&
      singleAnswerPassed &&
      sequencePassed;

    const check = {
      startedAt: startedAt.toISOString(),
      endedAt: now.toISOString(),
      singleAnswerCorrect,
      singleAnswerTotal: 30,
      numberToNameCorrect,
      nameToNumberCorrect,
      neighborCorrect,
      sequenceCorrect,
      numberToNamePassed,
      nameToNumberPassed,
      neighborPassed,
      singleAnswerPassed,
      sequencePassed,
      failedCardIds,
      promptResults,
      passed,
    };

    nextState.goal.graduationChecks.push(check);

    if (passed) {
      nextState.goal.status = "achieved";
      nextState.goal.graduatedAt = now.toISOString();
    } else {
      nextState.goal.status = "in_progress";
      failedCardIds.forEach((cardId) => {
        const response = responsesByCardId.get(cardId);
        const card = nextState.cards[cardId];
        card.lastResult = "incorrect";
        card.lastConfidence = response.confidence;
        card.lastSlowRecall = false;
        card.lastAnsweredAt = now.toISOString();
        card.lastResponseMs = null;
        card.lastTimeToFirstInputMs = null;
        card.lastTypingDurationMs = null;
        card.intervalDays = 0;
        card.dueAt = now.toISOString();
        card.lapses += 1;
        card.ease = clamp(Number((card.ease - 0.2).toFixed(2)), 1.3, 2.8);
      });
    }

    return { state: nextState, check };
  }

  function recentSessionSummaries(state, count = 7) {
    return state.sessions.slice(-count).map((session) => ({
      id: session.id,
      localDate: session.localDate,
      answers: session.answers,
      correct: session.correct,
      accuracy: session.answers ? Math.round((session.correct / session.answers) * 100) : 0,
      averageResponseMs: session.averageResponseMs || 0,
      masteryPercent: session.masterySnapshot ? session.masterySnapshot.masteryPercent : 0,
      isExtraPractice: session.isExtraPractice === true,
      isInProgress: session.isInProgress === true,
    }));
  }

  return {
    STORAGE_KEY,
    SCHEMA_VERSION,
    DAILY_MINUTES,
    MONTHS,
    CONFIDENCES,
    CARD_TOTAL,
    makeCardDefinitions,
    knownCardIds,
    expectedAnswer,
    checkAnswer,
    createInitialState,
    validateState,
    parseStoredState,
    cardLevel,
    computeMasterySnapshot,
    applyReview,
    createSessionDraft,
    recordInProgressSession,
    completeSession,
    selectNextCard,
    sessionPhase,
    graduationEligibility,
    recomputeGoalStatus,
    buildGraduationPrompts,
    shuffleGraduationPrompts,
    gradeGraduationCheck,
    deriveTypingBaseline,
    typingBaselineStatus,
    nextDueAt,
    isDue,
    isOverdue,
    toLocalDateKey,
    getTimeZoneName,
    recentSessionSummaries,
    parseMonthNumber,
    sequenceTokens,
    sameOrFutureLocalDate,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MonthsLearnerCore;
}

if (typeof globalThis !== "undefined") {
  globalThis.MonthsLearnerCore = MonthsLearnerCore;
}
