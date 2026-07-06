<script lang="ts">
	export let searchQuery: string;
	export let settingsOpen = false;
	export let filtersOpen = false;
	export let placeholder = 'Search';
	export let onSearchInput: () => void = () => {};
	export let onToggleSettings: () => void = () => {};
	export let onToggleFilters: () => void = () => {};

	let isSpinning = false;

	function handleClick() {
		isSpinning = true;
		onToggleSettings();
	}

	function handleAnimationEnd() {
		isSpinning = false;
	}
</script>

<div class="top-bar">
	<div class="logo">
		<img src="/SVG/Logo_Transparent.svg" alt="Headways Logo" class="logo-img" />
		<p>Headways</p>
	</div>
	<div class="search-container">
		<input
			type="text"
			bind:value={searchQuery}
			oninput={onSearchInput}
			{placeholder}
			class="search-input"
		/>
	</div>
	<div class="right-buttons">
		<button class="topbar-button" onclick={onToggleFilters} aria-label="Filters">
			<span class="material-symbols-outlined" class:active={filtersOpen}> tune </span>
		</button>
		<button class="topbar-button" onclick={handleClick} aria-label="Settings">
			<span
				class="material-symbols-outlined"
				class:spinning={isSpinning}
				onanimationend={handleAnimationEnd}
			>
				settings
			</span>
		</button>
	</div>
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

	.right-buttons {
		position: absolute;
		right: 10px;
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.topbar-button {
		border: none;
		color: white;
		background: none;
		padding: 8px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.7;
		transition: opacity 0.15s;
		text-decoration: none;
	}

	.topbar-button:hover {
		opacity: 1;
	}

	.topbar-button .material-symbols-outlined {
		font-size: 24px;
	}

	.topbar-button .material-symbols-outlined.active {
		opacity: 1;
	}

	.topbar-button .material-symbols-outlined.spinning {
		animation: spin 0.4s ease-out;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(120deg);
		}
	}
	.logo {
		position: absolute;
		left: 10px;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: left;
		gap: 15px;
		font-size: 30px;
		font-weight: 600;
		color: white;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}
	.logo-img {
		width: 40px;
		height: 40px;
	}

	.logo p {
		margin: 0;
	}

	@media (max-width: 600px) {
		.logo p {
			display: none;
		}
	}
</style>
