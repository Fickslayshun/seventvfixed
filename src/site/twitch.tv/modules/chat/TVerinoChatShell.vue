<template>
	<Teleport v-if="headerContainer" :to="headerContainer">
		<div class="seventv-tverino-header">
			<div class="seventv-tverino-tabs-row">
				<div class="seventv-tverino-tabs">
					<button
						v-for="tab of tabs"
						:key="tab.id"
						class="seventv-tverino-tab"
						:class="{
							active: tab.id === activeTabID,
							remote: tab.kind === 'remote',
							unread: (unreadCounts[tab.id] ?? 0) > 0,
						}"
						type="button"
						@click="selectTab(tab.id)"
					>
						<span class="tab-main">
							<span v-if="tab.kind === 'native'" class="live-dot"></span>
							<span class="tab-label">{{ tab.displayName }}</span>
							<span v-if="(unreadCounts[tab.id] ?? 0) > 0" class="tab-unread">
								{{ unreadCounts[tab.id] > 99 ? "99+" : unreadCounts[tab.id] }}
							</span>
						</span>
						<span
							v-if="tab.kind === 'remote'"
							class="tab-close"
							role="button"
							aria-label="Remove tab"
							@click.stop="removeTab(tab.id)"
						>
							x
						</span>
					</button>
				</div>

				<div class="seventv-tverino-actions">
					<form v-if="showAddInput" class="seventv-tverino-add-form" @submit.prevent="submitAddChannel">
						<input
							ref="addInputRef"
							v-model="addChannelValue"
							class="seventv-tverino-add-input"
							placeholder="Add channel"
							type="text"
							autocomplete="off"
							@keydown.esc.prevent="closeAddInput"
						/>
					</form>
					<button class="seventv-tverino-add-button" type="button" @click="toggleAddInput">+</button>
				</div>
			</div>

			<div v-if="inlineStatus" class="seventv-tverino-inline-status">
				{{ inlineStatus }}
			</div>
		</div>
	</Teleport>

	<div class="seventv-tverino-shell">
		<div class="seventv-tverino-body">
			<TVerinoChatPane
				v-if="activeTab?.kind === 'native'"
				:key="activeTab.id"
				:ctx="currentCtx"
				:list="list"
				:restrictions="restrictions"
				:message-handler="messageHandler"
				:shared-chat-data="sharedChatData"
				:mount-data="true"
				:force-hydrated="true"
			/>
			<TVerinoChatPane v-else-if="activeTab" :key="activeTab.id" :ctx="activeTab.ctx" :force-hydrated="true" />
		</div>

		<TVerinoChannelFeed v-for="tab of remoteTabs" :key="tab.id" :ctx="tab.ctx" />
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from "vue";
import { useApollo } from "@/composable/useApollo";
import { ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import { useConfig } from "@/composable/useSettings";
import { twitchChannelBadgesQuery } from "@/assets/gql/tw.channel-badges.gql";
import { twitchChannelLookupQuery } from "@/assets/gql/tw.channel-lookup.gql";
import TVerinoChannelFeed from "./TVerinoChannelFeed.vue";
import TVerinoChatPane from "./TVerinoChatPane.vue";
import { getTwitchBadgeSets } from "./twitchBadgeSets";
import { onTwitchHelixAuthChange } from "./twitchHelixAuth";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import type { HookedInstance } from "@/common/ReactHooks";
import type { TypedWorkerMessage } from "@/worker";

interface BaseTab {
	id: string;
	displayName: string;
	login: string;
	ctx: ChannelContext;
}

interface NativeTab extends BaseTab {
	kind: "native";
}

interface RemoteTab extends BaseTab {
	kind: "remote";
}

const props = defineProps<{
	headerContainer?: HTMLElement | null;
	currentCtx: ChannelContext;
	list: HookedInstance<Twitch.ChatListComponent>;
	restrictions?: HookedInstance<Twitch.ChatRestrictionsComponent>;
	messageHandler: Twitch.MessageHandlerAPI | null;
	sharedChatData: Map<string, Twitch.SharedChat> | null;
}>();

const apollo = useApollo();
const { subscribeChannel, unsubscribeChannel, target, getStatus } = useTVerinoChatTransport();
const workspace = useConfig<Map<string, SevenTV.TVerinoSavedTab>>("chat.tverino.workspace", new Map());
const transportStatus = useConfig<SevenTV.TVerinoTransportStatus>("chat.tverino.transport_status", {
	state: "idle",
	reason: "",
});
const activeTarget = useConfig<SevenTV.TVerinoActiveTarget>("chat.tverino.active_target", {
	kind: "native",
	id: "",
	login: "",
	displayName: "",
});
transportStatus.value = getStatus();

const activeTabID = ref(props.currentCtx.id);
const unreadCounts = ref<Record<string, number>>({});
const showAddInput = ref(false);
const addChannelValue = ref("");
const addInputRef = ref<HTMLInputElement | null>(null);

const remoteCtxByID = new Map<string, ChannelContext>();
const unreadStops = new Map<string, () => void>();
const subscribedRemoteIDs = new Set<string>();
const hydratedRemoteBadgeIDs = new Set<string>();

function ensureRemoteCtx(saved: SevenTV.TVerinoSavedTab): ChannelContext {
	let ctx = remoteCtxByID.get(saved.id);
	if (!ctx) {
		ctx = reactive(new ChannelContext());
		ctx.platform = props.currentCtx.platform;
		remoteCtxByID.set(saved.id, ctx);
	}

	ctx.remote = true;
	ctx.setCurrentChannel({
		id: saved.id,
		username: saved.login.toLowerCase(),
		displayName: saved.displayName,
		active: true,
	});

	ensureUnreadWatcher(ctx);
	return ctx;
}

function ensureUnreadWatcher(ctx: ChannelContext): void {
	if (unreadStops.has(ctx.id)) return;

	const messages = useChatMessages(ctx);
	const stop = watch(
		() => messages.displayed.length,
		(next, prev) => {
			if (typeof prev !== "number" || next <= prev) return;
			if (activeTabID.value === ctx.id) return;

			unreadCounts.value = {
				...unreadCounts.value,
				[ctx.id]: (unreadCounts.value[ctx.id] ?? 0) + (next - prev),
			};
		},
	);

	unreadStops.set(ctx.id, stop);
}

ensureUnreadWatcher(props.currentCtx);

const remoteTabs = computed<RemoteTab[]>(() =>
	Array.from(workspace.value.values())
		.filter((saved) => saved.id && saved.id !== props.currentCtx.id)
		.map((saved) => ({
			kind: "remote",
			id: saved.id,
			login: saved.login,
			displayName: saved.displayName,
			ctx: ensureRemoteCtx(saved),
		})),
);

const tabs = computed<(NativeTab | RemoteTab)[]>(() => [
	{
		kind: "native",
		id: props.currentCtx.id,
		login: props.currentCtx.username,
		displayName: props.currentCtx.displayName || props.currentCtx.username || "Current Stream",
		ctx: props.currentCtx,
	},
	...remoteTabs.value,
]);

const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabID.value) ?? tabs.value[0] ?? null);
const inlineStatus = computed(() => {
	if (activeTab.value?.kind !== "remote") return "";
	if (transportStatus.value.state === "connected") return "";
	return transportStatus.value.reason || "Connecting to Twitch chat...";
});

watch(
	() => props.currentCtx.id,
	(nextID, prevID) => {
		props.currentCtx.remote = false;
		ensureUnreadWatcher(props.currentCtx);

		if (workspace.value.has(nextID)) {
			const nextWorkspace = new Map(workspace.value);
			nextWorkspace.delete(nextID);
			workspace.value = nextWorkspace;
		}

		if (!activeTabID.value || activeTabID.value === prevID) {
			activeTabID.value = nextID;
		}
	},
	{ immediate: true },
);

watch(
	remoteTabs,
	(nextTabs) => {
		const nextIDs = new Set(nextTabs.map((tab) => tab.id));

		for (const tab of nextTabs) {
			void hydrateRemoteBadgeSets(tab.ctx);

			if (subscribedRemoteIDs.has(tab.id)) continue;

			subscribedRemoteIDs.add(tab.id);
			subscribeChannel(tab.ctx.base);
		}

		for (const channelID of Array.from(subscribedRemoteIDs)) {
			if (nextIDs.has(channelID)) continue;

			subscribedRemoteIDs.delete(channelID);
			unsubscribeChannel(channelID);
			remoteCtxByID.get(channelID)?.leave();
		}

		if (activeTab.value?.kind === "remote" && !nextIDs.has(activeTab.value.id)) {
			activeTabID.value = props.currentCtx.id;
		}
	},
	{ immediate: true },
);

function selectTab(channelID: string): void {
	activeTabID.value = channelID;
	unreadCounts.value = {
		...unreadCounts.value,
		[channelID]: 0,
	};
}

function removeTab(channelID: string): void {
	const nextWorkspace = new Map(workspace.value);
	nextWorkspace.delete(channelID);
	workspace.value = nextWorkspace;
	if (activeTabID.value === channelID) {
		activeTabID.value = props.currentCtx.id;
	}
}

function toggleAddInput(): void {
	showAddInput.value = !showAddInput.value;
	if (!showAddInput.value) return;

	nextTick(() => addInputRef.value?.focus());
}

function closeAddInput(): void {
	showAddInput.value = false;
	addChannelValue.value = "";
}

async function hydrateRemoteBadgeSets(ctx: ChannelContext): Promise<void> {
	if (!ctx.id || hydratedRemoteBadgeIDs.has(ctx.id)) return;

	hydratedRemoteBadgeIDs.add(ctx.id);

	try {
		const badgeSets =
			(apollo.value ? await fetchRemoteBadgeSetsViaApollo(ctx).catch(() => null) : null) ??
			(await getTwitchBadgeSets(ctx.id));

		useChatProperties(ctx).twitchBadgeSets = badgeSets;
	} catch {
		hydratedRemoteBadgeIDs.delete(ctx.id);
	}
}

async function fetchRemoteBadgeSetsViaApollo(ctx: ChannelContext): Promise<Twitch.BadgeSets> {
	if (!apollo.value || !ctx.username) {
		return Promise.reject(new Error("Apollo client unavailable"));
	}

	const resp = await apollo.value.query<twitchChannelBadgesQuery.Response, twitchChannelBadgesQuery.Variables>({
		query: twitchChannelBadgesQuery,
		variables: {
			login: ctx.username,
		},
		fetchPolicy: "network-only",
	});

	return mapBadgeSetsFromApollo(resp.data.badges ?? [], resp.data.user?.broadcastBadges ?? []);
}

function mapBadgeSetsFromApollo(globalBadges: Twitch.ChatBadge[], channelBadges: Twitch.ChatBadge[]): Twitch.BadgeSets {
	const globalsBySet = toBadgeMap(globalBadges);
	const channelsBySet = toBadgeMap(channelBadges);

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function toBadgeMap(badges: Twitch.ChatBadge[]): Map<string, Map<string, Twitch.ChatBadge>> {
	const mapped = new Map<string, Map<string, Twitch.ChatBadge>>();

	for (const badge of badges) {
		let versions = mapped.get(badge.setID);
		if (!versions) {
			versions = new Map();
			mapped.set(badge.setID, versions);
		}

		versions.set(badge.version, badge);
	}

	return mapped;
}

const stopHelixAuthListener = onTwitchHelixAuthChange(() => {
	for (const tab of remoteTabs.value) {
		void hydrateRemoteBadgeSets(tab.ctx);
	}
});

async function submitAddChannel(): Promise<void> {
	const login = addChannelValue.value.trim().replace(/^@+/, "").toLowerCase();
	if (!login) return;
	if (!apollo.value) {
		transportStatus.value = {
			state: "error",
			reason: "Twitch GraphQL client unavailable",
		};
		return;
	}

	if (login === props.currentCtx.username?.toLowerCase()) {
		closeAddInput();
		return;
	}

	for (const saved of workspace.value.values()) {
		if (saved.login.toLowerCase() === login) {
			selectTab(saved.id);
			closeAddInput();
			return;
		}
	}

	const resp = await apollo.value
		.query<twitchChannelLookupQuery.Response, twitchChannelLookupQuery.Variables>({
			query: twitchChannelLookupQuery,
			variables: {
				login,
			},
			fetchPolicy: "network-only",
		})
		.catch(() => null);

	const user = resp?.data?.user;
	if (!user) {
		transportStatus.value = {
			state: "error",
			reason: `Unable to resolve #${login}`,
		};
		return;
	}

	const nextWorkspace = new Map(workspace.value);
	nextWorkspace.set(user.id, {
		id: user.id,
		login: user.login.toLowerCase(),
		displayName: user.displayName || user.login,
	});
	workspace.value = nextWorkspace;
	activeTabID.value = user.id;
	unreadCounts.value = {
		...unreadCounts.value,
		[user.id]: 0,
	};
	closeAddInput();
}

function onTransportStatus(ev: Event): void {
	transportStatus.value = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_STATUS">>).detail;
}

target.addEventListener("tverino_chat_status", onTransportStatus);

watch(
	activeTab,
	(tab) => {
		activeTarget.value = {
			kind: tab?.kind ?? "native",
			id: tab?.id ?? props.currentCtx.id,
			login: tab?.login ?? props.currentCtx.username ?? "",
			displayName: tab?.displayName ?? props.currentCtx.displayName ?? props.currentCtx.username ?? "",
		};
	},
	{ immediate: true },
);

onUnmounted(() => {
	stopHelixAuthListener();
	target.removeEventListener("tverino_chat_status", onTransportStatus);
	activeTarget.value = {
		kind: "native",
		id: props.currentCtx.id,
		login: props.currentCtx.username ?? "",
		displayName: props.currentCtx.displayName ?? props.currentCtx.username ?? "",
	};

	for (const channelID of Array.from(subscribedRemoteIDs)) {
		unsubscribeChannel(channelID);
		remoteCtxByID.get(channelID)?.leave();
	}

	for (const stop of unreadStops.values()) {
		stop();
	}
});
</script>

<style scoped lang="scss">
.seventv-tverino-header {
	display: flex;
	flex-direction: column;
	background: var(--seventv-background-shade-1);
}

.seventv-tverino-shell {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	background: var(--seventv-background-shade-1);
}

.seventv-tverino-tabs-row {
	--tverino-tab-width: 8.8rem;
	--tverino-tab-active-width: 16rem;
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 0.8rem;
	padding: 0.8rem;
	border-top: 0.1rem solid var(--seventv-border-transparent-1);
	border-bottom: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-transparent-2);
}

.seventv-tverino-tabs {
	display: flex;
	gap: 0.45rem;
	overflow-x: auto;
	padding-bottom: 0.1rem;
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.seventv-tverino-tab {
	position: relative;
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	flex: 0 0 var(--tverino-tab-width);
	width: var(--tverino-tab-width);
	min-width: var(--tverino-tab-width);
	max-width: var(--tverino-tab-width);
	height: 3.4rem;
	padding: 0 0.9rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	border-radius: 0.25rem;
	background: var(--seventv-background-shade-1);
	color: var(--seventv-text-color-normal);
	transition:
		width 180ms ease,
		min-width 180ms ease,
		max-width 180ms ease,
		background-color 140ms ease,
		border-color 140ms ease,
		opacity 140ms ease;
	overflow: hidden;

	&.active {
		flex-basis: var(--tverino-tab-active-width);
		width: var(--tverino-tab-active-width);
		min-width: var(--tverino-tab-active-width);
		max-width: min(20rem, 42vw);
		background: var(--seventv-background-shade-2);
		border-color: var(--seventv-primary);
	}

	&:hover {
		background: var(--seventv-highlight-neutral-1);
	}

	&:not(.active) {
		color: var(--seventv-text-color-secondary);
	}
}

.tab-main {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	min-width: 0;
	flex: 1 1 auto;
}

.live-dot {
	width: 0.7rem;
	height: 0.7rem;
	border-radius: 999px;
	background: #ff5454;
	box-shadow: 0 0 0.75rem rgb(255 84 84 / 45%);
	flex: 0 0 auto;
}

.tab-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 700;
	mask-image: linear-gradient(90deg, #000 58%, transparent);
}

.seventv-tverino-tab.active .tab-label {
	mask-image: none;
}

.tab-unread {
	padding: 0.1rem 0.5rem;
	border-radius: 999px;
	background: var(--seventv-highlight-neutral-1);
	color: var(--seventv-text-color-normal);
	font-size: 1.1rem;
	font-weight: 700;
}

.tab-close {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.9rem;
	height: 1.9rem;
	border-radius: 999px;
	color: var(--seventv-text-color-secondary);
	opacity: 0;
	transform: scale(0.88);
	transition:
		opacity 120ms ease,
		transform 120ms ease,
		background-color 120ms ease;

	&:hover {
		background: var(--seventv-highlight-neutral-1);
		color: var(--seventv-text-color-normal);
	}
}

.seventv-tverino-tab.remote:hover .tab-close,
.seventv-tverino-tab.remote.active .tab-close {
	opacity: 1;
	transform: scale(1);
}

.seventv-tverino-actions {
	display: flex;
	align-items: center;
	gap: 0.45rem;
}

.seventv-tverino-add-form {
	width: 12rem;
}

.seventv-tverino-add-input,
.seventv-tverino-add-button {
	height: 3.4rem;
	border-radius: 0.25rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	background: var(--seventv-background-shade-1);
	color: var(--seventv-text-color-normal);
}

.seventv-tverino-add-input {
	width: 100%;
	padding: 0 1rem;
	outline: none;
	transition:
		outline 140ms ease,
		border-color 140ms ease;

	&:focus {
		outline: 1px solid var(--seventv-primary);
		border-color: var(--seventv-primary);
	}
}

.seventv-tverino-add-button {
	width: 3.4rem;
	font-size: 2rem;
	line-height: 1;

	&:hover {
		background: var(--seventv-highlight-neutral-1);
	}
}

.seventv-tverino-inline-status {
	padding: 0.65rem 0.8rem 0.8rem;
	color: var(--seventv-text-color-secondary);
	font-size: 1.2rem;
}

.seventv-tverino-body {
	display: flex;
	flex: 1 1 auto;
	min-height: 0;
	overflow: hidden;
	background: var(--seventv-background-shade-1);
}

@media (prefers-reduced-motion: reduce) {
	.seventv-tverino-tab,
	.tab-close,
	.seventv-tverino-add-input,
	.seventv-tverino-add-button {
		transition: none;
	}
}
</style>
