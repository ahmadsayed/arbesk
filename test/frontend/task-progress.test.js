/** @jest-environment jsdom */
import { jest } from "@jest/globals";
import {
  startTaskProgress,
  setTaskProgress,
  finishTaskProgress,
  failTaskProgress,
} from "../../frontend/src/js/ui/task-progress.js";

function setupDom() {
  document.body.innerHTML = `
    <div id="taskProgress" class="task-progress" hidden>
      <span id="taskProgressLabel"></span>
      <div class="task-progress-track">
        <div id="taskProgressFill"></div>
      </div>
    </div>`;
}

function els() {
  return {
    overlay: document.getElementById("taskProgress"),
    label: document.getElementById("taskProgressLabel"),
    fill: document.getElementById("taskProgressFill"),
  };
}

describe("task-progress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setupDom();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("startTaskProgress shows the overlay with label and fraction", () => {
    startTaskProgress("Saving draft…", 0.15);
    const { overlay, label, fill } = els();
    expect(overlay.hidden).toBe(false);
    expect(label.textContent).toBe("Saving draft…");
    expect(fill.style.width).toBe("15%");
  });

  test("setTaskProgress advances the fill and updates the label", () => {
    startTaskProgress("Besking — preparing…", 0.1);
    setTaskProgress(0.6, "Confirm the transaction in your wallet…");
    const { label, fill } = els();
    expect(label.textContent).toBe("Confirm the transaction in your wallet…");
    expect(fill.style.width).toBe("60%");
  });

  test("fractions are clamped to 0..1", () => {
    startTaskProgress("x", 1.4);
    expect(els().fill.style.width).toBe("100%");
    setTaskProgress(-0.5, "y");
    expect(els().fill.style.width).toBe("0%");
  });

  test("finishTaskProgress completes and fades out, then hides", () => {
    startTaskProgress("Saving…", 0.5);
    finishTaskProgress("Draft saved.");
    const { overlay, fill } = els();
    expect(fill.style.width).toBe("100%");
    expect(overlay.hidden).toBe(false);

    jest.advanceTimersByTime(2200);
    expect(overlay.classList.contains("fade")).toBe(true);
    jest.advanceTimersByTime(250);
    expect(overlay.hidden).toBe(true);
  });

  test("failTaskProgress applies error styling and hides after a longer delay", () => {
    startTaskProgress("Besking…", 0.6);
    failTaskProgress("Publish failed.");
    const { overlay } = els();
    expect(overlay.classList.contains("error")).toBe(true);

    jest.advanceTimersByTime(2200);
    expect(overlay.classList.contains("fade")).toBe(false); // not yet
    jest.advanceTimersByTime(1800);
    expect(overlay.classList.contains("fade")).toBe(true);
  });

  test("a new start cancels a pending fade and clears error state", () => {
    failTaskProgress("Publish failed.");
    startTaskProgress("Saving draft…", 0.15);
    const { overlay } = els();
    expect(overlay.hidden).toBe(false);
    expect(overlay.classList.contains("error")).toBe(false);
    expect(overlay.classList.contains("fade")).toBe(false);

    // The earlier hide timer must not hide the fresh overlay.
    jest.advanceTimersByTime(10_000);
    expect(overlay.hidden).toBe(false);
  });

  test("no-ops gracefully when the markup is absent", () => {
    document.body.innerHTML = "";
    expect(() => {
      startTaskProgress("x");
      setTaskProgress(0.5, "y");
      finishTaskProgress("z");
      failTaskProgress("w");
    }).not.toThrow();
  });
});
