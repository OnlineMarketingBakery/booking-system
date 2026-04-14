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
