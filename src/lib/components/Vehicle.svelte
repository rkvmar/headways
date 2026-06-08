<script lang="ts">
	import { getVehicleColorForAgency } from '$lib/utils/vehicleColors';
	interface VehicleProps {
		op_agency: number;
		agency: number;
		vehicle_id: string;
		unique_id: string;
		trip_id: string;
		lat: number;
		lon: number;
		deviation: number;
		timestamp: number;
		is_anomaly: boolean;
		next_stop_id: string;
		next_stop_seq: number;
		next_stop_name: string;
		current_headsign: string | null;
		occupancy: string | null;
		trip_type: string;
		car_count: number | null;
		bearing: number;
		speed: number;
		route_id: string;
		trip_headsign: string;
		service_id: string;
		direction_id: number;
		block_id: string;
		block_name: string | null;
		route_short_name: string;
		shape_id: string;
		trip_start_timestamp: number;
		trip_start_seq: number;
		trip_end_seq: number;
		trip_short_name: string;
		min: number;
		max: number;
		year: number;
		make: string;
		model: string;
		fuel: string;
		length: number;
		icon_code: string;
		short_headsign: string;
	}

	interface Agency {
		id: number;
		name: string;
		short_name: string;
		color: string;
		text_color: string;
		url: string;
		timezone: string;
		lang: string;
		phone: string;
		fare_url: string;
		email: string;
	}

	interface RouteInfo {
		route_id: string;
		route_short_name: string;
		route_long_name: string;
		agency_id: number;
	}

	let {
		vehicle,
		agency,
		routeInfo
	}: { vehicle: VehicleProps; agency?: Agency; routeInfo?: RouteInfo } = $props();

	const routeNameToShortName: Record<string, string> = {
		'Presidio GO South Hills': 'SH',
		'Presidio GO Downtown': 'DT',
		'Blue Line': 'B',
		'Green Line': 'G',
		'Orange Line': 'O',
		Copper: 'C'
	};

	const backgroundColor = $derived(
		getVehicleColorForAgency(vehicle.route_short_name, agency?.name)
	);

	function getDisplayName(v: VehicleProps, routeInfo?: RouteInfo): string {
		if (routeNameToShortName[v.route_short_name]) {
			return routeNameToShortName[v.route_short_name];
		}
		if (v.route_short_name?.includes('Rapid')) {
			return v.route_short_name.replace('Rapid', '');
		}
		if (v.route_short_name?.includes('Line')) {
			return v.route_short_name.replace('Line', '');
		}
		if (routeInfo && routeInfo.route_short_name) {
			return routeInfo.route_short_name;
		}
		return v.route_short_name || v.vehicle_id || '?';
	}

	const routeNumber = $derived(getDisplayName(vehicle, routeInfo));
	const routeTooltip = $derived(
		routeInfo && routeInfo.route_long_name
			? `${routeInfo.route_short_name} - ${routeInfo.route_long_name}`
			: vehicle.route_short_name
	);
	const isTrain: Boolean = [
		'J',
		'K',
		'L',
		'M',
		'N',
		'T',
		'F',
		'Blue Line',
		'Green Line',
		'Orange Line',
		'Copper Line'
	].includes(vehicle.route_short_name);
</script>

<div class="vehicle" style="background-color: {backgroundColor};" title={routeTooltip}>
	{routeNumber}
</div>

<style>
	.vehicle {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-size: 10px;
		font-weight: bold;
		font-family: 'Helvetica', sans-serif;
		border: 2px solid white;
		border-radius: 2px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
		border-radius: 2px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		box-sizing: border-box;
	}
</style>
