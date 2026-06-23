<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { mount } from 'svelte';
	import Vehicle from '$lib/components/Vehicle.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import VehiclePopup from '$lib/components/VehiclePopup.svelte';
	import { PUBLIC_API_BASE_URL } from '$env/static/public';
	import { getVehicleColorForAgency } from '$lib/utils/vehicleColors';
	import { titleCaseHeadsign } from '$lib/utils/strings';
	import { getReadableAgencyName } from '$lib/utils/agencyNames';

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
	let currentTripAbortController: AbortController | null = null;
	let agencyLayers: Map<number, any> = new Map(); // Map agency_id to layer group
	let searchQuery = $state('');
	let loading = $state(true);
	let allVehicles: TransitVehicle[] = $state([]);
	let lastFetchTime: number | null = $state(null); // epoch ms
	let selectedVehicle: TransitVehicle | null = $state(null);
	let isClosing = $state(false);
	let ledDestinationContainer: HTMLDivElement | null = null;
	let ledDestinationText: HTMLSpanElement | null = null;
	let shouldScroll = false;
	let stopsById: Map<string, string> = $state(new Map());
	const PINNED_STORAGE_KEY = 'headways:pinned-vehicles';
	const SETTINGS_STORAGE_KEY = 'headways:settings';
	const DEFAULT_MAP_VIEW = { lat: 37.75063, lng: -122.43276, zoom: 10 };
	let pinnedVehicleIds: string[] = $state([]);
	let pinnedSnapshots: Record<string, PinnedVehicleSnapshot> = $state({});
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

	async function fetchWithTimeout(
		url: string,
		signal: AbortSignal,
		timeoutMs = 30000
	): Promise<Response> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
		try {
			// Combine the timeout signal with any external signal
			const combinedSignal = signal.aborted
				? signal
				: combineAbortSignals(signal, controller.signal);
			return await fetch(url, { signal: combinedSignal });
		} finally {
			clearTimeout(timeoutId);
		}
	}

	function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
		const controller = new AbortController();
		for (const s of signals) {
			if (s.aborted) {
				controller.abort(s.reason);
				return controller.signal;
			}
			s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
		}
		return controller.signal;
	}

	async function fetchAgencies(): Promise<void> {
		const maxRetries = 3;
		const baseDelayMs = 1000;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const abortController = new AbortController();
				const [agenciesResponse, routesResponse, stopsResponse] = await Promise.all([
					fetchWithTimeout(`${apiBaseUrl}/datafeeds/agency`, abortController.signal),
					fetchWithTimeout(`${apiBaseUrl}/datafeeds/routes`, abortController.signal),
					fetchWithTimeout(`${apiBaseUrl}/datafeeds/stops`, abortController.signal)
				]);

				if (!agenciesResponse.ok || !routesResponse.ok) {
					throw new Error(
						`HTTP error! agencies: ${agenciesResponse.status}, routes: ${routesResponse.status}`
					);
				}

				const agenciesData = await agenciesResponse.json();
				const routesData = await routesResponse.json();
				const stopsData = stopsResponse.ok ? await stopsResponse.json() : [];

				stopsById.clear();
				for (const stop of stopsData) {
					if (stop.stop_id && stop.stop_name) {
						stopsById.set(stop.stop_id, stop.stop_name);
					}
				}

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
						agency_code: agencyCode,
						route_color: route.route_color,
						route_text_color: route.route_text_color,
						route_type: route.route_type,
						...route,
						agency_id: numericId
					});
				}

				// Success — exit retry loop
				return;
			} catch (error) {
				const isAbortError = error instanceof DOMException && error.name === 'AbortError';

				// On the last attempt, log the full error
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

				// Only retry on AbortError; for other errors (HTTP, parse) give up immediately
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

	async function fetchTransitData(): Promise<TransitVehicle[]> {
		try {
			const [vehiclePositionsResponse, tripsResponse] = await Promise.all([
				fetch(`${apiBaseUrl}/vehiclepositions`),
				fetch(`${apiBaseUrl}/datafeeds/trips`)
			]);

			if (!vehiclePositionsResponse.ok || !tripsResponse.ok) {
				throw new Error(
					`HTTP error! vehiclepositions: ${vehiclePositionsResponse.status}, trips: ${tripsResponse.status}`
				);
			}

			let vehiclePositionsData, tripsData;
			try {
				const parsed = await vehiclePositionsResponse.json();
				// Support both enveloped format ({ fetchedAt, data }) and raw feed
				if (parsed.data && parsed.fetchedAt) {
					lastFetchTime = new Date(parsed.fetchedAt).getTime();
					vehiclePositionsData = parsed.data;
				} else {
					lastFetchTime = Date.now();
					vehiclePositionsData = parsed;
				}
			} catch {
				console.error('Failed to parse vehicle positions JSON');
				return [];
			}
			try {
				tripsData = await tripsResponse.json();
			} catch {
				console.error('Failed to parse trips JSON');
				return [];
			}

			const tripMap = new Map<string, any>();
			const routeTripsMap = new Map<string, string[]>();
			for (const trip of tripsData) {
				tripMap.set(trip.trip_id, trip);
				// Build a route → trip_ids map for resolving inconsistent data
				if (trip.route_id && trip.trip_id) {
					const trips = routeTripsMap.get(trip.route_id);
					if (trips) {
						trips.push(trip.trip_id);
					} else {
						routeTripsMap.set(trip.route_id, [trip.trip_id]);
					}
				}
			}

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
				if (!trip || !trip.tripId) continue;

				const tripInfo = tripMap.get(trip.tripId);
				if (!tripInfo) continue;

				const position = vehicle.position;
				if (!position || !position.latitude || !position.longitude) continue;

				// Use the realtime feed's routeId as primary — 511.org's trip-to-route
				// mapping can be inconsistent (e.g. tripId maps to route U in static data
				// but routeId says 96). The realtime routeId reflects the actual assignment.
				const effectiveRouteId = trip.routeId || tripInfo.route_id;
				const agencyCode = effectiveRouteId?.split(':')[0] || trip.tripId?.split(':')[0];

				// If the realtime route differs from the static trip's route, the trip data
				// is unreliable for shape/schedule. Find a trip on the correct route instead.
				const effectiveTripId =
					trip.routeId && trip.routeId !== tripInfo.route_id
						? routeTripsMap.get(trip.routeId)?.[0] || trip.tripId
						: trip.tripId;
				const numericAgencyId = agencyCodeToNumericId.get(agencyCode) || 1;

				const routeInfo = routes.get(effectiveRouteId);
				const routeShortName = routeInfo?.route_short_name || effectiveRouteId?.split(':')[1] || '';

				const uniqueId = `${agencyCode}:${vehicle.vehicle?.id || entity.id}`;

				vehicles.push({
					op_agency: numericAgencyId,
					agency: numericAgencyId,
					agency_code: agencyCode,
					vehicle_id: vehicle.vehicle?.id || entity.id,
					unique_id: uniqueId,
					trip_id: effectiveTripId,
					lat: position.latitude,
					lon: position.longitude,
					deviation: vehicle.trip?.delay ?? 0,
					timestamp: vehicle.timestamp ? parseInt(vehicle.timestamp) : Date.now() / 1000,
					is_anomaly: false,
					next_stop_id: vehicle.stopId || '',
					next_stop_seq: vehicle.currentStopSequence || 0,
					next_stop_name: vehicle.stopName || stopsById.get(vehicle.stopId || '') || '',
					current_headsign: tripInfo.trip_headsign || '',
					occupancy: vehicle.occupancyStatus || null,
					trip_type: '0',
					car_count: null,
					bearing: position.bearing || 0,
					speed: position.speed || 0,
					route_id: effectiveRouteId,
					trip_headsign: tripInfo.trip_headsign || '',
					service_id: tripInfo.service_id || '',
					direction_id:
						trip.directionId !== undefined ? trip.directionId : tripInfo.direction_id || 0,
					block_id: tripInfo.block_id || '',
					block_name: tripInfo.block_id || null,
					route_short_name: routeShortName,
					shape_id:
						effectiveTripId !== trip.tripId
							? tripMap.get(effectiveTripId)?.shape_id || ''
							: tripInfo.shape_id || '',
					trip_start_timestamp: 0,
					trip_start_seq: 0,
					trip_end_seq: 0,
					trip_short_name: tripInfo.trip_short_name || '',
					min: 0,
					max: 0,
					year: vehicle.vehicleYear || 0,
					make: vehicle.vehicleMake || '',
					model: vehicle.vehicleModel || '',
					fuel: vehicle.vehicleFuel || '',
					length: vehicle.vehicleLength || 0,
					icon_code: vehicle.vehicleIconCode || '',
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
					apiBaseUrl,
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
			'sonoma marin area rail transit': `${basePath}/smart.png`,
			'tri delta transit': `${basePath}/tri-delta-transit.png`,
			'fairfield and suisun transit': `${basePath}/fast.png`,
			'presidio go': `${basePath}/presidigo.png`,
			'westcat (western contra costa)': `${basePath}/westcat.png`,
			sonoma: `${basePath}/sct.png`,
			petaluma: `${basePath}/petaluma.jpg`,
			vacaville: `${basePath}/city-coach.png`,
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
		const url = `${apiBaseUrl}/tripdetail?trip_id=${encodeURIComponent(tripId)}`;
		console.log(`Loading trip detail: trip_id=${tripId}, agency=${agency}, url=${url}`);
		try {
			const abortController = new AbortController();
			const combinedSignal = signal
				? combineAbortSignals(signal, abortController.signal)
				: abortController.signal;
			const response = await fetchWithTimeout(url, combinedSignal, 120000);
			if (!response.ok) {
				throw new Error(`HTTP error! tripdetail: ${response.status}`);
			}
			const data = await response.json();
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
				// Silent abort if cancelled by switching vehicles
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
		// Cancel any in-flight trip data loading
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
		isClosing = true;
		tripSchedule = null;
		clearTripLayers();
		resetBlockScheduleState();
		setTimeout(() => {
			selectedVehicle = null;
			isClosing = false;
		}, 200); // Match animation duration
	}

	async function fetchShapeForVehicle(
		vehicle: TransitVehicle,
		signal?: AbortSignal
	): Promise<number[][]> {
		if (!vehicle.shape_id) return [];
		console.log(`Loading shape for shape_id=${vehicle.shape_id}, vehicle=${vehicle.vehicle_id}`);
		try {
			const abortController = new AbortController();
			const combinedSignal = signal
				? combineAbortSignals(signal, abortController.signal)
				: abortController.signal;
			const response = await fetchWithTimeout(
				`${apiBaseUrl}/routeshapes?shape_id=${encodeURIComponent(vehicle.shape_id)}`,
				combinedSignal
			);
			if (!response.ok) {
				console.warn(
					`Shape fetch failed with status ${response.status} for shape_id=${vehicle.shape_id}`
				);
				return [];
			}
			const data = await response.json();
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

		// Create a new abort controller for this trip load
		currentTripAbortController = new AbortController();
		const signal = currentTripAbortController.signal;

		isLoadingTrip = true;
		clearTripLayers();

		try {
			// Get the route color for coloring the line and stop markers
			const agency = agencies.get(vehicle.agency);
			const routeColor = getVehicleColorForAgency(vehicle.route_short_name, agency?.name);

			// Start both fetches in parallel, passing the cancellation signal
			const shapePromise = fetchShapeForVehicle(vehicle, signal);
			const tripPromise = fetchTripData(vehicle.agency, vehicle.trip_id, signal);

			// Draw shape as soon as it arrives (don't wait for tripdetail)
			const shapeCoords = await shapePromise;
			if (shapeCoords.length > 0) {
				const routeLine = L.polyline(shapeCoords, {
					color: routeColor,
					weight: 5,
					opacity: 0.7
				}).addTo(map);
				currentTripLayers.push(routeLine);
			}

			// Wait for trip data for schedule (and fallback shape)
			const tripData = await tripPromise;

			tripSchedule = tripData?.schedule || null;

			// If shape didn't come from individual file, fall back to tripdata's embedded shape
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
				// Sort stops by sequence to determine passed vs upcoming
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
			// Ignore abort errors from switching vehicles
			if (error instanceof DOMException && error.name === 'AbortError') return;
			console.error('Error showing trip route:', error);
		} finally {
			isLoadingTrip = false;
			if (currentTripAbortController?.signal.aborted) {
				currentTripAbortController = null;
			}
		}
	}

	function createVehicleIcon(vehicle: TransitVehicle) {
		const tempDiv = document.createElement('div');
		const agency = agencies.get(vehicle.agency);

		const routeKey = vehicle.route_id;
		const routeInfo = routes.get(routeKey);

		if (!routeInfo && Math.random() < 0.01) {
			console.log(
				`Route not found for key: ${routeKey}, available keys:`,
				Array.from(routes.keys()).slice(0, 10)
			);
		}
		const vehicleComponent = mount(Vehicle, {
			target: tempDiv,
			props: { vehicle, agency, routeInfo, colorMode }
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

	function matchesFilters(vehicle: TransitVehicle): boolean {
		if (enabledAgencies && !enabledAgencies.has(vehicle.agency)) return false;

		if (enabledRouteTypes) {
			const routeInfo = routes.get(vehicle.route_id);
			const routeType = routeInfo?.route_type != null ? parseInt(routeInfo.route_type) : null;
			if (routeType != null && !enabledRouteTypes.has(routeType)) return false;
		}

		return true;
	}

	function toggleAgency(agencyId: number) {
		if (!enabledAgencies) {
			// Enable all agencies first, then disable this one
			const allEnabled = new Set<number>();
			for (const [id] of agencies) {
				allEnabled.add(id);
			}
			allEnabled.delete(agencyId);
			enabledAgencies = allEnabled;
		} else if (enabledAgencies.has(agencyId)) {
			if (enabledAgencies.size === 1) {
				enabledAgencies = null; // re-enable all
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
			// Enable all, then disable this one
			const allEnabled = new Set<number>();
			for (const [, route] of routes) {
				const rt = route.route_type != null ? parseInt(route.route_type) : null;
				if (rt != null) allEnabled.add(rt);
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
		const routeKey = vehicle.route_id;
		const routeInfo = routes.get(routeKey);

		if (vehicle.route_short_name?.toLowerCase().includes(query)) return true;

		if (routeInfo?.route_long_name?.toLowerCase().includes(query)) return true;

		if (vehicle.vehicle_id?.toString().toLowerCase().includes(query)) return true;

		if (agency?.name?.toLowerCase().includes(query)) return true;
		if (agency?.short_name?.toLowerCase().includes(query)) return true;

		if (vehicle.trip_headsign?.toLowerCase().includes(query)) return true;

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

		const filteredVehicles = vehicles.filter((v) => matchesSearch(v) && matchesFilters(v));
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
			// Refresh static GTFS data hourly — agencies, routes, stops barely change
			agenciesInterval = setInterval(fetchAgencies, 3600000);

			await updateTransitData();
			loading = false;
			// Refresh vehicle positions frequently (they move in real-time)
			updateInterval = setInterval(updateTransitData, 10000);

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
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
	/>
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
									agency?.name?.toLowerCase() === 'sonoma marin area rail transit'
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

	.filters-panel {
		position: absolute;
		top: 56px;
		right: 12px;
		z-index: 1000;
		width: 240px;
		max-height: calc(100vh - 80px);
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

	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
