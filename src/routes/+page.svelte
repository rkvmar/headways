<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { createVehicleCanvasLayer } from '$lib/components/VehicleCanvasLayer';
	import TopBar from '$lib/components/TopBar.svelte';
	import VehiclePopup from '$lib/components/VehiclePopup.svelte';
	import StopPopup from '$lib/components/StopPopup.svelte';
	import { PUBLIC_API_BASE_URL } from '$env/static/public';
	import { graphqlRequest } from '$lib/graphql';
	import { getVehicleColorForAgency } from '$lib/utils/vehicleColors';
	import { titleCaseHeadsign } from '$lib/utils/strings';
	import { getReadableAgencyName } from '$lib/utils/agencyNames';
	import {
		startLiveActivity,
		updateLiveActivity,
		endLiveActivity,
		formatDeviation
	} from '$lib/liveActivities';
	import type { LiveActivityVehicle } from '$lib/liveActivities';

	let mapContainer: HTMLDivElement;
	let map: any;
	let L: any;
	let vehicleCanvasLayer: any;
	let updateInterval: NodeJS.Timeout;
	let agenciesInterval: NodeJS.Timeout;
	let agencies: Map<number, any> = new Map();
	let routes: Map<string, any> = new Map();
	let userLocationMarker: any;
	let currentTripLayers: any[] = [];
	let isLoadingTrip = false;
	let currentTripAbortController: AbortController | null = null;
	let searchQuery = $state('');
	let loading = $state(true);
	let allVehicles: TransitVehicle[] = $state([]);
	let lastFetchTime: number | null = $state(null); // epoch ms
	let selectedVehicle: TransitVehicle | null = $state(null);
	let isClosing = $state(false);
	let ledDestinationContainer: HTMLDivElement | null = null;
	let ledDestinationText: HTMLSpanElement | null = null;
	let shouldScroll = false;
	const PINNED_STORAGE_KEY = 'headways:pinned-vehicles';
	const SETTINGS_STORAGE_KEY = 'headways:settings';
	const DEFAULT_MAP_VIEW = { lat: 37.75063, lng: -122.43276, zoom: 10 };
	const MAX_PINNED_VEHICLES = 3;
	let pinnedVehicleIds: string[] = $state([]);
	let pinnedSnapshots: Record<string, PinnedVehicleSnapshot> = $state({});
	let pinDisabled = $derived(pinnedVehicleIds.length >= MAX_PINNED_VEHICLES);
	let pendingDeepLinkId: string | null = null;
	let pendingDeepLinkTimer: ReturnType<typeof setTimeout> | null = null;
	let settingsOpen = $state(false);
	let filtersOpen = $state(false);
	let enabledAgencies: Set<number> | null = $state(null); // null = all enabled
	let enabledRouteTypes: Set<number> | null = $state(null); // null = all enabled
	let colorMode: 'route' | 'timeliness' = $state('route');
	let apiBaseUrl = $state(PUBLIC_API_BASE_URL);
	let defaultLat = $state(DEFAULT_MAP_VIEW.lat);
	let defaultLng = $state(DEFAULT_MAP_VIEW.lng);
	let defaultZoom = $state(DEFAULT_MAP_VIEW.zoom);
	let hasSavedLocation = $state(false);
	let nowTick = $state(Date.now());
	let tripSchedule: any[] | null = $state(null);
	let activeTab: 'vehicles' | 'stops' = $state('vehicles');
	let allStops: {
		stop_id: string;
		stop_name: string;
		stop_lat: number;
		stop_lon: number;
		color: string;
	}[] = $state([]);
	let stopsLoaded = false;
	let stopsLoading = $state(false);
	let stopLayer: any = null;
	let selectedStop: any | null = $state(null);
	let stopDepartures: any[] | null = $state(null);
	let stopIsClosing = $state(false);

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
		trip_short_name: string;
		trip_headsign: string;
		lat: number;
		lon: number;
		timestamp: number;
	}

	async function fetchAgencies(): Promise<void> {
		const maxRetries = 3;
		const baseDelayMs = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const data = await graphqlRequest<{
					agencies: any[];
				}>(apiBaseUrl, `{ agencies { agency_id agency_name } }`);

				const agenciesData = data.agencies;

				agencies.clear();

				let nextNumericId = 1;

				for (const agency of agenciesData) {
					const agencyCode = agency.agency_id;
					const numericId = nextNumericId++;

					agencies.set(numericId, {
						id: numericId,
						code: agencyCode,
						name: agency.agency_name,
						short_name: agency.agency_id,
						color: '',
						text_color: ''
					});
				}

				return;
			} catch (error) {
				const isAbortError = error instanceof DOMException && error.name === 'AbortError';

				if (attempt === maxRetries) {
					const context = isAbortError
						? 'Request aborted — possible timeout or network interruption'
						: '';
					console.error(
						`Error fetching agencies data (attempt ${attempt}/${maxRetries}):`,
						error,
						context
					);
					return;
				}

				if (!isAbortError) {
					console.error(`Error fetching agencies data (attempt ${attempt}/${maxRetries}):`, error);
					return;
				}

				const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
				console.warn(
					`Agencies fetch aborted (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
				);
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}
		}
	}

	async function fetchRoutes(): Promise<void> {
		try {
			const data = await graphqlRequest<{ routes: any[] }>(
				apiBaseUrl,
				`{ routes { route_id route_short_name route_long_name route_type } }`
			);

			routes.clear();
			for (const route of data.routes) {
				if (route.route_id) {
					routes.set(route.route_id, route);
				}
			}
			updateVehicleMarkers(allVehicles);
		} catch (error) {
			console.error('Error fetching routes data:', error);
		}
	}

	async function fetchTransitData(): Promise<TransitVehicle[]> {
		try {
			const data = await graphqlRequest<{
				vehicleFeed: { fetchedAt: string; data: { entity: any[] } };
			}>(
				apiBaseUrl,
				`{ vehicleFeed { fetchedAt data { entity { id vehicle { trip { tripId routeId directionId delay tripInfoFound tripHeadsign serviceId shapeId blockId tripShortName } position { latitude longitude bearing speed } timestamp stopId currentStopSequence occupancyStatus stopName vehicle { id label } vehicleYear vehicleMake vehicleModel vehicleFuel vehicleLength vehicleIconCode routeShortName } } } } }`
			);

			const vehiclePositionsData = data.vehicleFeed.data;
			lastFetchTime = new Date(data.vehicleFeed.fetchedAt).getTime();

			const agencyCodeToNumericId = new Map<string, number>();
			for (const [numericId, agency] of agencies.entries()) {
				if (agency.code) {
					agencyCodeToNumericId.set(agency.code, numericId);
				}
			}

			const vehicles: TransitVehicle[] = [];

			if (!vehiclePositionsData || !vehiclePositionsData.entity) {
				console.error('Vehicle positions data has no entity array');
				return [];
			}

			for (const entity of vehiclePositionsData.entity) {
				const vehicle = entity.vehicle;
				if (!vehicle) continue;

				const trip = vehicle.trip;
				if (!trip || !trip.tripId || !trip.tripInfoFound) continue;

				const position = vehicle.position;
				if (!position || !position.latitude || !position.longitude) continue;

				const effectiveRouteId = trip.routeId;
				const agencyCode = effectiveRouteId?.split(':')[0] || trip.tripId?.split(':')[0];
				const numericAgencyId = agencyCodeToNumericId.get(agencyCode) || 1;

				const routeShortName = vehicle.routeShortName || effectiveRouteId?.split(':')[1] || '';

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
					deviation: trip.delay ?? 0,
					timestamp: vehicle.timestamp ? parseInt(vehicle.timestamp) : Date.now() / 1000,
					is_anomaly: false,
					next_stop_id: vehicle.stopId || '',
					next_stop_seq: vehicle.currentStopSequence || 0,
					next_stop_name: vehicle.stopName || '',
					current_headsign: trip.tripHeadsign || '',
					occupancy: vehicle.occupancyStatus || null,
					trip_type: '0',
					car_count: null,
					bearing: position.bearing || 0,
					speed: position.speed || 0,
					route_id: effectiveRouteId,
					trip_headsign: trip.tripHeadsign || '',
					service_id: trip.serviceId || '',
					direction_id: trip.directionId !== undefined ? trip.directionId : 0,
					block_id: trip.blockId || '',
					block_name: trip.blockId || null,
					route_short_name: routeShortName,
					shape_id: trip.shapeId || '',
					trip_start_timestamp: 0,
					trip_start_seq: 0,
					trip_end_seq: 0,
					trip_short_name: trip.tripShortName || '',
					min: 0,
					max: 0,
					year: vehicle.vehicleYear || 0,
					make: vehicle.vehicleMake || '',
					model: vehicle.vehicleModel || '',
					fuel: vehicle.vehicleFuel || '',
					length: vehicle.vehicleLength || 0,
					icon_code: vehicle.vehicleIconCode || '',
					short_headsign: trip.tripHeadsign || ''
				});
			}

			return vehicles;
		} catch (error) {
			console.error(
				'Error fetching transit data:',
				error,
				error instanceof Error ? error.name + ': ' + error.message : String(error)
			);
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

	function resetBlockScheduleState() {}

	function loadSettingsFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);

			const lat = Number(parsed?.defaultLat);
			const lng = Number(parsed?.defaultLng);
			const zoom = Number(parsed?.defaultZoom);

			if (!Number.isNaN(lat) && !Number.isNaN(lng) && !Number.isNaN(zoom)) {
				defaultLat = lat;
				defaultLng = lng;
				defaultZoom = zoom;
				hasSavedLocation = true;
			}

			if (parsed?.colorMode === 'route' || parsed?.colorMode === 'timeliness') {
				colorMode = parsed.colorMode;
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
					defaultLat,
					defaultLng,
					defaultZoom,
					colorMode
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
			trip_short_name: vehicle.trip_short_name,
			trip_headsign: vehicle.trip_headsign,
			lat: vehicle.lat,
			lon: vehicle.lon,
			timestamp: vehicle.timestamp
		};
	}

	function toLiveActivityVehicle(vehicle: TransitVehicle): LiveActivityVehicle {
		const agency = agencies.get(vehicle.agency);
		return {
			uniqueId: vehicle.unique_id,
			vehicleId: vehicle.vehicle_id,
			routeNumber: getDisplayName(vehicle, agency, routes.get(vehicle.route_id)),
			headsign: titleCaseHeadsign(vehicle.trip_headsign) || 'No destination',
			agencyName: getReadableAgencyName(agency?.name) || 'Unknown agency',
			nextStop: vehicle.next_stop_name || '—',
			deviationText: formatDeviation(vehicle.deviation),
			routeColorHex: getVehicleColorForAgency(vehicle.route_short_name, agency?.name)
		};
	}

	function loadPinnedVehiclesFromStorage() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(PINNED_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed?.ids)) {
				const trimmed = parsed.ids.slice(0, MAX_PINNED_VEHICLES);
				if (trimmed.length < parsed.ids.length) {
					for (const id of parsed.ids.slice(MAX_PINNED_VEHICLES)) {
						endLiveActivity(id);
					}
				}
				pinnedVehicleIds = trimmed;
			}
			if (parsed?.snapshots && typeof parsed.snapshots === 'object') {
				pinnedSnapshots = parsed.snapshots;
				for (const id of Object.keys(pinnedSnapshots)) {
					if (!pinnedVehicleIds.includes(id)) {
						const next = { ...pinnedSnapshots };
						delete next[id];
						pinnedSnapshots = next;
					}
				}
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
		endLiveActivity(uniqueId);
	}

	function togglePin(vehicle: TransitVehicle) {
		if (isPinned(vehicle)) {
			unpinVehicleById(vehicle.unique_id);
			return;
		}
		if (pinnedVehicleIds.length >= MAX_PINNED_VEHICLES) {
			return;
		}
		pinnedVehicleIds = [...pinnedVehicleIds, vehicle.unique_id];
		pinnedSnapshots = {
			...pinnedSnapshots,
			[vehicle.unique_id]: toPinnedSnapshot(vehicle)
		};
		persistPinnedVehicles();
		startLiveActivity(toLiveActivityVehicle(vehicle));
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
				updateLiveActivity(toLiveActivityVehicle(vehicle));
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

	// ponytail: pending until the feed shows the vehicle, else a cold-launch
	// deep link would open nothing; 30s ceiling so a vehicle that never
	// reappears doesn't pop a stale popup later.
	function tryOpenDeepLink() {
		const id = pendingDeepLinkId;
		if (!id) return;
		if (allVehicles.some((vehicle) => vehicle.unique_id === id)) {
			jumpToVehicleById(id);
			pendingDeepLinkId = null;
		}
	}

	function handleVehicleOpen(event: Event) {
		const uniqueId = (event as CustomEvent).detail?.uniqueId;
		if (typeof uniqueId !== 'string' || !uniqueId) return;
		pendingDeepLinkId = uniqueId;
		if (pendingDeepLinkTimer) clearTimeout(pendingDeepLinkTimer);
		pendingDeepLinkTimer = setTimeout(() => {
			pendingDeepLinkId = null;
		}, 30000);
		tryOpenDeepLink();
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
				KBUS: `${basePath}/muni-k.png`,
				L: `${basePath}/muni-l.png`,
				LBUS: `${basePath}/muni-l.png`,
				LOWL: `${basePath}/muni-l.png`,
				M: `${basePath}/muni-m.png`,
				N: `${basePath}/muni-n.png`,
				NBUS: `${basePath}/muni-n.png`,
				NOWL: `${basePath}/muni-n.png`,
				T: `${basePath}/muni-t.png`,
				TBUS: `${basePath}/muni-t.png`,
				F: `${basePath}/muni-f.png`,
				FBUS: `${basePath}/muni-f.png`
			},
			'ac transit': {
				'1T': `${basePath}/ac-tempo.png`
			},
			vta: {
				'Blue Line': `${basePath}/vta-blue.png`,
				'Green Line': `${basePath}/vta-green.png`,
				'Orange Line': `${basePath}/vta-orange.png`
			},
			'westcat (western contra costa)': {
				Lynx: `${basePath}/lynx.png`
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
			'livermore amador valley transit authority': `${basePath}/wheels.png`,
			'dumbarton express consortium': `${basePath}/dumbarton-express.png`,
			soltrans: `${basePath}/soltrans.png`,
			'vine transit': `${basePath}/the-vine.png`,
			santarosa: `${basePath}/citybus.svg`,
			'sonoma-marin area rail transit': `${basePath}/smart.png`,
			'tri delta transit': `${basePath}/tri-delta-transit.png`,
			fast: `${basePath}/fast.png`,
			'presidio go': `${basePath}/presidigo.png`,
			'westcat (western contra costa)': `${basePath}/westcat.png`,
			sonoma: `${basePath}/sct.png`,
			petaluma: `${basePath}/petaluma.jpg`,
			'vacaville city coach': `${basePath}/city-coach.png`,
			'marin transit': `${basePath}/marin.jpg`,
			'sfo airport': `${basePath}/sfo.png`,
			'altamont corridor express': `${basePath}/ace.png`,
			'capitol corridor joint powers authority': `${basePath}/capitol-corridor.jpg`,

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

	async function fetchTripData(agency: number, tripId: string, signal?: AbortSignal) {
		console.log(`Loading trip detail: trip_id=${tripId}, agency=${agency}`);
		try {
			const result = await graphqlRequest<{ tripDetail: any }>(
				apiBaseUrl,
				`query($tripId: String!) { tripDetail(tripId: $tripId) { trip_id route_id service_id trip_headsign direction_id shape_id block_id trip_short_name shape schedule { stop_id stop_sequence arrival_time departure_time stop_name stop_lat stop_lon } } }`,
				{ tripId },
				signal,
				120000
			);
			const data = result.tripDetail;
			if (!data || !data.trip_id) {
				console.warn(`Trip detail returned no data for trip_id=${tripId}`);
				return null;
			}

			const schedule = (data.schedule || []).map((st: any) => ({
				stop_id: st.stop_id,
				stop_name: st.stop_name || st.stop_id,
				stop_lat: st.stop_lat,
				stop_lon: st.stop_lon,
				arrival_time: st.arrival_time,
				departure_time: st.departure_time,
				stop_sequence: parseInt(st.stop_sequence),
				timepoint: st.timepoint === '1' || st.timepoint === 1
			}));

			const shape = (data.shape || []).map((c: [number, number]) => [c[0], c[1]]);

			console.log(
				`Trip detail loaded: trip_id=${tripId}, ${schedule.length} stops, ${shape.length} shape points`
			);

			return {
				trip_id: data.trip_id,
				route_id: data.route_id,
				service_id: data.service_id,
				trip_headsign: data.trip_headsign,
				direction_id: parseInt(data.direction_id),
				shape_id: data.shape_id,
				block_id: data.block_id,
				trip_short_name: data.trip_short_name,
				shape: shape,
				schedule: schedule
			};
		} catch (error) {
			const isAbort = error instanceof DOMException && error.name === 'AbortError';
			const isNetwork = error instanceof TypeError;
			if (isAbort) {
				if (!signal?.aborted) {
					console.error(`Trip detail timeout for trip_id=${tripId}: request exceeded 120s`);
				}
			} else if (isNetwork) {
				console.error(
					`Trip detail network error for trip_id=${tripId}: server unreachable or connection dropped`
				);
			} else {
				console.error(`Trip detail error for trip_id=${tripId}:`, error);
			}
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
		if (currentTripAbortController) {
			currentTripAbortController.abort();
			currentTripAbortController = null;
		}
		isLoadingTrip = false;
		selectedVehicle = vehicle;
		isClosing = false;
		resetBlockScheduleState();
		showTripRoute(vehicle);
	}

	function closeBottomSheet() {
		if (!selectedVehicle) return;
		isClosing = true;
		tripSchedule = null;
		clearTripLayers();
		resetBlockScheduleState();
		setTimeout(() => {
			if (!isClosing) return;
			selectedVehicle = null;
			isClosing = false;
		}, 200);
	}

	async function fetchShapeForVehicle(
		vehicle: TransitVehicle,
		signal?: AbortSignal
	): Promise<number[][]> {
		if (!vehicle.shape_id) return [];
		console.log(`Loading shape for shape_id=${vehicle.shape_id}, vehicle=${vehicle.vehicle_id}`);
		try {
			const result = await graphqlRequest<{ shape: number[][] }>(
				apiBaseUrl,
				`query($shapeId: String!) { shape(shapeId: $shapeId) }`,
				{ shapeId: vehicle.shape_id },
				signal
			);
			const data = result.shape;
			const coords = (data || []).map((c: number[]) => [c[0], c[1]]);
			console.log(`Shape loaded: shape_id=${vehicle.shape_id}, ${coords.length} points`);
			return coords;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				console.error(`Shape fetch error for shape_id=${vehicle.shape_id}:`, error);
			}
			return [];
		}
	}

	async function showTripRoute(vehicle: TransitVehicle) {
		if (!map || !L) return;

		currentTripAbortController = new AbortController();
		const signal = currentTripAbortController.signal;

		isLoadingTrip = true;
		clearTripLayers();

		try {
			const agency = agencies.get(vehicle.agency);
			const routeColor = getVehicleColorForAgency(vehicle.route_short_name, agency?.name);

			const shapePromise = fetchShapeForVehicle(vehicle, signal);
			const tripPromise = fetchTripData(vehicle.agency, vehicle.trip_id, signal);

			const shapeCoords = await shapePromise;
			if (shapeCoords.length > 0) {
				const routeLine = L.polyline(shapeCoords, {
					color: routeColor,
					weight: 5,
					opacity: 0.7
				}).addTo(map);
				currentTripLayers.push(routeLine);
			}

			const tripData = await tripPromise;

			tripSchedule = tripData?.schedule || null;

			if (shapeCoords.length === 0 && tripData?.shape && tripData.shape.length > 0) {
				const fallbackCoords = tripData.shape.map((point: number[]) => [point[0], point[1]]);
				if (fallbackCoords.length > 0) {
					const routeLine = L.polyline(fallbackCoords, {
						color: routeColor,
						weight: 5,
						opacity: 0.7
					}).addTo(map);
					currentTripLayers.push(routeLine);
				}
			}

			if (tripData?.schedule && tripData.schedule.length > 0) {
				const sortedSchedule = [...tripData.schedule].sort(
					(a: any, b: any) => a.stop_sequence - b.stop_sequence
				);
				const nextSeq = vehicle.next_stop_seq;

				sortedSchedule.forEach((stop: any, index: number) => {
					if (stop.stop_lat && stop.stop_lon) {
						const isFirstStop = index === 0;
						const isLastStop = index === sortedSchedule.length - 1;
						const isPassed = nextSeq > 0 && stop.stop_sequence < nextSeq;
						const markerSize = isFirstStop || isLastStop ? 22 : 18;
						const stopColor = isPassed ? '#9ca3af' : routeColor;
						const borderColor = isPassed ? '#9ca3af' : routeColor;

						const flagSvg = `<svg width="${markerSize - 8}" height="${markerSize - 8}" viewBox="0 0 24 24" fill="${encodeURIComponent(stopColor)}" xmlns="http://www.w3.org/2000/svg"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z"/></svg>`;

						const stopIcon = L.divIcon({
							className: 'stop-marker',
							html: `<div style="width:${markerSize}px;height:${markerSize}px;background:${isPassed ? '#f3f4f6' : 'white'};border:2px solid ${borderColor};display:flex;align-items:center;justify-content:center;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${flagSvg}</div>`,
							iconSize: [markerSize, markerSize],
							iconAnchor: [markerSize / 2, markerSize / 2]
						});

						const stopMarker = L.marker([stop.stop_lat, stop.stop_lon], {
							icon: stopIcon,
							zIndexOffset: 1000
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
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			console.error('Error showing trip route:', error);
		} finally {
			isLoadingTrip = false;
			if (currentTripAbortController?.signal.aborted) {
				currentTripAbortController = null;
			}
		}
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

	function matchesFilters(vehicle: TransitVehicle): boolean {
		if (enabledAgencies && !enabledAgencies.has(vehicle.agency)) return false;

		if (enabledRouteTypes) {
			const routeType = routes.get(vehicle.route_id)?.route_type;
			const parsedType = routeType != null ? parseInt(routeType) : null;
			if (parsedType != null && !enabledRouteTypes.has(parsedType)) return false;
		}

		return true;
	}

	function toggleAgency(agencyId: number) {
		if (!enabledAgencies) {
			const allEnabled = new Set<number>();
			for (const [id] of agencies) {
				allEnabled.add(id);
			}
			allEnabled.delete(agencyId);
			enabledAgencies = allEnabled;
		} else if (enabledAgencies.has(agencyId)) {
			if (enabledAgencies.size === 1) {
				enabledAgencies = null;
			} else {
				const next = new Set(enabledAgencies);
				next.delete(agencyId);
				enabledAgencies = next;
			}
		} else {
			const next = new Set(enabledAgencies);
			next.add(agencyId);
			enabledAgencies = next;
		}
		updateVehicleMarkers(allVehicles);
	}

	function toggleRouteType(routeType: number) {
		if (!enabledRouteTypes) {
			const allEnabled = new Set<number>();
			for (const typeStr of Object.keys(routeTypeNames)) {
				allEnabled.add(parseInt(typeStr));
			}
			allEnabled.delete(routeType);
			enabledRouteTypes = allEnabled;
		} else if (enabledRouteTypes.has(routeType)) {
			if (enabledRouteTypes.size === 1) {
				enabledRouteTypes = null;
			} else {
				const next = new Set(enabledRouteTypes);
				next.delete(routeType);
				enabledRouteTypes = next;
			}
		} else {
			const next = new Set(enabledRouteTypes);
			next.add(routeType);
			enabledRouteTypes = next;
		}
		updateVehicleMarkers(allVehicles);
	}

	function isAgencyEnabled(agencyId: number): boolean {
		return enabledAgencies === null || enabledAgencies.has(agencyId);
	}

	function isRouteTypeEnabled(routeType: number): boolean {
		return enabledRouteTypes === null || enabledRouteTypes.has(routeType);
	}

	const routeTypeNames: Record<number, string> = {
		0: 'Tram / Light Rail',
		1: 'Subway / Metro',
		2: 'Rail',
		3: 'Bus',
		4: 'Ferry',
		5: 'Cable Car'
	};

	function matchesSearch(vehicle: TransitVehicle): boolean {
		if (!searchQuery.trim()) return true;

		const query = searchQuery.toLowerCase();
		const agency = agencies.get(vehicle.agency);

		if (vehicle.route_short_name?.toLowerCase().includes(query)) return true;

		if (routes.get(vehicle.route_id)?.route_long_name?.toLowerCase().includes(query)) return true;

		if (vehicle.vehicle_id?.toString().toLowerCase().includes(query)) return true;

		if (agency?.name?.toLowerCase().includes(query)) return true;
		if (agency?.short_name?.toLowerCase().includes(query)) return true;

		if (vehicle.trip_headsign?.toLowerCase().includes(query)) return true;

		if (vehicle.make?.toLowerCase().includes(query)) return true;
		if (vehicle.model?.toLowerCase().includes(query)) return true;

		return false;
	}

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

	function isTrain(agency?: Agency): boolean {
		if (!agency?.name) return false;
		const name = agency.name.toLowerCase();
		return ['caltrain', 'sonoma-marin area rail transit', 'altamont corridor express'].includes(
			name
		);
	}

	function getDisplayName(v: TransitVehicle, agency?: Agency, routeInfo?: any): string {
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

	function updateVehicleMarkers(vehicles: TransitVehicle[]) {
		if (!vehicleCanvasLayer) return;

		const filtered = vehicles.filter((v) => matchesSearch(v) && matchesFilters(v));
		const canvasVehicles = filtered
			.filter((v) => v.lat && v.lon)
			.map((v) => ({
				unique_id: v.unique_id,
				lat: v.lat,
				lon: v.lon,
				backgroundColor:
					colorMode === 'timeliness'
						? getTimelinessColor(v.deviation)
						: getVehicleColorForAgency(v.route_short_name, agencies.get(v.agency)?.name),
				routeNumber: getDisplayName(v, agencies.get(v.agency), routes.get(v.route_id)),
				routeTooltip: routes.get(v.route_id)?.route_long_name
					? `${routes.get(v.route_id)?.route_short_name} - ${routes.get(v.route_id)?.route_long_name}`
					: v.route_short_name,
				agencyId: v.agency
			}));

		vehicleCanvasLayer.setVehicles(canvasVehicles);
	}

	async function updateTransitData() {
		const vehicles = await fetchTransitData();
		allVehicles = vehicles;
		updateVehicleMarkers(vehicles);
		refreshPinnedSnapshots(vehicles);
		nowTick = Date.now();
		tryOpenDeepLink();
	}

	function handleSearchInput() {
		updateVehicleMarkers(allVehicles);
		if (activeTab === 'stops') renderStopMarkers();
	}

	async function fetchStops(): Promise<void> {
		if (stopsLoaded || stopsLoading) return;
		stopsLoading = true;
		try {
			// Station groups: parent_station hubs merged, standalone stops as-is.
			const data = await graphqlRequest<{ stopGroups: any[] }>(
				apiBaseUrl,
				`{ stopGroups { group_id group_name stop_lat stop_lon route_id } }`
			);
			allStops = (data.stopGroups || [])
				.filter((s) => s.stop_lat && s.stop_lon)
				.map((s) => {
					const routeId = s.route_id || '';
					const sep = routeId.indexOf(':');
					const agencyCode = sep >= 0 ? routeId.slice(0, sep) : '';
					const routeShortName = sep >= 0 ? routeId.slice(sep + 1) : routeId;
					let agencyName: string | null = null;
					for (const a of agencies.values()) {
						if (a.code === agencyCode) {
							agencyName = a.name;
							break;
						}
					}
					return {
						stop_id: s.group_id,
						stop_name: s.group_name || s.group_id,
						stop_lat: parseFloat(s.stop_lat),
						stop_lon: parseFloat(s.stop_lon),
						color: getVehicleColorForAgency(routeShortName, agencyName)
					};
				});
			stopsLoaded = true;
			renderStopMarkers();
		} catch (error) {
			console.error('Error fetching stops:', error);
		} finally {
			stopsLoading = false;
		}
	}

	function matchesStopSearch(stop: { stop_id: string; stop_name: string }): boolean {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return true;
		return (
			stop.stop_name?.toLowerCase().includes(query) || stop.stop_id.toLowerCase().includes(query)
		);
	}

	function makeStopFlagIcon(color: string): any {
		const size = 18;
		const flagSvg = `<svg width="${size - 6}" height="${size - 6}" viewBox="0 0 24 24" fill="#111111" xmlns="http://www.w3.org/2000/svg"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z"/></svg>`;
		return L.divIcon({
			className: 'stop-flag-marker',
			html: `<div style="width:${size}px;height:${size}px;background:white;border:2px solid ${color};display:flex;align-items:center;justify-content:center;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${flagSvg}</div>`,
			iconSize: [size, size],
			iconAnchor: [size / 2, size / 2]
		});
	}

	function renderStopMarkers() {
		if (!map || !L || activeTab !== 'stops') return;
		if (!stopLayer) {
			stopLayer = L.layerGroup().addTo(map);
		}
		stopLayer.clearLayers();

		// ponytail: DOM flags can't handle all ~19k groups at once, so only
		// render what's on screen (search matches ignore bounds); raise the
		// cap or switch to a custom canvas icon if panning feels slow.
		const bounds = map.getBounds().pad(0.25);
		const hasQuery = !!searchQuery.trim();
		let count = 0;
		for (const stop of allStops) {
			if (count >= 1500) break;
			if (!matchesStopSearch(stop)) continue;
			if (!hasQuery && !bounds.contains([stop.stop_lat, stop.stop_lon])) continue;
			L.marker([stop.stop_lat, stop.stop_lon], { icon: makeStopFlagIcon(stop.color) })
				.on('click', () => selectStop(stop))
				.addTo(stopLayer);
			count++;
		}
	}

	async function selectStop(stop: {
		stop_id: string;
		stop_name: string;
		stop_lat: number;
		stop_lon: number;
	}) {
		if (!map || !L) return;
		selectedStop = stop;
		stopIsClosing = false;
		stopDepartures = null;
		try {
			const result = await graphqlRequest<{ stop: any }>(
				apiBaseUrl,
				`query($stopId: String!) { stop(stopId: $stopId) { stop_id stop_name departures { route_id route_short_name trip_headsign departure_time departure_timestamp } } }`,
				{ stopId: stop.stop_id }
			);
			const detail = result.stop;
			if (!detail || selectedStop?.stop_id !== stop.stop_id) return;
			if (detail.stop_name) selectedStop = { ...stop, stop_name: detail.stop_name };

			stopDepartures = (detail.departures || []).map((d: any) => {
				const routeCode = d.route_id?.split(':')[0] || '';
				let agencyName: string | null = null;
				for (const a of agencies.values()) {
					if (a.code === routeCode) {
						agencyName = a.name;
						break;
					}
				}
				return { ...d, color: getVehicleColorForAgency(d.route_short_name, agencyName) };
			});
		} catch (error) {
			console.error(`Error fetching departures for stop ${stop.stop_id}:`, error);
			if (selectedStop?.stop_id === stop.stop_id) stopDepartures = [];
		}
	}

	function closeStopSheet() {
		if (!selectedStop) return;
		stopIsClosing = true;
		setTimeout(() => {
			if (!stopIsClosing) return;
			selectedStop = null;
			stopIsClosing = false;
		}, 200);
	}

	function jumpToDepartureVehicle(d: any) {
		if (!map || !L) return;
		const vehicle = allVehicles.find((v) => v.trip_id === d.trip_id);
		if (!vehicle) return;
		setTab('vehicles');
		selectVehicle(vehicle);
		map.setView([vehicle.lat, vehicle.lon], Math.max(map.getZoom(), 15), { animate: true });
	}

	function setTab(tab: 'vehicles' | 'stops') {
		if (activeTab === tab || !map) return;
		activeTab = tab;
		closeBottomSheet();
		closeStopSheet();
		if (tab === 'stops') {
			map.removeLayer(vehicleCanvasLayer);
			fetchStops();
			renderStopMarkers();
		} else {
			if (stopLayer) stopLayer.clearLayers();
			map.addLayer(vehicleCanvasLayer);
		}
	}

	onMount(async () => {
		if (browser) {
			window.addEventListener('headways:vehicleOpen', handleVehicleOpen);
			loadPinnedVehiclesFromStorage();
			loadSettingsFromStorage();
			L = (await import('leaflet')).default;

			(window as any).L = L;
			// await import('projektpro-leaflet-smoothwheelzoom');

			map = L.map(mapContainer, {
				scrollWheelZoom: true,
				smoothSensitivity: 1
			}).setView([defaultLat, defaultLng], defaultZoom);

			vehicleCanvasLayer = new (createVehicleCanvasLayer(L))();
			vehicleCanvasLayer.onClick((id: string) => {
				const vehicle = allVehicles.find((v) => v.unique_id === id);
				if (vehicle) selectVehicle(vehicle);
			});
			map.addLayer(vehicleCanvasLayer);

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
				closeStopSheet();
			});

			map.on('moveend zoomend', () => {
				if (activeTab === 'stops') renderStopMarkers();
			});

			await fetchAgencies();
			agenciesInterval = setInterval(() => {
				fetchAgencies();
				fetchRoutes();
			}, 3600000);

			await updateTransitData();
			loading = false;
			updateInterval = setInterval(updateTransitData, 10000);

			// Rehydrate Live Activities for pinned vehicles across app launches
			// (the native plugin is idempotent by uniqueId).
			for (const pinnedId of pinnedVehicleIds) {
				const vehicle = allVehicles.find((v) => v.unique_id === pinnedId);
				if (vehicle) startLiveActivity(toLiveActivityVehicle(vehicle));
			}

			fetchRoutes();

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(position) => {
						const lat = position.coords.latitude;
						const lng = position.coords.longitude;
						if (!hasSavedLocation) {
							map.setView([lat, lng], 13);
						}
						if (userLocationMarker) map.removeLayer(userLocationMarker);
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

				navigator.geolocation.watchPosition(
					(position) => {
						const lat = position.coords.latitude;
						const lng = position.coords.longitude;
						if (userLocationMarker) {
							userLocationMarker.setLatLng([lat, lng]);
						} else {
							userLocationMarker = L.marker([lat, lng], {
								icon: createUserLocationIcon(),
								zIndexOffset: 1000
							}).addTo(map);
						}
					},
					(error) => {
						console.log('Geolocation watch error:', error.message);
					},
					{
						enableHighAccuracy: true,
						timeout: 10000,
						maximumAge: 5000
					}
				);
			}
		}
	});

	onDestroy(() => {
		if (!browser) return;
		window.removeEventListener('headways:vehicleOpen', handleVehicleOpen);
		if (pendingDeepLinkTimer) {
			clearTimeout(pendingDeepLinkTimer);
		}
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

		if (vehicleCanvasLayer && map) {
			map.removeLayer(vehicleCanvasLayer);
		}

		if (map) {
			map.remove();
		}
	});
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
	/>
	<link rel="manifest" href="./manifest.json" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="apple-mobile-web-app-title" content="Headways" />
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no"
	/>
	<link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon-180x180.png" />
	<link rel="apple-touch-icon" sizes="167x167" href="./apple-touch-icon-167x167.png" />
	<link rel="apple-touch-icon" sizes="152x152" href="./apple-touch-icon-152x152.png" />
	<link rel="apple-touch-icon" sizes="120x120" href="./apple-touch-icon-120x120.png" />
	<link rel="apple-touch-icon" href="./apple-touch-icon.png" />
	<meta name="theme-color" content="#2563eb" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content="Headways" />
	<meta name="format-detection" content="telephone=no" />
</svelte:head>

<div class="map-container">
	<TopBar
		bind:searchQuery
		{settingsOpen}
		{filtersOpen}
		onSearchInput={handleSearchInput}
		onToggleSettings={() => {
			settingsOpen = !settingsOpen;
			if (settingsOpen) filtersOpen = false;
		}}
		onToggleFilters={() => {
			filtersOpen = !filtersOpen;
			if (filtersOpen) settingsOpen = false;
		}}
	/>

	{#if settingsOpen}
		<div class="settings-panel">
			<h3 class="settings-title">Settings</h3>
			<!-- <div class="settings-group">
				<label class="settings-label" for="api-base">API Base URL</label>
				<input
					id="api-base"
					class="settings-input"
					type="text"
					bind:value={apiBaseUrl}
					placeholder="http://localhost:8080"
					onchange={handleApiBaseChange}
				/>
			</div> -->

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

	{#if filtersOpen}
		<div class="filters-panel">
			<h3 class="filters-title">Filters</h3>

			<div class="filters-group">
				<div class="filters-group-title">Color Vehicles</div>
				<label class="filter-radio">
					<input
						type="radio"
						name="colorMode"
						value="route"
						checked={colorMode === 'route'}
						onchange={() => {
							colorMode = 'route';
							persistSettings();
							updateVehicleMarkers(allVehicles);
						}}
					/>
					<span>By Route</span>
				</label>
				<label class="filter-radio">
					<input
						type="radio"
						name="colorMode"
						value="timeliness"
						checked={colorMode === 'timeliness'}
						onchange={() => {
							colorMode = 'timeliness';
							persistSettings();
							updateVehicleMarkers(allVehicles);
						}}
					/>
					<span>By Timeliness</span>
				</label>
			</div>

			<div class="filters-group">
				<div class="filters-group-title">Route Type</div>
				{#each Object.entries(routeTypeNames) as [typeStr, typeName]}
					{@const typeNum = parseInt(typeStr)}
					<label class="filter-checkbox">
						<input
							type="checkbox"
							checked={isRouteTypeEnabled(typeNum)}
							onchange={() => toggleRouteType(typeNum)}
						/>
						<span>{typeName}</span>
					</label>
				{/each}
			</div>

			<div class="filters-group">
				<div class="filters-group-title">Agency</div>
				{#each [...agencies.entries()] as [id, agency]}
					<label class="filter-checkbox">
						<input
							type="checkbox"
							checked={isAgencyEnabled(id)}
							onchange={() => toggleAgency(id)}
						/>
						<span>{getReadableAgencyName(agency.name)}</span>
					</label>
				{/each}
			</div>
		</div>
	{/if}

	<div bind:this={mapContainer} class="map"></div>

	<!-- <div class="view-switcher">
		<button class:active={activeTab === 'vehicles'} onclick={() => setTab('vehicles')}>
			<span class="material-symbols-outlined">directions_bus</span>Vehicles
		</button>
		<button class:active={activeTab === 'stops'} onclick={() => setTab('stops')}>
			<span class="material-symbols-outlined">signpost</span>Stops
		</button>
	</div> -->

	{#if loading}
		<div class="loading-overlay">
			<div class="spinner"></div>
			<div class="loading-text">Loading vehicles...</div>
		</div>
	{/if}

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
									{agency?.name?.toLowerCase() === 'caltrain' ||
									agency?.name?.toLowerCase() === 'sonoma-marin area rail transit'
										? (displayVehicle.trip_short_name || '').replace('Trip ', '') ||
											displayVehicle.route_short_name
										: displayVehicle.route_short_name || displayVehicle.vehicle_id}
								</div>
								<div class="pinned-headsign">
									{titleCaseHeadsign(displayVehicle.trip_headsign) || 'No destination'}
								</div>
								<div class="pinned-meta">
									<span>{getReadableAgencyName(agency?.name) || 'Unknown agency'}</span>
									{#if liveVehicle?.deviation != null}
										{@const d = liveVehicle.deviation}
										{@const absMin = Math.round(Math.abs(d) / 60)}
										<span
											class="pinned-deviation"
											class:late={d > 0}
											class:early={d < 0}
											class:on-time={d === 0}
										>
											{d === 0
												? 'On time'
												: d > 0
													? absMin === 0
														? 'Late'
														: `${absMin}m late`
													: absMin === 0
														? 'Early'
														: `${absMin}m early`}
										</span>
									{/if}
									<span class:stale={!liveVehicle}>{liveVehicle ? 'Live' : 'Last seen'}</span>
								</div>
							</button>
							<button
								class="pinned-remove"
								onclick={(e) => {
									e.stopPropagation();
									unpinVehicleById(pinnedId);
								}}
								aria-label="Unpin vehicle"
								><svg width="10" height="10" viewBox="0 0 10 10" fill="none"
									><path
										d="M1 1L9 9M9 1L1 9"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
									/></svg
								></button
							>
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
			{pinDisabled}
			{getAgencyLogo}
			{getVehicleColorForAgency}
			{pinnedVehicleIds}
			{togglePin}
			{closeBottomSheet}
			{formatTime}
			{hexToRgba}
			{tripSchedule}
			{lastFetchTime}
		/>
	{/if}

	<!-- {#if selectedStop}
		<StopPopup
			{selectedStop}
			departures={stopDepartures}
			isClosing={stopIsClosing}
			onClose={closeStopSheet}
			onDepartureClick={jumpToDepartureVehicle}
		/>
	{/if} -->
</div>

<style>
	.map-container {
		--top-bar-height: calc(56px + var(--s, env(safe-area-inset-top)));
		width: 100vw;
		height: 100vh;
		margin: 0;
		padding: 0;
		position: relative;
	}

	.settings-panel {
		position: absolute;
		top: calc(var(--top-bar-height) + 10px);
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

	.filters-panel {
		position: absolute;
		top: calc(var(--top-bar-height) + 10px);
		right: 12px;
		z-index: 1000;
		width: 240px;
		max-height: calc(100vh - 120px);
		overflow-y: auto;
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		padding: 12px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.filters-title {
		margin: 0 0 10px 0;
		font-size: 14px;
		font-weight: 700;
		color: #111827;
	}

	.filters-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 12px;
	}

	.filters-group:last-child {
		margin-bottom: 0;
	}

	.filters-group-title {
		font-size: 12px;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 2px;
	}

	.filter-checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #374151;
		cursor: pointer;
		padding: 3px 0;
	}

	.filter-checkbox input[type='checkbox'] {
		margin: 0;
		accent-color: #e24b4b;
	}

	.filter-radio {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #374151;
		cursor: pointer;
		padding: 3px 0;
	}

	.filter-radio input[type='radio'] {
		margin: 0;
		accent-color: #e24b4b;
	}

	.map {
		position: absolute;
		top: var(--top-bar-height);
		left: 0;
		right: 0;
		bottom: 0;
	}

	.view-switcher {
		position: absolute;
		bottom: calc(16px + env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		display: flex;
		background: white;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		padding: 4px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.view-switcher button {
		display: flex;
		align-items: center;
		gap: 6px;
		border: none;
		background: transparent;
		border-radius: 999px;
		padding: 8px 18px;
		font-size: 13px;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
	}

	.view-switcher button.active {
		background: #2563eb;
		color: white;
	}

	.view-switcher .material-symbols-outlined {
		font-size: 18px;
	}

	.pinned-panel {
		position: absolute;
		top: calc(var(--top-bar-height) + 10px);
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
		position: relative;
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

	.pinned-deviation.on-time {
		color: #059669;
	}

	.pinned-deviation.late {
		color: #dc2626;
	}

	.pinned-deviation.early {
		color: #2563eb;
	}

	.pinned-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		position: absolute;
		top: 4px;
		right: 4px;
		background: none;
		border: none;
		color: #9ca3af;
		border-radius: 50%;
		width: 20px;
		height: 20px;
		cursor: pointer;
		padding: 0;
		z-index: 1;
	}

	.pinned-remove:hover {
		background: rgba(0, 0, 0, 0.06);
		color: #374151;
	}

	.loading-overlay {
		position: absolute;
		top: var(--top-bar-height);
		left: 0;
		width: 100%;
		height: calc(100% - var(--top-bar-height));
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: rgba(243, 244, 246, 0.85);
		z-index: 9999;
		pointer-events: none;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #d1d5db;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.loading-text {
		margin-top: 12px;
		font-size: 14px;
		color: #6b7280;
		font-weight: 500;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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

	:global(.stop-marker) {
		background: transparent !important;
		border: none !important;
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

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
