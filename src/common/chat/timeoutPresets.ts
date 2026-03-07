export const CHAT_TIMEOUT_PRESETS = ["1s", "30s", "1m", "10m", "30m", "1h", "4h", "12h", "1d", "7d", "14d"] as const;

export const DEFAULT_PERSONAL_TIMEOUT_DURATION = "10m";

const DURATION_UNITS_MS = {
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
	w: 7 * 24 * 60 * 60 * 1000,
} as const;

export function parseTimeoutDuration(input: string): number | null {
	const normalized = input.trim().toLowerCase();
	const match = normalized.match(/^(\d+)([smhdw])$/);
	if (!match) return null;

	const amount = Number.parseInt(match[1] ?? "", 10);
	const unit = match[2] as keyof typeof DURATION_UNITS_MS;
	if (!Number.isFinite(amount) || amount <= 0 || !DURATION_UNITS_MS[unit]) return null;

	return amount * DURATION_UNITS_MS[unit];
}

export function formatRemainingDuration(remainingMs: number): string {
	if (remainingMs <= 0) return "expired";

	const units = [
		["w", DURATION_UNITS_MS.w],
		["d", DURATION_UNITS_MS.d],
		["h", DURATION_UNITS_MS.h],
		["m", DURATION_UNITS_MS.m],
		["s", DURATION_UNITS_MS.s],
	] as const;

	for (const [unit, ms] of units) {
		if (remainingMs >= ms) {
			return `${Math.ceil(remainingMs / ms)}${unit}`;
		}
	}

	return "1s";
}

export function formatTimeoutNotice(username: string, duration: string, personal = false): string | null {
	const durationMs = parseTimeoutDuration(duration);
	if (!durationMs) return null;

	const durationSeconds = Math.max(1, Math.round(durationMs / 1000));
	return `${username} was timed out${personal ? " personally" : ""} (${durationSeconds}s)`;
}
