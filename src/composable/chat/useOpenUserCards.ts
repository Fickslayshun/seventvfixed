import { computed, reactive } from "vue";

const state = reactive({
	openRows: new Set<symbol>(),
	version: 0,
});

function markDirty(): void {
	state.version += 1;
}

export function useOpenUserCards() {
	return {
		openRows: state.openRows,
		version: computed(() => state.version),
		isOpen(sym: symbol): boolean {
			return state.openRows.has(sym);
		},
		open(sym: symbol): void {
			if (state.openRows.has(sym)) return;

			state.openRows.add(sym);
			markDirty();
		},
		close(sym: symbol): void {
			if (!state.openRows.delete(sym)) return;

			markDirty();
		},
	};
}
