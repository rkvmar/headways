<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { mount } from 'svelte';
	import Vehicle from '$lib/components/Vehicle.svelte';

	let mapContainer: HTMLDivElement;
	let map: any;
	let L: any;
	let vehicleMarkers: Map<string, any> = new Map();
	let updateInterval: NodeJS.Timeout;
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

	async function fetchAgencies(): Promise<void> {
		try {
			const response = await fetch('https://sfbay.pantographapp.com/agencies');
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

				// Create layer group for this agency if it doesn't exist
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
			const response = await fetch('https://sfbay.pantographapp.com/current');
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

	function getAgencyLogo(agency?: any, vehicle?: TransitVehicle): string | null {
		if (!agency || !agency.name) return null;

		const agencyName = agency.name.toLowerCase();
		const routeShortName = vehicle?.route_short_name;

		if (agencyName.toLowerCase() == 'san francisco muni') {
			if (routeShortName == 'J') {
				return '/agencyLogos/muni-j.png';
			}
			if (routeShortName == 'K') {
				return '/agencyLogos/muni-k.png';
			}
			if (routeShortName === 'L') {
				return '/agencyLogos/muni-l.png';
			}
			if (routeShortName === 'M') {
				return '/agencyLogos/muni-m.png';
			}
			if (routeShortName === 'N') {
				return '/agencyLogos/muni-n.png';
			}
			if (routeShortName === 'T') {
				return '/agencyLogos/muni-t.png';
			}
			if (routeShortName === 'F') {
				return '/agencyLogos/muni-f.png';
			}
			return '/agencyLogos/muni.png';
		}
		if (agencyName === 'samtrans') {
			return '/agencyLogos/samtrans.png';
		}
		if (agencyName === 'golden gate transit') {
			return '/agencyLogos/golden-gate-transit.png';
		}
		if (agencyName === 'caltrain') {
			return '/agencyLogos/caltrain.png';
		}
		if (agencyName === 'ac transit') {
			if (routeShortName === '1T') {
				return '/agencyLogos/ac-tempo.png';
			}
			return '/agencyLogos/ac-transit.png';
		}
		if (agencyName === 'san francisco bay ferries') {
			return '/agencyLogos/sf-bay-ferry.png';
		}
		if (agencyName === 'county connection') {
			return '/agencyLogos/county-connection.png';
		}
		if (agencyName === 'wheels') {
			return '/agencyLogos/wheels.png';
		}
		if (agencyName === 'dumbarton express') {
			return '/agencyLogos/dumbarton-express.png';
		}
		if (agencyName === 'vta') {
			if (routeShortName === 'Blue Line') {
				return '/agencyLogos/vta-blue.png';
			}
			if (routeShortName === 'Green Line') {
				return '/agencyLogos/vta-green.png';
			}
			if (routeShortName === 'Orange Line') {
				return '/agencyLogos/vta-orange.png';
			}
			return '/agencyLogos/vta.png';
		}
		if (agencyName === 'soltrans') {
			return '/agencyLogos/soltrans.png';
		}
		if (agencyName === 'the vine') {
			return '/agencyLogos/the-vine.png';
		}
		if (agencyName === 'sonoma county transit') {
			return '/agencyLogos/sonoma-county-transit.png';
		}
		if (agencyName === 'santa rosa citybus') {
			return '/agencyLogos/santa-rosa-citybus.png';
		}
		if (agencyName === 'sonoma marin area rail transit') {
			return '/agencyLogos/smart.png';
		}
		if (agencyName === 'tri delta transit') {
			return '/agencyLogos/tri-delta-transit.png';
		}
		if (agencyName === 'fairfield and suisun transit') {
			return '/agencyLogos/fast.png';
		}

		return null;
	}

	async function fetchTripData(agency: number, tripId: string) {
		try {
			const response = await fetch(
				`https://sfbay.pantographapp.com/schedules/trip/${agency}/${tripId}`
			);
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
		showTripRoute(vehicle);
	}

	function closeBottomSheet() {
		isClosing = true;
		clearTripLayers();
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
				opacity: 0.7,
				dashArray: '10, 5'
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

	function updateVehicleMarkers(vehicles: TransitVehicle[]) {
		if (!map || !L) {
			return;
		}

		const filteredVehicles = vehicles.filter(matchesSearch);
		const activeVehicles = new Set<string>();

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

				const marker = vehicleMarkers.get(vehicle.unique_id);
				const newPosition = [vehicle.lat, vehicle.lon];

				if (marker) {
					const currentPos = marker.getLatLng();
					const newPos = L.latLng(newPosition[0], newPosition[1]);

					const distance = currentPos.distanceTo(newPos);
					if (distance > 1) {
						animateMarkerToPosition(marker, newPos, 2500);
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
	}

	function handleSearchInput() {
		updateVehicleMarkers(allVehicles);
	}

	onMount(async () => {
		if (browser) {
			L = (await import('leaflet')).default;

			let defaultLat = 37.7749;
			let defaultLng = -122.4194;
			let defaultZoom = 10;

			map = L.map(mapContainer).setView([defaultLat, defaultLng], defaultZoom);

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

			await fetchAgencies();

			// Create layer control after agencies are loaded
			const overlays: Record<string, any> = {};
			agencyLayers.forEach((layer, agencyId) => {
				const agency = agencies.get(agencyId);
				if (agency) {
					overlays[agency.name] = layer;
				}
			});
			L.control.layers(null, overlays, { collapsed: true }).addTo(map);

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(position) => {
						const lat = position.coords.latitude;
						const lng = position.coords.longitude;
						map.setView([lat, lng], 13);

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
	<div bind:this={mapContainer} class="map"></div>
	
	{#if selectedVehicle}
		{@const agency = agencies.get(selectedVehicle.agency)}
		{@const routeInfo = routes.get(`${selectedVehicle.agency}:${selectedVehicle.route_id}`)}
		{@const routeDisplay = routeInfo && routeInfo.route_long_name
			? `${routeInfo.route_short_name} - ${routeInfo.route_long_name}`
			: selectedVehicle.route_short_name}
		{@const agencyLogo = getAgencyLogo(agency, selectedVehicle)}
		
		<div class="bottom-sheet" class:closing={isClosing}>
			<button class="close-button" onclick={closeBottomSheet} aria-label="Close">×</button>
			
			{#if agencyLogo}
				<div class="logo-container">
					<img src={agencyLogo} alt={agency?.name} class="agency-logo" />
				</div>
			{/if}
			
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
						<span class="detail-value">{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</span>
					</div>
				{/if}
				
				{#if selectedVehicle.speed}
					<div class="detail-row">
						<span class="detail-label">Speed:</span>
						<span class="detail-value">{Math.round(selectedVehicle.speed)} mph</span>
					</div>
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
		z-index: 1000;
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

	.search-input:focus {
		box-shadow: 0 2px 12px rgba(37, 99, 235, 0.3);
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
		max-height: 60vh;
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
	}
</style>
