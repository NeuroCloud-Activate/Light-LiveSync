import assert from "node:assert/strict";
import { CalmStatusPresenter } from "../src/status-presenter.ts";

let now = 0;
let nextTimerId = 1;
const timers = new Map();
const shown = [];

const presenter = new CalmStatusPresenter({
  now: () => now,
  setText: (message) => shown.push({ at: now, message }),
  setTimer: (callback, delayMs) => {
    const id = nextTimerId++;
    timers.set(id, { callback, due: now + delayMs });
    return id;
  },
  clearTimer: (id) => {
    timers.delete(id);
  }
}, { minimumVisibleMs: 1000 });

function advanceTo(targetTime) {
  while (true) {
    let nextId = null;
    let nextDue = Infinity;
    for (const [id, timer] of timers) {
      if (timer.due < nextDue) {
        nextId = id;
        nextDue = timer.due;
      }
    }
    if (nextId === null || nextDue > targetTime) {
      now = targetTime;
      return;
    }
    now = nextDue;
    const timer = timers.get(nextId);
    timers.delete(nextId);
    timer.callback();
  }
}

presenter.set("loaded");
advanceTo(100);
presenter.set("syncing");
advanceTo(400);
presenter.set("queued latest");
advanceTo(999);

assert.deepEqual(shown, [{ at: 0, message: "loaded" }]);

advanceTo(1000);
assert.deepEqual(shown, [
  { at: 0, message: "loaded" },
  { at: 1000, message: "queued latest" }
]);

presenter.set("done");
advanceTo(1500);
assert.equal(shown.length, 2);
advanceTo(2000);
assert.deepEqual(shown.at(-1), { at: 2000, message: "done" });

presenter.set("will cancel");
presenter.cancel();
advanceTo(3000);
assert.equal(shown.at(-1).message, "done");

console.log(JSON.stringify({
  ok: true,
  minimumVisibleMs: 1000,
  latestQueuedMessageWon: shown[1].message === "queued latest",
  cancelledQueuedMessage: shown.at(-1).message === "done",
  shown
}, null, 2));
