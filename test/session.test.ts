import { decodePosition, decodeSession, encodePosition, encodeSession } from "../src/app/session";

describe("reading positions", () => {
  it("round-trips", () => {
    const p = { anchor: { page: 12, fraction: 0.4321 }, zoom: { mode: "custom" as const, zoom: 1.25 } };
    expect(decodePosition(encodePosition(p))).toEqual(p);
  });

  it("rejects or repairs bad data", () => {
    expect(decodePosition(null)).toBeNull();
    expect(decodePosition("not json")).toBeNull();
    expect(decodePosition('{"v":2,"page":1,"fraction":0}')).toBeNull();
    expect(decodePosition('{"v":1,"page":-1,"fraction":0}')).toBeNull();
    expect(decodePosition('{"v":1,"page":3,"fraction":7,"mode":"weird","zoom":-2}')).toEqual({
      anchor: { page: 3, fraction: 1 },
      zoom: { mode: "fit-width", zoom: 1 },
    });
  });
});

describe("session", () => {
  it("round-trips", () => {
    const s = { tabs: [{ path: "C:/a.pdf", name: "a.pdf" }], active: 0, outlineOpen: true, annotationsOpen: true };
    expect(decodeSession(encodeSession(s))).toEqual(s);
  });

  it("drops malformed tabs and clamps the active index", () => {
    const json = JSON.stringify({ v: 1, tabs: [{ path: "a", name: "a" }, { path: 3 }, null], active: 9 });
    expect(decodeSession(json)).toEqual({ tabs: [{ path: "a", name: "a" }], active: 0, outlineOpen: false, annotationsOpen: false });
    expect(decodeSession("{}")).toBeNull();
  });
});
