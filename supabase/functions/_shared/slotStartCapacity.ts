/** Same rules as src/lib/slotStartCapacity.ts — keep in sync. */

export type SlotStartRow = { start_time: string; staff_id: string | null };

const START_MATCH_TOLERANCE_MS = 2000;

export function rowMatchesSlotStart(rowIso: string, slotMs: number): boolean {
  return Math.abs(new Date(rowIso).getTime() - slotMs) <= START_MATCH_TOLERANCE_MS;
}

export function isSlotAvailableForBooking(opts: {
  rows: SlotStartRow[];
  slotStartMs: number;
  eligibleStaffCount: number;
  locationHasNoStaff: boolean;
  requestedStaffId: string | null;
}): boolean {
  const { rows, slotStartMs, eligibleStaffCount, locationHasNoStaff, requestedStaffId } = opts;
  const atSlot = rows.filter((r) => rowMatchesSlotStart(r.start_time, slotStartMs));

  if (requestedStaffId) {
    if (atSlot.some((r) => r.staff_id === requestedStaffId)) return false;
  }

  if (locationHasNoStaff) {
    return atSlot.length === 0;
  }

  if (eligibleStaffCount <= 0) return false;

  return atSlot.length < eligibleStaffCount;
}
