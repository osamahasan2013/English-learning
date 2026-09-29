// IANA time zone helpers. The database validates the same thing (is_valid_time_zone) as
// the authoritative check.

export function isValidTimeZone(name: string) {
  if (!name || name.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function listTimeZones(): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}
