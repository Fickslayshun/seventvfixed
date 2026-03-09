<template>
	<ChatData />
</template>

<script setup lang="ts">
import { onUnmounted, provide } from "vue";
import { useApollo } from "@/composable/useApollo";
import { CHANNEL_CTX, type ChannelContext } from "@/composable/channel/useChannelContext";
import { useChatMessageProcessor } from "@/composable/chat/useChatMessageProcessor";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatProperties } from "@/composable/chat/useChatProperties";
import ChatData from "@/app/chat/ChatData.vue";
import { twitchUserDisplayBadgesQuery } from "@/assets/gql/tw.user-display-badges.gql";
import { useTVerinoChatTransport } from "./useTVerinoChatTransport";
import type { TypedWorkerMessage } from "@/worker";

const props = defineProps<{
	ctx: ChannelContext;
}>();

provide(CHANNEL_CTX, props.ctx);

const apollo = useApollo();
const properties = useChatProperties(props.ctx);
const { target } = useTVerinoChatTransport();
const processor = useChatMessageProcessor(props.ctx);
const messages = useChatMessages(props.ctx);
const requestedBadgeUsers = new Set<string>();

function onTverinoChatMessage(ev: Event): void {
	const detail = (ev as CustomEvent<TypedWorkerMessage<"TVERINO_CHAT_MESSAGE">>).detail;
	if (detail.channelID !== props.ctx.id) return;

	void hydrateMessageBadges(detail.message);
	processor.onMessage(detail.message);
}

function onTverinoSendResult(ev: Event): void {
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

async function hydrateMessageBadges(message: Twitch.AnyMessage): Promise<void> {
	const author = message.user ?? message.message?.user;
	const badges = message.badges ?? message.message?.badges ?? {};
	if (!apollo.value || !props.ctx.id || !author?.userLogin || Object.keys(badges).length === 0) return;

	const cacheKey = `${props.ctx.id}:${author.userID || author.userLogin}`;
	if (requestedBadgeUsers.has(cacheKey)) return;

	requestedBadgeUsers.add(cacheKey);

	try {
		const resp = await apollo.value.query<
			twitchUserDisplayBadgesQuery.Response,
			twitchUserDisplayBadgesQuery.Variables
		>({
			query: twitchUserDisplayBadgesQuery,
			variables: {
				channelID: props.ctx.id,
				login: author.userLogin,
			},
			fetchPolicy: "network-only",
		});

		const displayBadges = resp.data.user?.displayBadges ?? [];
		if (!displayBadges.length) return;

		properties.twitchBadgeSets = mergeBadgeSets(properties.twitchBadgeSets, displayBadges);
	} catch {
		requestedBadgeUsers.delete(cacheKey);
	}
}

function mergeBadgeSets(
	current: Twitch.BadgeSets | null | undefined,
	badges: Twitch.ChatBadge[],
): Twitch.BadgeSets {
	const globalsBySet = cloneBadgeSetMap(current?.globalsBySet);
	const channelsBySet = cloneBadgeSetMap(current?.channelsBySet);

	for (const badge of badges) {
		let versions = channelsBySet.get(badge.setID);
		if (!versions) {
			versions = new Map();
			channelsBySet.set(badge.setID, versions);
		}

		versions.set(badge.version, badge);
	}

	return {
		globalsBySet,
		channelsBySet,
		count: globalsBySet.size + channelsBySet.size,
	};
}

function cloneBadgeSetMap(
	source: Map<string, Map<string, Twitch.ChatBadge>> | null | undefined,
): Map<string, Map<string, Twitch.ChatBadge>> {
	const cloned = new Map<string, Map<string, Twitch.ChatBadge>>();
	if (!source) return cloned;

	for (const [setID, versions] of source) {
		cloned.set(setID, new Map(versions));
	}

	return cloned;
}

target.addEventListener("tverino_chat_message", onTverinoChatMessage);
target.addEventListener("tverino_chat_send_result", onTverinoSendResult);

onUnmounted(() => {
	target.removeEventListener("tverino_chat_message", onTverinoChatMessage);
	target.removeEventListener("tverino_chat_send_result", onTverinoSendResult);
});
</script>
