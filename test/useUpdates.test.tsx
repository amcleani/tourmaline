import { act, renderHook } from "@testing-library/react";

let resolveCheck: (update: null) => void = () => {};
vi.mock("../src/platform", () => ({
  checkForUpdate: vi.fn(() => new Promise((r) => (resolveCheck = r))),
  getState: vi.fn(async () => null),
  setState: vi.fn(async () => {}),
}));

import { useUpdates } from "../src/app/useUpdates";

describe("useUpdates", () => {
  it("answers a check asked for while the automatic one is under way", async () => {
    const { result } = renderHook(() => useUpdates(async () => {}));
    // The automatic check at start (nothing saved: due).
    await act(async () => {});
    act(() => void result.current.check(true));
    expect(result.current.status.kind).toBe("checking");
    await act(async () => resolveCheck(null));
    expect(result.current.status.kind).toBe("current");
  });

  it("says nothing when an automatic check finds no update", async () => {
    const { result } = renderHook(() => useUpdates(async () => {}));
    await act(async () => {});
    await act(async () => resolveCheck(null));
    expect(result.current.status.kind).toBe("idle");
  });
});
