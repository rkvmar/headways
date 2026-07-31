<script lang="ts">
	import { page } from '$app/stores';
	import { PUBLIC_API_BASE_URL } from '$env/static/public';
	import { onMount } from 'svelte';

	const AGENCY_OPTIONS = [
		{ code: 'SF', name: 'SF Muni' },
		{ code: 'AC', name: 'AC Transit' },
		{ code: 'VTA', name: 'VTA' },
		{ code: 'SM', name: 'SamTrans' },
		{ code: 'SC', name: 'Santa Cruz Metro' },
		{ code: 'GG', name: 'Golden Gate Transit' },
		{ code: 'ST', name: 'SolTrans' },
		{ code: 'MA', name: 'Marin Transit' },
		{ code: 'WC', name: 'WestCAT' },
		{ code: 'CT', name: 'County Connection' },
		{ code: 'VN', name: 'Vine Transit' },
		{ code: 'CC', name: 'Capitol Corridor' },
		{ code: 'ACE', name: 'Altamont Corridor Express' },
		{ code: 'LA', name: 'LA Metro' },
		{ code: 'SD', name: 'SD MTS' },
		{ code: 'NCTD', name: 'North County Transit District' },
		{ code: 'FO', name: 'Foothill Transit' },
		{ code: 'PA', name: 'Pasadena Transit' }
	];

	let vehicleId = $state('');
	let agencyCode = $state('');

	onMount(() => {
		vehicleId = $page.url.searchParams.get('vehicle_id') || '';
		agencyCode = $page.url.searchParams.get('agency') || '';
	});

	let imageUrl = $state('');
	let attribution = $state('');
	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!imageUrl.trim() || !vehicleId || !agencyCode) return;
		saving = true;
		error = '';
		success = '';
		try {
			const res = await fetch(`${PUBLIC_API_BASE_URL}/api/images/upload`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					image_url: imageUrl.trim(),
					vehicle_id: vehicleId,
					agency_code: agencyCode,
					attribution: attribution.trim() || undefined
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Save failed');
			success = `Photo saved for vehicle ${data.vehicle_id}`;
			imageUrl = '';
			attribution = '';
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to save';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Add Photo - Headways</title>
</svelte:head>

<div class="container">
	<a href="/" class="back-link">← Back to map</a>
	<h1>Add Vehicle Photo</h1>

	{#if vehicleId}
		<p class="vehicle-info">
			Adding photo for vehicle <strong>{vehicleId}</strong>
		</p>
	{/if}

	<form onsubmit={handleSubmit} class="form">
		<label class="field">
			<span class="label">Vehicle ID *</span>
			<input type="text" bind:value={vehicleId} required class="input" placeholder="e.g. 1015" />
		</label>

		<label class="field">
			<span class="label">Agency *</span>
			<select bind:value={agencyCode} required class="input">
				<option value="" disabled>Select agency</option>
				{#each AGENCY_OPTIONS as opt}
					<option value={opt.code}>{opt.name}</option>
				{/each}
			</select>
		</label>

		<label class="field">
			<span class="label">Image URL *</span>
			<input
				type="url"
				bind:value={imageUrl}
				required
				placeholder="https://example.com/photo.jpg"
				class="input"
			/>
		</label>

		<label class="field">
			<span class="label">Attribution</span>
			<input
				type="text"
				bind:value={attribution}
				placeholder="e.g. Photo by John Doe"
				class="input"
			/>
		</label>

		{#if error}
			<div class="msg error">{error}</div>
		{/if}
		{#if success}
			<div class="msg success">
				{success}
				<a href="/" class="success-link">Back to map</a>
			</div>
		{/if}

		<button
			type="submit"
			class="btn"
			disabled={saving || !imageUrl.trim() || !vehicleId || !agencyCode}
		>
			{saving ? 'Saving...' : 'Save Photo'}
		</button>
	</form>
</div>

<style>
	.container {
		max-width: 480px;
		margin: 0 auto;
		padding: 24px 16px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.back-link {
		font-size: 14px;
		color: #2563eb;
		text-decoration: none;
		font-weight: 500;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	h1 {
		font-size: 24px;
		font-weight: 700;
		margin: 12px 0 8px;
		color: #111827;
	}

	.vehicle-info {
		font-size: 14px;
		color: #6b7280;
		margin-bottom: 20px;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: white;
		padding: 24px;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.label {
		font-size: 14px;
		font-weight: 600;
		color: #374151;
	}

	.input {
		padding: 10px 14px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		outline: none;
		transition: border-color 0.15s;
		font-family: inherit;
	}

	.input:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.input:disabled {
		background: #f3f4f6;
		color: #6b7280;
	}

	.btn {
		padding: 12px 20px;
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
		font-family: inherit;
	}

	.btn:hover:not(:disabled) {
		background: #1d4ed8;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.msg {
		padding: 12px 16px;
		border-radius: 8px;
		font-size: 14px;
	}

	.msg.error {
		background: #fef2f2;
		color: #991b1b;
		border: 1px solid #fecaca;
	}

	.msg.success {
		background: #ecfdf5;
		color: #065f46;
		border: 1px solid #a7f3d0;
	}

	.success-link {
		display: inline-block;
		margin-top: 8px;
		color: #059669;
		font-weight: 600;
	}
</style>
