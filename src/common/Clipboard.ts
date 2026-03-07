export async function copyText(text: string): Promise<boolean> {
	if (!text) return false;

	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// fallback below
	}

	try {
		const input = document.createElement("textarea");
		input.value = text;
		input.setAttribute("readonly", "");
		input.style.position = "fixed";
		input.style.opacity = "0";
		document.body.appendChild(input);
		input.select();

		const ok = document.execCommand("copy");
		document.body.removeChild(input);
		return ok;
	} catch {
		return false;
	}
}
