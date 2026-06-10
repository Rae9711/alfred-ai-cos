import { describe, expect, it } from "vitest";

import {
  applyEvent,
  applyUnlocks,
  COSMETICS,
  getDefaultMeta,
  levelFromXp,
  nextLevelXp,
  type AgentMeta,
} from "./agentMeta";

function metaAtLevel(level: number, extra: Partial<AgentMeta> = {}): AgentMeta {
  return { ...getDefaultMeta(), level, ...extra };
}

describe("levelFromXp", () => {
  it("starts at level 1 with zero XP", () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it("levels up at the first threshold (80 XP)", () => {
    expect(levelFromXp(79)).toBe(1);
    expect(levelFromXp(80)).toBe(2);
  });
});

describe("applyEvent", () => {
  it("grants XP for agent_message_sent", () => {
    const meta = getDefaultMeta();
    const { next, gainedXp } = applyEvent(meta, "agent_message_sent");
    expect(gainedXp).toBeGreaterThan(0);
    expect(next.xp).toBe(meta.xp + gainedXp);
  });

  it("stops granting XP at the daily cap", () => {
    let meta = getDefaultMeta();
    // streak_day caps at 1/day — the second event the same day grants nothing.
    let result = applyEvent(meta, "streak_day");
    expect(result.gainedXp).toBeGreaterThan(0);
    meta = result.next;
    result = applyEvent(meta, "streak_day");
    expect(result.gainedXp).toBe(0);
    expect(result.next.xp).toBe(meta.xp);
  });

  it("resets daily counters when the calendar day rolls over", () => {
    const day1 = Date.parse("2026-06-09T12:00:00.000Z");
    const day2 = Date.parse("2026-06-10T12:00:00.000Z");
    let meta = applyEvent(getDefaultMeta(), "streak_day", day1).next;
    expect(meta.todayCounters.streak_day).toBe(1);
    const { gainedXp, next } = applyEvent(meta, "streak_day", day2);
    expect(gainedXp).toBeGreaterThan(0);
    expect(next.todayCounters.streak_day).toBe(1);
  });

  it("extends the streak on consecutive days and resets after a gap", () => {
    const day1 = Date.parse("2026-06-01T12:00:00.000Z");
    const day2 = Date.parse("2026-06-02T12:00:00.000Z");
    const day5 = Date.parse("2026-06-05T12:00:00.000Z");
    let meta = applyEvent(getDefaultMeta(), "streak_day", day1).next;
    expect(meta.streakDays).toBe(1);
    meta = applyEvent(meta, "streak_day", day2).next;
    expect(meta.streakDays).toBe(2);
    meta = applyEvent(meta, "streak_day", day5).next;
    expect(meta.streakDays).toBe(1);
  });

  it("reports leveledUp and unlocks cosmetics when crossing a threshold", () => {
    // 79 XP + task_completed (40 base) crosses the 80 XP level-2 threshold.
    const meta = metaAtLevel(1, { xp: 79 });
    const { next, leveledUp } = applyEvent(meta, "task_completed");
    expect(leveledUp).toBe(true);
    expect(next.level).toBe(2);
    // aura-glow unlocks at level 2 and auto-equips into the empty slot.
    expect(next.inventory).toContain("aura-glow");
    expect(next.equipped.aura).toBe("aura-glow");
  });
});

describe("applyUnlocks", () => {
  it("adds every cosmetic at or below the current level to the inventory", () => {
    const next = applyUnlocks(metaAtLevel(5));
    const expected = COSMETICS.filter((c) => c.unlockLevel <= 5).map(
      (c) => c.id,
    );
    expect(next.inventory).toEqual(expect.arrayContaining(expected));
    expect(next.inventory).not.toContain("head-crown"); // unlocks at 7
  });

  it("auto-equips the highest-unlockLevel item per empty slot", () => {
    const next = applyUnlocks(metaAtLevel(5));
    // back slot: back-pack (5) beats back-particles (4); wings (10) still locked.
    expect(next.equipped.back).toBe("back-pack");
    expect(next.equipped.face).toBe("face-visor");
    expect(next.equipped.aura).toBe("aura-glow");
  });

  it("never overrides a slot the user already equipped", () => {
    const meta = metaAtLevel(10, {
      inventory: ["back-particles"],
      equipped: { back: "back-particles" },
    });
    const next = applyUnlocks(meta);
    expect(next.equipped.back).toBe("back-particles");
    // But new inventory still accumulates.
    expect(next.inventory).toContain("back-wing");
  });

  it("keeps previously earned inventory when merging new unlocks", () => {
    const meta = metaAtLevel(2, { inventory: ["custom-item"] });
    const next = applyUnlocks(meta);
    expect(next.inventory).toContain("custom-item");
    expect(next.inventory).toContain("aura-glow");
  });
});

describe("nextLevelXp", () => {
  it("returns the threshold for level 2", () => {
    expect(nextLevelXp(1)).toBe(80);
  });
});
