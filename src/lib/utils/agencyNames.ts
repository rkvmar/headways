export const agencyNameMap: Record<string, string> = {
	'san francisco municipal transportation agency': 'SF Muni',
	'san francisco bay ferry': 'SF Bay Ferry',
	'sonoma-marin area rail transit': 'SMART',
	'westcat (western contra costa)': 'WestCAT',
	'capitol corridor joint powers authority': 'Capitol Corridor',
	'ac transit': 'AC Transit',
	petaluma: 'Petaluma Transit',
	sonoma: 'Sonoma County Transit',
	santarosa: 'Santa Rosa CityBus',
	'vacaville city coach': 'Vacaville City Coach',
	'livermore amador valley transit authority': 'Wheels',
	'sfo airport': 'SFO',
	'dumbarton express consortium': 'Dumbarton Express'
};

export function getReadableAgencyName(agencyName: string | null | undefined): string {
	if (!agencyName) return '';
	const key = agencyName.toLowerCase().trim();
	return agencyNameMap[key] || agencyName;
}
