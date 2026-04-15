import { describe, expect, it } from "vitest";
import {
  intervalOverlapsAnyOccupancy,
  isWallIntervalAvailableForBooking,
  pickAutoStaffIdForInterval,
  wallIntervalsOverlap,
  type OccupancyRow,
} from "./slotStartCapacity";

describe("wallIntervalsOverlap", () => {
  it("detects overlap for staggered intervals", () => {
    const a0 = new Date("2026-04-10T09:45:00").getTime();
    const a1 = new Date("2026-04-10T10:15:00").getTime();
    const b0 = new Date("2026-04-10T10:00:00").getTime();
    const b1 = new Date("2026-04-10T11:00:00").getTime();
    expect(wallIntervalsOverlap(a0, a1, b0, b1)).toBe(true);
  });

  it("allows adjacent boundary (end === start)", () => {
    const a0 = new Date("2026-04-10T09:00:00").getTime();
    const a1 = new Date("2026-04-10T09:30:00").getTime();
    const b0 = new Date("2026-04-10T09:30:00").getTime();
    const b1 = new Date("2026-04-10T10:00:00").getTime();
    expect(wallIntervalsOverlap(a0, a1, b0, b1)).toBe(false);
  });

  it("allows 9:45 start when prior ends 9:30", () => {
    const prior0 = new Date("2026-04-10T09:00:00").getTime();
    const prior1 = new Date("2026-04-10T09:30:00").getTime();
    const next0 = new Date("2026-04-10T09:45:00").getTime();
    const next1 = new Date("2026-04-10T10:15:00").getTime();
    expect(wallIntervalsOverlap(next0, next1, prior0, prior1)).toBe(false);
  });
});

describe("isWallIntervalAvailableForBooking", () => {
  const staffA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const staffB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("blocks when selected staff has overlapping booking", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T10:00:00.000Z",
        end_time: "2026-04-10T11:00:00.000Z",
        staff_id: staffA,
      },
    ];
    const ok = isWallIntervalAvailableForBooking({
      rows,
      intervalStartMs: new Date("2026-04-10T09:45:00.000Z").getTime(),
      intervalEndMs: new Date("2026-04-10T10:15:00.000Z").getTime(),
      eligibleStaffIds: [staffA, staffB],
      locationHasNoStaff: false,
      requestedStaffId: staffA,
    });
    expect(ok).toBe(false);
  });

  it("allows same window for different staff", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T10:00:00.000Z",
        end_time: "2026-04-10T11:00:00.000Z",
        staff_id: staffA,
      },
    ];
    const ok = isWallIntervalAvailableForBooking({
      rows,
      intervalStartMs: new Date("2026-04-10T10:00:00.000Z").getTime(),
      intervalEndMs: new Date("2026-04-10T11:00:00.000Z").getTime(),
      eligibleStaffIds: [staffA, staffB],
      locationHasNoStaff: false,
      requestedStaffId: staffB,
    });
    expect(ok).toBe(true);
  });

  it("blocks unassigned staff overlap for selected stylist", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T10:00:00.000Z",
        end_time: "2026-04-10T10:30:00.000Z",
        staff_id: null,
      },
    ];
    const ok = isWallIntervalAvailableForBooking({
      rows,
      intervalStartMs: new Date("2026-04-10T10:00:00.000Z").getTime(),
      intervalEndMs: new Date("2026-04-10T10:30:00.000Z").getTime(),
      eligibleStaffIds: [staffA],
      locationHasNoStaff: false,
      requestedStaffId: staffA,
    });
    expect(ok).toBe(false);
  });
});

describe("pickAutoStaffIdForInterval", () => {
  const staffA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const staffB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const t0 = new Date("2026-04-10T10:00:00.000Z").getTime();
  const t1 = new Date("2026-04-10T11:00:00.000Z").getTime();

  it("picks the only free stylist when the other is booked for that window", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T10:00:00.000Z",
        end_time: "2026-04-10T11:00:00.000Z",
        staff_id: staffA,
      },
    ];
    const picked = pickAutoStaffIdForInterval({
      rows,
      intervalStartMs: t0,
      intervalEndMs: t1,
      eligibleStaffIds: [staffA, staffB],
      realStaffIds: [staffA, staffB],
      ownerDefaultStaffId: null,
    });
    expect(picked).toBe(staffB);
  });

  it("prefers the stylist with fewer rows in the occupancy payload when both are free", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T08:00:00.000Z",
        end_time: "2026-04-10T08:30:00.000Z",
        staff_id: staffA,
      },
      {
        start_time: "2026-04-10T08:30:00.000Z",
        end_time: "2026-04-10T09:00:00.000Z",
        staff_id: staffA,
      },
    ];
    const picked = pickAutoStaffIdForInterval({
      rows,
      intervalStartMs: t0,
      intervalEndMs: t1,
      eligibleStaffIds: [staffA, staffB],
      realStaffIds: [staffA, staffB],
      ownerDefaultStaffId: null,
    });
    expect(picked).toBe(staffB);
  });
});

describe("intervalOverlapsAnyOccupancy", () => {
  it("filters overlapping rows only", () => {
    const rows: OccupancyRow[] = [
      {
        start_time: "2026-04-10T08:00:00.000Z",
        end_time: "2026-04-10T08:30:00.000Z",
        staff_id: null,
      },
      {
        start_time: "2026-04-10T10:00:00.000Z",
        end_time: "2026-04-10T11:00:00.000Z",
        staff_id: null,
      },
    ];
    const s = new Date("2026-04-10T09:45:00.000Z").getTime();
    const e = new Date("2026-04-10T10:15:00.000Z").getTime();
    const hit = intervalOverlapsAnyOccupancy(s, e, rows);
    expect(hit).toHaveLength(1);
    expect(hit[0].start_time).toContain("10:00");
  });
});
