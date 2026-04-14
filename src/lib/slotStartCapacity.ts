/** Rows from get_location_booking_occupancy (wall [start_time, end_time) per booking segment or hold). */
export type OccupancyRow = { start_time: string; end_time: string; staff_id: string | null };

/** Half-open interval overlap: [aStart, aEnd) vs [bStart, bEnd). */
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

/**
 * True if the wall-time interval [intervalStart, intervalEnd) can be booked
 * (half-open; touching at boundary is allowed).
 */
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
