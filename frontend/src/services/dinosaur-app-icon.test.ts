import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const mock = vi.hoisted(() => ({ available: true, set: vi.fn(), listener: vi.fn() }));
let game = create(() => ({ game: { dinosaur: 0 } }));
let session = create(() => ({ active: true }));
let cloud = create(() => ({ ready: true }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isPluginAvailable: () => mock.available },
  registerPlugin: () => ({ setDinosaur: mock.set }),
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: mock.listener } }));
vi.mock("../stores/game-store", () => ({
  useGameStore: {
    getState: () => game.getState(),
    subscribe: (...args: Parameters<typeof game.subscribe>) => game.subscribe(...args),
  },
}));
vi.mock("../stores/session-store", () => ({
  useSessionStore: {
    getState: () => session.getState(),
    subscribe: (...args: Parameters<typeof session.subscribe>) => session.subscribe(...args),
  },
}));
vi.mock("../cloud/sync", () => ({
  useCloudStore: {
    getState: () => cloud.getState(),
    subscribe: (...args: Parameters<typeof cloud.subscribe>) => cloud.subscribe(...args),
  },
}));

describe("selected dinosaur launcher", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mock.available = true;
    game = create(() => ({ game: { dinosaur: 0 } }));
    session = create(() => ({ active: true }));
    cloud = create(() => ({ ready: true }));
    mock.set.mockResolvedValue({});
    mock.listener.mockResolvedValue({ remove: vi.fn() });
  });
  it("waits for the signed-in account to finish loading", async () => {
    cloud.setState({ ready: false });
    const { startDinosaurAppIcon } = await import("./dinosaur-app-icon");
    startDinosaurAppIcon();
    expect(mock.set).not.toHaveBeenCalled();
    game.setState({ game: { dinosaur: 4 } });
    cloud.setState({ ready: true });
    await vi.waitFor(() => expect(mock.set).toHaveBeenLastCalledWith({ dinosaur: 4 }));
  });
  it("settles rapid selection on the newest dinosaur", async () => {
    let done: () => void = () => {};
    mock.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    const { startDinosaurAppIcon } = await import("./dinosaur-app-icon");
    startDinosaurAppIcon();
    game.setState({ game: { dinosaur: 1 } });
    game.setState({ game: { dinosaur: 5 } });
    done();
    await vi.waitFor(() => expect(mock.set).toHaveBeenLastCalledWith({ dinosaur: 5 }));
  });
  it("does not invoke an unavailable native plugin", async () => {
    mock.available = false;
    const { startDinosaurAppIcon } = await import("./dinosaur-app-icon");
    startDinosaurAppIcon();
    expect(mock.set).not.toHaveBeenCalled();
  });
});
