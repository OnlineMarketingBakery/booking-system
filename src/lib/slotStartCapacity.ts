/** Rows from get_location_slot_start_bookings (first segment starts only matter for slot picking). */
export type SlotStartRow = { start_time: string; staff_id: string | null };

/** Allow small skew between browser Date and DB timestamptz serialization. */
const START_MATCH_TOLERANCE_MS = 2000;

export function rowMatchesSlotStart(rowIso: string, slotMs: number): boolean {
  return Math.abs(new Date(rowIso).getTime() - slotMs) <= START_MATCH_TOLERANCE_MS;
}

export function countRowsAtSlot(rows: SlotStartRow[], slotMs: number): number {
  return rows.filter((r) => rowMatchesSlotStart(r.start_time, slotMs)).length;
}

/**
 * Slot stays bookable while bookings at this start time are fewer than eligible staff.
 * If customer chose a stylist, that stylist must not already have a row at this start.
 */
export function isSlotAvailableForBooking(opts: {
  rows: SlotStartRow[];
  slotStartMs: number;
  /** Active staff who can take this slot (e.g. not on a qualifying break). */
  eligibleStaffCount: number;
  /** No staff at location: allow only when nothing at slot. */
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
