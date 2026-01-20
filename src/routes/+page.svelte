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
				return '/agencyLogos/muni-t.png';
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

	function updateVehicleMarkers(vehicles: TransitVehicle[]) {
		if (!map || !L) {
			return;
		}

		const activeVehicles = new Set<string>();

		vehicles.forEach((vehicle) => {
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
						showTripRoute(vehicle);
					});
				} else {
					const newMarker = L.marker(newPosition, {
						icon: createVehicleIcon(vehicle)
					}).addTo(map);

					// Add popup with vehicle info
					const agency = agencies.get(vehicle.agency);
					const routeInfo = routes.get(`${vehicle.agency}:${vehicle.route_id}`);
					const routeDisplay =
						routeInfo && routeInfo.route_long_name
							? `${routeInfo.route_short_name} - ${routeInfo.route_long_name}`
							: vehicle.route_short_name;
					const agencyLogo = getAgencyLogo(agency, vehicle);
					const logoHtml = agencyLogo
						? `<div style="text-align: left;"><img src="${agencyLogo}" alt="${agency.name}" style="max-width: 100%; max-height: 36px; width: auto; height: auto;"></div>`
						: '';

					newMarker.bindPopup(`
						<div style="font-family: sans-serif; font-size: 12px;">
							${logoHtml}
							<h2>${routeDisplay}</h2>
							<h3>${vehicle.trip_headsign || 'No destination'}</h3>
							Vehicle: ${vehicle.vehicle_id}<br>
							${vehicle.next_stop_name ? `Next: ${vehicle.next_stop_name}` : ''}
							${vehicle.make && vehicle.model ? `<br>${vehicle.year} ${vehicle.make} ${vehicle.model}` : ''}
						</div>
					`);

					newMarker.on('click', () => {
						showTripRoute(vehicle);
					});

					vehicleMarkers.set(vehicle.unique_id, newMarker);
				}
			}
		});
		for (const [uniqueId, marker] of vehicleMarkers.entries()) {
			if (!activeVehicles.has(uniqueId)) {
				map.removeLayer(marker);
				vehicleMarkers.delete(uniqueId);
			}
		}
	}

	async function updateTransitData() {
		const vehicles = await fetchTransitData();
		updateVehicleMarkers(vehicles);
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
				clearTripLayers();
			});

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

			await fetchAgencies();
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
	<link
		rel="apple-touch-icon"
		sizes="180x180"
		href="AppIcons/Assets.xcassets/AppIcon.appiconset/180.png"
	/>
	<link
		rel="apple-touch-icon"
		sizes="167x167"
		href="AppIcons/Assets.xcassets/AppIcon.appiconset/167.png"
	/>
	<link
		rel="apple-touch-icon"
		sizes="152x152"
		href="AppIcons/Assets.xcassets/AppIcon.appiconset/152.png"
	/>
	<link
		rel="apple-touch-icon"
		sizes="120x120"
		href="AppIcons/Assets.xcassets/AppIcon.appiconset/120.png"
	/>
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" content="#2563eb" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="application-name" content="Headways" />
	<meta name="format-detection" content="telephone=no" />
</svelte:head>

<div class="map-container">
	<div bind:this={mapContainer} class="map"></div>
</div>

<style>
	.map-container {
		width: 100vw;
		height: 100vh;
		margin: 0;
		padding: 0;
	}

	.map {
		width: 100%;
		height: 100%;
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
