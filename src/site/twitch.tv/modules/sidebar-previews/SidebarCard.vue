<template />

<script setup lang="ts">
import { onUnmounted, ref, toRaw, watch } from "vue";
import { REACT_TYPEOF_TOKEN } from "@/common/Constant";
import { HookedInstance } from "@/common/ReactHooks";
import { defineFunctionHook, definePropertyHook, unsetPropertyHook } from "@/common/Reflection";
import { useApollo } from "@/composable/useApollo";
import { useConfig } from "@/composable/useSettings";
import { twitchSidebarCardQuery } from "@/assets/gql/tw.sidebar-card.gql";

const SIDEBAR_TITLE_CACHE_TTL_MS = 5 * 60 * 1000;
const SIDEBAR_TITLE_NEGATIVE_CACHE_TTL_MS = 30 * 1000;
const sidebarTitleCache = new Map<string, { title: string; expiresAt: number }>();

const props = defineProps<{
	instance: HookedInstance<Twitch.SidebarCardComponent>;
}>();

const apollo = useApollo();
const showPreviews = useConfig<boolean>("ui.sidebar_previews");
const replaceHoverBox = useConfig<boolean>("layout.sidebar_inline_hover_details");

const metadataLeft = ref<Twitch.SidebarCardComponent["props"]["metadataLeft"]>();
const tooltipContent = ref<Twitch.SidebarCardComponent["props"]["tooltipContent"]>();
const streamTitle = ref("");
let sidebarTitleRequest = 0;

function readCachedSidebarTitle(login: string | undefined): string | null {
	if (!login) return null;

	const key = login.toLowerCase();
	const cached = sidebarTitleCache.get(key);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		sidebarTitleCache.delete(key);
		return null;
	}

	return cached.title;
}

function writeCachedSidebarTitle(login: string | undefined, title: string, ttlMs: number): void {
	if (!login) return;

	sidebarTitleCache.set(login.toLowerCase(), {
		title,
		expiresAt: Date.now() + ttlMs,
	});
}

definePropertyHook(props.instance.component, "props", {
	value: (v: Twitch.SidebarCardComponent["props"]) => {
		definePropertyHook(v, "metadataLeft", {
			value: (v) => {
				metadataLeft.value = v;
			},
			get: (v) => {
				if (!replaceHoverBox.value) return v;

				return makeInlineHoverDetails(extractText(v), streamTitle.value);
			},
		});

		definePropertyHook(v, "tooltipContent", {
			value: (v) => {
				tooltipContent.value = v;
				streamTitle.value = extractTooltipStreamTitleFromContent(v, extractText(metadataLeft.value));
			},
			get: (v) => (replaceHoverBox.value ? null : v),
		});
	},
});

watch(
	tooltipContent,
	(tooltip, old) => {
		if (tooltip != old) {
			if (isRuntimeElement(old) && typeof old.type == "function") {
				unsetPropertyHook(old.type.prototype, "render");
			}

			if (isRuntimeElement(tooltip) && typeof tooltip.type == "function") {
				defineFunctionHook(tooltip.type.prototype, "render", function (old, ...args: unknown[]) {
					const vnode = old?.apply(this, args) ?? null;

					return patchTooltip(this, vnode);
				});

				rerenderCard();
			}
		}
	},
	{ immediate: true },
);

watch([showPreviews, replaceHoverBox, streamTitle], () => rerenderCard());

watch(
	[() => props.instance.component.props.userLogin, () => props.instance.component.props.offline],
	() => {
		sidebarTitleRequest++;
		const gameTitle = extractText(metadataLeft.value);
		const extractedTitle = extractTooltipStreamTitleFromContent(tooltipContent.value, gameTitle);
		const cachedTitle = readCachedSidebarTitle(props.instance.component.props.userLogin);

		if (isUsefulSidebarTitle(extractedTitle, props.instance.component.props.title, gameTitle)) {
			writeCachedSidebarTitle(
				props.instance.component.props.userLogin,
				extractedTitle,
				SIDEBAR_TITLE_CACHE_TTL_MS,
			);
		}

		streamTitle.value = cachedTitle || extractedTitle;
	},
	{ immediate: true },
);

watch(
	[
		replaceHoverBox,
		apollo,
		() => props.instance.component.props.userLogin,
		() => props.instance.component.props.offline,
	],
	([enabled, client, login, offline]) => {
		if (!enabled || !client || !login || offline) return;

		const gameTitle = extractText(metadataLeft.value);
		const cachedTitle = readCachedSidebarTitle(login);
		if (cachedTitle !== null) {
			if (cachedTitle) {
				streamTitle.value = cachedTitle;
			}
			return;
		}

		if (isUsefulSidebarTitle(streamTitle.value, props.instance.component.props.title, gameTitle)) return;

		const requestID = ++sidebarTitleRequest;
		client
			.query<twitchSidebarCardQuery.Response, twitchSidebarCardQuery.Variables>({
				query: twitchSidebarCardQuery,
				variables: {
					login,
				},
				fetchPolicy: "network-only",
			})
			.then((resp) => {
				if (requestID !== sidebarTitleRequest) return;

				const title = pickSidebarStreamTitle(
					[
						normalizeText(resp.data.user?.stream?.title ?? ""),
						normalizeText(resp.data.user?.lastBroadcast?.title ?? ""),
					],
					props.instance.component.props.title,
					gameTitle,
				);
				if (!title) {
					writeCachedSidebarTitle(login, "", SIDEBAR_TITLE_NEGATIVE_CACHE_TTL_MS);
					return;
				}

				writeCachedSidebarTitle(login, title, SIDEBAR_TITLE_CACHE_TTL_MS);
				streamTitle.value = title;
			})
			.catch(() => {
				writeCachedSidebarTitle(login, "", SIDEBAR_TITLE_NEGATIVE_CACHE_TTL_MS);
			});
	},
	{ immediate: true },
);

function rerenderCard() {
	toRaw(props.instance.component).forceUpdate();
}

function patchTooltip(tooltip: ReactExtended.ReactRuntimeElement, vnode: ReactExtended.ReactRuntimeElement) {
	const nextTitle = extractTooltipStreamTitle(tooltip, vnode, extractText(metadataLeft.value));
	streamTitle.value = nextTitle;
	if (isUsefulSidebarTitle(nextTitle, props.instance.component.props.title, extractText(metadataLeft.value))) {
		writeCachedSidebarTitle(props.instance.component.props.userLogin, nextTitle, SIDEBAR_TITLE_CACHE_TTL_MS);
	}

	if (replaceHoverBox.value) return null;
	if (!showPreviews.value) return vnode;

	const body = vnode?.props?.children;

	if (!body || !body.props?.children) return vnode;

	body.props.style = { width: "20rem" };

	body.props.children.splice(2, 0, {
		[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
		ref: null,
		key: null,
		type: "div",
		props: {
			className: "seventv-sidebar-tooltip-preview",
			style: {
				backgroundImage: getThumbnail(tooltip.props.channelDisplayName?.toLowerCase() ?? "???"),
			},
		},
	});

	return vnode;
}

function extractTooltipStreamTitleFromContent(
	tooltip: Twitch.SidebarCardComponent["props"]["tooltipContent"] | undefined,
	gameTitle: string,
): string {
	if (!tooltip) return "";

	if (typeof tooltip === "string") {
		return pickSidebarStreamTitle([normalizeText(tooltip)], props.instance.component.props.title, gameTitle);
	}

	return extractTooltipStreamTitle(tooltip, tooltip, gameTitle);
}

function isRuntimeElement(
	value: Twitch.SidebarCardComponent["props"]["tooltipContent"] | null | undefined,
): value is ReactExtended.ReactRuntimeElement {
	return !!value && typeof value === "object";
}

function extractTooltipStreamTitle(
	tooltip: ReactExtended.ReactRuntimeElement,
	vnode: ReactExtended.ReactRuntimeElement,
	gameTitle: string,
): string {
	const channelDisplayName = normalizeText(
		tooltip?.props?.channelDisplayName ?? tooltip?.props?.displayName ?? props.instance.component.props.title ?? "",
	);
	const candidates = [
		getTooltipPropString(tooltip?.props, [
			"streamTitle",
			"broadcastTitle",
			"tooltipTitle",
			"liveCardTitle",
			"title",
			"subtitle",
		]),
		...extractTooltipTextBlocks(tooltip),
		...extractTooltipTextBlocks(vnode),
		...extractTooltipStringsDeep(tooltip),
		...extractTooltipStringsDeep(vnode),
	];

	return pickSidebarStreamTitle(candidates, channelDisplayName, gameTitle);
}

function extractTooltipTextBlocks(vnode: ReactExtended.ReactRuntimeElement): string[] {
	const blocks = [] as string[];
	const body = vnode?.props?.children;
	const children = body?.props?.children;

	if (Array.isArray(children)) {
		for (const child of children) {
			blocks.push(extractText(child));
		}
	} else if (children) {
		blocks.push(extractText(children));
	}

	if (!blocks.length && body) {
		blocks.push(extractText(body));
	}

	return dedupeTexts(blocks);
}

function getTooltipPropString(props: Record<string, unknown> | undefined, keys: string[]): string {
	if (!props) return "";

	for (const key of keys) {
		const value = props[key];
		if (typeof value === "string" && value.trim()) {
			return normalizeText(value);
		}
	}

	return "";
}

function extractTooltipStringsDeep(value: unknown, seen = new WeakSet<object>(), depth = 0): string[] {
	if (value == null || typeof value === "boolean" || depth > 6) return [];
	if (typeof value === "string" || typeof value === "number") {
		const text = normalizeText(String(value));
		return text ? [text] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((entry) => extractTooltipStringsDeep(entry, seen, depth + 1));
	}
	if (typeof value !== "object") return [];
	if (seen.has(value)) return [];

	seen.add(value);

	const strings = [] as string[];
	for (const [key, entry] of Object.entries(value)) {
		if (key === "style" || key === "className") continue;
		strings.push(...extractTooltipStringsDeep(entry, seen, depth + 1));
	}

	return strings;
}

function extractText(node: unknown): string {
	if (node == null || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return normalizeText(String(node));
	if (Array.isArray(node)) {
		return normalizeText(
			node
				.map((child) => extractText(child))
				.filter(Boolean)
				.join(" "),
		);
	}
	if (typeof node === "object" && "props" in node) {
		return extractText((node as { props?: { children?: unknown } }).props?.children);
	}

	return "";
}

function pickSidebarStreamTitle(candidates: string[], channelDisplayName: string, gameTitle: string): string {
	const game = normalizeText(gameTitle);
	const channel = normalizeText(channelDisplayName);

	return (
		dedupeTexts(candidates)
			.filter((text) => isUsefulSidebarTitle(text, channel, game))
			.sort((a, b) => scoreSidebarStreamTitle(b) - scoreSidebarStreamTitle(a) || b.length - a.length)[0] ?? ""
	);
}

function isUsefulSidebarTitle(text: string, channelDisplayName: string, gameTitle: string): boolean {
	if (!text) return false;
	if (matchesIgnoreCase(text, channelDisplayName) || matchesIgnoreCase(text, gameTitle)) return false;
	if (text.length < 4) return false;
	if (!/[a-z]/i.test(text)) return false;
	if (/^[0-9.,]+[KMB]?$/i.test(text)) return false;
	if (/^[0-9.,]+[KMB]?\s+viewers?$/i.test(text)) return false;
	if (/^live$/i.test(text)) return false;
	if (/use the right arrow key/i.test(text)) return false;
	if (/show more information/i.test(text)) return false;
	if (isUrlLikeSidebarText(text)) return false;
	if (isIdentifierLikeSidebarText(text)) return false;

	return true;
}

function scoreSidebarStreamTitle(text: string): number {
	let score = 0;

	if (/\s/.test(text)) score += 40;
	if (/[!?'"(),-]/.test(text)) score += 12;
	score += Math.min(text.split(/\s+/).length, 12) * 6;
	score += Math.min(text.length, 96) / 2;
	score -= (text.match(/[/:?=&]/g)?.length ?? 0) * 8;
	score -= (text.match(/\./g)?.length ?? 0) * 6;

	return score;
}

function isUrlLikeSidebarText(text: string): boolean {
	if (/^(?:https?:)?\/\//i.test(text)) return true;
	if (/static-cdn/i.test(text)) return true;
	if (/[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/i.test(text)) return true;
	if (/\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i.test(text)) return true;
	if ((text.match(/\//g)?.length ?? 0) >= 2) return true;

	return false;
}

function isIdentifierLikeSidebarText(text: string): boolean {
	if (/^provider[-_]/i.test(text)) return true;
	if (/(?:^|[-_])side[-_]nav(?:[-_]|$)/i.test(text)) return true;
	if (/(?:^|[-_])followed[-_]channels?(?:[-_]|$)/i.test(text)) return true;
	if (/^[a-z0-9]+(?:[-_:][a-z0-9]+){2,}$/i.test(text) && !/[A-Z ]/.test(text)) return true;

	return false;
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function dedupeTexts(texts: string[]): string[] {
	const out = [] as string[];
	const seen = new Set<string>();

	for (const text of texts.map((text) => normalizeText(text)).filter(Boolean)) {
		const key = text.toLowerCase();
		if (seen.has(key)) continue;

		seen.add(key);
		out.push(text);
	}

	return out;
}

function matchesIgnoreCase(a: string, b: string): boolean {
	return !!a && !!b && a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function makeInlineHoverDetails(gameTitle: string, nextTitle: string): ReactExtended.ReactRuntimeElement {
	const currentTitle = normalizeText(gameTitle);
	const hoverTitle = normalizeText(nextTitle);
	const displayTitle = hoverTitle || currentTitle;
	const hasAlternateTitle = !!hoverTitle && !matchesIgnoreCase(hoverTitle, currentTitle);

	return makeElement(
		"span",
		{
			className: `seventv-sidebar-inline-details${
				hasAlternateTitle ? " seventv-sidebar-inline-details--has-stream" : ""
			}`,
			title: displayTitle,
			children: hasAlternateTitle
				? makeElement(
						"span",
						{
							className: "seventv-sidebar-inline-details__track",
							children: [
								makeElement(
									"span",
									{
										className:
											"seventv-sidebar-inline-details__text seventv-sidebar-inline-details__text--game",
										children: currentTitle,
									},
									null,
								),
								makeElement(
									"span",
									{
										className:
											"seventv-sidebar-inline-details__text seventv-sidebar-inline-details__text--stream",
										children: hoverTitle,
									},
									null,
								),
							],
						},
						null,
				  )
				: currentTitle || hoverTitle,
		},
		null,
	);
}

function makeElement(
	type: string,
	props: Record<string, unknown>,
	key: string | null,
): ReactExtended.ReactRuntimeElement {
	return {
		[REACT_TYPEOF_TOKEN]: Symbol.for("react.element"),
		ref: null,
		key,
		type,
		props,
	};
}

function getThumbnail(channel: string) {
	let url = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-190x107.jpg`;

	url += `?${Math.floor(Date.now() / 300000)}`;

	return `url("${url}")`;
}

onUnmounted(() => {
	unsetPropertyHook(props.instance.component, "props");

	if (props.instance.component?.props) {
		unsetPropertyHook(props.instance.component.props, "metadataLeft");
		unsetPropertyHook(props.instance.component.props, "tooltipContent");
	}

	if (typeof tooltipContent.value == "object" && typeof tooltipContent.value?.type == "function") {
		unsetPropertyHook(tooltipContent.value.type.prototype, "render");
	}
});
</script>

<style lang="scss">
.seventv-sidebar-inline-hover-details-enabled {
	.side-nav-card__link__tooltip-arrow {
		display: none !important;
	}

	.side-nav-card__link {
		border-radius: 0.6rem;
		transition:
			background-color 120ms ease,
			box-shadow 120ms ease;
	}

	.side-nav-card__link:hover {
		background-color: rgb(255 255 255 / 0.04);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16);
	}
}

.seventv-sidebar-tooltip-preview {
	margin: 2px 0;
	border-radius: 4px;
	width: 100%;
	padding-bottom: 56.25%;
	background-color: var(--color-background-placeholder);
	background-size: contain;
	background-position: center;
}

.seventv-sidebar-inline-details {
	--seventv-sidebar-inline-details-height: 1.5em;
	display: block;
	position: relative;
	min-width: 0;
	max-width: 100%;
	height: var(--seventv-sidebar-inline-details-height);
	line-height: var(--seventv-sidebar-inline-details-height);
	overflow: hidden;
	vertical-align: top;
}

.seventv-sidebar-inline-details__track {
	display: flex;
	flex-direction: column;
	transform: translateY(0);
	will-change: transform;
	transition: transform 280ms cubic-bezier(0.4, 0, 0.2, 1);
}

.seventv-sidebar-inline-details__text {
	display: block;
	flex: 0 0 var(--seventv-sidebar-inline-details-height);
	min-width: 0;
	height: var(--seventv-sidebar-inline-details-height);
	line-height: var(--seventv-sidebar-inline-details-height);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.side-nav-card__link:hover .seventv-sidebar-inline-details--has-stream .seventv-sidebar-inline-details__track {
	transform: translateY(calc(-1 * var(--seventv-sidebar-inline-details-height)));
	transition-delay: 0.12s;
}
</style>
