/** Same rules as src/lib/slotStartCapacity.ts — keep in sync. */

export type OccupancyRow = { start_time: string; end_time: string; staff_id: string | null };

export function wallIntervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export function intervalOverlapsAnyOccupancy(
  intervalStartMs: number,
  intervalEndMs: number,
  rows: OccupancyRow[],
): OccupancyRow[] {
  return rows.filter((r) =>
    wallIntervalsOverlap(
      intervalStartMs,
      intervalEndMs,
      new Date(r.start_time).getTime(),
      new Date(r.end_time).getTime(),
    ),
  );
}

export function isWallIntervalAvailableForBooking(opts: {
  rows: OccupancyRow[];
  intervalStartMs: number;
  intervalEndMs: number;
  eligibleStaffIds: string[];
  locationHasNoStaff: boolean;
  requestedStaffId: string | null;
}): boolean {
  const { rows, intervalStartMs, intervalEndMs, eligibleStaffIds, locationHasNoStaff, requestedStaffId } = opts;
  const overlapping = intervalOverlapsAnyOccupancy(intervalStartMs, intervalEndMs, rows);

  if (locationHasNoStaff) {
    return overlapping.length === 0;
  }
  if (requestedStaffId) {
    return !overlapping.some((r) => r.staff_id === requestedStaffId || r.staff_id === null);
  }
  return eligibleStaffIds.some((sid) => !overlapping.some((r) => r.staff_id === sid || r.staff_id === null));
}

/** Among stylists free for the interval, pick the one with fewest occupancy rows (tie: lexicographic id). */
export function pickAutoStaffIdForInterval(opts: {
  rows: OccupancyRow[];
  intervalStartMs: number;
  intervalEndMs: number;
  eligibleStaffIds: string[];
  realStaffIds: string[];
  ownerDefaultStaffId: string | null;
}): string | null {
  const { rows, intervalStartMs, intervalEndMs, eligibleStaffIds, realStaffIds, ownerDefaultStaffId } = opts;
  if (realStaffIds.length === 0) {
    return ownerDefaultStaffId ?? null;
  }
  const uniqueEligible = [...new Set(eligibleStaffIds)];
  const free: string[] = [];
  for (const sid of uniqueEligible) {
    if (
      isWallIntervalAvailableForBooking({
        rows,
        intervalStartMs,
        intervalEndMs,
        eligibleStaffIds: [sid],
        locationHasNoStaff: false,
        requestedStaffId: sid,
      })
    ) {
      free.push(sid);
    }
  }
  if (free.length === 0) return null;
  if (free.length === 1) return free[0];
  const load = (sid: string) => rows.filter((r) => r.staff_id === sid).length;
  free.sort((a, b) => {
    const d = load(a) - load(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
  return free[0];
}
