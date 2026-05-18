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
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        assert(document.body.textContent.includes("Today's 8 minute practice"), "home screen did not render");
        document.querySelector('[data-action="start-session"]').click();
        await wait();
        const input = document.querySelector("#answer-input");
        assert(input, "answer input did not render");
        assert(document.activeElement === input, "answer input was not focused");
        const promptText = document.querySelector(".prompt-text").textContent;
        input.value = promptText.includes("What number") ? "1" : "January";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-confidence="Sure"]').click();
        await wait();
        assert(document.body.textContent.includes("Expected"), "feedback did not render");
        assert(document.body.textContent.includes("January"), "feedback did not name expected answer");
        const stored = JSON.parse(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY));
        assert(stored.sessions.length === 1, "in-progress session was not persisted");
        assert(stored.sessions[0].isInProgress === true, "session was not marked in progress");
        assert(stored.sessions[0].answerEvents.length === 1, "answer event was not persisted");
        assert(stored.sessions[0].answerEvents[0].correct === true, "persisted event was not correct");
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
