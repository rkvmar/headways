<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { mount } from 'svelte';

	import Vehicle from '$lib/components/Vehicle.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import VehiclePopup from '$lib/components/VehiclePopup.svelte';
	import { getVehicleColorForAgency } from '$lib/utils/vehicleColors';

	let mapContainer: HTMLDivElement;
	let map: any;
	let L: any;
	let vehicleMarkers: Map<string, any> = new Map();
	let updateInterval: NodeJS.Timeout;
	let agenciesInterval: NodeJS.Timeout;
	let agencies: Map<number, any> = new Map();
	let routes: Map<string, any> = new Map(); // Map agency_id:route_id to route info
	let userLocationMarker: any;
	let currentTripLayers: any[] = []; // Store route shape and stop layers
	let isLoadingTrip = false;
	let agencyLayers: Map<number, any> = new Map(); // Map agency_id to layer group
	let searchQuery = $state('');
	let allVehicles: TransitVehicle[] = $state([]);
	let selectedVehicle: TransitVehicle | null = $state(null);
	let isClosing = $state(false);
	let ledDestinationContainer: HTMLDivElement | null = null;
	let ledDestinationText: HTMLSpanElement | null = null;
	let shouldScroll = false;
	const PINNED_STORAGE_KEY = 'headways:pinned-vehicles';
	const SETTINGS_STORAGE_KEY = 'headways:settings';
	const DEFAULT_MAP_VIEW = { lat: 37.7749, lng: -122.4194, zoom: 10 };
	let pinnedVehicleIds: string[] = $state([]);
	let pinnedSnapshots: Record<string, PinnedVehicleSnapshot> = $state({});
	let settingsOpen = $state(false);
	let apiBaseUrl = $state('http://localhost:8080');
	let defaultLat = $state(DEFAULT_MAP_VIEW.lat);
	let defaultLng = $state(DEFAULT_MAP_VIEW.lng);
	let defaultZoom = $state(DEFAULT_MAP_VIEW.zoom);
	let hasSavedLocation = $state(false);
	let nowTick = $state(Date.now());
	let blockSchedule: BlockScheduleResponse | null = $state(null);
	let isLoadingBlockSchedule = $state(false);
	let blockScheduleError = $state('');
	let isBlockScheduleOpen = $state(false);

	function updateLedScrollState() {
		if (!ledDestinationContainer || !ledDestinationText) return;
		shouldScroll = ledDestinationText.scrollWidth > ledDestinationContainer.clientWidth;
	}

	$effect(() => {
		updateLedScrollState();
	});

	interface TransitVehicle {
		op_agency: number;
		agency: number;
		agency_code: string;
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

	interface PinnedVehicleSnapshot {
		unique_id: string;
		vehicle_id: string;
		agency: number;
		route_id: string;
		route_short_name: string;
		trip_headsign: string;
		lat: number;
		lon: number;
		timestamp: number;
	}

	interface BlockScheduleInfo {
		op_agency: number;
		block_id: string;
		service_id: string;
		gtfs_timestamp: number;
	}

	interface BlockScheduleEntry {
		op_agency: number;
		gtfs_timestamp: number;
		trip_id: string;
		block_id: string;
		block_name: string | null;
		route_id: string;
		route_short_name: string;
		direction_id: number;
		trip_start_stop_id: string;
		trip_start_stop_name: string;
		trip_end_stop_id: string;
		trip_end_stop_name: string;
		shape_id: string;
		service_id: string;
		trip_short_name: string | null;
		wheelchair_accessible: number;
		bikes_allowed: number;
		trip_start_time?: string;
		trip_end_time?: string;
		trip_headsign: string | null;
	}

	interface BlockScheduleResponse {
		block_info: BlockScheduleInfo;
		schedule: BlockScheduleEntry[];
		layover_times?: number[];
	}

	async function fetchAgencies(): Promise<void> {
		try {
			const [agenciesResponse, routesResponse] = await Promise.all([
				fetch(`${apiBaseUrl}/datafeeds/agency`),
				fetch(`${apiBaseUrl}/datafeeds/routes`)
			]);

			if (!agenciesResponse.ok || !routesResponse.ok) {
				throw new Error(`HTTP error! agencies: ${agenciesResponse.status}, routes: ${routesResponse.status}`);
			}

			const agenciesData = await agenciesResponse.json();
			const routesData = await routesResponse.json();

			agencies.clear();
			routes.clear();

			const agencyIdMap = new Map<string, number>();
			let nextNumericId = 1;

			for (const agency of agenciesData) {
				const agencyCode = agency.agency_id;
				const numericId = nextNumericId++;
				agencyIdMap.set(agencyCode, numericId);

				agencies.set(numericId, {
					id: numericId,
					code: agencyCode,
					name: agency.agency_name,
					short_name: agency.agency_id,
					color: '',
					text_color: '',
					url: agency.agency_url,
					timezone: agency.agency_timezone,
					lang: agency.agency_lang,
					phone: agency.agency_phone,
					fare_url: agency.agency_fare_url,
					email: agency.agency_email
				});

				if (L && map && !agencyLayers.has(numericId)) {
					const layerGroup = L.layerGroup().addTo(map);
					agencyLayers.set(numericId, layerGroup);
				}
			}

			for (const route of routesData) {
				const agencyCode = route.agency_id;
				const numericId = agencyIdMap.get(agencyCode);
				if (!numericId) continue;

				const routeKey = route.route_id;
				routes.set(routeKey, {
					route_id: route.route_id,
					route_short_name: route.route_short_name,
					route_long_name: route.route_long_name,
					agency_id: numericId,
					agency_code: agencyCode,
					route_color: route.route_color,
					route_text_color: route.route_text_color,
					route_type: route.route_type,
					...route
				});
			}
		} catch (error) {
			console.error('Error fetching agencies data:', error);
		}
	}

	async function fetchTransitData(): Promise<TransitVehicle[]> {
		try {
			const [vehiclePositionsResponse, tripsResponse] = await Promise.all([
				fetch(`${apiBaseUrl}/vehiclepositions`),
				fetch(`${apiBaseUrl}/datafeeds/trips`)
			]);

			if (!vehiclePositionsResponse.ok || !tripsResponse.ok) {
				throw new Error(`HTTP error! vehiclepositions: ${vehiclePositionsResponse.status}, trips: ${tripsResponse.status}`);
			}

			const vehiclePositionsData = await vehiclePositionsResponse.json();
			const tripsData = await tripsResponse.json();

			const tripMap = new Map<string, any>();
			for (const trip of tripsData) {
				tripMap.set(trip.trip_id, trip);
			}

			const agencyCodeToNumericId = new Map<string, number>();
			for (const [numericId, agency] of agencies.entries()) {
				if (agency.code) {
					agencyCodeToNumericId.set(agency.code, numericId);
				}
			}

			const vehicles: TransitVehicle[] = [];

			for (const entity of vehiclePositionsData.entity || []) {
				const vehicle = entity.vehicle;
				if (!vehicle) continue;

				const trip = vehicle.trip;
				if (!trip || !trip.tripId) continue;

				const tripInfo = tripMap.get(trip.tripId);
				if (!tripInfo) continue;

				const position = vehicle.position;
				if (!position || !position.latitude || !position.longitude) continue;

				const agencyCode = tripInfo.route_id?.split(':')[0] || trip.tripId?.split(':')[0];
				const numericAgencyId = agencyCodeToNumericId.get(agencyCode) || 1;

				const routeInfo = routes.get(tripInfo.route_id || trip.routeId || '');
				const routeShortName = routeInfo?.route_short_name || tripInfo.route_id?.split(':')[1] || trip.routeId?.split(':')[1] || '';

				const uniqueId = `${agencyCode}:${vehicle.vehicle?.id || entity.id}`;

				vehicles.push({
					op_agency: numericAgencyId,
					agency: numericAgencyId,
					agency_code: agencyCode,
					vehicle_id: vehicle.vehicle?.id || entity.id,
					unique_id: uniqueId,
					trip_id: trip.tripId,
					lat: position.latitude,
					lon: position.longitude,
					deviation: 0,
					timestamp: vehicle.timestamp ? parseInt(vehicle.timestamp) : Date.now() / 1000,
					is_anomaly: false,
					next_stop_id: vehicle.stopId || '',
					next_stop_seq: vehicle.currentStopSequence || 0,
					next_stop_name: '',
					current_headsign: tripInfo.trip_headsign || '',
					occupancy: vehicle.occupancyStatus || null,
					trip_type: '0',
					car_count: null,
					bearing: position.bearing || 0,
					speed: position.speed || 0,
					route_id: tripInfo.route_id || trip.routeId || '',
					trip_headsign: tripInfo.trip_headsign || '',
					service_id: tripInfo.service_id || '',
					direction_id: trip.directionId !== undefined ? trip.directionId : tripInfo.direction_id || 0,
					block_id: tripInfo.block_id || '',
					block_name: tripInfo.block_id || null,
					route_short_name: routeShortName,
					shape_id: tripInfo.shape_id || '',
					trip_start_timestamp: 0,
					trip_start_seq: 0,
					trip_end_seq: 0,
					trip_short_name: tripInfo.trip_short_name || '',
					min: 0,
					max: 0,
					year: 0,
					make: '',
					model: '',
					fuel: '',
					length: 0,
					icon_code: '',
					short_headsign: tripInfo.trip_headsign || ''
				});
			}

			return vehicles;
		} catch (error) {
			console.error('Error fetching transit data:', error);
			return [];
		}
	}

	function formatTime(timeString: string): string {
		if (!timeString) return '';
		const parts = timeString.split(':');
		if (parts.length >= 2) {
			return `${parts[0]}:${parts[1]}`;
		}
		return timeString;
	}

	function formatLayoverSeconds(seconds: number): string {
		if (!Number.isFinite(seconds)) return '';
		if (seconds < 60) {
			return `${Math.round(seconds)} sec`;
		}
		const minutes = Math.round(seconds / 60);
		return `${minutes} min`;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '');
		if (normalized.length !== 3 && normalized.length !== 6) {
			return `rgba(0, 0, 0, ${alpha})`;
		}

		const hexValue =
			normalized.length === 3
				? normalized
						.split('')
						.map((value) => value + value)
						.join('')
				: normalized;

		const r = parseInt(hexValue.slice(0, 2), 16);
		const g = parseInt(hexValue.slice(2, 4), 16);
		const b = parseInt(hexValue.slice(4, 6), 16);

		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function timeToMinutes(timeValue: string): number | null {
		if (!timeValue) return null;
		const [hours, minutes, seconds] = timeValue.split(':').map(Number);
		if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
		const normalizedSeconds = Number.isFinite(seconds) ? seconds : 0;
		return hours * 60 + minutes + normalizedSeconds / 60;
	}

	function isCurrentBlock(
		entry: BlockScheduleEntry,
		index: number,
		schedule: BlockScheduleEntry[],
		layovers?: number[]
	): boolean {
		const startMinutes = timeToMinutes(entry.trip_start_time);
		const endMinutes = timeToMinutes(entry.trip_end_time);

		if (startMinutes == null || endMinutes == null) {
			return false;
		}

		const now = new Date(nowTick);
		const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

		const isWithinRange = (start: number, end: number) => {
			if (end < start) {
				return nowMinutes >= start || nowMinutes <= end;
			}
			return nowMinutes >= start && nowMinutes <= end;
		};

		if (isWithinRange(startMinutes, endMinutes)) {
			return true;
		}

		const layoverSeconds = layovers?.[index];
		if (Number.isFinite(layoverSeconds)) {
			const layoverMinutes = (layoverSeconds as number) / 60;
			const layoverEnd = (endMinutes + layoverMinutes) % 1440;
			return isWithinRange(endMinutes, layoverEnd);
		}

		const nextEntry = schedule[index + 1];
		if (nextEntry) {
			const nextStart = timeToMinutes(nextEntry.trip_start_time);
			if (nextStart != null) {
				return isWithinRange(endMinutes, nextStart);
			}
		}

		return false;
	}

	function resetBlockScheduleState() {
		blockSchedule = null;
		blockScheduleError = '';
		isLoadingBlockSchedule = false;
		isBlockScheduleOpen = false;
	}

	async function fetchBlockSchedule(agency: number, blockId: string, serviceId: string) {
		try {
			const tripsResponse = await fetch(`${apiBaseUrl}/datafeeds/trips`);
			if (!tripsResponse.ok) {
				throw new Error(`HTTP error! trips: ${tripsResponse.status}`);
			}
			const tripsData = await tripsResponse.json();

			const blockTrips = tripsData
				.filter((t: any) => t.block_id === blockId && t.service_id === serviceId)
				.sort((a: any, b: any) => {
					const aTime = timeToMinutes(a.trip_start_time || '00:00:00') || 0;
					const bTime = timeToMinutes(b.trip_start_time || '00:00:00') || 0;
					return aTime - bTime;
				});

			if (blockTrips.length === 0) return null;

			const schedule = blockTrips.map((trip: any) => ({
				op_agency: agency,
				gtfs_timestamp: Date.now(),
				trip_id: trip.trip_id,
				block_id: trip.block_id,
				block_name: trip.block_id,
				route_id: trip.route_id,
				route_short_name: trip.route_id?.split(':')[1] || '',
				direction_id: parseInt(trip.direction_id),
				trip_start_stop_id: '',
				trip_start_stop_name: '',
				trip_end_stop_id: '',
				trip_end_stop_name: '',
				shape_id: trip.shape_id,
				service_id: trip.service_id,
				trip_short_name: trip.trip_short_name,
				wheelchair_accessible: parseInt(trip.wheelchair_accessible || '0'),
				bikes_allowed: parseInt(trip.bikes_allowed || '0'),
				trip_start_time: trip.trip_start_time || '00:00:00',
				trip_end_time: trip.trip_end_time || '00:00:00',
				trip_headsign: trip.trip_headsign
			}));

			return {
				block_info: {
					op_agency: agency,
					block_id: blockId,
					service_id: serviceId,
					gtfs_timestamp: Date.now()
				},
				schedule: schedule,
				layover_times: []
			} as BlockScheduleResponse;
		} catch (error) {
			console.error('Error fetching block schedule:', error);
			return null;
		}
	}

	async function loadBlockScheduleForVehicle(vehicle: TransitVehicle) {
		blockScheduleError = '';
		isBlockScheduleOpen = true;

		if (!vehicle.block_id || !vehicle.service_id) {
			blockSchedule = null;
			blockScheduleError = 'Block schedule unavailable for this vehicle.';
			return;
		}

		isLoadingBlockSchedule = true;
		const data = await fetchBlockSchedule(vehicle.agency, vehicle.block_id, vehicle.service_id);
		isLoadingBlockSchedule = false;

		if (!data) {
			blockSchedule = null;
			blockScheduleError = 'Unable to load block schedule.';
			return;
		}

		blockSchedule = data;
	}

	function loadSettingsFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);

			if (typeof parsed?.apiBaseUrl === 'string') {
				apiBaseUrl = parsed.apiBaseUrl;
			}

			const lat = Number(parsed?.defaultLat);
			const lng = Number(parsed?.defaultLng);
			const zoom = Number(parsed?.defaultZoom);

			if (!Number.isNaN(lat) && !Number.isNaN(lng) && !Number.isNaN(zoom)) {
				defaultLat = lat;
				defaultLng = lng;
				defaultZoom = zoom;
				hasSavedLocation = true;
			}
		} catch (error) {
			console.warn('Failed to load settings from storage:', error);
		}
	}

	function persistSettings() {
		if (!browser) return;
		try {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({
					apiBaseUrl,
					defaultLat,
					defaultLng,
					defaultZoom
				})
			);
		} catch (error) {
			console.warn('Failed to persist settings:', error);
		}
	}

	function applyLocationSettings() {
		const lat = Number(defaultLat);
		const lng = Number(defaultLng);
		const zoom = Number(defaultZoom);

		if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(zoom)) return;

		defaultLat = lat;
		defaultLng = lng;
		defaultZoom = zoom;
		hasSavedLocation = true;

		persistSettings();

		if (map) {
			map.setView([lat, lng], zoom, { animate: true });
		}
	}

	function setDefaultLocationFromMap() {
		if (!map) return;
		const center = map.getCenter();
		defaultLat = Number(center.lat.toFixed(5));
		defaultLng = Number(center.lng.toFixed(5));
		defaultZoom = map.getZoom();
		hasSavedLocation = true;
		persistSettings();
	}

	async function handleApiBaseChange() {
		persistSettings();
		await fetchAgencies();
		await updateTransitData();
	}

	function toPinnedSnapshot(vehicle: TransitVehicle): PinnedVehicleSnapshot {
		return {
			unique_id: vehicle.unique_id,
			vehicle_id: vehicle.vehicle_id,
			agency: vehicle.agency,
			route_id: vehicle.route_id,
			route_short_name: vehicle.route_short_name,
			trip_headsign: vehicle.trip_headsign,
			lat: vehicle.lat,
			lon: vehicle.lon,
			timestamp: vehicle.timestamp
		};
	}

	function loadPinnedVehiclesFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(PINNED_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed?.ids)) {
				pinnedVehicleIds = parsed.ids;
			}
			if (parsed?.snapshots && typeof parsed.snapshots === 'object') {
				pinnedSnapshots = parsed.snapshots;
			}
		} catch (error) {
			console.warn('Failed to load pinned vehicles from storage:', error);
		}
	}

	function persistPinnedVehicles() {
		if (!browser) return;
		try {
			localStorage.setItem(
				PINNED_STORAGE_KEY,
				JSON.stringify({
					ids: pinnedVehicleIds,
					snapshots: pinnedSnapshots
				})
			);
		} catch (error) {
			console.warn('Failed to persist pinned vehicles:', error);
		}
	}

	function isPinned(vehicle: TransitVehicle): boolean {
		return pinnedVehicleIds.includes(vehicle.unique_id);
	}

	function unpinVehicleById(uniqueId: string) {
		pinnedVehicleIds = pinnedVehicleIds.filter((id) => id !== uniqueId);
		const nextSnapshots = { ...pinnedSnapshots };
		delete nextSnapshots[uniqueId];
		pinnedSnapshots = nextSnapshots;
		persistPinnedVehicles();
	}

	function togglePin(vehicle: TransitVehicle) {
		if (isPinned(vehicle)) {
			unpinVehicleById(vehicle.unique_id);
			return;
		}
		pinnedVehicleIds = [...pinnedVehicleIds, vehicle.unique_id];
		pinnedSnapshots = {
			...pinnedSnapshots,
			[vehicle.unique_id]: toPinnedSnapshot(vehicle)
		};
		persistPinnedVehicles();
	}

	function refreshPinnedSnapshots(vehicles: TransitVehicle[]) {
		if (pinnedVehicleIds.length === 0) return;
		const pinnedSet = new Set(pinnedVehicleIds);
		let nextSnapshots = { ...pinnedSnapshots };
		let didUpdate = false;

		for (const vehicle of vehicles) {
			if (pinnedSet.has(vehicle.unique_id)) {
				nextSnapshots[vehicle.unique_id] = toPinnedSnapshot(vehicle);
				didUpdate = true;
			}
		}

		if (didUpdate) {
			pinnedSnapshots = nextSnapshots;
			persistPinnedVehicles();
		}
	}

	function jumpToVehicleById(uniqueId: string) {
		if (!map) return;
		const liveVehicle = allVehicles.find((vehicle) => vehicle.unique_id === uniqueId);
		const snapshot = pinnedSnapshots[uniqueId];
		const target = liveVehicle || snapshot;

		if (!target || !target.lat || !target.lon) return;

		const targetLatLng = [target.lat, target.lon] as [number, number];
		const nextZoom = Math.max(map.getZoom(), 15);
		const size = map.getSize();
		const desiredPoint = L.point(size.x / 2, size.y * 0.25);
		const centerPoint = map
			.project(targetLatLng, nextZoom)
			.subtract(desiredPoint)
			.add(L.point(size.x / 2, size.y / 2));
		const centerLatLng = map.unproject(centerPoint, nextZoom);

		map.setView(centerLatLng, nextZoom, { animate: true });

		if (liveVehicle) {
			selectVehicle(liveVehicle);
		}
	}

	function getAgencyLogo(agency?: any, vehicle?: TransitVehicle): string | null {
		if (!agency || !agency.name) return null;

		const agencyName = agency.name.toLowerCase();
		const routeShortName = vehicle?.route_short_name;

		const regionKey = apiBaseUrl.includes('socal') ? 'socal' : 'sfbay';
		const basePath = `/agencyLogos/${regionKey}`;
		const agencyKey = agencyName.toLowerCase();
		const routeKey = routeShortName || '';

		const routeLogoMap: Record<string, Record<string, string>> = {
			'san francisco municipal transportation agency': {
				J: `${basePath}/muni-j.png`,
				K: `${basePath}/muni-k.png`,
				L: `${basePath}/muni-l.png`,
				M: `${basePath}/muni-m.png`,
				N: `${basePath}/muni-n.png`,
				T: `${basePath}/muni-t.png`,
				F: `${basePath}/muni-f.png`
			},
			'ac transit': {
				'1T': `${basePath}/ac-tempo.png`
			},
			vta: {
				'Blue Line': `${basePath}/vta-blue.png`,
				'Green Line': `${basePath}/vta-green.png`,
				'Orange Line': `${basePath}/vta-orange.png`
			},
			'san diego mts': {
				'Blue Line': `${basePath}/mts-blue.png`,
				'Green Line': `${basePath}/mts-green.png`,
				'Orange Line': `${basePath}/mts-orange.png`,
				Copper: `${basePath}/mts-copper.png`
			},
			'la metro': {
				'J Line': `${basePath}/metro-j.png`,
				'G Line': `${basePath}/metro-g.png`
			}
		};

		const agencyLogoMap: Record<string, string> = {
			//SFBAY
			'san francisco municipal transportation agency': `${basePath}/muni.png`,
			'ac transit': `${basePath}/ac-transit.png`,
			vta: `${basePath}/vta.png`,
			samtrans: `${basePath}/samtrans.png`,
			'golden gate ferry': `${basePath}/golden-gate-transit.png`,
			'golden gate transit': `${basePath}/golden-gate-transit.png`,
			caltrain: `${basePath}/caltrain.png`,
			'san francisco bay ferry': `${basePath}/sf-bay-ferry.png`,
			'san francisco bay ferries': `${basePath}/sf-bay-ferry.png`,
			'county connection': `${basePath}/county-connection.png`,
			wheels: `${basePath}/wheels.png`,
			'dumbarton express': `${basePath}/dumbarton-express.png`,
			soltrans: `${basePath}/soltrans.png`,
			'the vine': `${basePath}/the-vine.png`,
			'sonoma county transit': `${basePath}/sonoma-county-transit.png`,
			'santa rosa citybus': `${basePath}/santa-rosa-citybus.png`,
			'sonoma marin area rail transit': `${basePath}/smart.png`,
			'tri delta transit': `${basePath}/tri-delta-transit.png`,
			'fairfield and suisun transit': `${basePath}/fast.png`,
			'santa rosa citybus': `${basePath}/citybus.svg`,
			//SOCAL
			'san diego mts': `${basePath}/mts.png`,
			'north county transit district': `${basePath}/nctd.png`,
			'la metro': `${basePath}/lametro.png`,
			'foothill transit': `${basePath}/foothill-transit.png`,
			'pasadena transit': `${basePath}/pasadena-transit.png`
		};

		const routeMap = routeLogoMap[agencyKey];
		if (routeMap && routeKey && routeMap[routeKey]) {
			return routeMap[routeKey];
		}

		return agencyLogoMap[agencyKey] || null;
	}

	async function fetchTripData(agency: number, tripId: string) {
		try {
			const [tripsResponse, stopTimesResponse, shapesResponse, stopsResponse] = await Promise.all([
				fetch(`${apiBaseUrl}/datafeeds/trips`),
				fetch(`${apiBaseUrl}/datafeeds/stop_times`),
				fetch(`${apiBaseUrl}/datafeeds/shapes`),
				fetch(`${apiBaseUrl}/datafeeds/stops`)
			]);

			if (!tripsResponse.ok || !stopTimesResponse.ok || !shapesResponse.ok || !stopsResponse.ok) {
				throw new Error(`HTTP error! trips: ${tripsResponse.status}, stop_times: ${stopTimesResponse.status}, shapes: ${shapesResponse.status}, stops: ${stopsResponse.status}`);
			}

			const [tripsData, stopTimesData, shapesData, stopsData] = await Promise.all([
				tripsResponse.json(),
				stopTimesResponse.json(),
				shapesResponse.json(),
				stopsResponse.json()
			]);

			const trip = tripsData.find((t: any) => t.trip_id === tripId);
			if (!trip) return null;

			const stopTimes = stopTimesData
				.filter((st: any) => st.trip_id === tripId)
				.sort((a: any, b: any) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));

			const stopMap = new Map<string, any>();
			for (const stop of stopsData) {
				stopMap.set(stop.stop_id, stop);
			}

			const schedule = stopTimes.map((st: any) => {
				const stop = stopMap.get(st.stop_id);
				return {
					stop_id: st.stop_id,
					stop_name: stop?.stop_name || st.stop_id,
					stop_lat: stop?.stop_lat,
					stop_lon: stop?.stop_lon,
					arrival_time: st.arrival_time,
					departure_time: st.departure_time,
					stop_sequence: parseInt(st.stop_sequence),
					timepoint: st.timepoint === '1' || st.timepoint === 1
				};
			});

			const shapePoints = shapesData
				.filter((s: any) => s.shape_id === trip.shape_id)
				.sort((a: any, b: any) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence))
				.map((s: any) => [parseFloat(s.shape_pt_lat), parseFloat(s.shape_pt_lon)]);

			return {
				trip_id: trip.trip_id,
				route_id: trip.route_id,
				service_id: trip.service_id,
				trip_headsign: trip.trip_headsign,
				direction_id: parseInt(trip.direction_id),
				shape_id: trip.shape_id,
				block_id: trip.block_id,
				trip_short_name: trip.trip_short_name,
				shape: shapePoints,
				schedule: schedule
			};
		} catch (error) {
			console.error('Error fetching trip data:', error);
			return null;
		}
	}

	function clearTripLayers() {
		currentTripLayers.forEach((layer) => {
			if (map.hasLayer(layer)) {
				map.removeLayer(layer);
			}
		});
		currentTripLayers = [];
	}

	function selectVehicle(vehicle: TransitVehicle) {
		selectedVehicle = vehicle;
		isClosing = false;
		resetBlockScheduleState();
		showTripRoute(vehicle);
		loadBlockScheduleForVehicle(vehicle);
	}

	function closeBottomSheet() {
		isClosing = true;
		clearTripLayers();
		resetBlockScheduleState();
		setTimeout(() => {
			selectedVehicle = null;
			isClosing = false;
		}, 200); // Match animation duration
	}

	async function showTripRoute(vehicle: TransitVehicle) {
		if (!map || !L || isLoadingTrip) return;

		isLoadingTrip = true;

		clearTripLayers();

		const tripData = await fetchTripData(vehicle.agency, vehicle.trip_id);
		isLoadingTrip = false;

		if (!tripData) return;

		if (tripData.shape && tripData.shape.length > 0) {
			const routeCoords = tripData.shape.map((point: number[]) => [point[0], point[1]]);
			const routeLine = L.polyline(routeCoords, {
				color: '#2563eb',
				weight: 5,
				opacity: 0.7
			}).addTo(map);
			currentTripLayers.push(routeLine);
		}

		if (tripData.schedule && tripData.schedule.length > 0) {
			tripData.schedule.forEach((stop: any, index: number) => {
				if (stop.stop_lat && stop.stop_lon) {
					const isFirstStop = index === 0;
					const isLastStop = index === tripData.schedule.length - 1;

					const stopMarker = L.circleMarker([stop.stop_lat, stop.stop_lon], {
						radius: isFirstStop || isLastStop ? 6 : 4,
						fillColor: isFirstStop ? '#10b981' : isLastStop ? '#10b981' : '#f59e0b',
						color: isFirstStop ? '#059669' : isLastStop ? '#059669' : '#d97706',
						weight: 2,
						opacity: 1,
						fillOpacity: 0.9
					}).addTo(map);

					stopMarker.bindPopup(`
						<div style="font-family: sans-serif; font-size: 12px;">
							<strong>${stop.stop_name}</strong><br>
							${stop.arrival_time ? formatTime(stop.arrival_time) : ''}
							${stop.departure_time && stop.departure_time !== stop.arrival_time ? `<br>Departure: ${formatTime(stop.departure_time)}` : ''}
							${stop.timepoint ? '<br><em>Timepoint</em>' : ''}
						</div>
					`);

					currentTripLayers.push(stopMarker);
				}
			});
		}
	}

	function createVehicleIcon(vehicle: TransitVehicle) {
		const tempDiv = document.createElement('div');
		const agency = agencies.get(vehicle.agency);

		// route_id from trips is already in format "3D:370", routes map uses same format as key
		const routeKey = vehicle.route_id;
		const routeInfo = routes.get(routeKey);

		// Debug: log route lookup for troubleshooting
		if (!routeInfo && Math.random() < 0.01) {
			// Log 1% of missing routes to avoid spam
			console.log(
				`Route not found for key: ${routeKey}, available keys:`,
				Array.from(routes.keys()).slice(0, 10)
			);
		}
		const vehicleComponent = mount(Vehicle, {
			target: tempDiv,
			props: { vehicle, agency, routeInfo }
		});

		return L.divIcon({
			className: 'vehicle-marker',
			html: tempDiv.innerHTML,
			iconSize: [24, 24],
			iconAnchor: [12, 12]
		});
	}

	function createUserLocationIcon() {
		return L.divIcon({
			className: 'user-location-marker',
			html: `
				<div style="
					width: 16px;
					height: 16px;
					background: #2563eb;
					border: 3px solid white;
					border-radius: 50%;
					box-shadow: 0 0 10px rgba(37, 99, 235, 0.5);
				"></div>
			`,
			iconSize: [22, 22],
			iconAnchor: [11, 11]
		});
	}

	function animateMarkerToPosition(marker: any, newLatLng: any, duration = 2000) {
		const startLatLng = marker.getLatLng();
		const startTime = performance.now();

		function animate(currentTime: number) {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);

			const easedProgress = 1 - (1 - progress) * (1 - progress);

			const lat = startLatLng.lat + (newLatLng.lat - startLatLng.lat) * easedProgress;
			const lng = startLatLng.lng + (newLatLng.lng - startLatLng.lng) * easedProgress;

			marker.setLatLng([lat, lng]);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		}

		requestAnimationFrame(animate);
	}

	function matchesSearch(vehicle: TransitVehicle): boolean {
		if (!searchQuery.trim()) return true;

		const query = searchQuery.toLowerCase();
		const agency = agencies.get(vehicle.agency);
		const routeKey = vehicle.route_id;
		const routeInfo = routes.get(routeKey);

		// Check route short name
		if (vehicle.route_short_name?.toLowerCase().includes(query)) return true;

		// Check route long name
		if (routeInfo?.route_long_name?.toLowerCase().includes(query)) return true;

		// Check vehicle ID
		if (vehicle.vehicle_id?.toString().toLowerCase().includes(query)) return true;

		// Check agency name
		if (agency?.name?.toLowerCase().includes(query)) return true;
		if (agency?.short_name?.toLowerCase().includes(query)) return true;

		// Check headsign
		if (vehicle.trip_headsign?.toLowerCase().includes(query)) return true;

		// Check vehicle make and model
		if (vehicle.make?.toLowerCase().includes(query)) return true;
		if (vehicle.model?.toLowerCase().includes(query)) return true;

		return false;
	}

	function isVehicleInView(vehicle: TransitVehicle, bounds: any): boolean {
		if (!vehicle.lat || !vehicle.lon) return false;
		return bounds.contains(L.latLng(vehicle.lat, vehicle.lon));
	}

	function updateVehicleMarkers(vehicles: TransitVehicle[]) {
		if (!map || !L) {
			return;
		}

		const filteredVehicles = vehicles.filter(matchesSearch);
		const activeVehicles = new Set<string>();
		const bounds = map.getBounds();

		// Hide all markers first
		vehicleMarkers.forEach((marker, uniqueId) => {
			agencyLayers.forEach((layer) => {
				if (layer.hasLayer(marker)) {
					layer.removeLayer(marker);
				}
			});
		});

		filteredVehicles.forEach((vehicle) => {
			if (vehicle.lat && vehicle.lon) {
				activeVehicles.add(vehicle.unique_id);

				if (!isVehicleInView(vehicle, bounds)) {
					return;
				}

				const marker = vehicleMarkers.get(vehicle.unique_id);
				const newPosition = [vehicle.lat, vehicle.lon];

				if (marker) {
					const currentPos = marker.getLatLng();
					const newPos = L.latLng(newPosition[0], newPosition[1]);

					const distance = currentPos.distanceTo(newPos);
					if (distance > 1) {
						animateMarkerToPosition(marker, newPos, 2500);
					} else {
						marker.setLatLng(newPos);
					}

					marker.setIcon(createVehicleIcon(vehicle));

					// Update click handler for existing marker
					marker.off('click');
					marker.on('click', () => {
						selectVehicle(vehicle);
					});

					// Re-add to agency layer
					const agencyLayer = agencyLayers.get(vehicle.agency);
					if (agencyLayer && !agencyLayer.hasLayer(marker)) {
						agencyLayer.addLayer(marker);
					}
				} else {
					const newMarker = L.marker(newPosition, {
						icon: createVehicleIcon(vehicle)
					});

					newMarker.on('click', () => {
						selectVehicle(vehicle);
					});

					// Add marker to agency-specific layer
					const agencyLayer = agencyLayers.get(vehicle.agency);
					if (agencyLayer) {
						agencyLayer.addLayer(newMarker);
					}

					vehicleMarkers.set(vehicle.unique_id, newMarker);
				}
			}
		});
		for (const [uniqueId, marker] of vehicleMarkers.entries()) {
			if (!activeVehicles.has(uniqueId)) {
				// Remove from all layers
				agencyLayers.forEach((layer) => {
					if (layer.hasLayer(marker)) {
						layer.removeLayer(marker);
					}
				});
				vehicleMarkers.delete(uniqueId);
			}
		}
	}

	async function updateTransitData() {
		const vehicles = await fetchTransitData();
		allVehicles = vehicles;
		updateVehicleMarkers(vehicles);
		refreshPinnedSnapshots(vehicles);
		nowTick = Date.now();
	}

	function handleSearchInput() {
		updateVehicleMarkers(allVehicles);
	}

	onMount(async () => {
		if (browser) {
			loadPinnedVehiclesFromStorage();
			loadSettingsFromStorage();
			L = (await import('leaflet')).default;

			(window as any).L = L;
			// await import('projektpro-leaflet-smoothwheelzoom');

			map = L.map(mapContainer, {
				scrollWheelZoom: true,
				smoothSensitivity: 1
			}).setView([defaultLat, defaultLng], defaultZoom);

			// if (map.smoothWheelZoom) {
			// 	map.smoothWheelZoom.enable();
			// }

			L.tileLayer(
				'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png',
				{
					attribution:
						'&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
				}
			).addTo(map);

			map.on('click', () => {
				closeBottomSheet();
			});

			map.on('moveend zoomend', () => {
				updateVehicleMarkers(allVehicles);
			});

			await fetchAgencies();
			agenciesInterval = setInterval(fetchAgencies, 3000);

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(position) => {
						const lat = position.coords.latitude;
						const lng = position.coords.longitude;
						if (!hasSavedLocation) {
							map.setView([lat, lng], 13);
						}

						userLocationMarker = L.marker([lat, lng], {
							icon: createUserLocationIcon(),
							zIndexOffset: 1000
						}).addTo(map);
					},
					(error) => {
						console.log('Geolocation error:', error.message);
					},
					{
						enableHighAccuracy: true,
						timeout: 10000,
						maximumAge: 60000
					}
				);
			}

			await updateTransitData();
			updateInterval = setInterval(updateTransitData, 3000);
		}
	});

	onDestroy(() => {
		if (updateInterval) {
			clearInterval(updateInterval);
		}

		if (agenciesInterval) {
			clearInterval(agenciesInterval);
		}

		if (userLocationMarker) {
			map.removeLayer(userLocationMarker);
		}

		clearTripLayers();

		if (map) {
			map.remove();
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
	<link rel="manifest" href="/manifest.json" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="Headways" />
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no"
	/>
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180x180.png" />
	<link rel="apple-touch-icon" sizes="167x167" href="/apple-touch-icon-167x167.png" />
	<link rel="apple-touch-icon" sizes="152x152" href="/apple-touch-icon-152x152.png" />
	<link rel="apple-touch-icon" sizes="120x120" href="/apple-touch-icon-120x120.png" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#2563eb" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content="Headways" />
	<meta name="format-detection" content="telephone=no" />
</svelte:head>

<div class="map-container">
	<TopBar
		bind:searchQuery
		{settingsOpen}
		onSearchInput={handleSearchInput}
		onToggleSettings={() => (settingsOpen = !settingsOpen)}
	/>

	{#if settingsOpen}
		<div class="settings-panel">
			<h3 class="settings-title">Settings</h3>
			<div class="settings-group">
				<label class="settings-label" for="api-base">API Base URL</label>
				<input
					id="api-base"
					class="settings-input"
					type="text"
					bind:value={apiBaseUrl}
					placeholder="http://localhost:8080"
					onchange={handleApiBaseChange}
				/>
			</div>

			<div class="settings-group">
				<label class="settings-label">Default Map Location</label>
				<div class="settings-row">
					<input
						class="settings-input"
						type="number"
						step="0.00001"
						bind:value={defaultLat}
						placeholder="Latitude"
					/>
					<input
						class="settings-input"
						type="number"
						step="0.00001"
						bind:value={defaultLng}
						placeholder="Longitude"
					/>
				</div>
				<div class="settings-row">
					<input
						class="settings-input"
						type="number"
						step="1"
						bind:value={defaultZoom}
						placeholder="Zoom"
					/>
					<button class="settings-action" onclick={applyLocationSettings}>Apply</button>
				</div>
				<button class="settings-secondary" onclick={setDefaultLocationFromMap}>
					Use Current View
				</button>
			</div>
		</div>
	{/if}

	<div bind:this={mapContainer} class="map"></div>

	{#if pinnedVehicleIds.length > 0}
		<div class="pinned-panel">
			<h3 class="pinned-title">Pinned Vehicles</h3>
			<div class="pinned-list">
				{#each pinnedVehicleIds as pinnedId (pinnedId)}
					{@const liveVehicle = allVehicles.find((vehicle) => vehicle.unique_id === pinnedId)}
					{@const snapshot = pinnedSnapshots[pinnedId]}
					{@const displayVehicle = liveVehicle || snapshot}

					{#if displayVehicle}
						{@const agency = agencies.get(displayVehicle.agency)}
						{@const cardColor = getVehicleColorForAgency(
							displayVehicle.route_short_name,
							agency?.name
						)}
						<div class="pinned-item">
							<button
								class="pinned-main"
								style={`border-left-color: ${cardColor};`}
								onclick={() => jumpToVehicleById(pinnedId)}
							>
								<div class="pinned-vehicle">
									{displayVehicle.vehicle_id}
								</div>
								<div class="pinned-route">
									{displayVehicle.route_short_name || displayVehicle.vehicle_id}
								</div>
								<div class="pinned-headsign">
									{displayVehicle.trip_headsign || 'No destination'}
								</div>
								<div class="pinned-meta">
									<span>{agency?.short_name || agency?.name || 'Unknown agency'}</span>
									<span class:stale={!liveVehicle}>{liveVehicle ? 'Live' : 'Last seen'}</span>
								</div>
							</button>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	{#if selectedVehicle}
		<VehiclePopup
			{selectedVehicle}
			{agencies}
			{routes}
			{isClosing}
			{isLoadingBlockSchedule}
			{blockSchedule}
			{blockScheduleError}
			{isBlockScheduleOpen}
			{getAgencyLogo}
			{getVehicleColorForAgency}
			{isPinned}
			{togglePin}
			{closeBottomSheet}
			{loadBlockScheduleForVehicle}
			{formatTime}
			{formatLayoverSeconds}
			{isCurrentBlock}
			{hexToRgba}
		/>
	{/if}
</div>

<style>
	.map-container {
		--top-bar-height: 56px;
		width: 100vw;
		height: 100vh;
		margin: 0;
		padding: 0;
		position: relative;
	}

	.settings-panel {
		position: absolute;
		top: 56px;
		right: 12px;
		z-index: 1000;
		width: 260px;
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		padding: 12px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.settings-title {
		margin: 0 0 10px 0;
		font-size: 14px;
		font-weight: 700;
		color: #111827;
	}

	.settings-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
	}

	.settings-label {
		font-size: 12px;
		font-weight: 600;
		color: #6b7280;
	}

	.settings-select,
	.settings-input {
		width: 100%;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 8px;
		font-size: 12px;
		outline: none;
	}

	.settings-row {
		display: flex;
		gap: 8px;
	}

	.settings-action {
		border: none;
		background: #2563eb;
		color: white;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 12px;
		cursor: pointer;
		font-weight: 600;
		white-space: nowrap;
	}

	.settings-secondary {
		border: 1px solid #e5e7eb;
		background: #f9fafb;
		color: #111827;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 12px;
		cursor: pointer;
		font-weight: 600;
	}

	.map {
		position: absolute;
		top: var(--top-bar-height);
		left: 0;
		right: 0;
		bottom: 0;
	}

	.pinned-panel {
		position: absolute;
		top: 66px;
		right: 10px;
		z-index: 1000;
		width: 260px;
		max-height: 50vh;
		overflow-y: auto;
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		padding: 10px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	@media (max-width: 1000px) {
		.pinned-panel {
			top: 64px;
			right: 8px;
			width: 220px;
			max-height: 40vh;
		}
	}

	.pinned-title {
		margin: 0 0 8px 0;
		font-size: 14px;
		font-weight: 700;
		color: #111827;
	}

	.pinned-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.pinned-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.pinned-main {
		flex: 1 1 auto;
		text-align: left;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-left: 4px solid transparent;
		border-radius: 10px;
		padding: 8px;
		cursor: pointer;
	}

	.pinned-route {
		font-size: 14px;
		font-weight: 700;
		color: #111827;
	}
	.pinned-vehicle {
		font-size: 14px;
		font-weight: 700;
		color: #111827;
	}

	.pinned-headsign {
		font-size: 12px;
		color: #6b7280;
	}

	.pinned-meta {
		margin-top: 4px;
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: #9ca3af;
	}

	.pinned-meta .stale {
		color: #f59e0b;
		font-weight: 600;
	}

	.pinned-remove {
		background: #fee2e2;
		border: 1px solid #fecaca;
		color: #991b1b;
		border-radius: 8px;
		padding: 6px 8px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 700;
	}

	:global(.leaflet-container) {
		height: 100%;
		width: 100%;
	}

	:global(.vehicle-marker) {
		background: transparent !important;
		border: none !important;
	}

	:global(.user-location-marker) {
		background: transparent !important;
		border: none !important;
		z-index: 1000 !important;
	}

	:global(.leaflet-popup-content) {
		margin: 8px 12px !important;
	}

	:global(.leaflet-popup-content h2) {
		margin: 0 !important;
	}

	:global(.leaflet-popup-content h3) {
		margin: 0 !important;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
