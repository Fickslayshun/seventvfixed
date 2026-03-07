function stableSerializeOptions(options: Intl.DateTimeFormatOptions): string {
	return Object.entries(options)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}:${String(value)}`)
		.join("|");
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function getDateTimeFormatter(
	locales: string | string[] | undefined,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const localeKey = Array.isArray(locales) ? locales.join(",") : locales ?? "";
	const cacheKey = `${localeKey}::${stableSerializeOptions(options)}`;

	const cached = formatterCache.get(cacheKey);
	if (cached) return cached;

	const formatter = new Intl.DateTimeFormat(locales, options);
	formatterCache.set(cacheKey, formatter);

	return formatter;
}

export function formatDateTime(
	value: number | Date,
	locales: string | string[] | undefined,
	options: Intl.DateTimeFormatOptions,
): string {
	return getDateTimeFormatter(locales, options).format(value);
}
