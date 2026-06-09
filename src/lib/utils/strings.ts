export function titleCase(str: string): string {
	return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function titleCaseHeadsign(headsign: string | null | undefined): string {
	if (!headsign) return '';
	return titleCase(headsign);
}
