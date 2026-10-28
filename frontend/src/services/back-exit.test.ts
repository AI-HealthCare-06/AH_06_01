import { describe, expect, it, vi } from "vitest";
import { createBackExitHandler } from "./back-exit";
describe("Android double-back exit", () => {
  it("shows a toast first and exits only on a second press inside two seconds", () => {
    let time = 0;
    const onFirst = vi.fn(),
      onExit = vi.fn();
    const handler = createBackExitHandler({ onFirst, onExit, now: () => time });
    handler.press();
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    time = 1500;
    handler.press();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
  it("rearms after timeout and after leaving the app", () => {
    let time = 100;
    const onFirst = vi.fn(),
      onExit = vi.fn();
    const handler = createBackExitHandler({ onFirst, onExit, now: () => time });
    handler.press();
    time = 2100;
    handler.press();
    expect(onExit).not.toHaveBeenCalled();
    handler.reset();
    time = 2200;
    handler.press();
    expect(onFirst).toHaveBeenCalledTimes(3);
  });
  it("returns to home first, then requires two new presses to exit", () => {
    let home = false,
      time = 0;
    const onFirst = vi.fn(),
      onExit = vi.fn(),
      onHome = vi.fn(() => {
        home = true;
      });
    const handler = createBackExitHandler({
      onFirst,
      onExit,
      onHome,
      isHome: () => home,
      now: () => time,
    });
    handler.press();
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(onFirst).not.toHaveBeenCalled();
    time = 200;
    handler.press();
    expect(onFirst).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    time = 500;
    handler.press();
    expect(onExit).toHaveBeenCalledTimes(1);
    home = false;
    handler.press();
    expect(onHome).toHaveBeenCalledTimes(2);
    time = 600;
    handler.press();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
