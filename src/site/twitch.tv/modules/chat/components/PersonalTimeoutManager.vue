<template>
	<div class="seventv-personal-timeout-manager">
		<div v-if="entries.length" class="seventv-personal-timeout-actions">
			<button type="button" class="clear-all" @click="clearAllEntries">Clear All</button>
		</div>

		<div v-if="entries.length" class="seventv-personal-timeout-list">
			<div
				v-for="entry of entries"
				:key="`${entry.channelID}:${entry.username}`"
				class="seventv-personal-timeout-entry"
			>
				<div class="entry-main">
					<div class="entry-title">
						<TimerIcon />
						<span>{{ entry.displayName }}</span>
					</div>
					<div class="entry-meta">
						<span>#{{ entry.channelLogin }}</span>
						<span>{{ remaining(entry.expiresAt) }}</span>
					</div>
				</div>
				<button type="button" class="clear-one" @click="clearEntry(entry.channelID, entry.username)">
					Clear
				</button>
			</div>
		</div>

		<p v-else class="seventv-personal-timeout-empty">No active personal timeouts.</p>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { formatRemainingDuration } from "@/common/chat/timeoutPresets";
import { usePersonalTimeouts } from "@/composable/chat/usePersonalTimeouts";
import TimerIcon from "@/assets/svg/icons/TimerIcon.vue";

const { entries, clearEntry, clearAllEntries, pruneExpired } = usePersonalTimeouts();

const now = ref(Date.now());
let tickTimer: number | null = null;

function remaining(expiresAt: number): string {
	return formatRemainingDuration(Math.max(0, expiresAt - now.value));
}

onMounted(() => {
	pruneExpired();
	tickTimer = window.setInterval(() => {
		now.value = Date.now();
		pruneExpired(now.value);
	}, 1000);
});

onUnmounted(() => {
	if (tickTimer !== null) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
});
</script>

<style scoped lang="scss">
.seventv-personal-timeout-manager {
	display: grid;
	gap: 0.75rem;
}

.seventv-personal-timeout-actions {
	display: flex;
	justify-content: flex-end;
	margin-top: -0.25rem;
}

.seventv-personal-timeout-list {
	display: grid;
	gap: 0.5rem;
}

.seventv-personal-timeout-entry {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.75rem 1rem;
	border: 0.1rem solid var(--seventv-border-transparent-1);
	border-radius: 0.35rem;
	background: var(--seventv-background-transparent-1);
}

.entry-main {
	display: grid;
	gap: 0.25rem;
}

.entry-title {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	font-weight: 700;
}

.entry-meta {
	display: flex;
	gap: 0.75rem;
	color: var(--seventv-text-color-secondary);
	font-size: 0.95rem;
}

.clear-all,
.clear-one {
	border: 0;
	border-radius: 0.3rem;
	padding: 0.4rem 0.7rem;
	background: hsla(0deg, 0%, 100%, 10%);
	color: var(--seventv-text-primary);
	cursor: pointer;
	align-self: flex-start;
}

.clear-all:hover,
.clear-one:hover {
	background: hsla(0deg, 0%, 100%, 18%);
}

.clear-one {
	margin-top: 0.05rem;
}

.seventv-personal-timeout-empty {
	color: var(--seventv-text-color-secondary);
}
</style>
