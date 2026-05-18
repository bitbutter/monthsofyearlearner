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
  const styleUrl = pathToFileURL(path.join(root, "styles.css")).href;

  fs.writeFileSync(
    harnessPath,
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUrl}" />
  </head>
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
        const nextPromptTop = document.querySelector(".prompt-text").getBoundingClientRect().top;
        nextInput.value = "wrong";
        nextInput.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-confidence="Sure"]').click();
        await wait();
        assert(document.querySelector(".prompt-text").textContent === nextPromptText, "incorrect answer moved or changed the question title");
        const feedbackPromptTop = document.querySelector(".prompt-text").getBoundingClientRect().top;
        assert(Math.abs(feedbackPromptTop - nextPromptTop) <= 2, "incorrect answer shifted the question title from " + nextPromptTop + " to " + feedbackPromptTop);
        assert(document.querySelector("#answer-input").disabled, "incorrect answer did not disable the answer input");
        assert(document.querySelector("#answer-input").value === "wrong", "incorrect answer did not keep the submitted answer visible");
        assert(!document.querySelector(".confidence-row"), "incorrect answer still showed confidence buttons");
        assert(document.querySelector(".incorrect-label").textContent.trim() === "Incorrect", "incorrect answer did not show a clear lozenge");
        assert(document.querySelectorAll("h1").length === 1, "incorrect answer showed a duplicate heading");
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
        "--window-size=375,667",
        "--force-device-scale-factor=1",
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

test("incorrect feedback keeps prompt position with long desktop corrections", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-layout-"));
  const userDataDir = path.join(tempDir, "profile");
  const harnessPath = path.join(tempDir, "harness.html");
  const styleUrl = pathToFileURL(path.join(root, "styles.css")).href;

  fs.writeFileSync(
    harnessPath,
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUrl}" />
  </head>
  <body>
    <section class="prompt-surface"></section>
    <script>
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const fixture = document.querySelector(".prompt-surface");
      const normalControls = [
        '<div class="prompt-meta"><span>Daily session</span><span>Month order</span></div>',
        '<h1 class="prompt-text">Type the months from 1 to 12.</h1>',
        '<label class="answer-label" for="answer-input">Answer</label>',
        '<input id="answer-input" class="answer-input" type="text" autocomplete="off" inputmode="text" />',
        '<div class="confidence-row" aria-label="Submit with confidence">',
        '<button class="confidence-button"><strong>Sure</strong><span>I knew it.</span></button>',
        '<button class="confidence-button"><strong>Unsure</strong><span>I think this is right.</span></button>',
        '<button class="confidence-button"><strong>Guessed</strong><span>I am guessing.</span></button>',
        '</div>',
      ].join("");
      const longCorrection = [
        '<div class="prompt-meta"><span>Daily session</span><span>Month order</span></div>',
        '<h1 class="prompt-text">Type the months from 1 to 12.</h1>',
        '<label class="answer-label" for="answer-input">Answer</label>',
        '<input id="answer-input" class="answer-input" type="text" value="January, March" disabled />',
        '<div class="correction-row" aria-live="polite">',
        '<span class="feedback-label incorrect-label">Incorrect</span>',
        '<span class="correction-line">Correct answer: <strong>January, February, March, April, May, June, July, August, September, October, November, December</strong></span>',
        '<button class="primary-button" data-action="next-card">Continue</button>',
        '</div>',
      ].join("");
      try {
        fixture.innerHTML = normalControls;
        const normalTop = fixture.querySelector(".prompt-text").getBoundingClientRect().top;
        fixture.innerHTML = longCorrection;
        const correctionTop = fixture.querySelector(".prompt-text").getBoundingClientRect().top;
        assert(Math.abs(correctionTop - normalTop) <= 2, "long correction shifted the question title from " + normalTop + " to " + correctionTop);
        document.body.setAttribute("data-test-status", "PASS");
      } catch (error) {
        document.body.setAttribute("data-test-status", "FAIL " + error.message);
      }
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
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=1000",
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

test("long mobile correction keeps Continue visible", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-mobile-layout-"));
  const userDataDir = path.join(tempDir, "profile");
  const harnessPath = path.join(tempDir, "harness.html");
  const styleUrl = pathToFileURL(path.join(root, "styles.css")).href;

  fs.writeFileSync(
    harnessPath,
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUrl}" />
  </head>
  <body>
    <main class="drill-shell">
      <header class="drill-status">
        <div><strong>7:57</strong><span>remaining</span></div>
        <div><strong>49</strong><span>due</span></div>
        <div><strong>50%</strong><span>accuracy</span></div>
        <div><strong>Get ready</strong><span>activity</span></div>
      </header>
      <section class="prompt-surface" aria-live="polite">
        <div class="prompt-meta"><span>Daily session</span><span>Month order</span></div>
        <h1 class="prompt-text">Type the months from 1 to 12.</h1>
        <label class="answer-label" for="answer-input">Answer</label>
        <input id="answer-input" class="answer-input" type="text" value="January, March" disabled />
        <div class="correction-row" aria-live="polite">
          <span class="feedback-label incorrect-label">Incorrect</span>
          <span class="correction-line">Correct answer: <strong>January, February, March, April, May, June, July, August, September, October, November, December</strong></span>
          <button class="primary-button" data-action="next-card">Continue</button>
        </div>
      </section>
      <footer class="drill-footer">
        <span class="compact">Session continues until the timer ends or due work is complete.</span>
      </footer>
    </main>
    <script>
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      try {
        const button = document.querySelector('[data-action="next-card"]');
        button.focus({ preventScroll: true });
        const rect = button.getBoundingClientRect();
        assert(rect.bottom <= window.innerHeight, "Continue button bottom was " + rect.bottom + " with viewport " + window.innerHeight);
        document.body.setAttribute("data-test-status", "PASS");
      } catch (error) {
        document.body.setAttribute("data-test-status", "FAIL " + error.message);
      }
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
        "--window-size=375,667",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=1000",
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

test("feedback lozenge text is vertically balanced", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-lozenge-layout-"));
  const userDataDir = path.join(tempDir, "profile");
  const harnessPath = path.join(tempDir, "harness.html");
  const styleUrl = pathToFileURL(path.join(root, "styles.css")).href;

  fs.writeFileSync(
    harnessPath,
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styleUrl}" />
  </head>
  <body>
    <section class="prompt-surface">
      <span id="incorrect-label" class="feedback-label incorrect-label">Incorrect</span>
      <div class="correct-toast"><span id="correct-label">Correct!</span></div>
    </section>
    <script>
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const measure = (selector) => {
        const label = document.querySelector(selector);
        const range = document.createRange();
        range.selectNodeContents(label);
        const labelRect = label.getBoundingClientRect();
        const textRect = range.getBoundingClientRect();
        const top = textRect.top - labelRect.top;
        const bottom = labelRect.bottom - textRect.bottom;
        const minClearance = window.innerWidth < 640 ? 5 : 8;
        const minLift = window.innerWidth < 640 ? 1 : 2;
        assert(top >= minClearance, selector + " top clearance was " + top);
        assert(bottom >= minClearance, selector + " bottom clearance was " + bottom);
        assert(bottom >= top + minLift, selector + " label sat too low: top " + top + ", bottom " + bottom);
        assert(bottom - top <= 18, selector + " label sat too high: top " + top + ", bottom " + bottom);
      };
      const colorAlpha = (value) => {
        const match = /rgba?\\([^,]+,[^,]+,[^,]+(?:,\\s*([\\d.]+))?\\)/.exec(value);
        return match && match[1] ? Number(match[1]) : 1;
      };
      try {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const toast = document.querySelector(".correct-toast");
        const correctLabel = document.querySelector("#correct-label");
        const toastAnimation = getComputedStyle(toast).animationName;
        const correctAnimation = getComputedStyle(document.querySelector("#correct-label")).animationName;
        const ringStyle = getComputedStyle(toast, "::before");
        const ringAnimation = ringStyle.animationName;
        const ringDisplay = ringStyle.display;
        if (reducedMotion) {
          assert(toastAnimation === "none", "Correct toast wrapper motion was not reduced");
          assert(correctAnimation === "none", "Correct lozenge motion was not reduced");
          assert(ringAnimation === "none", "Correct ring motion was not reduced");
          assert(ringDisplay === "none", "Correct ring still displayed under reduced motion");
        } else {
          assert(toastAnimation.includes("toast-fade"), "Correct toast wrapper animation was missing");
          assert(correctAnimation.includes("correct-label-pop"), "Correct lozenge pop animation was missing");
          assert(ringAnimation.includes("correct-ring-pop"), "Correct lozenge ring animation was missing");
          assert(ringDisplay !== "none", "Correct lozenge ring was missing");
          assert(parseFloat(ringStyle.width) > correctLabel.getBoundingClientRect().width * 1.25, "Correct ring was not wider than the lozenge");
          assert(parseFloat(ringStyle.borderTopWidth) >= 8, "Correct ring border was too subtle");
          assert(colorAlpha(ringStyle.borderTopColor) >= 0.35, "Correct ring border was too transparent");
        }
        measure("#incorrect-label");
        measure("#correct-label");
        document.body.setAttribute("data-test-status", "PASS");
      } catch (error) {
        document.body.setAttribute("data-test-status", "FAIL " + error.message);
      }
    </script>
  </body>
</html>`,
    "utf8",
  );

  try {
    const runs = [
      { windowSize: "1280,720", extraArgs: [] },
      { windowSize: "375,667", extraArgs: [] },
      { windowSize: "1280,720", extraArgs: ["--force-prefers-reduced-motion"] },
    ];
    for (const run of runs) {
      const output = execFileSync(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          `--window-size=${run.windowSize}`,
          "--force-device-scale-factor=1",
          ...run.extraArgs,
          `--user-data-dir=${userDataDir}`,
          "--virtual-time-budget=1000",
          "--dump-dom",
          pathToFileURL(harnessPath).href,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.match(output, /data-test-status="PASS"/);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
