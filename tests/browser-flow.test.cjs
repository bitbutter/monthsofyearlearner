"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const net = require("node:net");
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

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function withChromeRuntime(browser, htmlPath, userDataDir, callback) {
  const port = await availablePort();
  const chrome = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      "--window-size=800,600",
      "--force-device-scale-factor=1",
      `--user-data-dir=${userDataDir}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  let socket = null;
  try {
    let target = null;
    for (let attempt = 0; attempt < 30 && !target; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await response.json();
        target = targets.find((candidate) => candidate.type === "page");
      } catch (_error) {
        await waitMs(100);
      }
    }
    assert.ok(target, "Chrome DevTools target did not open");

    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let messageId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = (messageId += 1);
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    await send("Runtime.enable");
    const evaluate = async (expression) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true });
      if (response.result.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.text);
      }
      return response.result.result.value;
    };
    await callback({ evaluate, send });
  } finally {
    if (socket) socket.close();
    chrome.kill();
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), waitMs(1500)]);
  }
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
        assert(appText().includes("Today's 5 minute practice"), "home screen did not render");
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
        for (let attempts = 0; attempts < 20 && !document.querySelector(".correct-toast"); attempts += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert(appText().includes("Correct!"), "correct toast did not render");
        await new Promise((resolve) => setTimeout(resolve, 80));
        const liveReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const liveToast = document.querySelector(".correct-toast");
        const liveRing = document.querySelector(".correct-ring-primary");
        const liveLabel = document.querySelector(".correct-label");
        assert(liveToast && liveRing && liveLabel, "correct toast parts did not render");
        const liveToastStyle = getComputedStyle(liveToast);
        const liveRingStyle = getComputedStyle(liveRing);
        const liveLabelStyle = getComputedStyle(liveLabel);
        assert(Number(liveToastStyle.opacity) >= 0.2, "live correct overlay was not visible");
        assert(Number(liveRingStyle.opacity) >= 0.2, "live correct ring was not visible");
        if (liveReducedMotion) {
          assert(liveRingStyle.animationName.includes("correct-ring-reduced"), "live correct reduced-motion ring was missing");
          assert(liveLabelStyle.animationName.includes("correct-label-rise"), "live correct label rise animation was missing");
          assert(liveLabelStyle.animationName.includes("correct-label-exit"), "live correct label exit animation was missing");
          assert(!liveLabelStyle.animationName.includes("correct-label-pop"), "live correct label bounce was not reduced");
        } else {
          assert(liveRingStyle.animationName.includes("correct-ring-pop"), "live correct ring animation was missing");
          assert(liveLabelStyle.animationName.includes("correct-label-rise"), "live correct label rise animation was missing");
          assert(liveLabelStyle.animationName.includes("correct-label-settle-halo"), "live correct label halo animation was missing");
          assert(liveLabelStyle.animationName.includes("correct-label-exit"), "live correct label exit animation was missing");
        }
        for (let attempts = 0; attempts < 50 && document.querySelector(".prompt-text").textContent === promptText; attempts += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
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

test("correct toast animation visibly advances in a live browser", async (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-live-animation-"));
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
    <script src="${coreUrl}"></script>
    <script>
      localStorage.removeItem(MonthsLearnerCore.STORAGE_KEY);
    </script>
    <script src="${appUrl}"></script>
  </body>
</html>`,
    "utf8",
  );

  try {
    await withChromeRuntime(browser, harnessPath, userDataDir, async ({ evaluate, send }) => {
      await send("Page.enable");
      await evaluate(`(() => {
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
        document.querySelector('[data-action="start-session"]').click();
        const input = document.querySelector("#answer-input");
        input.value = answerForPrompt(document.querySelector(".prompt-text").textContent);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-confidence="Sure"]').click();
      })()`);
      for (let attempts = 0; attempts < 30; attempts += 1) {
        if (await evaluate(`document.querySelector(".correct-toast") !== null`)) break;
        await waitMs(25);
      }
      assert.equal(await evaluate(`document.querySelector(".correct-toast") !== null`), true, "real app correct toast did not render");
      const sample = () =>
        evaluate(`(() => {
          const toast = document.querySelector(".correct-toast");
          if (!toast) return { gone: true };
          const ring = document.querySelector(".correct-ring-primary");
          const label = document.querySelector(".correct-label");
          const toastStyle = getComputedStyle(toast);
          const ringStyle = getComputedStyle(ring);
          const labelStyle = getComputedStyle(label);
          const rect = toast.getBoundingClientRect();
          const inputRect = document.querySelector("#answer-input").getBoundingClientRect();
          const ringRect = ring.getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          return {
            reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
            toastOpacity: Number(toastStyle.opacity),
            ringOpacity: Number(ringStyle.opacity),
            ringTransform: ringStyle.transform,
            ringBorderColor: ringStyle.borderTopColor,
            ringBoxShadow: ringStyle.boxShadow,
            ringAnimation: ringStyle.animationName,
            ringDuration: ringStyle.animationDuration,
            labelAnimation: labelStyle.animationName,
            labelOpacity: Number(labelStyle.opacity),
            toastRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            inputCenterY: inputRect.top + inputRect.height / 2,
            ringCenterY: ringRect.top + ringRect.height / 2,
            labelCenterY: labelRect.top + labelRect.height / 2,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        })()`);
      await waitMs(180);
      const first = await sample();
      const firstClip = {
        x: Math.max(0, first.toastRect.x),
        y: Math.max(0, first.toastRect.y),
        width: Math.min(first.toastRect.width, first.viewport.width - Math.max(0, first.toastRect.x)),
        height: Math.min(first.toastRect.height, first.viewport.height - Math.max(0, first.toastRect.y)),
        scale: 1,
      };
      assert(firstClip.width > 120 && firstClip.height > 120, "correct toast was not visibly inside the viewport");
      const firstShot = await send("Page.captureScreenshot", { format: "png", clip: firstClip });
      await waitMs(120);
      const second = await sample();
      await waitMs(360);
      const third = await sample();
      const secondShot = await send("Page.captureScreenshot", { format: "png", clip: firstClip });
      assert(first.toastOpacity >= 0.2 || second.toastOpacity >= 0.2, "toast wrapper was not visibly present");
      assert(first.ringOpacity >= 0.2 || second.ringOpacity >= 0.2, "correct ring was not visibly present");
      assert.notEqual(firstShot.result.data, secondShot.result.data, "correct toast pixels did not change between live frames");
      assert(Math.abs(first.labelCenterY - first.inputCenterY) <= 12, "correct lozenge did not settle at answer input height");
      assert(Math.abs(first.ringCenterY - first.labelCenterY) <= 6, "correct ring did not originate from the settled lozenge position");
      assert(first.ringDuration.split(",").some((duration) => duration.trim() === "0.3s" || duration.trim() === "300ms"), "correct ring was not 3x faster");
      assert(third.gone || third.labelCenterY > first.labelCenterY + 8, "correct lozenge did not move downward for exit");
      assert(third.gone || third.labelOpacity < first.labelOpacity, "correct lozenge did not fade during exit");
      if (first.reducedMotion) {
        assert(first.ringAnimation.includes("correct-ring-reduced"), "reduced-motion ring animation was missing");
        assert(first.ringTransform !== second.ringTransform, "reduced-motion correct ring did not grow between live frames");
        assert(
          first.ringOpacity !== second.ringOpacity ||
            first.ringBorderColor !== second.ringBorderColor ||
            first.ringBoxShadow !== second.ringBoxShadow,
          "reduced-motion ring did not visibly pulse",
        );
        assert(first.labelAnimation.includes("correct-label-rise"), "reduced-motion label rise was missing");
        assert(first.labelAnimation.includes("correct-label-exit"), "reduced-motion label exit was missing");
        assert(!first.labelAnimation.includes("correct-label-pop"), "reduced-motion label should not bounce");
      } else {
        assert(first.ringAnimation.includes("correct-ring-pop"), "ring expansion animation was missing");
        assert(first.ringTransform !== second.ringTransform, "correct ring did not expand between live frames");
        assert(first.labelAnimation.includes("correct-label-rise"), "correct label rise animation was missing");
        assert(first.labelAnimation.includes("correct-label-settle-halo"), "correct label halo animation was missing");
        assert(first.labelAnimation.includes("correct-label-exit"), "correct label exit animation was missing");
      }
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("graduation test mode seeds an isolated eligible profile", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-graduation-test-mode-"));
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
      window.addEventListener("error", (event) => {
        document.body.setAttribute("data-test-status", "FAIL " + event.message);
      });
    </script>
    <script src="${coreUrl}"></script>
    <script>
      localStorage.setItem(MonthsLearnerCore.STORAGE_KEY, "real-progress-marker");
    </script>
    <script src="${appUrl}"></script>
    <script>
      const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
      const appText = () => document.querySelector("#app").textContent;
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        assert(appText().includes("Graduation test mode"), "test mode heading did not render");
        assert(document.querySelector('[data-action="start-graduation"]').textContent.trim() === "Take graduation check", "test mode did not expose graduation check");
        assert(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY) === "real-progress-marker", "test mode touched real progress storage");
        const testState = JSON.parse(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY + ".graduationTest"));
        assert(testState.goal.status === "eligible_for_check", "test profile was not graduation eligible");
        document.querySelector('[data-action="start-graduation"]').click();
        await wait();
        assert(document.querySelector("#graduation-input"), "graduation input did not render from test mode");
        assert(appText().includes("graduation check"), "graduation check did not start from test mode");
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
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=3000",
        "--dump-dom",
        `${pathToFileURL(harnessPath).href}?graduationTest=1`,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.match(output, /data-test-status="PASS"/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("queue exhaustion lands on the same learner-facing summary page", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-summary-"));
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
      window.addEventListener("error", (event) => {
        document.body.setAttribute("data-test-status", "FAIL " + event.message);
      });
    </script>
    <script src="${coreUrl}"></script>
    <script>
      const now = new Date();
      const state = MonthsLearnerCore.createInitialState(now);
      const futureDue = MonthsLearnerCore.nextDueAt(now, 7);
      Object.keys(state.cards).forEach((cardId) => {
        state.cards[cardId].dueAt = futureDue;
      });
      state.cards["number_to_name:1"].dueAt = now.toISOString();
      localStorage.setItem(MonthsLearnerCore.STORAGE_KEY, JSON.stringify(state));
    </script>
    <script src="${appUrl}"></script>
    <script>
      const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
      const appText = () => document.querySelector("#app").textContent;
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        document.querySelector('[data-action="start-session"]').click();
        await wait();
        const prompt = document.querySelector(".prompt-text").textContent;
        assert(prompt === "What is month 1?", "expected only January to be due, got " + prompt);
        const input = document.querySelector("#answer-input");
        input.value = "January";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector('[data-confidence="Sure"]').click();
        for (let attempts = 0; attempts < 80 && !appText().includes("Session complete"); attempts += 1) {
          await wait(25);
        }
        assert(appText().includes("Session complete"), "queue exhaustion did not show the summary page");
        assert(appText().includes("You completed 1 session!"), "summary did not show completed session count");
        assert(appText().includes("Every answer updated your practice plan"), "summary did not include learner-facing goal progress copy");
        assert(document.querySelector(".summary-band"), "summary metrics were not included");
        assert(document.querySelector(".progress-trend-panel"), "progress-over-time panel was not included");
        assert(document.querySelector(".trend circle"), "progress trend did not render a visible point");
        assert(!appText().includes("No due review is waiting"), "old no-due copy is still visible");
        const stored = JSON.parse(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY));
        assert(stored.sessions.length === 1, "completed session was not saved");
        assert(stored.sessions[0].isInProgress === false, "session stayed in progress after queue exhaustion");
        assert(stored.sessions[0].answers === 1, "summary did not keep reviewed answer count");
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
        "--window-size=1280,720",
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

test("timer completion lands on the same learner-facing summary page", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-timer-summary-"));
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
      const RealDate = Date;
      let fakeNowMs = new RealDate("2026-05-17T08:00:00.000Z").getTime();
      class FakeDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fakeNowMs]));
        }
        static now() {
          return fakeNowMs;
        }
        static parse(value) {
          return RealDate.parse(value);
        }
        static UTC(...args) {
          return RealDate.UTC(...args);
        }
      }
      window.Date = FakeDate;
      window.advanceFakeTime = (ms) => {
        fakeNowMs += ms;
      };
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
      const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
      const appText = () => document.querySelector("#app").textContent;
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        document.querySelector('[data-action="start-session"]').click();
        await wait();
        window.advanceFakeTime((MonthsLearnerCore.DAILY_MINUTES * 60 + 1) * 1000);
        for (let attempts = 0; attempts < 80 && !appText().includes("Session complete"); attempts += 1) {
          await wait(25);
        }
        assert(appText().includes("Session complete"), "timer completion did not show the summary page");
        assert(appText().includes("You completed 1 session!"), "timer summary did not show completed session count");
        assert(document.querySelector(".summary-band"), "timer summary metrics were not included");
        assert(document.querySelector(".progress-trend-panel"), "timer progress-over-time panel was not included");
        assert(!appText().includes("No due review is waiting"), "old no-due copy is visible after timer completion");
        const stored = JSON.parse(localStorage.getItem(MonthsLearnerCore.STORAGE_KEY));
        assert(stored.sessions.length === 1, "timer-completed session was not saved");
        assert(stored.sessions[0].isInProgress === false, "timer-completed session stayed in progress");
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
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=4000",
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

test("sequence prompts show learner-facing instruction text", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-instructions-"));
  const coreUrl = pathToFileURL(path.join(root, "core.js")).href;
  const appUrl = pathToFileURL(path.join(root, "app.js")).href;
  const styleUrl = pathToFileURL(path.join(root, "styles.css")).href;
  const checks = [
    ["gap_fill:even_months", "Type the missing months in order."],
    ["ordinal_sequence:full", "Type all 12 months in order."],
    ["ordinal_sequence:first_half", "Type months 1 to 6 in order."],
    ["ordinal_sequence:second_half", "Type months 7 to 12 in order."],
  ];

  try {
    checks.forEach(([cardId, expectedInstruction], index) => {
      const userDataDir = path.join(tempDir, `profile-${index}`);
      const harnessPath = path.join(tempDir, `harness-${index}.html`);
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
      window.addEventListener("error", (event) => {
        document.body.setAttribute("data-test-status", "FAIL " + event.message);
      });
    </script>
    <script src="${coreUrl}"></script>
    <script>
      const now = new Date();
      const state = MonthsLearnerCore.createInitialState(now);
      const futureDue = MonthsLearnerCore.nextDueAt(now, 7);
      Object.keys(state.cards).forEach((id) => {
        state.cards[id].dueAt = futureDue;
      });
      state.cards["${cardId}"].dueAt = now.toISOString();
      localStorage.setItem(MonthsLearnerCore.STORAGE_KEY, JSON.stringify(state));
    </script>
    <script src="${appUrl}"></script>
    <script>
      const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        const definitions = MonthsLearnerCore.makeCardDefinitions();
        document.querySelector('[data-action="start-session"]').click();
        await wait();
        assert(document.querySelector(".prompt-text").textContent === definitions["${cardId}"].prompt, "wrong prompt rendered for ${cardId}");
        assert(document.querySelector(".prompt-instruction").textContent === "${expectedInstruction}", "wrong instruction for ${cardId}");
        document.querySelector("#answer-input").value = "wrong";
        document.querySelector('[data-confidence="Sure"]').click();
        await wait();
        assert(document.querySelector(".prompt-instruction").textContent === "${expectedInstruction}", "feedback lost instruction for ${cardId}");
        document.body.setAttribute("data-test-status", "PASS");
      })().catch((error) => {
        document.body.setAttribute("data-test-status", "FAIL " + error.message);
      });
    </script>
  </body>
</html>`,
        "utf8",
      );
      const output = execFileSync(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--window-size=1280,720",
          "--force-device-scale-factor=1",
          `--user-data-dir=${userDataDir}`,
          "--virtual-time-budget=3000",
          "--dump-dom",
          pathToFileURL(harnessPath).href,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.match(output, /data-test-status="PASS"/);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("graduation sequence prompt uses the same learner-facing instruction", (t) => {
  const browser = findChrome();
  if (!browser) {
    t.skip("Chrome or Edge is not installed in a known location");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "months-learner-graduation-instruction-"));
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
      window.addEventListener("error", (event) => {
        document.body.setAttribute("data-test-status", "FAIL " + event.message);
      });
    </script>
    <script src="${coreUrl}"></script>
    <script>
      const now = new Date();
      let state = MonthsLearnerCore.createInitialState(now);
      const dueAt = MonthsLearnerCore.nextDueAt(now, 30);
      Object.values(state.cards).forEach((card) => {
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
      ["2026-05-10T08:00:00.000Z", "2026-05-14T08:00:00.000Z", "2026-05-17T08:00:00.000Z"].forEach((startedAt) => {
        const started = new Date(startedAt);
        const draft = MonthsLearnerCore.createSessionDraft(state, { now: started });
        draft.elapsedSeconds = 60;
        state = MonthsLearnerCore.completeSession(state, draft, new Date(started.getTime() + 60000));
        const latest = state.sessions[state.sessions.length - 1];
        latest.answers = 1;
        latest.correct = 1;
        latest.averageResponseMs = 1000;
      });
      localStorage.setItem(MonthsLearnerCore.STORAGE_KEY, JSON.stringify(state));
    </script>
    <script src="${appUrl}"></script>
    <script>
      const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
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
        throw new Error("No test answer for prompt: " + prompt);
      };
      const assert = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      (async () => {
        await wait();
        document.querySelector('[data-action="start-graduation"]').click();
        for (let attempts = 0; attempts < 40 && !document.querySelector(".prompt-text").textContent.includes("1 to 12"); attempts += 1) {
          document.querySelector("#graduation-input").value = answerForPrompt(document.querySelector(".prompt-text").textContent);
          document.querySelector('[data-graduation-confidence="Sure"]').click();
          await wait();
        }
        assert(document.querySelector(".prompt-text").textContent.includes("1 to 12"), "graduation sequence prompt did not render");
        assert(document.querySelector(".prompt-instruction").textContent === "Type all 12 months in order.", "graduation sequence instruction was missing");
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
        "--window-size=1280,720",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userDataDir}`,
        "--virtual-time-budget=4000",
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
      <div class="correct-toast">
        <span class="correct-ring correct-ring-primary" aria-hidden="true"></span>
        <span class="correct-ring correct-ring-secondary" aria-hidden="true"></span>
        <span id="correct-label" class="correct-label">Correct!</span>
      </div>
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
        const ring = document.querySelector(".correct-ring-primary");
        const secondaryRing = document.querySelector(".correct-ring-secondary");
        const toastAnimation = getComputedStyle(toast).animationName;
        const correctAnimation = getComputedStyle(document.querySelector("#correct-label")).animationName;
        const ringStyle = getComputedStyle(ring);
        const secondaryRingStyle = getComputedStyle(secondaryRing);
        const ringAnimation = ringStyle.animationName;
        const ringDisplay = ringStyle.display;
        if (reducedMotion) {
          assert(toastAnimation.includes("toast-fade-reduced"), "Correct toast wrapper did not use reduced fade");
          assert(correctAnimation.includes("correct-label-rise"), "Correct lozenge rise animation was missing");
          assert(correctAnimation.includes("correct-label-exit"), "Correct lozenge exit animation was missing");
          assert(!correctAnimation.includes("correct-label-pop"), "Correct lozenge bounce was not reduced");
          assert(ringAnimation.includes("correct-ring-reduced"), "Correct reduced-motion ring was missing");
          assert(ringDisplay !== "none", "Correct ring was hidden under reduced motion");
          assert(secondaryRingStyle.display === "none", "Secondary correct ring was not reduced");
          assert(Number(ringStyle.opacity) >= 0.2, "Correct reduced-motion ring was not visible");
          assert(ringStyle.transform !== "none", "Correct reduced-motion ring did not have a growth transform");
        } else {
          assert(toastAnimation.includes("toast-fade"), "Correct toast wrapper animation was missing");
          assert(correctAnimation.includes("correct-label-rise"), "Correct lozenge rise animation was missing");
          assert(correctAnimation.includes("correct-label-settle-halo"), "Correct lozenge halo animation was missing");
          assert(correctAnimation.includes("correct-label-exit"), "Correct lozenge exit animation was missing");
          assert(ringAnimation.includes("correct-ring-pop"), "Correct lozenge ring animation was missing");
          assert(ringDisplay !== "none", "Correct lozenge ring was missing");
          assert(parseFloat(ringStyle.width) >= Math.min(180, correctLabel.getBoundingClientRect().width), "Correct ring was too small to read");
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
