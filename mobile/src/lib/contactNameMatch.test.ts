import { describe, expect, it } from "vitest";

import { pickAutoContact, scoreContactNameMatch } from "./contactNameMatch";

describe("scoreContactNameMatch", () => {
  it("scores exact first name highest", () => {
    expect(
      scoreContactNameMatch("Leo", {
        firstName: "Leo",
        lastName: "Wang",
      }),
    ).toBe(100);
  });

  it("does not loosely match unrelated names", () => {
    expect(
      scoreContactNameMatch("Leo", {
        firstName: "Fortino",
        lastName: "Smith",
      }),
    ).toBe(0);
  });

  it("matches nickname", () => {
    expect(
      scoreContactNameMatch("Mom", {
        nickname: "Mom",
        firstName: "Mary",
      }),
    ).toBe(100);
  });
});

describe("pickAutoContact", () => {
  it("auto-picks only one strong match", () => {
    expect(
      pickAutoContact([
        { id: "1", name: "Leo", email: "leo@x.com", score: 100 },
      ]),
    ).toEqual({ id: "1", name: "Leo", email: "leo@x.com", score: 100 });
  });

  it("returns null when multiple strong matches", () => {
    expect(
      pickAutoContact([
        { id: "1", name: "Leo Wang", phone: "1", score: 100 },
        { id: "2", name: "Leo Chen", phone: "2", score: 100 },
      ]),
    ).toBeNull();
  });

  it("returns null when best match is weak", () => {
    expect(
      pickAutoContact([{ id: "1", name: "Leonard", phone: "1", score: 88 }]),
    ).toBeNull();
  });
});
