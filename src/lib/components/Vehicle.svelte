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
		routeInfo,
		colorMode = 'route'
	}: {
		vehicle: VehicleProps;
		agency?: Agency;
		routeInfo?: RouteInfo;
		colorMode?: 'route' | 'timeliness';
	} = $props();

	function getTimelinessColor(deviation: number | null): string {
		if (deviation == null) return '#9ca3af';
		const absMin = Math.abs(deviation) / 60;
		if (absMin < 0.5) return '#069b37';
		if (deviation > 0) {
			if (absMin < 2) return '#f4a609';
			if (absMin < 5) return '#d8630f';
			if (absMin < 10) return '#b50909';
			return '#dc2626';
		} else {
			if (absMin < 2) return '#2e87f4';
			if (absMin < 5) return '#1264e8';
			if (absMin < 10) return '#134bc4';
			return '#1d4ed8';
		}
	}

	const routeNameToShortName: Record<string, string> = {
		'Presidio GO South Hills': 'SH',
		'Presidio GO Downtown': 'DT',
		'Blue Line': 'B',
		'Green Line': 'G',
		'Orange Line': 'O',
		OrangeW: 'Ow',
		OrangeE: 'Oe',
		GreenS: 'Gs',
		BlueS: 'Bs',
		NBUS: 'N',
		TBUS: 'T',
		LBUS: 'L',
		KBUS: 'K',
		FBUS: 'F',
		Hollis: 'H',
		'Shell/Pow': 'SP',
		'Shell/Pow Sun': 'SP',
		'Lot D': 'D',
		'West Field Garage': 'WFG',
		'A - AM': 'A',
		'B - AM': 'B',
		'C - AM': 'C',
		Copper: 'C'
	};

	const backgroundColor = $derived(
		colorMode === 'timeliness'
			? getTimelinessColor(vehicle.deviation)
			: getVehicleColorForAgency(vehicle.route_short_name, agency?.name)
	);

	function isTrain(agency?: Agency): boolean {
		if (!agency?.name) return false;
		const name = agency.name.toLowerCase();
		return ['caltrain', 'sonoma-marin area rail transit', 'altamont corridor express'].includes(
			name
		);
	}

	function getDisplayName(v: VehicleProps, agency?: Agency, routeInfo?: RouteInfo): string {
		if (isTrain(agency) && v.trip_short_name) {
			return v.trip_short_name.replace('Trip ', '');
		}
		if (routeNameToShortName[v.route_short_name]) {
			return routeNameToShortName[v.route_short_name];
		}
		if (v.route_short_name?.includes('Rapid')) {
			return v.route_short_name.replace('Rapid', '').trim();
		}
		if (v.route_short_name?.includes('Express')) {
			return v.route_short_name.replace('Express', '').trim();
		}
		if (v.route_short_name?.includes('Line')) {
			return v.route_short_name.replace('Line', '').trim();
		}
		if (v.route_short_name?.includes('Trip')) {
			return v.route_short_name.replace('Trip', '').trim();
		}
		if (v.route_short_name?.includes(' - AM')) {
			return v.route_short_name.replace(' - AM', '').trim();
		}
		if (routeInfo && routeInfo.route_short_name) {
			return routeInfo.route_short_name;
		}
		return v.route_short_name || v.vehicle_id || '?';
	}

	const routeNumber = $derived(getDisplayName(vehicle, agency, routeInfo));
	const routeTooltip = $derived(
		routeInfo && routeInfo.route_long_name
			? `${routeInfo.route_short_name} - ${routeInfo.route_long_name}`
			: vehicle.route_short_name
	);
	// const isTrain: Boolean = [
	// 	'J',
	// 	'K',
	// 	'L',
	// 	'M',
	// 	'N',
	// 	'T',
	// 	'F',
	// 	'Blue Line',
	// 	'Green Line',
	// 	'Orange Line',
	// 	'Copper Line'
	// ].includes(vehicle.route_short_name);

	const fontSize = $derived(routeNumber.length > 3 ? '7px' : '10px');
</script>

<div
	class="vehicle"
	style="background-color: {backgroundColor}; font-size: {fontSize};"
	title={routeTooltip}
>
	{routeNumber}
</div>

<style>
	.vehicle {
		width: 24px;
		height: 26px;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		box-sizing: border-box;
		line-height: 1;
		padding-bottom: 2px;
	}
</style>
