# Months of the Year Learner Spec

Date: 2026-05-17
Status: Draft plan

## Goal

Create a single-page web app that helps a motivated learner memorize the months of the year in order and convert fluently between month number and month name. The app runs locally in the browser, stores progress in `localStorage`, and guides one focused 8 minute practice session per day.

## Assumptions

- The learner is studying English month names.
- The target learner is a motivated 12-year-old.
- The app has no backend, account system, or network dependency after loading.
- The first version prioritizes accurate recall, confidence, retention, and comfortable pace over decoration.
- Full month names are the canonical answers. Case and surrounding whitespace are ignored.
- Month numbers are accepted as integers `1` through `12`.
- The learner is not assumed to be a fluent typist.
- MVP is written recall only. It does not include audio pronunciation.

## Evidence Basis

The drill design should use:

- Retrieval practice: the learner must produce an answer before seeing it. Reviews identify retrieval practice as broadly beneficial for retention across domains and ages.
- Spacing: items are reviewed across days, not massed into one sitting. Meta-analysis supports spaced retrieval practice over massed retrieval practice.
- Feedback: after each attempt, the app shows the correct answer and marks whether the learner was correct. Feedback helps correct errors and can reinforce low-confidence correct answers.
- Interleaving: number-to-name, name-to-number, and sequence questions are mixed in one session after a short warm-up.
- Fluency practice: once accuracy is high, the app emphasizes confident recall at a comfortable pace.

The cited evidence supports the principles above. Exact interval lengths, thresholds, section scores, and the 8 minute session length are product heuristics for this small learning domain.

Sources checked:

- Carpenter, Pan, and Butler, "The science of effective learning with spacing and retrieval practice", Nature Reviews Psychology, 2022: https://www.nature.com/articles/s44159-022-00089-1
- Dunlosky et al., "Improving Students' Learning With Effective Learning Techniques", Psychological Science in the Public Interest, 2013: https://www.psychologicalscience.org/publications/journals/pspi/learning-techniques.html
- Latimier, Peyre, and Ramus, "A Meta-Analytic Review of the Benefit of Spacing out Retrieval Practice Episodes on Retention", Educational Psychology Review, 2021: https://eric.ed.gov/?id=EJ1310148
- Nunes and Karpicke, "Retrieval Practice Consistently Benefits Student Learning", Educational Psychology Review, 2020: https://link.springer.com/article/10.1007/s10648-021-09595-9
- Rohrer, Taylor, and Sholar, "Tests Enhance the Transfer of Learning", Journal of Experimental Psychology: Learning, Memory, and Cognition, 2010: https://digitalcommons.usf.edu/psy_facpub/1761/
- Butler, Karpicke, and Roediger, "Correcting a metacognitive error: feedback increases retention of low-confidence correct responses", 2008: https://pubmed.ncbi.nlm.nih.gov/18605878/

## Product Decisions

OLD: Passive month list exposure as the main activity.
CHANGES_TO: The main activity is typed retrieval before feedback.
REASON: Producing the answer is the learning event.

OLD: One quiz mode at a time.
CHANGES_TO: Mix conversion, sequence, and neighbor prompts in the same daily drill after a short warm-up.
REASON: The learner needs flexible recall, not only one memorized route.

OLD: Fixed repetition count.
CHANGES_TO: Schedule each prompt by due time, accuracy, confidence, and calibrated slow-recall signals.
REASON: Easy items should consume less of the 8 minute budget.

OLD: Multiple-choice answers for all prompts.
CHANGES_TO: Use typed answers for primary drills and reserve choice UI only for an optional early onboarding check.
REASON: Recognition is weaker evidence of memorization than production.

OLD: Hidden correction after a miss.
CHANGES_TO: Show the correct answer immediately, then require one successful retry before the item can leave the current session.
REASON: Errors should be corrected before spacing resumes.

OLD: Silent handling when storage is unavailable.
CHANGES_TO: Show a blocking error if `localStorage` cannot be read or written.
REASON: Progress integrity depends on persisted state.

OLD: Post-session reporting as raw activity counts only.
CHANGES_TO: Show a progress panel with mastery, fluency, and today's movement between levels.
REASON: Activity volume is not the same as improved recall.

OLD: Raw answer latency as a direct fluency signal.
CHANGES_TO: Separate recall confidence from typing speed, and use generous or calibrated timing only after the learner has a baseline.
REASON: Slow typing should not be treated as weak month knowledge.

OLD: Progress without a defined finish line.
CHANGES_TO: Treat the goal as achieved only after spaced, correct, confident performance on a graduation check.
REASON: A good session is not enough evidence of durable recall.

OLD: Confidence rating after correctness feedback.
CHANGES_TO: Submit each typed answer with one of three confidence buttons before showing feedback.
REASON: Confidence must describe the learner's recall state before correction.

OLD: Full sequence recall as a substitute for conversion mastery.
CHANGES_TO: Full sequence recall is required for graduation, but conversion prompts must still pass separately.
REASON: Serial recitation does not prove direct random access between month numbers and names.

OLD: Confidence submission through numeric shortcuts.
CHANGES_TO: Confidence is submitted only by explicit button activation.
REASON: Number shortcuts conflict with month-number answers.

OLD: Spelling as separate from month-name recall.
CHANGES_TO: Correct spelling of full month names is part of the learning goal.
REASON: The app teaches typed month recall, and exact spelling keeps answer checking unambiguous.

OLD: Qualitative scheduling rules.
CHANGES_TO: Use deterministic due-time, retry, and interval rules for every scored outcome.
REASON: Testing and diagnostics need the same answer to produce the same scheduler transition.

OLD: Historical fluency levels without due-state checks.
CHANGES_TO: Due and overdue cards block graduation even if their last historical level was fluent or durable.
REASON: A card due for review has not yet demonstrated current retention.

OLD: One blended graduation score.
CHANGES_TO: Require explicit pass thresholds for number-to-name, name-to-number, neighbor, and sequence sections.
REASON: The goal contains distinct retrieval routes.

OLD: Invalid storage as a blocking dead end.
CHANGES_TO: Invalid-storage diagnostics include raw export and clear-local-progress controls.
REASON: Testers need to recover broken local state without browser devtools.

OLD: Diagnostics from aggregate counters only.
CHANGES_TO: Store per-answer scheduler events in each session.
REASON: Scheduler bugs need an audit trail from answer to next due date.

OLD: Randomized gap prompts sharing one card history.
CHANGES_TO: Gap-fill sequence cards are deterministic.
REASON: One card's review history should represent one stable prompt.

OLD: Calendar day meaning implied.
CHANGES_TO: Practice days use the browser-local date at session start.
REASON: Graduation spacing and streak diagnostics need one consistent day rule.

OLD: Failed graduation check without a result flow.
CHANGES_TO: A failed check shows section results and routes missed material back into review.
REASON: The learner needs a clear repair path.

OLD: 15 minute daily session.
CHANGES_TO: 8 minute daily session, with optional extra practice after the summary.
REASON: A shorter focused session better fits a 12-year-old and the small content set.

OLD: Possible future abbreviation acceptance.
CHANGES_TO: Never accept abbreviations.
REASON: Correct full-name spelling is part of the learning goal.

OLD: Audio pronunciation as an open MVP question.
CHANGES_TO: Written recall only for MVP.
REASON: The first version should measure the requested conversion and sequence skills directly.

OLD: Extra practice effect on SRS left open.
CHANGES_TO: Extra practice is recorded separately and does not change SRS intervals.
REASON: Optional over-practice should not distort the daily spaced-repetition schedule.

## Learning Model

### Prompt Types

Core cards:

- `number_to_name`: "What is month 4?"
- `name_to_number`: "What number is April?"

Sequence cards:

- `next_month`: "What month comes after March?"
- `previous_month`: "What month comes before April?"
- `ordinal_sequence`: "Type months 1 to 12 in order."
- `gap_fill`: "January, February, ___, April"

Sequence recall and conversion recall are related but not interchangeable. A learner can recite January through December and still need to count through the list to answer "What number is September?" or "What is month 9?" The app should treat a correct full sequence as strong evidence for order knowledge, not as automatic success for conversion or neighbor cards.

The initial card set contains:

- 12 number-to-name cards.
- 12 name-to-number cards.
- 11 next-month cards.
- 11 previous-month cards.
- 4 sequence cards covering full order, first half, second half, and a fixed gap-fill prompt.

The fixed gap-fill card is:

- Prompt: "January, ___, March, ___, May, ___, July, ___, September, ___, November, ___"
- Expected answer: "February, April, June, August, October, December"

Wrap mode adds December-to-January and January-to-December cycle prompts.

Default MVP should not use wrap prompts unless the UI clearly labels them as cycle practice. Calendar order normally starts at January and ends at December.

### Answer Checking

- Month names: normalize by trimming whitespace and comparing lowercase full English names.
- Correct full-name spelling is required. Misspelled month names are incorrect.
- Month numbers: parse base-10 integers and require exact range `1` to `12`.
- Sequence prompts: split on commas, spaces, or line breaks, then compare normalized month names to the prompt's expected list in order.
- Abbreviations are always incorrect.
- The feedback copy names the expected answer and the learner's answer.

### Confidence and Pace

The learner submits each typed answer with one of three confidence buttons:

- `Sure`: "I knew it."
- `Unsure`: "I think this is right."
- `Guessed`: "I am guessing."

The button label is the stored value. The supporting text can appear as a tooltip or accessible description.
There are no confidence keyboard shortcuts. Pressing Enter in the answer input must not submit the answer, since number prompts use typed digits.

The app records response time, time to first input, and typing time. Raw speed is never used to mark an answer wrong. A correct answer is only treated as slow for scheduling after the app has enough baseline data to distinguish hesitant recall from slow typing.

Initial fluency target:

- Single conversion prompts: correct and confident, with no long hesitation before first input.
- Next/previous prompts: correct and confident, with no long hesitation before first input.
- Full 12-month sequence: correct order with no mistakes. Time is shown as a pace metric, not a mastery requirement in MVP.

Typing adjustment:

- Track `timeToFirstInputMs` separately from `typingDurationMs`.
- Do not apply slow-answer scheduling penalties during the learner's first two sessions.
- After two sessions, estimate a personal typing baseline from correct, confident answers.
- Only apply a slow-recall flag when the total response time is well above the learner's baseline for the same answer length and the confidence rating is not `Sure`.
- If the evidence is ambiguous, treat the card as correct but not fluent rather than weak.

## Scheduling

Use a small transparent SRS scheduler rather than a complex imported memory model. The domain has fewer than 60 prompts, and the learner needs predictable behavior.

Time and day rules:

- Store timestamps as ISO instants.
- A practice day is the browser-local `YYYY-MM-DD` at session start.
- Session history stores both `localDate` and the browser time zone name when available.
- `nextDueAt(days)` means browser-local date plus `days`, at 06:00 local time, converted to an ISO instant.
- A card is `due` when `dueAt <= now`.
- A card is `overdue` when `dueAt` is before the start of the current browser-local date.
- Due and overdue are derived review states, not stored card levels.

Each card stores:

- `dueAt`: ISO timestamp.
- `intervalDays`: current review interval.
- `ease`: multiplier, default `2.3`, bounded `1.3` to `2.8`.
- `reps`: lifetime reviews that were correct with `Sure` or `Unsure`.
- `lapses`: incorrect lifetime reviews.
- `lastResult`: latest scored result.
- `lastConfidence`: latest submitted confidence.
- `lastSlowRecall`: whether the latest scored result was flagged as slow-recall.
- `lastAnsweredAt`: ISO timestamp.
- `lastResponseMs`: response duration.
- `lastTimeToFirstInputMs`: time from prompt display to first typed character.
- `lastTypingDurationMs`: time from first typed character to submitted answer.

Scoring:

- Incorrect: `intervalDays = 0`, `dueAt = now`, `lapses += 1`, `ease = max(1.3, ease - 0.2)`, and the card enters the current session retry queue.
- A retry card becomes eligible after 3 other prompts have been shown, or immediately if no other prompt is available.
- Correct retry with `Sure` or `Unsure`: `intervalDays = 1`, `dueAt = nextDueAt(1)`, `reps` does not increase, and the card leaves the retry queue.
- Correct retry with `Guessed`: `intervalDays = 0`, `dueAt = now`, and the card remains in the retry queue.
- Correct first attempt with `Guessed`: `intervalDays = 1`, `dueAt = nextDueAt(1)`, `ease = max(1.3, ease - 0.1)`, and `reps` does not increase.
- Correct first attempt with `Unsure`: increment `reps`, then use the unsure interval rule below.
- Correct first attempt with `Sure`: increment `reps`, then use the sure interval rule below.
- Correct but slow-recall: after the confidence interval is computed, cap `intervalDays` at `max(1, previousIntervalDays + 1)`.
- Correct but slow-typing: no interval penalty.

Interval rules:

- `Sure`, first credited review: 1 day.
- `Sure`, second credited review: 3 days.
- `Sure`, third credited review: 7 days.
- `Sure`, later credited reviews: `round(previousIntervalDays * ease)`.
- `Unsure`, first credited review: 1 day.
- `Unsure`, second credited review: 2 days.
- `Unsure`, third credited review: 4 days.
- `Unsure`, later credited reviews: `round(previousIntervalDays * 1.5)`.

The app should cap intervals at 60 days for MVP. This app is for mastery of a tiny set, not long-term archival review.

## Daily 8 Minute Session

The session should run from a visible timer. It ends when 8 minutes elapse or when all due work is complete and the learner chooses to stop.

Session phases:

1. Start check, 20 seconds: show today's due count, current streak, and last session outcome.
2. Warm-up, 60 seconds: recently missed items and one easy success.
3. Main SRS review, 4 minutes: due cards sorted by lateness, lapses, and low confidence.
4. Mixed fluency sprint, 2 minutes: random conversion and neighbor prompts with response pace tracking.
5. Sequence finish, 40 seconds: one sequence or gap-fill challenge.

If all due items are exhausted before 8 minutes, the app switches to fluency maintenance using mastered cards. It does not create artificial new facts.

## UX Requirements

First screen:

- Today's timer and start button.
- Current mastery summary.
- Last session date and result.

During drills:

- One prompt at a time.
- Large text input focused automatically.
- Three submit buttons below the input: `Sure`, `Unsure`, and `Guessed`.
- Submitting requires explicit confidence button activation.
- Mouse and touch users activate a confidence button by click or tap.
- Keyboard users may Tab to a confidence button and activate the focused button with Enter or Space.
- No global or numeric confidence shortcuts are allowed.
- Feedback appears only after the answer and confidence have been submitted.
- Progress strip showing elapsed time, due cards remaining, and current accuracy.
- No navigation distractions during the active session.

After session:

- Accuracy, response pace, cards reviewed, cards relearned, progress metrics, and next due estimate.
- Clear "Practice again" option for motivated extra work.
- Extra practice is marked separately from the daily session in storage and does not change SRS intervals.

Settings and testing controls:

- Keep settings out of the active drill screen.
- Include a testing-only `Clear local progress` button.
- The clear button must require confirmation before deleting data.
- Confirmation copy must name the storage key: `monthsOfYearLearner.v1`.
- After clearing, reload the app into the same state as a first-time learner.
- Include a diagnostics panel sourced from `localStorage`.
- Diagnostics must be read-only except for export and clear controls.
- If stored data is invalid, show a blocking diagnostic screen with raw JSON export and `Clear local progress`.

Diagnostics panel:

- Storage key and schema version.
- Created date and current goal status.
- Graduation date and latest graduation-check result, when present.
- Total sessions, total practice time, total answers, and lifetime accuracy.
- Last session date, elapsed time, answer count, accuracy, and response pace.
- Current card counts by level: `new`, `weak`, `learning`, `fluent`, `durable`.
- Due now count and next due date.
- Card IDs currently weak, due, or overdue.
- Typing baseline status: unset, collecting baseline, or calibrated.
- Last 7 session summaries.
- Recent answer events with card ID, confidence, correctness, previous due date, next due date, and interval change.
- Raw JSON export button for debugging.

Congratulations screen:

- Appears immediately after a passed graduation check.
- Uses the learner-facing headline: "You know the months of the year."
- Shows completion date, graduation-check score, and a compact mastery summary.
- Shows what the learner can now do: month number to name, month name to number, and full order.
- Provides two actions: `Continue with maintenance` and `Review progress`.
- Does not show a new 8 minute session prompt on the same screen.

Accessibility:

- Keyboard-first operation.
- Visible focus states.
- Text contrast suitable for WCAG AA.
- No dependence on color alone for correctness.
- Responsive layout for phone and desktop.

## Progress Metrics

The post-session screen should avoid a vague score by showing three concrete measures:

- Mastery: how many cards are stable enough to be scheduled at least 7 days out.
- Fluency: how many conversion and neighbor cards were answered correctly with confidence and no slow-recall flag.
- Movement today: how many cards moved from weak to learning, learning to fluent, or fluent back to needs review.

Card levels:

- `new`: no successful review yet.
- `weak`: last scored answer was wrong, `Guessed`, or slow-recall.
- `learning`: last answer was correct, but interval is under 7 days or confidence was not `Sure`.
- `fluent`: last answer was correct and `Sure`, no slow-recall flag was applied, and interval is at least 7 days.
- `durable`: same as `fluent`, with interval at least 21 days.

Due-state overlay:

- `due`: `dueAt <= now`.
- `overdue`: `dueAt` is before the start of the current browser-local date.
- Due or overdue cards retain their historical level for diagnostics.
- Due or overdue cards do not count as `fluent` or `durable` for graduation eligibility until reviewed again.

Display format:

- A segmented bar: `new`, `weak`, `learning`, `fluent`, `durable`.
- A separate due/overdue count next to the segmented bar.
- A small trend line for the last 7 sessions using mastery percentage.
- Plain-language movement: "Today: 5 cards became fluent, 2 need review again."
- Separate submetrics for conversion fluency and sequence fluency.

Mastery percentage:

```text
masteryPercent = round(((fluentNotDueCards + durableNotDueCards) / totalCards) * 100)
```

The headline metric should be `masteryPercent`, but the UI must keep the card-level counts visible. A single percentage is too easy to misread without context.

## Goal Achieved

The app should distinguish daily progress from demonstrated mastery.

Goal status:

- `in_progress`: normal state.
- `eligible_for_check`: all required card groups are fluent or durable.
- `achieved`: the learner passed the graduation check after spaced practice. Future work is maintenance review.

`eligible_for_check` is recomputed on app load and after each session before display. The app must not trust a stored eligible status if due dates, weak cards, or practice-day spacing no longer satisfy the criteria.

Eligibility for graduation check:

- All 24 conversion cards are `fluent` or `durable`.
- At least 18 of 22 neighbor cards are `fluent` or `durable`.
- All 4 sequence cards are `fluent` or `durable`.
- No card is currently `weak`.
- No required card is currently `due` or `overdue`.
- The learner has practiced on at least 3 different calendar days.
- The first and latest practice sessions are at least 7 days apart.

Serving the graduation check:

- The app computes eligibility after each session and on app load.
- When eligible, the start screen and post-session screen show `Take graduation check`.
- The check is never launched automatically.
- The learner can ignore the check and keep doing maintenance practice.
- If any required card becomes due or weak before the check starts, eligibility is removed.

Graduation check:

- Untimed.
- One attempt per prompt.
- No correctness feedback until the entire check is complete.
- Covers all 12 number-to-name prompts.
- Covers all 12 name-to-number prompts.
- Covers 6 fixed neighbor prompts across the year: after January, after April, after August, before March, before July, and before December.
- Covers one full sequence prompt.
- The 12 number-to-name, 12 name-to-number, and 6 neighbor prompts are the 30 single-answer prompts.
- The full sequence prompt is scored as its own required section.
- Requires 12 of 12 number-to-name prompts correct.
- Requires 12 of 12 name-to-number prompts correct.
- Requires at least 5 of 6 neighbor prompts correct.
- Requires at least 29 of 30 single-answer prompts correct.
- Requires the full sequence prompt to be exactly correct.
- Requires all sections to pass.
- A correct full sequence does not auto-pass any single-answer prompt.
- A `Guessed` confidence response counts as failing that prompt even if the typed answer is correct.

Typing accommodation:

- The graduation check does not use response pace as a pass/fail rule.
- The UI should allow the learner to pause before typing without penalty.
- Typed answers are still required in MVP, but the copy should frame the check as knowledge assessment, not speed assessment.

After achievement:

- The app shows the congratulations screen immediately after the passed check.
- Later post-session screens show "Goal achieved" with the completion date.
- The app offers a short maintenance review when any durable card becomes due.
- Maintenance does not reopen the goal unless the learner fails a future check or many cards become weak.

Reopening rule:

- If more than 6 cards become `weak` after achievement, status returns to `in_progress`.
- If a later graduation check is failed, status returns to `in_progress`.
- `graduatedAt` remains as historical evidence even if the learner later needs repair work.

Failed graduation check:

- Shows a result screen with number-to-name, name-to-number, neighbor, and sequence section results.
- Does not show the congratulations screen.
- Keeps or returns `goal.status` to `in_progress`.
- Marks missed and `Guessed` single-answer cards as `weak`, `dueAt = now`, `intervalDays = 0`, and `lapses += 1`.
- Marks the failed sequence card as `weak`, `dueAt = now`, `intervalDays = 0`, and `lapses += 1`.
- Correct answers from a failed check are logged but do not grow SRS intervals.
- The next normal session prioritizes failed-check material.

## localStorage Data Shape

Key: `monthsOfYearLearner.v1`

```json
{
  "version": 1,
  "createdAt": "2026-05-17T00:00:00.000Z",
  "settings": {
    "dailyMinutes": 8,
    "wrapSequencePrompts": false,
    "typingBaselineMsPerChar": null
  },
  "goal": {
    "status": "in_progress",
    "graduatedAt": null,
    "graduationChecks": [
      {
        "startedAt": "2026-05-24T08:00:00.000Z",
        "endedAt": "2026-05-24T08:07:00.000Z",
        "singleAnswerCorrect": 29,
        "singleAnswerTotal": 30,
        "numberToNameCorrect": 12,
        "nameToNumberCorrect": 12,
        "neighborCorrect": 5,
        "sequenceCorrect": true,
        "numberToNamePassed": true,
        "nameToNumberPassed": true,
        "neighborPassed": true,
        "singleAnswerPassed": true,
        "sequencePassed": true,
        "failedCardIds": [],
        "passed": true
      }
    ]
  },
  "cards": {
    "number_to_name:1": {
      "type": "number_to_name",
      "month": 1,
      "dueAt": "2026-05-17T00:00:00.000Z",
      "intervalDays": 0,
      "ease": 2.3,
      "reps": 0,
      "lapses": 0,
      "lastResult": null,
      "lastConfidence": null,
      "lastSlowRecall": false,
      "lastAnsweredAt": null,
      "lastResponseMs": null,
      "lastTimeToFirstInputMs": null,
      "lastTypingDurationMs": null
    }
  },
  "sessions": [
    {
      "id": "2026-05-17-001",
      "localDate": "2026-05-17",
      "timeZone": "Europe/Amsterdam",
      "startedAt": "2026-05-17T08:00:00.000Z",
      "endedAt": "2026-05-17T08:15:00.000Z",
      "plannedSeconds": 900,
      "elapsedSeconds": 900,
      "answers": 42,
      "correct": 37,
      "averageResponseMs": 2200,
      "relearnedCards": 5,
      "masterySnapshot": {
        "totalCards": 50,
        "newCards": 4,
        "weakCards": 6,
        "learningCards": 16,
        "fluentCards": 19,
        "durableCards": 5,
        "fluentNotDueCards": 18,
        "durableNotDueCards": 5,
        "dueCards": 12,
        "overdueCards": 0,
        "masteryPercent": 46,
        "conversionFluencyPercent": 67,
        "sequenceFluencyPercent": 25,
        "becameFluent": 5,
        "becameWeak": 2
      },
      "answerEvents": [
        {
          "cardId": "number_to_name:4",
          "prompt": "What is month 4?",
          "expected": "April",
          "submitted": "April",
          "correct": true,
          "confidence": "Sure",
          "responseMs": 3100,
          "timeToFirstInputMs": 900,
          "typingDurationMs": 2200,
          "previousDueAt": "2026-05-17T00:00:00.000Z",
          "nextDueAt": "2026-05-18T04:00:00.000Z",
          "previousIntervalDays": 0,
          "nextIntervalDays": 1,
          "outcome": "correct_sure"
        }
      ]
    }
  ]
}
```

Storage rules:

- Validate the root object on load.
- Validate `version` exactly.
- Validate every card against known card IDs.
- Clearing progress removes only `monthsOfYearLearner.v1`.
- After clearing, seed a fresh canonical card set.
- Diagnostic stats are derived from `sessions`, `cards`, and `goal` at render time.
- Diagnostic stats must not be stored as separate persisted aggregates.
- If validation fails, block normal practice with a clear error, developer details, raw JSON export, and `Clear local progress`.
- Add migration only when a later version exists.

## Implementation Plan

Phase 1: Static single-page app

- Create `index.html`, `styles.css`, and `app.js`.
- Render start screen, drill screen, feedback state, and session summary.
- Seed the canonical card set when no storage exists.

Phase 2: Drill engine

- Implement prompt generation, answer normalization, scoring, and scheduling.
- Persist every answered card immediately after scoring.
- Add deterministic session selection, retry queue, due-state, and browser-local day rules.
- Store per-answer scheduler events in each session.

Phase 3: Fluency and session reporting

- Add timer, response pace tracking, confidence buttons, and daily summary.
- Add progress metrics for mastery, conversion fluency, sequence fluency, and card-level movement.
- Add goal status display and graduation-check eligibility.

Phase 4: Polish and validation

- Add responsive styling.
- Add storage validation errors.
- Add manual reset/export controls behind a settings view, including `Clear local progress`.
- Add a diagnostics panel for localStorage history and scheduler state.
- Add the untimed graduation check.
- Add the congratulations screen after a passed graduation check.
- Add the failed-check result screen and repair routing.

## Acceptance Criteria

- A learner can complete an 8 minute session without reloading the page.
- Progress survives browser refresh through `localStorage`.
- A new learner starts with all cards due.
- Every scored answer records confidence before feedback is shown.
- Confidence has no global or numeric keyboard shortcuts.
- Full month-name spelling is required for month-name answers.
- Correct number-to-name and name-to-number answers schedule future reviews.
- Incorrect answers remain in the current session until corrected.
- Incorrect, `Guessed`, `Unsure`, `Sure`, retry, slow-recall, and slow-typing outcomes produce deterministic scheduler transitions.
- The app can ask all twelve month number conversions in both directions.
- The app can ask sequence, next-month, and previous-month prompts.
- The session summary reports accuracy, response pace, reviewed count, and relearned count.
- The session summary reports mastery percentage, card-level counts, and today's movement between levels.
- Due and overdue cards are visible in progress metrics and block graduation eligibility.
- The app shows when the learner is eligible for a graduation check and offers it without launching it automatically.
- The app can run an untimed graduation check and mark the goal achieved only when pass criteria are met.
- The graduation check enforces separate pass thresholds for number-to-name, name-to-number, neighbor, and sequence sections.
- A passed graduation check routes to a dedicated congratulations screen.
- A failed graduation check routes to a result screen and prioritizes failed material in later review.
- Once achieved, the app displays the completion date and switches future work to maintenance.
- The settings view can clear `monthsOfYearLearner.v1` after confirmation and return to first-run state.
- The settings view shows diagnostic history stats derived from localStorage.
- The settings view can export raw localStorage JSON for debugging.
- Each session stores per-answer scheduler events for diagnostics.
- If `localStorage` contains invalid data, the app shows a blocking diagnostic with export and clear controls.

## Open Questions Before Build

No open product questions before build.

## Risks

- Optional extra practice must remain unscored for SRS or it will distort spacing.
- The scheduler is deliberately simple, but it still needs deterministic tests for each outcome path.
- Typed answers improve retrieval quality but can frustrate young learners or mobile users.
