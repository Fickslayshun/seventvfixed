import { useWorker } from "@/composable/useWorker";
import { getTwitchHelixAuth } from "./twitchHelixAuth";

const worker = useWorker();
const pending = new Map<string, { resolve: (value: Twitch.BadgeSets) => void; reject: (reason?: unknown) => void }>();
const cache = new Map<string, Promise<Twitch.BadgeSets>>();

worker.target.addEventListener("tverino_badge_sets_result", (ev) => {
	const detail = ev.detail;
	const listener = pending.get(detail.requestID);
	if (!listener) return;

	pending.delete(detail.requestID);
	if (detail.badgeSets) {
		listener.resolve(detail.badgeSets);
		return;
	}

	listener.reject(new Error(detail.error || "Unable to load Twitch badges"));
});

export function getTwitchBadgeSets(channelID: string): Promise<Twitch.BadgeSets> {
	const normalizedChannelID = channelID.trim();
	if (!normalizedChannelID) {
		return Promise.resolve({
			globalsBySet: new Map(),
			channelsBySet: new Map(),
			count: 0,
		});
	}

	let request = cache.get(normalizedChannelID);
	if (!request) {
		request = requestTwitchBadgeSets(normalizedChannelID).catch((err) => {
			cache.delete(normalizedChannelID);
			throw err;
		});
		cache.set(normalizedChannelID, request);
	}

	return request;
}

function requestTwitchBadgeSets(channelID: string): Promise<Twitch.BadgeSets> {
	const auth = getTwitchHelixAuth();
	if (!auth.clientID || !auth.token) {
		return Promise.reject(new Error("Twitch badge auth unavailable"));
	}

	const requestID = `badge-sets:${channelID}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

	return new Promise((resolve, reject) => {
		pending.set(requestID, { resolve, reject });
		worker.sendMessage("TVERINO_BADGE_SETS_FETCH", {
			requestID,
			channelID,
			clientID: auth.clientID,
			token: auth.token,
		});
	});
}
