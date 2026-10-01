import { checkDue } from "../src/app/useUpdates";

describe("automatic update checks", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("happen at most about once a day", () => {
    expect(checkDue(null, now)).toBe(true);
    expect(checkDue("garbage", now)).toBe(true);
    expect(checkDue("2026-10-01T09:00:00Z", now)).toBe(false);
    expect(checkDue("2026-09-30T12:00:00Z", now)).toBe(true);
    // A clock that went backwards doesn't stop them for good.
    expect(checkDue("2027-01-01T00:00:00Z", now)).toBe(true);
  });
});
