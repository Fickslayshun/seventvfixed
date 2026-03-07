<template>
	<div class="seventv-user-card-mod" :personal-only="!canModerate && personalTimeoutsEnabled ? '1' : '0'">
		<div v-if="showModeSwitch" class="seventv-user-card-mod-mode-switch">
			<button
				v-tooltip="'Moderator tools'"
				type="button"
				data-mode="mod"
				:active="mode === 'mod'"
				@click="mode = 'mod'"
			>
				M
			</button>
			<button
				v-tooltip="'Personal timeouts'"
				type="button"
				data-mode="personal"
				:active="mode === 'personal'"
				@click="mode = 'personal'"
			>
				P
			</button>
		</div>

		<div v-if="mode === 'mod' && canModerate" class="seventv-user-card-mod-controls">
			<div class="seventv-user-card-mod-side seventv-user-card-mod-ban" :is-banned="ban ? '1' : '0'">
				<GavelIcon
					v-tooltip="ban ? t('user_card.unban_button') : t('user_card.ban_button')"
					:slashed="!!ban"
					@click="ban ? unbanUser() : banUser('')"
				/>
			</div>

			<div class="seventv-user-card-mod-side seventv-user-card-mod-warn">
				<WarningIcon
					v-tooltip="t('user_card.warn_button')"
					@click="tools.openViewerWarnPopover(target.id, target.username, 0)"
				/>
			</div>

			<div v-show="!ban" class="seventv-user-card-mod-timeout-options">
				<button
					v-for="opt of timeoutOptions"
					:key="opt"
					v-tooltip="t('user_card.timeout_button', { duration: opt })"
					type="button"
					@click="banUser(opt)"
				>
					{{ opt }}
				</button>
			</div>

			<div
				v-if="ctx.actor.roles.has('BROADCASTER')"
				class="seventv-user-card-mod-side seventv-user-card-mod-moderator"
				:is-mod="isModerator ? '1' : '0'"
			>
				<ShieldIcon
					v-tooltip="isModerator ? t('user_card.unmod_button') : t('user_card.mod_button')"
					:slashed="isModerator"
					@click="setMod(!!isModerator)"
				/>
			</div>
		</div>

		<div v-else-if="personalTimeoutsEnabled" class="seventv-user-card-personal-timeout-options">
			<button
				v-for="opt of timeoutOptions"
				:key="opt"
				v-tooltip="`Hide locally for ${opt}`"
				type="button"
				@click="setPersonalTimeout(opt)"
			>
				{{ opt }}
			</button>
			<button v-if="activePersonalTimeout" type="button" class="clear-personal" @click="clearPersonalTimeout">
				Clear
			</button>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ChatMessage, type ChatUser } from "@/common/chat/ChatMessage";
import { CHAT_TIMEOUT_PRESETS, formatTimeoutNotice } from "@/common/chat/timeoutPresets";
import { useChannelContext } from "@/composable/channel/useChannelContext";
import { useChatMessages } from "@/composable/chat/useChatMessages";
import { useChatModeration } from "@/composable/chat/useChatModeration";
import { useChatTools } from "@/composable/chat/useChatTools";
import { usePersonalTimeouts } from "@/composable/chat/usePersonalTimeouts";
import { useConfig } from "@/composable/useSettings";
import { TwTypeChatBanStatus } from "@/assets/gql/tw.gql";
import GavelIcon from "@/assets/svg/icons/GavelIcon.vue";
import ShieldIcon from "@/assets/svg/icons/ShieldIcon.vue";
import WarningIcon from "@/assets/svg/icons/WarningIcon.vue";
import BasicSystemMessage from "./msg/BasicSystemMessage.vue";

const props = defineProps<{
	target: ChatUser;
	ban?: TwTypeChatBanStatus | null;
	isModerator?: boolean;
}>();

const emit = defineEmits<{
	(e: "victim-banned", data: TwTypeChatBanStatus): void;
	(e: "victim-unbanned"): void;
	(e: "victim-modded"): void;
	(e: "victim-unmodded"): void;
}>();

const { t } = useI18n();

const ctx = useChannelContext();
const messages = useChatMessages(ctx);
const mod = useChatModeration(ctx, props.target.username);
const tools = useChatTools(ctx);
const personalTimeouts = usePersonalTimeouts();
const personalTimeoutsEnabled = useConfig<boolean>("chat.personal_timeouts");
const canModerate = computed(
	() => (ctx.actor.roles.has("MODERATOR") && !props.isModerator) || ctx.actor.roles.has("BROADCASTER"),
);
const showModeSwitch = computed(() => canModerate.value && personalTimeoutsEnabled.value);
const activePersonalTimeout = computed(() => personalTimeouts.findEntry(ctx.id, props.target.username));
const mode = ref<"mod" | "personal">(canModerate.value ? "mod" : "personal");

async function banUser(duration: string): Promise<void> {
	const resp = await mod.banUserFromChat(duration).catch(() => void 0);
	if (!resp || resp.errors?.length || !resp.data?.banUserFromChatRoom.ban) return;

	emit("victim-banned", resp.data?.banUserFromChatRoom.ban);
}

async function unbanUser(): Promise<void> {
	const resp = await mod.unbanUserFromChat().catch(() => void 0);
	if (!resp || resp.errors?.length) return;

	emit("victim-unbanned");
}

async function setMod(v: boolean): Promise<void> {
	const resp = await mod.setUserModerator(props.target.id, v).catch(() => void 0);
	if (!resp || resp.errors?.length) return;

	!v ? emit("victim-modded") : emit("victim-unmodded");
}

function setPersonalTimeout(duration: string): void {
	const entry = personalTimeouts.upsertEntry(ctx, props.target, duration);
	if (!entry) return;

	emitLocalSystemMessage(formatTimeoutNotice(entry.displayName || entry.username, entry.duration, true) ?? "");
}

function clearPersonalTimeout(): void {
	personalTimeouts.clearEntry(ctx.id, props.target.username);
}

function emitLocalSystemMessage(text: string): void {
	if (!text) return;

	const message = new ChatMessage().setComponent(BasicSystemMessage, {
		text,
	});
	message.setTimestamp(Date.now());
	messages.add(message, true);
}

watch(
	[canModerate, personalTimeoutsEnabled],
	([mayModerate, personalEnabled]) => {
		if (!personalEnabled) {
			mode.value = "mod";
			return;
		}

		if (!mayModerate) {
			mode.value = "personal";
		}
	},
	{ immediate: true },
);

const timeoutOptions = CHAT_TIMEOUT_PRESETS;
</script>

<style scoped lang="scss">
.seventv-user-card-mod {
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 0.5rem;
	min-height: 3.4rem;
	padding: 0.55rem 1rem 0.7rem;
	border-top: 0.1rem solid hsla(0deg, 0%, 100%, 10%);

	&[personal-only="1"] {
		height: auto;
		padding-left: 1.35rem;
	}

	.seventv-user-card-mod-mode-switch {
		display: flex;
		justify-content: flex-end;
		gap: 0.35rem;
		padding-right: 0.1rem;

		button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			border: 0;
			border-radius: 0.25rem;
			min-width: 2rem;
			height: 2rem;
			padding: 0 0.55rem;
			background: hsla(0deg, 0%, 100%, 8%);
			color: var(--seventv-text-color-secondary);
			cursor: pointer;
			font-weight: 800;
			line-height: 1;
			transition:
				background-color 0.12s ease,
				color 0.12s ease,
				transform 0.12s ease;

			&[data-mode="mod"] {
				color: var(--seventv-accent);
			}

			&[active="true"] {
				background: hsla(0deg, 0%, 100%, 18%);
				color: var(--seventv-text-primary);
			}

			&[data-mode="mod"][active="true"] {
				background: hsla(122deg, 39%, 57%, 22%);
				color: var(--seventv-accent);
			}

			&:hover {
				transform: translateY(-1px);
			}
		}
	}

	.seventv-user-card-mod-controls {
		display: grid;
		grid-template-columns: 3em 3em minmax(0, 1fr) 3em;
		align-items: center;
		column-gap: 0.65rem;
		padding-left: 0.35rem;
	}

	.seventv-user-card-mod-timeout-options {
		display: grid;
		grid-template-columns: repeat(11, 1fr);
		align-items: center;
		gap: 0 0.5rem;
		font-size: 1rem;
		color: var(--seventv-muted);
	}

	.seventv-user-card-personal-timeout-options {
		display: grid;
		grid-template-columns: repeat(11, minmax(0, 1fr)) auto;
		align-items: center;
		gap: 0 0.5rem;
		padding-left: 0.35rem;
		font-size: 1rem;
		color: var(--seventv-muted);
	}

	.seventv-user-card-mod-side {
		display: grid;
		justify-content: center;
	}

	.seventv-user-card-mod-side,
	.seventv-user-card-mod-timeout-options > button,
	.seventv-user-card-personal-timeout-options > button {
		border: 0;
		background: transparent;
		padding: 0;
		cursor: pointer;
		transition: color 0.1s ease-in-out;

		svg {
			font-size: 1.5rem;
		}

		&:hover {
			color: var(--seventv-warning);
		}
	}

	.seventv-user-card-mod-moderator[is-mod="0"]:hover,
	.seventv-user-card-mod-ban[is-banned="1"]:hover {
		color: var(--seventv-accent);
	}

	.seventv-user-card-mod-warn:hover {
		color: #fd0;
	}

	.clear-personal:hover {
		color: var(--seventv-primary);
	}
}
</style>
