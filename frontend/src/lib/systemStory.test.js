import { describeStar, lightYears, systemLede } from "./systemStory";

const ru = (ruText) => ruText;
const en = (_ruText, enText) => enText;

test("K giant reads as an orange giant", () => {
  expect(describeStar({ spectral_type: "K5 III", temperature: 4055, radius: 45.1 }, ru)).toBe("Оранжевый гигант");
  expect(describeStar({ spectral_type: "K5 III", temperature: 4055, radius: 45.1 }, en)).toBe("Orange giant");
});

test("M dwarf without a spectral class falls back to temperature and radius", () => {
  expect(describeStar({ temperature: 2566, radius: 0.12 }, ru)).toBe("Красный карлик");
});

test("G main-sequence star keeps feminine agreement", () => {
  expect(describeStar({ spectral_type: "G8.5V", temperature: 5310, radius: 0.83 }, ru)).toBe("Жёлтая звезда");
});

test("subgiant and supergiant classes", () => {
  expect(describeStar({ spectral_type: "G0 IV", radius: 2.1 }, ru)).toBe("Жёлтый субгигант");
  expect(describeStar({ spectral_type: "M2 Iab", radius: 800 }, ru)).toBe("Красный сверхгигант");
});

test("light years agree with the number", () => {
  expect(lightYears(20.4332, ru)).toBe("67 световых лет");
  expect(lightYears(12.43, ru)).toBe("41 световой год");
  expect(lightYears(0.7, ru)).toBe("2,3 светового года");
  expect(lightYears(20.4332, en)).toBe("67 light years");
});

test("lede for one planet", () => {
  const star = { spectral_type: "K5 III", temperature: 4055, radius: 45.1, distance_pc: 20.4332 };
  const planets = [{ radius_earth: 12.7, mass_earth: 2056, period_days: 628.96, a_au: 1.46 }];
  expect(systemLede(star, planets, null, ru)).toBe(
    "Оранжевый гигант в 67 световых годах от нас. Вокруг него известна одна планета — газовый гигант, год на котором длится 629 дней.");
});

test("lede for a packed system mentions the range and the habitable zone", () => {
  const star = { spectral_type: "M8.0 V", temperature: 2566, radius: 0.12, distance_pc: 12.43 };
  const hz = { inner_optimistic: 0.02, outer_optimistic: 0.05 };
  const planets = [1.51, 2.42, 4.05, 6.1, 9.21, 12.35, 18.77].map((p, i) => ({
    period_days: p, a_au: [0.0115, 0.0158, 0.0223, 0.0293, 0.0385, 0.0468, 0.0619][i], radius_earth: 1 }));
  expect(systemLede(star, planets, hz, ru)).toBe(
    "Красный карлик в 41 световом году от нас. Вокруг него известно 7 планет: ближайшая обходит звезду за 1,5 дня, дальняя — за 19 дней. 4 из них — в зоне обитаемости.");
});

test("lede never invents what the catalogue lacks", () => {
  expect(systemLede({ name: "X" }, [{}], null, ru)).toBe("Вокруг этой звезды известна одна планета.");
});

test("english lede has an article and names the star when it is not described", () => {
  const star = { spectral_type: "K5 III", temperature: 4055, radius: 45.1, distance_pc: 20.4332 };
  const planets = [{ radius_earth: 12.7, period_days: 628.96, a_au: 1.46 }];
  expect(systemLede(star, planets, null, en)).toBe(
    "An orange giant 67 light years away. One planet is known around it: a gas giant whose year lasts 629 days.");
  expect(systemLede({}, [{}], null, en)).toBe("One planet is known around this star.");
});
