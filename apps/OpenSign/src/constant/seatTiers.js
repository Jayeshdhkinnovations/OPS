// Seat limits are picked from fixed tiers rather than typed as a free
// number: every seat has to be provisioned on shared hardware, and an open
// field invited values that could never be honoured.
//
// The label is a range ("1-10") because the number is a ceiling, not an
// allocation - a company on this tier may create anywhere from 1 up to
// `value` users. `value` is what the server stores as maxUsers.
export const SEAT_TIERS = [
  { value: 5, label: "1-5" },
  { value: 10, label: "1-10" },
  { value: 25, label: "1-25" },
  { value: 50, label: "1-50" },
  { value: 100, label: "1-100" },
];

export const DEFAULT_SEAT_TIER = 5;
