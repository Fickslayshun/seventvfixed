import { computed } from "vue";
import type { ChatMessage, ChatUser } from "@/common/chat/ChatMessage";
import { DEFAULT_PERSONAL_TIMEOUT_DURATION, parseTimeoutDuration } from "@/common/chat/timeoutPresets";
import type { ChannelContext } from "@/composable/channel/useChannelContext";
import { useConfig } from "@/composable/useSettings";

export interface PersonalTimeoutEntry {
	channelID: string;
	channelLogin: string;
	username: string;
	displayName: string;
	userID: string;
	createdAt: number;
	expiresAt: number;
	duration: string;
}

interface PersonalTimeoutTarget {
	id?: string | null;
	username: string;
	displayName?: string | null;
}

const enabled = useConfig<boolean>("chat.personal_timeouts", false);
const storedEntries = useConfig<PersonalTimeoutEntry[]>("chat.personal_timeout_entries", []);

let pruneTimer: number | null = null;

function normalizeUsername(username: string): string {
	return username.trim().toLowerCase();
}

function sortEntries(entries: PersonalTimeoutEntry[]): PersonalTimeoutEntry[] {
	return [...entries].sort((a, b) => a.expiresAt - b.expiresAt || a.username.localeCompare(b.username));
}

function pruneExpired(now = Date.now()): void {
	const nextEntries = (storedEntries.value ?? []).filter((entry) => entry.expiresAt > now);
	if (nextEntries.length === (storedEntries.value?.length ?? 0)) return;

	storedEntries.value = nextEntries;
}

function ensurePruneTimer(): void {
	if (pruneTimer !== null || typeof window === "undefined") return;

	pruneTimer = window.setInterval(() => pruneExpired(), 5 * 1000);
}

function findEntryIndex(channelID: string, username: string): number {
	const normalized = normalizeUsername(username);
	return (storedEntries.value ?? []).findIndex(
		(entry) => entry.channelID === channelID && normalizeUsername(entry.username) === normalized,
	);
}

function buildEntry(
	ctx: Pick<ChannelContext, "id" | "username">,
	target: PersonalTimeoutTarget,
	duration: string,
): PersonalTimeoutEntry | null {
	const normalizedUsername = normalizeUsername(target.username);
	if (!normalizedUsername) return null;

	const durationMs = parseTimeoutDuration(duration);
	if (!durationMs) return null;

	const now = Date.now();

	return {
		channelID: ctx.id,
		channelLogin: ctx.username,
		username: normalizedUsername,
		displayName: target.displayName?.trim() || target.username,
		userID: target.id?.trim() ?? "",
		createdAt: now,
		expiresAt: now + durationMs,
		duration: duration || DEFAULT_PERSONAL_TIMEOUT_DURATION,
	};
}

function upsertEntry(ctx: Pick<ChannelContext, "id" | "username">, target: PersonalTimeoutTarget, duration: string) {
	pruneExpired();

	const entry = buildEntry(ctx, target, duration || DEFAULT_PERSONAL_TIMEOUT_DURATION);
	if (!entry) return null;

	const nextEntries = [...(storedEntries.value ?? [])];
	const existingIndex = findEntryIndex(ctx.id, entry.username);

	if (existingIndex >= 0) {
		nextEntries.splice(existingIndex, 1, entry);
	} else {
		nextEntries.push(entry);
	}

	storedEntries.value = sortEntries(nextEntries);
	return entry;
}

function clearEntry(channelID: string, username: string): boolean {
	pruneExpired();

	const nextEntries = [...(storedEntries.value ?? [])];
	const existingIndex = findEntryIndex(channelID, username);
	if (existingIndex < 0) return false;

	nextEntries.splice(existingIndex, 1);
	storedEntries.value = nextEntries;
	return true;
}

function clearAllEntries(): void {
	storedEntries.value = [];
}

function findEntry(channelID: string, username: string): PersonalTimeoutEntry | null {
	const normalized = normalizeUsername(username);
	const now = Date.now();
	return (
		(storedEntries.value ?? []).find(
			(entry) =>
				entry.expiresAt > now &&
				entry.channelID === channelID &&
				normalizeUsername(entry.username) === normalized,
		) ?? null
	);
}

function isTimedOut(ctx: Pick<ChannelContext, "id">, user: ChatUser | null | undefined): boolean {
	if (!enabled.value || !user?.username) return false;
	return !!findEntry(ctx.id, user.username);
}

function shouldHideMessage(ctx: Pick<ChannelContext, "id">, message: ChatMessage): boolean {
	return isTimedOut(ctx, message.author);
}

ensurePruneTimer();
pruneExpired();

export function usePersonalTimeouts() {
	return {
		enabled,
		entries: computed(() =>
			sortEntries((storedEntries.value ?? []).filter((entry) => entry.expiresAt > Date.now())),
		),
		upsertEntry,
		clearEntry,
		clearAllEntries,
		findEntry,
		isTimedOut,
		shouldHideMessage,
		pruneExpired,
	};
}
