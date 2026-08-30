<script lang="ts">
	import { page } from '$app/stores';
	import { PUBLIC_API_BASE_URL } from '$env/static/public';
	import { graphqlRequest } from '$lib/graphql';
	import { getReadableAgencyName } from '$lib/utils/agencyNames';
	import { onMount } from 'svelte';

	let vehicleId = $state('');
	let agencyCode = $state('');
	let agencyOptions = $state<{ code: string; name: string }[]>([]);

	onMount(async () => {
		vehicleId = $page.url.searchParams.get('vehicle_id') || '';
		const fromUrl = $page.url.searchParams.get('agency') || '';
		try {
			const data = await graphqlRequest<{ agencies: { agency_id: string; agency_name: string }[] }>(
				PUBLIC_API_BASE_URL,
				'query($region: String) { agencies(region: $region) { agency_id agency_name } }'
			);
			agencyOptions = (data?.agencies || [])
				.map((a) => ({ code: a.agency_id, name: getReadableAgencyName(a.agency_name) }))
				.sort((a, b) => a.name.localeCompare(b.name));
			if (fromUrl) agencyCode = fromUrl;
		} catch {
			agencyOptions = [];
		}
	});

	let imageFile: File | null = $state(null);
	let previewUrl = $state('');
	let attribution = $state('');
	let saving = $state(false);
	let error = $state('');
	let success = $state('');

	function onFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		imageFile = input.files?.[0] || null;
		error = '';
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = imageFile ? URL.createObjectURL(imageFile) : '';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!imageFile || !vehicleId || !agencyCode) return;
		saving = true;
		error = '';
		success = '';
		try {
			const fd = new FormData();
			fd.append('vehicle_id', vehicleId);
			fd.append('agency_code', agencyCode);
			fd.append('attribution', attribution.trim());
			fd.append('file', imageFile);
			const res = await fetch(`${PUBLIC_API_BASE_URL}/api/images/upload`, {
				method: 'POST',
				body: fd
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Save failed');
			success = `Photo saved for vehicle ${data.vehicle_id}.`;
			imageFile = null;
			attribution = '';
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			previewUrl = '';
			const input = document.getElementById('file') as HTMLInputElement | null;
			if (input) input.value = '';
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
			<select bind:value={agencyCode} required class="input" disabled={agencyOptions.length === 0}>
				<option value="" disabled selected>Select agency</option>
				{#each agencyOptions as opt (opt.code)}
					<option value={opt.code}>{opt.name}</option>
				{/each}
			</select>
		</label>

		<label class="field">
			<span class="label">Photo *</span>
			<input id="file" type="file" accept="image/*" required onchange={onFileSelected} class="input" />
		</label>

		{#if previewUrl}
			<div class="preview">
				<img src={previewUrl} alt="Preview" />
			</div>
		{/if}

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

		<button type="submit" class="btn" disabled={saving || !imageFile || !vehicleId || !agencyCode}>
			{saving ? 'Saving...' : 'Upload Photo'}
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
		color: #e24b4b;
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
		border-color: #e24b4b;
	}

	select.input {
		background: #ffffff;
	}

	.input:disabled {
		background: #f3f4f6;
		color: #6b7280;
	}

	.preview {
		margin-top: -8px;
	}

	.preview img {
		width: 100%;
		max-height: 240px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.btn {
		padding: 12px 20px;
		background: #e24b4b;
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
		background: #c73737;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.msg {
		font-size: 14px;
		text-align: left;
	}

	.msg.error {
		color: #991b1b;
	}

	.msg.success {
		color: #111827;
	}

	.success-link {
		display: inline-block;
		margin-top: 8px;
		color: #e24b4b;
		font-weight: 600;
	}
</style>
