"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("static page loads dependency-free scripts and styles", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml"/);
  assert.match(html, /<link rel="stylesheet" href="styles\.css"/);
  assert.match(html, /<script src="core\.js"><\/script>/);
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.ok(fs.existsSync(path.join(root, "favicon.svg")));
});

test("UI maps answer-input Enter to Sure and exposes explicit confidence labels", () => {
  const app = read("app.js");
  assert.match(app, /event\.key === "Enter"/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /submitSureFromKeyboard\(\)/);
  assert.match(app, /keyboard-flash/);
  assert.match(app, /data-confidence/);
  assert.match(app, /data-graduation-confidence/);
  assert.doesNotMatch(app, /Digit1|Digit2|Digit3|Numpad1|Numpad2|Numpad3/);
});

test("sequence prompts include learner-facing instructions", () => {
  const app = read("app.js");
  assert.match(app, /prompt-instruction/);
  assert.match(app, /Type the missing months in order\./);
  assert.match(app, /Type all 12 months in order\./);
});

test("active drill does not expose early finish while due or retry work remains", () => {
  const app = read("app.js");
  assert.match(app, /Session continues until the timer ends or due work is complete\./);
  assert.doesNotMatch(app, /End now/);
});

test("daily session limit is five minutes", () => {
  const app = read("app.js");
  const core = read("core.js");
  assert.match(core, /const DAILY_MINUTES = 5;/);
  assert.match(app, /Today's 5 minute practice/);
  assert.match(app, /<p class="timer-readout">5:00<\/p>/);
  assert.doesNotMatch(app, /Today's 8 minute practice/);
});

test("graduation test mode uses isolated storage and the real exam route", () => {
  const app = read("app.js");
  assert.match(app, /graduationTestMode/);
  assert.match(app, /Core\.STORAGE_KEY}\.graduationTest/);
  assert.match(app, /createGraduationTestState/);
  assert.match(app, /Graduation test mode/);
  assert.match(app, /Core\.shuffleGraduationPrompts\(\)/);
});

test("graduation readiness copy is learner-facing", () => {
  const app = read("app.js");
  assert.match(app, /Graduation Check/);
  assert.match(app, /answers are confident and your practice has held up for a week/);
  assert.match(app, /Confident month skills/);
  assert.match(app, /Practice over time/);
  assert.match(app, /Practise on 3 different days, with at least 7 days from first to latest\./);
  assert.match(app, /Take the graduation check!/);
  assert.doesNotMatch(app, /Graduation readiness:/);
  assert.doesNotMatch(app, /neighbor target/);
});

test("queue exhaustion and timer completion share the session summary", () => {
  const app = read("app.js");
  assert.match(app, /finishSession\(\);\s*return;/);
  assert.match(app, /Session complete/);
  assert.match(app, /You completed \$\{sessionCount\} \$\{sessionNoun\}!/);
  assert.match(app, /progress-trend-panel/);
  assert.doesNotMatch(app, /No due review is waiting/);
});

test("settings copy names the exact storage key for clearing progress", () => {
  const app = read("app.js");
  const core = read("core.js");
  assert.match(app, /Clear local progress for \$\{storageKey\}/);
  assert.match(app, /: Core\.STORAGE_KEY/);
  assert.match(core, /monthsOfYearLearner\.v1/);
});
