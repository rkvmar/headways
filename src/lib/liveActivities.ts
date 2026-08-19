import { Capacitor, registerPlugin } from '@capacitor/core';

// Keep in sync with HeadwaysActivityAttributes.ContentState in
// ios/App/App/HeadwaysActivityAttributes.swift (shared with the widget).
export interface LiveActivityVehicle {
	uniqueId: string;
	vehicleId: string;
	routeNumber: string;
	headsign: string;
	agencyName: string;
	nextStop: string;
	deviationText: string;
	routeColorHex: string;
}

interface LiveActivitiesNative {
	start(options: { vehicle: LiveActivityVehicle }): Promise<{ started: boolean }>;
	update(options: { vehicle: LiveActivityVehicle }): Promise<{ updated: boolean }>;
	end(options: { uniqueId: string }): Promise<void>;
}

const LiveActivities = registerPlugin<LiveActivitiesNative>('LiveActivities');

export function liveActivitiesSupported(): boolean {
	return Capacitor.getPlatform() === 'ios';
}

export function formatDeviation(deviationSec: number | null | undefined): string {
	if (deviationSec == null) return '';
	const d = deviationSec;
	if (d === 0) return 'On time';
	const absMin = Math.round(Math.abs(d) / 60);
	if (d > 0) return absMin === 0 ? 'Late' : `${absMin}m late`;
	return absMin === 0 ? 'Early' : `${absMin}m early`;
}

export async function startLiveActivity(vehicle: LiveActivityVehicle): Promise<void> {
	if (!liveActivitiesSupported()) return;
	try {
		await LiveActivities.start({ vehicle });
	} catch (error) {
		console.warn('Failed to start Live Activity:', error);
	}
}

export async function updateLiveActivity(vehicle: LiveActivityVehicle): Promise<void> {
	if (!liveActivitiesSupported()) return;
	try {
		await LiveActivities.update({ vehicle });
	} catch (error) {
		console.warn('Failed to update Live Activity:', error);
	}
}

export async function endLiveActivity(uniqueId: string): Promise<void> {
	if (!liveActivitiesSupported()) return;
	try {
		await LiveActivities.end({ uniqueId });
	} catch (error) {
		console.warn('Failed to end Live Activity:', error);
	}
}
