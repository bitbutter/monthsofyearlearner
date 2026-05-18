"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

test("browser flow persists an in-progress answer event before session completion", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-browser-"));
  const userDataDir = path.join(tempDir, "profile");
  const harnessPath = path.join(tempDir, "harness.html");
  const coreUrl = pathToFileURL(path.join(root, "core.js")).href;
  const appUrl = pathToFileURL(path.join(root, "app.js")).href;

  fs.writeFileSync(
    harnessPath,
    `<!doctype html>
<html>
  <body>
    <div id="app"></div>
    <script>
      window.confirm = () => true;
      window.addEventListener("error", (event) => {
        document.body.setAttribute("data-test-status", "FAIL " + event.message);
      });
    </script>
    <script src="${coreUrl}"></script>
    <script>
      localStorage.removeItem(MonthsLearnerCore.STORAGE_KEY);
    </script>
    <script src="${appUrl}"></script>
    <script>
      const wait = () => new Promise((resolve) => setTimeout(resolve, 0));
      const appText = () => document.querySelector("#app").textContent;
      const months = MonthsLearnerCore.MONTHS;
      const answerForPrompt = (prompt) => {
        const monthNumber = /^What is month (\\d+)\\?/.exec(prompt);
        if (monthNumber) return months[Number(monthNumber[1]) - 1];
        const numberForMonth = /^What number is ([A-Za-z]+)\\?/.exec(prompt);
        if (numberForMonth) return String(months.indexOf(numberForMonth[1]) + 1);
        const after = /^What month comes after ([A-Za-z]+)\\?/.exec(prompt);
        if (after) return months[months.indexOf(after[1]) + 1];
        const before = /^What month comes before ([A-Za-z]+)\\?/.exec(prompt);
        if (before) return months[months.indexOf(before[1]) - 1];
        if (prompt.includes("1 to 12")) return months.join(", ");
        if (prompt.includes("1 to 6")) return months.slice(0, 6).join(", ");
        if (prompt.includes("7 to 12")) return months.slice(6).join(", ");
        if (prompt.includes("___")) return "February, April, June, August, October, December";
        throw new Error("No test answer for prompt: " + prompt);
      };
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        assert(appText().includes("Today's 8 minute practice"), "home screen did not render");
        document.querySelector('[data-action="start-session"]').click();
        await wait();
        const input = document.querySelector("#answer-input");
        assert(input, "answer input did not render");
        assert(document.activeElement === input, "answer input was not focused");
        assert(document.querySelector("[data-phase]").textContent === "Get ready", "internal phase label was shown");
        assert(!["start_check", "warmup", "main", "fluency", "sequence"].includes(document.querySelector("[data-phase]").textContent), "internal phase text leaked");
        assert(!["conversion", "neighbor", "sequence"].includes(document.querySelector(".prompt-meta span:last-child").textContent), "internal prompt type leaked");
        const promptText = document.querySelector(".prompt-text").textContent;
        input.value = answerForPrompt(promptText);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        assert(document.querySelector('[data-confidence="Sure"]').classList.contains("keyboard-flash"), "enter did not flash the Sure button");
        await new Promise((resolve) => setTimeout(resolve, 180));
        assert(appText().includes("Correct!"), "correct toast did not render");
        await new Promise((resolve) => setTimeout(resolve, 800));
        assert(!appText().includes("Expected"), "correct answer should not show blocking feedback");
        const nextPromptText = document.querySelector(".prompt-text").textContent;
        assert(nextPromptText !== promptText, "correct answer did not auto-advance");
        const stored = JSON.parse(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY));
        assert(stored.sessions.length === 1, "in-progress session was not persisted");
        assert(stored.sessions[0].isInProgress === true, "session was not marked in progress");
        assert(stored.sessions[0].answerEvents.length === 1, "answer event was not persisted");
        assert(stored.sessions[0].answerEvents[0].correct === true, "persisted event was not correct");
        const nextInput = document.querySelector("#answer-input");
        nextInput.value = "wrong";
        nextInput.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-confidence="Sure"]').click();
        await wait();
        assert(document.querySelector(".feedback.incorrect .feedback-label").textContent.trim() === "Incorrect", "incorrect answer did not show a clear lozenge");
        assert(!document.querySelector(".feedback.incorrect h1"), "incorrect answer showed a duplicate heading");
        assert(appText().includes(nextPromptText), "incorrect answer did not show the full question");
        assert(appText().includes("Correct answer:"), "incorrect answer did not show the correct answer");
        assert(appText().includes("Continue"), "incorrect answer did not show a continue button");
        assert(!appText().includes("Your answer"), "incorrect answer still showed the answer table");
        assert(!appText().includes("Next interval"), "incorrect answer still showed scheduler details");
        assert(!appText().includes("Correct it before spacing resumes"), "opaque incorrect feedback is still present");
        assert(document.querySelector('[data-action="next-card"]'), "incorrect answer did not require click to continue");
        await new Promise((resolve) => setTimeout(resolve, 800));
        assert(appText().includes("Correct answer:"), "incorrect feedback advanced without click");
        document.body.setAttribute("data-test-status", "PASS");
      })().catch((error) => {
        document.body.setAttribute("data-test-status", "FAIL " + error.message);
      });
    </script>
  </body>
</html>`,
    "utf8",
  );

  try {
    const output = execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=3000",
        "--dump-dom",
        pathToFileURL(harnessPath).href,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.match(output, /data-test-status="PASS"/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
