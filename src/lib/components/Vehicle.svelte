<script lang="ts">
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
		'Presidio GO Downtown Route': 'DR',
		'Local Weekday': vehicle.vehicle_id.toString(),
		'Local Weekend': vehicle.vehicle_id.toString(),
		Limited: vehicle.vehicle_id.toString(),
		Express: vehicle.vehicle_id.toString(),
		'South County': vehicle.vehicle_id.toString(),
		SMART: vehicle.vehicle_id.toString(),
		'Blue Line': 'B',
		'Green Line': 'G',
		'Orange Line': 'O'
	};

	function getVehicleColor(vehicle: VehicleProps, agency?: Agency): string {
		const route = vehicle.route_short_name;

		if (agency) {
			if (agency.name.toLowerCase() == 'san francisco muni') {
				if (route == 'J') {
					return '#DF8719';
				}
				if (route == 'K') {
					return '#579BBE';
				}
				if (route == 'L') {
					return '#942593';
				}
				if (route == 'M') {
					return '#03814E';
				}
				if (route == 'N') {
					return '#084E75';
				}
				if (route == 'T') {
					return '#D01245';
				}
				if (route == 'F') {
					return '#6D4300';
				}
				if (['PM', 'PH', 'CA'].includes(route)) {
					return '#911515';
				}
				return '#CD3545';
			}
			if (agency.name.toLowerCase() == 'samtrans') {
				return '#00529B';
			}
			if (agency.name.toLowerCase() == 'golden gate transit') {
				return '#426C3E';
			}
			if (agency.name.toLowerCase() == 'caltrain') {
				return '#DB1734';
			}
			if (agency.name.toLowerCase() == 'ac transit') {
				if (route == '1T') {
					return '#6B1984';
				}
				return '#006B54';
			}
			if (agency.name.toLowerCase() == 'san francisco bay ferries') {
				return '#0A4E86';
			}
			if (agency.name.toLowerCase() == 'county connection') {
				return '#FFB944';
			}
			if (agency.name.toLowerCase() == 'wheels') {
				return '#02354C';
			}
			if (agency.name.toLowerCase() == 'dumbarton express') {
				return '#007AFF';
			}
			if (agency.name.toLowerCase() == 'vta') {
				if (route == 'Blue Line') {
					return '#2CB6E7';
				}
				if (route == 'Green Line') {
					return '#A1CF67';
				}
				if (route == 'Orange Line') {
					return '#F89923';
				}
				if (route.includes('Rapid')) {
					return '#E4002B';
				}
				return '#4CB4E7';
			}
			if (agency.name.toLowerCase() == 'soltrans') {
				if (route == 'R') {
					return '#D63029';
				}
				if (route == 'Y') {
					return '#FDB415';
				}
				if (route == 'G') {
					return '#50A140';
				}
				if (route == 'B') {
					return '#004D91';
				}
				return '#2C8736';
			}
			if (agency.name.toLowerCase() == 'the vine') {
				return '#E77342';
			}
			if (agency.name.toLowerCase() == 'sonoma county transit') {
				return '#193888';
			}
			if (agency.name.toLowerCase() == 'santa rosa citybus') {
				return '#035B91';
			}
			if (agency.name.toLowerCase() == 'sonoma marin area rail transit') {
				return '#104432';
			}
			if (agency.name.toLowerCase() == 'tri delta transit') {
				return '#004B8F';
			}
			if (agency.name.toLowerCase() == 'fairfield and suisun transit') {
				return '#064F8F';
			}
		}
		return '#424242';
	}

	const backgroundColor = $derived(getVehicleColor(vehicle, agency));

	function getDisplayName(vehicle: VehicleProps, routeInfo?: RouteInfo): string {
		if (routeNameToShortName[vehicle.route_short_name]) {
			return routeNameToShortName[vehicle.route_short_name];
		}
		if (vehicle.route_short_name.includes('Rapid')) {
			return vehicle.route_short_name.replace('Rapid', '');
		}
		if (routeInfo && routeInfo.route_short_name) {
			return routeInfo.route_short_name;
		}
		return vehicle.route_short_name || '?';
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
		'Orange Line'
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
