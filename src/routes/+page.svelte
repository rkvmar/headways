<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { mount } from 'svelte';

	import Vehicle from '$lib/components/Vehicle.svelte';
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
	let apiBaseUrl = $state('https://sfbay.pantographapp.com');
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
		trip_start_time: string;
		trip_end_time: string;
		trip_headsign: string | null;
	}

	interface BlockScheduleResponse {
		block_info: BlockScheduleInfo;
		schedule: BlockScheduleEntry[];
		layover_times?: number[];
	}

	async function fetchAgencies(): Promise<void> {
		try {
			const response = await fetch(`${apiBaseUrl}/agencies`);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const data = await response.json();

			agencies.clear();
			routes.clear();

			for (const [agencyId, agencyData] of Object.entries(data)) {
				const id = parseInt(agencyId);
				agencies.set(id, {
					id,
					name: agencyData.full_name || agencyData.short_name,
					short_name: agencyData.short_name,
					color: agencyData.color_scheme?.default?.[0] || '',
					text_color: agencyData.color_scheme?.default?.[1] || '',
					...agencyData
				});

				if (L && map && !agencyLayers.has(id)) {
					const layerGroup = L.layerGroup().addTo(map);
					agencyLayers.set(id, layerGroup);
				}

				if (agencyData.routes && Array.isArray(agencyData.routes)) {
					for (const route of agencyData.routes) {
						if (route.route_id) {
							const routeKey = `${id}:${route.route_id}`;
							routes.set(routeKey, {
								route_id: route.route_id,
								route_short_name: route.route_short_name,
								route_long_name: route.route_long_name,
								agency_id: id,
								...route
							});
						}
					}
				}
			}
		} catch (error) {
			console.error('Error fetching agencies data:', error);
		}
	}

	async function fetchTransitData(): Promise<TransitVehicle[]> {
		try {
			const response = await fetch(`${apiBaseUrl}/current`);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const data = await response.json();
			const vehicles: TransitVehicle[] = data;
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
			const response = await fetch(
				`${apiBaseUrl}/schedules/block/${agency}/${encodeURIComponent(blockId)}?serviceID=${encodeURIComponent(serviceId)}`
			);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const data = await response.json();
			return data as BlockScheduleResponse;
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
			'san francisco muni': {
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
			'san francisco muni': `${basePath}/muni.png`,
			'ac transit': `${basePath}/ac-transit.png`,
			vta: `${basePath}/vta.png`,
			samtrans: `${basePath}/samtrans.png`,
			'golden gate transit': `${basePath}/golden-gate-transit.png`,
			caltrain: `${basePath}/caltrain.png`,
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
			const response = await fetch(`${apiBaseUrl}/schedules/trip/${agency}/${tripId}`);
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const data = await response.json();
			return data;
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

		const routeKey = `${vehicle.agency}:${vehicle.route_id}`;
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
		const routeKey = `${vehicle.agency}:${vehicle.route_id}`;
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
	<div class="search-container">
		<input
			type="text"
			bind:value={searchQuery}
			oninput={handleSearchInput}
			placeholder="Search routes, vehicles, agencies..."
			class="search-input"
		/>
	</div>

	<div class="settings-toggle">
		<button class="settings-button" onclick={() => (settingsOpen = !settingsOpen)}>
			{settingsOpen ? 'Close' : 'Settings'}
		</button>
	</div>

	{#if settingsOpen}
		<div class="settings-panel">
			<h3 class="settings-title">Settings</h3>
			<div class="settings-group">
				<label class="settings-label" for="api-region">API Region</label>
				<select
					id="api-region"
					class="settings-select"
					bind:value={apiBaseUrl}
					onchange={handleApiBaseChange}
				>
					<option value="https://sfbay.pantographapp.com">SF Bay</option>
					<option value="https://socal.pantographapp.com">SoCal</option>
				</select>
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
		{@const agency = agencies.get(selectedVehicle.agency)}
		{@const routeInfo = routes.get(`${selectedVehicle.agency}:${selectedVehicle.route_id}`)}
		{@const routeDisplay =
			routeInfo && routeInfo.route_long_name
				? `${routeInfo.route_short_name} - ${routeInfo.route_long_name}`
				: selectedVehicle.route_short_name}
		{@const ledNumber = selectedVehicle.route_short_name}
		{@const ledDestination = selectedVehicle.trip_headsign || 'No destination'}
		{@const agencyLogo = getAgencyLogo(agency, selectedVehicle)}

		<div class="bottom-sheet" class:closing={isClosing}>
			<button class="close-button" onclick={closeBottomSheet} aria-label="Close">×</button>
			<button
				class="pin-button"
				onclick={() => togglePin(selectedVehicle)}
				aria-label={isPinned(selectedVehicle) ? 'Unpin vehicle' : 'Pin vehicle'}
			>
				{isPinned(selectedVehicle) ? 'Unpin' : 'Pin'}
			</button>

			{#if agencyLogo}
				<div class="logo-container">
					<img src={agencyLogo} alt={agency?.name} class="agency-logo" />
				</div>
			{/if}

			<!-- <div class="led-display">
				<div class="led-number">{ledNumber}</div>
				<div class="led-destination" bind:this={ledDestinationContainer}>
					<div class="led-scroll" class:scrolling={shouldScroll}>
						<span class="led-scroll-text" bind:this={ledDestinationText}>{ledDestination}</span>
					</div>
				</div>
			</div> -->
			<div class="route-info">
				<h2 class="route-name">{routeDisplay}</h2>
				<h3 class="headsign">{selectedVehicle.trip_headsign || 'No destination'}</h3>
			</div>

			<div class="vehicle-details">
				<div class="detail-row">
					<span class="detail-label">Vehicle:</span>
					<span class="detail-value">{selectedVehicle.vehicle_id}</span>
				</div>

				{#if agency}
					<div class="detail-row">
						<span class="detail-label">Agency:</span>
						<span class="detail-value">{agency.name}</span>
					</div>
				{/if}

				{#if selectedVehicle.next_stop_name}
					<div class="detail-row">
						<span class="detail-label">Next Stop:</span>
						<span class="detail-value">{selectedVehicle.next_stop_name}</span>
					</div>
				{/if}

				{#if selectedVehicle.make && selectedVehicle.model}
					<div class="detail-row">
						<span class="detail-label">Vehicle Type:</span>
						<span class="detail-value"
							>{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</span
						>
					</div>
				{/if}

				{#if selectedVehicle.speed}
					<div class="detail-row">
						<span class="detail-label">Speed:</span>
						<span class="detail-value">{Math.round(selectedVehicle.speed)} mph</span>
					</div>
				{/if}
			</div>

			<div class="block-schedule">
				<div class="block-schedule-header">
					<h3 class="block-schedule-title">Block Schedule</h3>
					<button
						class="block-schedule-button"
						onclick={() => loadBlockScheduleForVehicle(selectedVehicle)}
						disabled={isLoadingBlockSchedule}
					>
						{isLoadingBlockSchedule ? 'Loading…' : blockSchedule ? 'Refresh' : 'Load'}
					</button>
				</div>
				{#if blockScheduleError}
					<div class="block-schedule-error">{blockScheduleError}</div>
				{/if}
				{#if blockSchedule && blockSchedule.schedule && blockSchedule.schedule.length > 0}
					<div class="block-schedule-list">
						{#each blockSchedule.schedule as entry, index (entry.trip_id)}
							{@const cardColor = getVehicleColorForAgency(entry.route_short_name, agency?.name)}
							{@const isActive = isCurrentBlock(
								entry,
								index,
								blockSchedule.schedule,
								blockSchedule.layover_times
							)}
							{@const tintColor = isActive ? hexToRgba(cardColor, 0.12) : ''}
							<div
								class="block-schedule-item"
								class:active={isActive}
								style={`border-left-color: ${cardColor};${isActive ? ' background-color: ' + tintColor + ';' : ''}`}
							>
								<div class="block-schedule-time">
									{formatTime(entry.trip_start_time)} → {formatTime(entry.trip_end_time)}
								</div>
								<div class="block-schedule-headsign">
									{entry.route_short_name}
									{entry.trip_headsign || ''}
								</div>
								<div class="block-schedule-stops">
									{entry.trip_start_stop_name} → {entry.trip_end_stop_name}
								</div>
							</div>
							{#if blockSchedule.layover_times && blockSchedule.layover_times[index] != null && index < blockSchedule.schedule.length - 1}
								<div class="block-schedule-layover-row">
									Layover: {formatLayoverSeconds(blockSchedule.layover_times[index])}
								</div>
							{/if}
						{/each}
					</div>
				{:else if isBlockScheduleOpen && !blockScheduleError && !isLoadingBlockSchedule}
					<div class="block-schedule-empty">No block schedule available.</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.map-container {
		width: 100vw;
		height: 100vh;
		margin: 0;
		padding: 0;
		position: relative;
	}

	.search-container {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1002;
		width: 90%;
		max-width: 400px;
	}

	.search-input {
		width: 100%;
		padding: 12px 16px;
		font-size: 16px;
		border: none;
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		outline: none;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.settings-toggle {
		position: absolute;
		bottom: 10px;
		left: 10px;
		z-index: 1000;
	}

	.settings-button {
		border: none;
		background: white;
		border-radius: 8px;
		padding: 8px 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		cursor: pointer;
		font-weight: 600;
		font-size: 12px;
	}

	.settings-panel {
		position: absolute;
		bottom: 52px;
		left: 10px;
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
		width: 100%;
		height: 100%;
	}

	.bottom-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: white;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
		z-index: 1001;
		padding: 20px;
		max-height: 45vh;
		overflow-y: auto;
		animation: slideUp 0.2s ease-out;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		transition: height 0.2s ease-out;
	}

	.bottom-sheet.closing {
		animation: slideDown 0.2s ease-out;
	}

	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes slideDown {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(100%);
		}
	}

	.close-button {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 32px;
		height: 32px;
		border: none;
		background: #f3f4f6;
		border-radius: 50%;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #6b7280;
		transition: background 0.2s;
		padding: 0;
		font-family: Arial, sans-serif;
	}

	.close-button:hover {
		background: #e5e7eb;
	}

	.logo-container {
		text-align: center;
		margin-bottom: 16px;
	}

	.agency-logo {
		max-width: 100%;
		max-height: 48px;
		width: auto;
		height: auto;
	}

	.route-info {
		margin-bottom: 20px;
		padding-bottom: 16px;
		border-bottom: 1px solid #e5e7eb;
	}
	@font-face {
		font-family: tenpixel;
		src: url('$lib/assets/BusMatrixCondensed.otf');
	}
	.led-display {
		width: 98%;
		height: 100px;
		background-color: #2d2b38;
		color: #ce8a37;
		font-family: tenpixel;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 12px;
		border-radius: 10px;
		overflow: hidden;
	}
	.led-number {
		font-size: 80px;
		line-height: 1;
		white-space: nowrap;
		flex: 0 0 auto;
	}
	.led-destination {
		flex: 1 1 auto;
		min-width: 0;
		font-size: 80px;
		line-height: 1;
	}
	.led-scroll {
		overflow: hidden;
		white-space: nowrap;
		position: relative;
	}
	.led-scroll-text {
		display: inline-block;
	}
	.led-scroll.scrolling .led-scroll-text {
		padding-left: 100%;
		animation: led-marquee 10s linear infinite;
	}
	@keyframes led-marquee {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-100%);
		}
	}

	.route-name {
		font-size: 24px;
		font-weight: 700;
		margin: 0 0 8px 0;
		color: #111827;
	}

	.headsign {
		font-size: 18px;
		font-weight: 500;
		margin: 0;
		color: #6b7280;
	}

	.vehicle-details {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
	}

	.detail-label {
		font-weight: 600;
		color: #6b7280;
		font-size: 14px;
	}

	.detail-value {
		font-weight: 500;
		color: #111827;
		font-size: 14px;
		text-align: right;
	}

	.block-schedule {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.block-schedule-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.block-schedule-title {
		margin: 0;
		font-size: 16px;
		font-weight: 700;
		color: #111827;
	}

	.block-schedule-button {
		border: none;
		background: #2563eb;
		color: white;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}

	.block-schedule-button:disabled {
		background: #93c5fd;
		cursor: default;
	}

	.block-schedule-error,
	.block-schedule-empty {
		font-size: 12px;
		color: #b45309;
		background: #fef3c7;
		border-radius: 8px;
		padding: 8px;
	}

	.block-schedule-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.block-schedule-item {
		padding: 10px;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
		border-left: 4px solid transparent;
		background: #f9fafb;
	}

	.block-schedule-item.active {
		background: transparent;
		box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.15);
	}

	.block-schedule-layover-row {
		margin: -4px 0 6px 0;
		font-size: 11px;
		font-weight: 600;
		color: #6b7280;
		padding-left: 6px;
	}

	.block-schedule-time {
		font-size: 13px;
		font-weight: 700;
		color: #111827;
	}

	.block-schedule-headsign {
		font-size: 12px;
		color: #374151;
		margin-top: 2px;
	}

	.block-schedule-stops {
		font-size: 11px;
		color: #6b7280;
		margin-top: 2px;
	}

	.pin-button {
		position: absolute;
		top: 12px;
		right: 52px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: #2563eb;
		color: white;
		border-radius: 999px;
		padding: 0 12px;
		font-size: 12px;
		line-height: 1;
		cursor: pointer;
		font-weight: 600;
	}

	.pin-button:hover {
		background: #1d4ed8;
	}

	.pinned-panel {
		position: absolute;
		top: 10px;
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
