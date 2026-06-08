<script lang="ts">
	export let searchQuery: string;
	export let settingsOpen = false;
	export let placeholder = 'Search routes, vehicles, agencies...';
	export let onSearchInput: () => void = () => {};
	export let onToggleSettings: () => void = () => {};
</script>

<div class="top-bar">
	<div class="search-container">
		<input
			type="text"
			bind:value={searchQuery}
			oninput={onSearchInput}
			{placeholder}
			class="search-input"
		/>
	</div>
	<button class="settings-button" onclick={onToggleSettings}>
		{settingsOpen ? 'Close' : 'Settings'}
	</button>
</div>

<style>
	.top-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 1002;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 10px 12px;
		height: var(--top-bar-height, 56px);
		background: #e24b4b;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		box-sizing: border-box;
	}

	.search-container {
		width: 50%;
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

	.settings-button {
		position: absolute;
		right: 10px;
		border: none;
		background: white;
		border-radius: 8px;
		padding: 10px 14px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
		cursor: pointer;
		font-weight: 600;
		font-size: 12px;
		white-space: nowrap;
	}

	.settings-button:active {
		transform: translateY(1px);
	}
</style>
