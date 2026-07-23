<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { PUBLIC_API_BASE_URL } from '$env/static/public';
	import { titleCaseHeadsign, titleCase } from '$lib/utils/strings';
	import { getReadableAgencyName } from '$lib/utils/agencyNames';

	let {
		selectedVehicle = null,
		agencies,
		routes,
		isClosing = false,
		getAgencyLogo = () => null,
		getVehicleColorForAgency = () => '#e5e7eb',
		pinnedVehicleIds = [] as string[],
		togglePin = () => {},
		closeBottomSheet = () => {},
		formatTime = (time: string) => time,
		hexToRgba = (hex: string, alpha: number) => '',
		tripSchedule = null as any[] | null,
		lastFetchTime = null as number | null
	}: {
		selectedVehicle?: any | null;
		agencies: Map<number, any>;
		routes: Map<string, any>;
		isClosing?: boolean;
		getAgencyLogo?: (agency: any, vehicle: any) => string | null;
		getVehicleColorForAgency?: (routeShortName: string, agencyName?: string) => string;
		pinnedVehicleIds?: string[];
		togglePin?: (vehicle: any) => void;
		closeBottomSheet?: () => void;
		formatTime?: (time: string) => string;
		hexToRgba?: (hex: string, alpha: number) => string;
		tripSchedule?: any[] | null;
		lastFetchTime?: number | null;
	} = $props();

	let now = $state(Date.now());
	let relativeTimeInterval: NodeJS.Timeout;

	onMount(() => {
		relativeTimeInterval = setInterval(() => {
			now = Date.now();
		}, 1000);
	});

	onDestroy(() => {
		if (relativeTimeInterval) clearInterval(relativeTimeInterval);
	});

	let relativeTimeText = $derived.by(() => {
		if (lastFetchTime == null) return '';
		const elapsed = Math.floor((now - lastFetchTime) / 1000);
		if (elapsed < 5) return 'just now';
		if (elapsed < 60) return `${elapsed}s ago`;
		const mins = Math.floor(elapsed / 60);
		if (mins < 60) return mins === 1 ? '1m ago' : `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return hrs === 1 ? '1h ago' : `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return days === 1 ? '1d ago' : `${days}d ago`;
	});

	let vehicleImages: any[] = [];
	let imagesLoading = false;

	async function loadVehicleImages(vehicleId: string) {
		imagesLoading = true;
		try {
			const res = await fetch(
				`${PUBLIC_API_BASE_URL}/api/images/vehicle/${encodeURIComponent(vehicleId)}`
			);
			vehicleImages = res.ok ? await res.json() : [];
		} catch {
			vehicleImages = [];
		} finally {
			imagesLoading = false;
		}
	}

	$effect(() => {
		const vehicle = selectedVehicle;
		if (vehicle?.vehicle_id) {
			loadVehicleImages(vehicle.vehicle_id);
		} else {
			vehicleImages = [];
		}
	});

	let isStopsOpen = $state(false);

	// Trip origin and destination
	let tripOrigin = $derived('');
	let tripDestination = $derived(selectedVehicle?.trip_headsign || '');

	// Sort stops by sequence and determine next stop index
	let sortedStops = $derived(
		tripSchedule
			? [...tripSchedule].sort((a: any, b: any) => a.stop_sequence - b.stop_sequence)
			: []
	);

	let nextStopIndex = $derived.by(() => {
		if (!selectedVehicle?.next_stop_seq || !sortedStops.length) return -1;
		return sortedStops.findIndex((s: any) => s.stop_sequence === selectedVehicle.next_stop_seq);
	});

	let nextStopTime = $derived.by(() => {
		if (nextStopIndex < 0) return '';
		return sortedStops[nextStopIndex]?.arrival_time || '';
	});

	// Format deviation (delay in seconds) into a human-readable string
	let deviationText = $derived.by(() => {
		const d = selectedVehicle?.deviation;
		if (d == null) return '';
		if (d === 0) return 'On time';
		const absMin = Math.round(Math.abs(d) / 60);
		if (absMin === 0) return d > 0 ? 'Late' : 'Early';
		if (d > 0) return `${absMin}m late`;
		return `${absMin}m early`;
	});

	let deviationClass = $derived.by(() => {
		const d = selectedVehicle?.deviation;
		if (d == null) return '';
		if (d === 0) return 'on-time';
		if (d > 0) return 'late';
		return 'early';
	});
</script>

{#if selectedVehicle}
	{@const agency = agencies.get(selectedVehicle.agency)}
	{@const routeInfo = routes.get(selectedVehicle.route_id)}
	{@const agencyName = agency?.name?.toLowerCase() || ''}
	{@const isTrain =
		agencyName === 'caltrain' ||
		agencyName === 'sonoma-marin area rail transit' ||
		agencyName === 'sonoma marin area rail transit'}
	{@const routeShortName =
		isTrain && selectedVehicle.trip_short_name
			? selectedVehicle.trip_short_name.replace('Trip ', '')
			: selectedVehicle.route_short_name || ''}
	{@const routeLongName = routeInfo?.route_long_name ? titleCase(routeInfo.route_long_name) : ''}
	{@const headsign = titleCaseHeadsign(selectedVehicle.trip_headsign) || 'No destination'}
	{@const agencyLogo = getAgencyLogo(agency, selectedVehicle)}

	<div class="popup" class:closing={isClosing}>
		<div class="header">
			<div class="header-top">
				{#if agencyLogo}
					<div class="logo-container">
						<img src={agencyLogo} alt={agency?.name} class="agency-logo" />
					</div>
				{/if}
				<div class="header-text">
					<span class="route-short-name">{routeShortName}</span>
					{#if routeLongName}
						<div class="route-long-name">{routeLongName}</div>
					{/if}
					<div class="headsign">{headsign}</div>
					{#if relativeTimeText}
						<div class="data-age">{relativeTimeText}</div>
					{/if}
				</div>
				<div class="header-buttons">
					<button
						class="pin-button"
						onclick={() => togglePin(selectedVehicle)}
						aria-label={pinnedVehicleIds.includes(selectedVehicle.unique_id)
							? 'Unpin vehicle'
							: 'Pin vehicle'}
					>
						{pinnedVehicleIds.includes(selectedVehicle.unique_id) ? 'Unpin' : 'Pin'}
					</button>
					<button class="close-button" onclick={closeBottomSheet} aria-label="Close">×</button>
				</div>
			</div>
		</div>

		{#if selectedVehicle.next_stop_name}
			<button class="next-stop-header" onclick={() => (isStopsOpen = !isStopsOpen)}>
				<span class="next-stop-label">Next Stop</span>
				<span class="next-stop-value">
					<span class="next-stop-name">{selectedVehicle.next_stop_name}</span>
					{#if nextStopTime}
						<span class="next-stop-time">{nextStopTime}</span>
					{/if}
					<span class="next-stop-arrow" class:open={isStopsOpen}>▶</span>
				</span>
			</button>
		{/if}

		{#if isStopsOpen && sortedStops.length > 0}
			<div class="stops-list">
				{#each sortedStops as stop, i (stop.stop_id || i)}
					{@const isPassed = nextStopIndex >= 0 && i < nextStopIndex}
					{@const isNext = nextStopIndex >= 0 && i === nextStopIndex}
					<div class="stop-item" class:passed={isPassed} class:next={isNext}>
						<span class="stop-name">{stop.stop_name}</span>
						<span class="stop-time">{formatTime(stop.arrival_time)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="status-rows">
			{#if selectedVehicle.speed != null}
				<div class="detail-row">
					<span class="detail-label">Speed</span>
					<span class="detail-value">{Math.round(selectedVehicle.speed)} mph</span>
				</div>
			{/if}

			<div class="detail-row">
				<span class="detail-label">Status</span>
				<span class="detail-value {deviationClass}">{deviationText || 'No data'}</span>
			</div>
		</div>

		<div class="section-title">Photos</div>
		{#if imagesLoading}
			<div class="photo-placeholder">Loading...</div>
		{:else if vehicleImages.length > 0}
			{#each vehicleImages as img (img.id)}
				<div class="photo-entry">
					<a href={img.image_url} target="_blank" class="photo-link">
						<img src={img.image_url} alt={img.description || 'Vehicle photo'} loading="lazy" />
					</a>
					{#if img.attribution}
						<div class="photo-attribution">{img.attribution}</div>
					{/if}
				</div>
			{/each}
		{:else}
			<div class="photo-placeholder">No image</div>
		{/if}
		<div class="add-photo">
			<a
				href="/add-photo?vehicle_id={encodeURIComponent(
					selectedVehicle.vehicle_id
				)}&agency={encodeURIComponent(agency?.code || '')}"
				class="add-photo-link">Add Photo</a
			>
		</div>

		<div class="vehicle-info-box">
			<div class="section-title">Vehicle Info</div>
			<div class="detail-row">
				<span class="detail-label">Vehicle</span>
				<span class="detail-value">{selectedVehicle.vehicle_id}</span>
			</div>

			{#if agency}
				<div class="detail-row">
					<span class="detail-label">Agency</span>
					<span class="detail-value">{getReadableAgencyName(agency.name)}</span>
				</div>
			{/if}

			{#if selectedVehicle.make && selectedVehicle.model}
				<div class="detail-row">
					<span class="detail-label">Vehicle Type</span>
					<span class="detail-value"
						>{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</span
					>
				</div>
				{#if selectedVehicle.fuel}
					<div class="detail-row">
						<span class="detail-label">Fuel</span>
						<span class="detail-value">{selectedVehicle.fuel}</span>
					</div>
				{/if}
				{#if selectedVehicle.length}
					<div class="detail-row">
						<span class="detail-label">Length</span>
						<span class="detail-value">{selectedVehicle.length} ft</span>
					</div>
				{/if}
			{:else}
				<div class="detail-row">
					<span class="detail-label">Vehicle Type</span>
					<span class="detail-value unknown">Unknown</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.popup {
		position: fixed;
		top: 66px;
		bottom: 10px;
		left: 10px;
		width: 300px;
		background: white;
		border-radius: 16px;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
		z-index: 1001;
		padding: 20px;
		overflow-y: auto;
		animation: slideRight 0.2s ease-out;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.popup.closing {
		animation: slideLeft 0.2s ease-out;
	}

	@keyframes slideRight {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(0);
		}
	}

	@keyframes slideLeft {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(-100%);
		}
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

	@media (max-width: 800px) {
		.popup {
			top: auto;
			left: 0;
			bottom: 0;
			width: calc(100% - 40px);
			margin: 0 auto;
			max-height: 50vh;
			border-radius: 16px 16px 0 0;
			animation: slideUp 0.2s ease-out;
		}

		.popup.closing {
			animation: slideDown 0.2s ease-out;
		}

		.header-buttons {
			position: relative;
			top: auto;
			right: auto;
		}

		.header-top {
			flex-wrap: wrap;
		}

		.route-short-name {
			padding-right: 10px;
		}
	}

	.header {
		padding-bottom: 12px;
		/*border-bottom: 1px solid #e5e7eb;*/
		margin-bottom: 12px;
	}

	.header-top {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.logo-container {
		width: 80px;
		height: 50px;
		flex-shrink: 0;
	}

	.agency-logo {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.header-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.route-short-name {
		font-size: 24px;
		font-weight: 700;
		color: #111827;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		height: 32px;
		line-height: 32px;
		padding-right: 100px;
	}

	.route-long-name {
		font-size: 14px;
		font-weight: 500;
		color: #374151;
		/*word-wrap: break-word;*/
	}

	.headsign {
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		/*word-wrap: break-word;*/
	}

	.data-age {
		font-size: 11px;
		font-weight: 400;
		color: #9ca3af;
		margin-top: 2px;
	}

	.header-buttons {
		display: flex;
		flex-direction: row;
		align-items: flex-end;
		gap: 6px;
		flex-shrink: 0;
		position: absolute;
		top: 20px;
		right: 12px;
		height: 32px;
	}

	.pin-button {
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
		height: 32px;
	}

	.pin-button:hover {
		background: #1d4ed8;
	}

	.close-button {
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

	.vehicle-info-box {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 12px;
		margin-bottom: 12px;
	}

	.section-title {
		font-size: 14px;
		font-weight: 700;
		/*color: #9ca3af;*/
		/*text-transform: uppercase;*/
		/*letter-spacing: 0.05em;*/
		margin-bottom: 8px;
	}

	.trip-route {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		color: #111827;
		margin-bottom: 8px;
		white-space: nowrap;
		overflow: hidden;
	}

	.trip-endpoint {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trip-destination {
		color: #6b7280;
	}

	.trip-arrow {
		flex-shrink: 0;
		font-size: 11px;
		color: #9ca3af;
	}

	.next-stop-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: none;
		border: none;
		border-top: 1px solid #e5e7eb;
		padding: 10px 0;
		margin-top: 4px;
		cursor: pointer;
		color: inherit;
		font: inherit;
		white-space: nowrap;
		gap: 12px;
	}

	.next-stop-label {
		font-weight: 600;
		color: #6b7280;
		font-size: 14px;
		flex-shrink: 0;
	}

	.next-stop-value {
		font-weight: 500;
		color: #111827;
		font-size: 14px;
		text-align: right;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}

	.next-stop-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.next-stop-time {
		color: #9ca3af;
		font-size: 12px;
		font-weight: 400;
	}

	.next-stop-arrow {
		font-size: 10px;
		transition: transform 0.2s ease;
		color: #9ca3af;
	}

	.next-stop-arrow.open {
		transform: rotate(90deg);
	}

	.stops-list {
		display: flex;
		flex-direction: column;
		margin-top: 6px;
		max-height: 200px;
		overflow-y: auto;
		gap: 1px;
	}

	.stop-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px;
		font-size: 12px;
		border-radius: 4px;
	}

	.stop-item.passed {
		opacity: 0.45;
	}

	.stop-item.next {
		background: #eff6ff;
		font-weight: 600;
	}

	.stop-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stop-time {
		color: #6b7280;
		flex-shrink: 0;
		font-size: 11px;
	}

	.status-rows {
		border-top: 1px solid #e5e7eb;
		padding-top: 4px;
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
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.detail-time {
		color: #9ca3af;
		font-size: 12px;
		font-weight: 400;
	}

	.detail-value.on-time {
		color: #059669;
	}

	.detail-value.late {
		color: #dc2626;
	}

	.detail-value.early {
		color: #2563eb;
	}

	.detail-value.unknown {
		color: #9ca3af;
		font-style: italic;
	}

	.photo-placeholder {
		width: 100%;
		height: 160px;
		background: #e5e7eb;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #9ca3af;
		font-size: 13px;
		font-style: italic;
	}

	.photo-entry {
		margin-bottom: 8px;
	}

	.photo-link {
		display: block;
	}

	.photo-entry img {
		width: 100%;
		height: 160px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: #f3f4f6;
		transition: opacity 0.15s;
		display: block;
	}

	.photo-entry img:hover {
		opacity: 0.9;
	}

	.photo-attribution {
		font-size: 11px;
		color: #9ca3af;
		margin-top: 2px;
		font-style: italic;
	}

	.add-photo {
		margin-bottom: 6px;
	}

	.add-photo-link {
		color: #2563eb;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
	}

	.add-photo-link:hover {
		text-decoration: underline;
	}
</style>
