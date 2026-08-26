<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { titleCaseHeadsign } from '$lib/utils/strings';

	let {
		selectedStop = null,
		departures = null as any[] | null,
		isClosing = false,
		onClose = () => {},
		onDepartureClick = () => {}
	}: {
		selectedStop?: any | null;
		departures?: any[] | null;
		isClosing?: boolean;
		onClose?: () => void;
		onDepartureClick?: (departure: any) => void;
	} = $props();

	let now = $state(Date.now());
	let tickerInterval: NodeJS.Timeout;

	onMount(() => {
		tickerInterval = setInterval(() => {
			now = Date.now();
		}, 1000);
	});

	onDestroy(() => {
		clearInterval(tickerInterval);
	});

	function countdownText(timestamp: number): string {
		const mins = Math.round((timestamp - now / 1000) / 60);
		if (mins <= 0) return 'Now';
		if (mins < 60) return `${mins} min`;
		return `${Math.floor(mins / 60)}h ${mins % 60}m`;
	}

	function formatTime(timeString: string): string {
		if (!timeString) return '';
		const parts = timeString.split(':');
		if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
		return timeString;
	}
</script>

{#if selectedStop}
	<div class="popup" class:closing={isClosing}>
		<div class="header">
			<div class="header-top">
				<div class="header-text">
					<span class="stop-name">{selectedStop.stop_name}</span>
					<div class="subtitle">Next departures</div>
				</div>
				<div class="header-buttons">
					<button class="close-button" onclick={onClose} aria-label="Close">×</button>
				</div>
			</div>
		</div>

		{#if departures == null}
			<div class="empty-row">Loading departures...</div>
		{:else if departures.length === 0}
			<div class="empty-row">No upcoming departures</div>
		{:else}
			<div class="departures-list">
				{#each departures as d}
					<button class="departure-row" onclick={() => onDepartureClick(d)}>
						<span class="route-badge" style={`background:${d.color};`}>
							{d.route_short_name}
						</span>
						<span class="headsign">{titleCaseHeadsign(d.trip_headsign)}</span>
						<span class="when">
							<span class="scheduled">{formatTime(d.departure_time)}</span>
							<b class="countdown">{countdownText(d.departure_timestamp)}</b>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.popup {
		position: fixed;
		top: calc(var(--top-bar-height) + 10px);
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
	}

	.header {
		padding-bottom: 12px;
		margin-bottom: 12px;
	}

	.header-top {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.header-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stop-name {
		font-size: 24px;
		font-weight: 700;
		color: #111827;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		padding-right: 60px;
	}

	.subtitle {
		font-size: 12px;
		font-weight: 500;
		color: #6b7280;
	}

	.header-buttons {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		flex-shrink: 0;
		position: absolute;
		top: 20px;
		right: 12px;
		height: 32px;
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

	.empty-row {
		font-size: 13px;
		color: #9ca3af;
		padding: 8px 0;
	}

	.departures-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.departure-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px;
		font-size: 13px;
		border-radius: 6px;
		border: none;
		background: none;
		width: 100%;
		text-align: left;
		cursor: pointer;
		font: inherit;
		color: inherit;
	}

	.departure-row:hover {
		background: #f3f4f6;
	}

	.route-badge {
		color: white;
		font-weight: 700;
		border-radius: 6px;
		padding: 3px 8px;
		font-size: 12px;
		white-space: nowrap;
		flex-shrink: 0;
		min-width: 20px;
		text-align: center;
	}

	.headsign {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #111827;
	}

	.when {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-shrink: 0;
	}

	.scheduled {
		color: #9ca3af;
		font-size: 11px;
	}

	.countdown {
		color: #111827;
		font-size: 13px;
	}
</style>
