interface TwitchHelixAuthState {
	clientID: string;
	token: string;
}

const authState: TwitchHelixAuthState = {
	clientID: "",
	token: "",
};

const listeners = new Set<() => void>();

export function setTwitchHelixAuth(next: Partial<TwitchHelixAuthState>): void {
	let changed = false;

	if (typeof next.clientID === "string" && next.clientID.trim()) {
		const clientID = next.clientID.trim();
		if (clientID !== authState.clientID) {
			authState.clientID = clientID;
			changed = true;
		}
	}

	if (typeof next.token === "string" && next.token.trim()) {
		const token = next.token.trim();
		if (token !== authState.token) {
			authState.token = token;
			changed = true;
		}
	}

	if (changed) {
		for (const listener of listeners) {
			listener();
		}
	}
}

export function getTwitchHelixAuth(): TwitchHelixAuthState {
	return {
		clientID: authState.clientID,
		token: authState.token,
	};
}

export function onTwitchHelixAuthChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
