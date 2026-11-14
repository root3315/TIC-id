import {
  axisDomain, earthEquivalentAu, decadeTicks, labelLanes, logX, planetDotRadius, planetLetter, inHabitableZone,
  stackLabels,
} from "./systemScale";

test("domain covers every apoapsis without stretching to 1 AU", () => {
  const [lo, hi] = axisDomain({ planets: [{ a_au: 0.011 }, { a_au: 0.062, eccentricity: 0.5 }] });
  expect(lo).toBeLessThanOrEqual(0.011 * 0.7);
  expect(hi).toBeGreaterThanOrEqual(0.062 * 1.5);
  expect(hi).toBeLessThanOrEqual(1);
});

test("domain includes extra marks such as the Earth-equivalent distance", () => {
  const [, hi] = axisDomain({ planets: [{ a_au: 0.05 }], extra: [3.2] });
  expect(hi).toBeGreaterThanOrEqual(3.2);
});

test("empty input falls back to a sane range", () => {
  expect(axisDomain({ planets: [] })).toEqual([0.1, 10]);
});

test("Earth-equivalent distance is the square root of luminosity", () => {
  expect(earthEquivalentAu(1)).toBeCloseTo(1);
  expect(earthEquivalentAu(470)).toBeCloseTo(21.68, 1);
  expect(earthEquivalentAu(null)).toBeNull();
});

test("domain stretches to a habitable zone far beyond the planets (Aldebaran)", () => {
  const hz = { inner_optimistic: 17.3, outer_optimistic: 44.3 };
  const [, hi] = axisDomain({ planets: [{ a_au: 1.46 }], hz });
  expect(hi).toBeGreaterThanOrEqual(44.3);
});

test("log scale maps decades evenly", () => {
  const x = logX([0.1, 10], 200);
  expect(x(0.1)).toBeCloseTo(0);
  expect(x(1)).toBeCloseTo(100);
  expect(x(10)).toBeCloseTo(200);
});

test("decade ticks", () => {
  expect(decadeTicks([0.01, 10])).toEqual([0.01, 0.1, 1, 10]);
});

test("crowded labels go to different lanes", () => {
  expect(labelLanes([0, 10, 20, 100])).toEqual([0, 1, 2, 0]);
});

test("planet dot radius is bounded", () => {
  expect(planetDotRadius(null)).toBe(4.5);
  expect(planetDotRadius(1)).toBeGreaterThanOrEqual(3);
  expect(planetDotRadius(5000)).toBe(11);
});

test("planet letter", () => {
  expect(planetLetter("tau Cet e", "tau Cet")).toBe("e");
  expect(planetLetter("TRAPPIST-1 b", "Other")).toBe("b");
});

test("habitable zone check", () => {
  const hz = { inner_optimistic: 0.8, outer_optimistic: 1.7 };
  expect(inHabitableZone(1, hz)).toBe(true);
  expect(inHabitableZone(3, hz)).toBe(false);
  expect(inHabitableZone(1, null)).toBe(false);
});

test("a tiny star does not stretch the axis (TRAPPIST-1)", () => {
  const [lo, hi] = axisDomain({ planets: [{ a_au: 0.0115 }, { a_au: 0.0619 }] });
  expect(lo).toBe(0.001);
  expect(hi).toBe(0.1);
});

describe("stackLabels", () => {
  it("keeps labels at their points when there is room", () => {
    expect(stackLabels([10, 40, 90])).toEqual([10, 40, 90]);
  });
  it("pushes crowded labels down, never up", () => {
    expect(stackLabels([10, 15, 20, 80], 18)).toEqual([10, 28, 46, 80]);
  });
});
