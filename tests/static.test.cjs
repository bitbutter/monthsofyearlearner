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
  assert.match(html, /<link rel="stylesheet" href="styles\.css"/);
  assert.match(html, /<script src="core\.js"><\/script>/);
  assert.match(html, /<script src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("UI code blocks answer-input Enter submission and exposes explicit confidence labels", () => {
  const app = read("app.js");
  assert.match(app, /event\.key === "Enter"/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /data-confidence/);
  assert.doesNotMatch(app, /Digit1|Digit2|Digit3|Numpad1|Numpad2|Numpad3/);
});

test("active drill does not expose early finish while due or retry work remains", () => {
  const app = read("app.js");
  assert.match(app, /Session continues until the timer ends or due work is complete\./);
  assert.doesNotMatch(app, /End now/);
});

test("settings copy names the exact storage key for clearing progress", () => {
  const app = read("app.js");
  const core = read("core.js");
  assert.match(app, /Clear local progress for \$\{storageKey\}/);
  assert.match(app, /const storageKey = Core\.STORAGE_KEY/);
  assert.match(core, /monthsOfYearLearner\.v1/);
});
