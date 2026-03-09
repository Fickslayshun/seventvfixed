<template>
	<div class="seventv-tverino-input" :class="{ disabled: transportStatus.state !== 'connected' }">
		<div v-if="resolvedRecentEntries.length" class="seventv-tverino-recents">
			<button
				v-for="emote of resolvedRecentEntries"
				:key="`${emote.provider}:${emote.id}`"
				class="seventv-tverino-recents-item"
				type="button"
				@click="onRecentClick($event, emote)"
			>
				<Emote :emote="emote" />
			</button>
		</div>

		<div class="seventv-tverino-input-shell">
			<input
				ref="inputRef"
				v-model="value"
				class="seventv-tverino-input-field"
				:disabled="transportStatus.state !== 'connected'"
				:placeholder="placeholder"
				type="text"
				autocomplete="off"
				spellcheck="false"
				@focus="isFocused = true"
				@blur="onBlur"
				@keydown="onKeyDown"
			/>
			<button class="seventv-tverino-send" type="button" :disabled="!canSend" @click="() => submit()">
				Send
			</button>
		</div>

		<div v-if="isFocused && suggestionItems.length" class="seventv-tverino-suggestions">
			<button
				v-for="(item, index) of suggestionItems"
				:key="`${item.kind}:${item.token}`"
				class="seventv-tverino-suggestion"
				:class="{ active: index === suggestionIndex }"
				type="button"
				@mousedown.prevent="applySuggestion(item)"
			>
				<span class="token">{{ item.token }}</span>
				<span class="meta">{{ item.kind }}</span>
			</button>
		</div>

		<p v-if="transportStatus.reason" class="seventv-tverino-status">
			{{ transportStatus.reason }}
		</p>
	</div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useStore } from "@/store/main";
import { MessagePartType, MessageType } from "@/site/twitch.tv";
import { type ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatEmotes } from "@/composable/chat/useChatEmotes";
import { useChatMessageProcessor } from "@/composable/chat/useChatMessageProcessor";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useRecentSentEmotes } from "@/composable/chat/useRecentSentEmotes";
import Emote from "@/app/chat/Emote.vue";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import type { TypedWorkerMessage } from "@/worker";

interface SuggestionItem {
	token: string;
	kind: "emote" | "user";
}

const props = defineProps<{
	ctx: ChannelContext;
	transportStatus: SevenTV.TVerinoTransportStatus;
}>();

const { identity } = storeToRefs(useStore());
const { sendChatMessage, target } = useTVerinoChatTransport();
const emotes = useChatEmotes(props.ctx);
const messages = useChatMessages(props.ctx);
const recentSentEmotes = useRecentSentEmotes();
const processor = useChatMessageProcessor(props.ctx);

const inputRef = ref<HTMLInputElement | null>(null);
const value = ref("");
const isFocused = ref(false);
const suggestionIndex = ref(0);
const actorDisplayName = computed(() => {
	const currentIdentity = identity.value;
	if (!currentIdentity) return "";
	if ("displayName" in currentIdentity && currentIdentity.displayName) return currentIdentity.displayName;
	return currentIdentity.username;
});

const placeholder = computed(() => {
	if (props.transportStatus.state !== "connected") return "7TVerino Chat unavailable";
	return `Send a message to #${props.ctx.username || props.ctx.displayName || "channel"}`;
});

const canSend = computed(() => props.transportStatus.state === "connected" && value.value.trim().length > 0);

const resolvedRecentEntries = computed(() =>
	recentSentEmotes
		.getEntries(props.ctx.id)
		.filter((entry) => recentSentEmotes.scopeAllows(entry.provider))
		.map((entry) => emotes.active[entry.name])
		.filter((entry): entry is SevenTV.ActiveEmote => !!entry),
);

const suggestionItems = computed(() => {
	const { token, start, end } = getTokenAtCursor();
	if (!isFocused.value || start === end || token.length < 2) return [] as SuggestionItem[];

	const normalized = token.replace(/^@/, "").toLowerCase();
	const items = [] as SuggestionItem[];
	const seen = new Set<string>();

	for (const activeEmote of Object.values(emotes.active)) {
		if (!activeEmote?.name) continue;
		if (!activeEmote.name.toLowerCase().startsWith(normalized)) continue;

		const key = `emote:${activeEmote.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			token: activeEmote.name,
			kind: "emote",
		});
		if (items.length >= 8) return items;
	}

	for (const chatter of Object.values(messages.chatters)) {
		const displayName = chatter.displayName || chatter.username;
		if (!displayName) continue;
		if (!displayName.toLowerCase().startsWith(normalized)) continue;

		const tokenValue = token.startsWith("@") ? `@${displayName}` : displayName;
		const key = `user:${tokenValue}`;
		if (seen.has(key)) continue;
		seen.add(key);
		items.push({
			token: tokenValue,
			kind: "user",
		});
		if (items.length >= 8) break;
	}

	return items;
});

function getTokenAtCursor(): { token: string; start: number; end: number } {
	const input = inputRef.value;
	const cursor = input?.selectionStart ?? value.value.length;
	const text = value.value;

	let start = cursor;
	let end = cursor;
	while (start > 0 && text[start - 1] !== " ") start--;
	while (end < text.length && text[end] !== " ") end++;

	return {
		token: text.slice(start, end),
		start,
		end,
	};
}

function replaceToken(nextToken: string): void {
	const input = inputRef.value;
	if (!input) return;

	const { start, end } = getTokenAtCursor();
	const prefix = value.value.slice(0, start);
	const suffix = value.value.slice(end);
	const replacement = `${prefix}${nextToken}${suffix.startsWith(" ") || !suffix ? "" : " "}${suffix}`;
	value.value = replacement;

	requestAnimationFrame(() => {
		const pos = prefix.length + nextToken.length;
		input.focus();
		input.setSelectionRange(pos, pos);
	});
}

function applySuggestion(item: SuggestionItem): void {
	replaceToken(item.token);
	suggestionIndex.value = 0;
}

function onBlur(): void {
	window.setTimeout(() => {
		isFocused.value = false;
		suggestionIndex.value = 0;
	}, 100);
}

function onKeyDown(ev: KeyboardEvent): void {
	if (suggestionItems.value.length) {
		if (ev.key === "ArrowDown") {
			ev.preventDefault();
			suggestionIndex.value = Math.min(suggestionIndex.value + 1, suggestionItems.value.length - 1);
			return;
		}

		if (ev.key === "ArrowUp") {
			ev.preventDefault();
			suggestionIndex.value = Math.max(suggestionIndex.value - 1, 0);
			return;
		}

		if (ev.key === "Tab") {
			ev.preventDefault();
			applySuggestion(suggestionItems.value[suggestionIndex.value] ?? suggestionItems.value[0]!);
			return;
		}
	}

	if (ev.key === "Enter" && !ev.shiftKey) {
		ev.preventDefault();
		if (suggestionItems.value.length) {
			applySuggestion(suggestionItems.value[suggestionIndex.value] ?? suggestionItems.value[0]!);
			return;
		}

		submit();
	}
}

function createNonce(): string {
	return `tverino:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function submit(explicitText?: string): void {
	const message = (explicitText ?? value.value).trim();
	if (!message || !identity.value) return;

	const nonce = createNonce();
	processor.onMessage({
		id: nonce,
		type: MessageType.MESSAGE,
		nonce,
		channelID: props.ctx.id,
		user: {
			color: "",
			isIntl: false,
			isSubscriber: false,
			userDisplayName: actorDisplayName.value,
			displayName: actorDisplayName.value,
			userID: identity.value.id,
			userLogin: identity.value.username,
			userType: "",
		},
		badgeDynamicData: {},
		badges: {},
		deleted: false,
		banned: false,
		hidden: false,
		isHistorical: false,
		isFirstMsg: false,
		isReturningChatter: false,
		isVip: false,
		messageBody: message,
		messageParts: [
			{
				type: MessagePartType.TEXT,
				content: message,
			},
		],
		messageType: 0,
		timestamp: Date.now(),
	} as Twitch.ChatMessage);

	recentSentEmotes.recordMessage(props.ctx.id, message, emotes.active);
	sendChatMessage(props.ctx.id, props.ctx.username, message, nonce);
	value.value = "";
	suggestionIndex.value = 0;
}

function onSendResult(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_SEND_RESULT">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	const found = messages.find((msg) => msg.nonce === detail.nonce);
	if (!found) return;

	if (detail.ok) {
		if (detail.messageID) {
			found.setID(detail.messageID);
		}
		found.setDeliveryState("SENT");
		return;
	}

	found.setDeliveryState("BOUNCED");
}

function onRecentClick(ev: MouseEvent, emote: SevenTV.ActiveEmote): void {
	if (ev.ctrlKey || ev.altKey) {
		replaceToken(emote.name);
		return;
	}

	submit(emote.name);
}

target.addEventListener("tverino_chat_send_result", onSendResult);

onUnmounted(() => {
	target.removeEventListener("tverino_chat_send_result", onSendResult);
});
</script>

<style scoped lang="scss">
.seventv-tverino-input {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	padding: 0.8rem;
	border-top: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-transparent-2);

	&.disabled {
		opacity: 0.7;
	}
}

.seventv-tverino-recents {
	display: flex;
	gap: 0.4rem;
	overflow-x: auto;
	padding-bottom: 0.1rem;
}

.seventv-tverino-recents-item {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 2.6rem;
	height: 2.6rem;
	padding: 0.25rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	border-radius: 0.25rem;
	background: var(--seventv-background-shade-1);
	transition:
		transform 120ms ease,
		border-color 120ms ease,
		background-color 120ms ease;

	&:hover {
		transform: translateY(-1px);
		border-color: rgb(255 255 255 / 24%);
		background: var(--seventv-background-lesser-transparent-1);
	}
}

.seventv-tverino-input-shell {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0.6rem;
}

.seventv-tverino-input-field {
	height: 4rem;
	padding: 0 1.2rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	border-radius: 0.25rem;
	background: var(--seventv-background-shade-1);
	color: var(--seventv-text-color-normal);
	outline: none;
	transition:
		border-color 120ms ease,
		outline 120ms ease,
		background-color 120ms ease;

	&:focus {
		border-color: var(--seventv-primary);
		outline: 1px solid var(--seventv-primary);
	}
}

.seventv-tverino-send {
	min-width: 7.2rem;
	padding: 0 1rem;
	border-radius: 0.25rem;
	border: 0.1rem solid var(--seventv-primary);
	background: var(--seventv-background-shade-1);
	color: var(--seventv-primary);
	font-weight: 800;
	transition:
		background-color 120ms ease,
		color 120ms ease,
		opacity 120ms ease;

	&:hover:not(:disabled) {
		background: var(--seventv-primary);
		color: var(--seventv-background-shade-1);
	}

	&:disabled {
		opacity: 0.5;
	}
}

.seventv-tverino-suggestions {
	position: absolute;
	left: 0.8rem;
	right: 0.8rem;
	bottom: calc(100% + 0.4rem);
	display: grid;
	gap: 0.25rem;
	padding: 0.45rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	border-radius: 0.25rem;
	background: var(--seventv-background-shade-1);
	box-shadow: 0 0.9rem 2.4rem rgb(0 0 0 / 30%);
}

.seventv-tverino-suggestion {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.65rem 0.8rem;
	border-radius: 0.25rem;
	color: var(--seventv-text-color-normal);
	text-align: left;

	&.active,
	&:hover {
		background: rgb(255 255 255 / 6%);
	}

	.token {
		font-weight: 700;
	}

	.meta {
		color: var(--seventv-text-color-secondary);
		font-size: 1.2rem;
		text-transform: uppercase;
	}
}

.seventv-tverino-status {
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
}
</style>
