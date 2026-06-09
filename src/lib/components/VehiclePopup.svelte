<script lang="ts">
	import { titleCaseHeadsign, titleCase } from '$lib/utils/strings';
	import { getReadableAgencyName } from '$lib/utils/agencyNames';

	export let selectedVehicle: any | null = null;
	export let agencies: Map<number, any>;
	export let routes: Map<string, any>;
	export let isClosing = false;
	export let isLoadingBlockSchedule = false;
	export let blockSchedule: any = null;
	export let blockScheduleError = '';
	export let isBlockScheduleOpen = false;
	export let getAgencyLogo: (agency: any, vehicle: any) => string | null = () => null;
	export let getVehicleColorForAgency: (
		routeShortName: string,
		agencyName?: string
	) => string = () => '#e5e7eb';
	export let isPinned: (vehicle: any) => boolean = () => false;
	export let togglePin: (vehicle: any) => void = () => {};
	export let closeBottomSheet: () => void = () => {};
	export let loadBlockScheduleForVehicle: (vehicle: any) => void = () => {};
	export let formatTime: (time: string) => string = (time) => time;
	export let formatLayoverSeconds: (seconds: number) => string = () => '';
	export let isCurrentBlock: (
		entry: any,
		index: number,
		schedule: any[],
		layovers?: number[]
	) => boolean = () => false;
	export let hexToRgba: (hex: string, alpha: number) => string = () => '';
</script>

{#if selectedVehicle}
	{@const agency = agencies.get(selectedVehicle.agency)}
	{@const routeInfo = routes.get(selectedVehicle.route_id)}
	{@const agencyName = agency?.name?.toLowerCase() || ''}
	{@const isTrain = agencyName === 'caltrain' || agencyName === 'sonoma marin area rail transit'}
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
				</div>
				<div class="header-buttons">
					<button
						class="pin-button"
						onclick={() => togglePin(selectedVehicle)}
						aria-label={isPinned(selectedVehicle) ? 'Unpin vehicle' : 'Pin vehicle'}
					>
						{isPinned(selectedVehicle) ? 'Unpin' : 'Pin'}
					</button>
					<button class="close-button" onclick={closeBottomSheet} aria-label="Close">×</button>
				</div>
			</div>
		</div>

		<!-- <div class="route-info">
			<h2 class="route-name">{routeDisplay}</h2>
			<h3 class="headsign">{titleCaseHeadsign(selectedVehicle.trip_headsign) || 'No destination'}</h3>
		</div> -->

		<div class="vehicle-details">
			<div class="detail-row">
				<span class="detail-label">Vehicle:</span>
				<span class="detail-value">{selectedVehicle.vehicle_id}</span>
			</div>

			{#if agency}
				<div class="detail-row">
					<span class="detail-label">Agency:</span>
					<span class="detail-value">{getReadableAgencyName(agency.name)}</span>
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
								{entry.route_long_name ? titleCase(entry.route_long_name) : ''}
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

	.header {
		padding-bottom: 12px;
		border-bottom: 1px solid #e5e7eb;
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
	}

	.route-long-name {
		font-size: 14px;
		font-weight: 500;
		color: #374151;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.headsign {
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
</style>
