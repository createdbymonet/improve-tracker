<script lang="ts">
	import type { PageProps } from './$types';
	import { mutate } from '../../lib/client/api';
	let { data }: PageProps = $props();
	let key = $state('');
	let busy = $state(false);
	let error = $state('');
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		error = '';
		busy = true;
		try {
			await mutate('/api/auth/login', 'POST', { key });
			key = '';
			window.location.assign('/');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Unable to sign in.';
			busy = false;
		}
	}
</script>

<svelte:head
	><title>Owner sign-in — Improve Tracker</title><meta
		name="robots"
		content="noindex"
	/></svelte:head
>
<main class="login-page">
	<a href="/">← Back to notebook</a>
	<section class="login-card" aria-labelledby="login-title">
		<p class="eyebrow">Improve Tracker</p>
		<h1 id="login-title">Owner sign-in</h1>
		<p>Use your private owner access key. Visitors can explore the notebook without signing in.</p>
		{#if !data.configured}
			<p role="status">Owner sign-in is not configured yet.</p>
		{:else}
			{#if data.isOwner}<p role="status">
					You are already signed in. Signing in here creates a new session.
				</p>{/if}
			<form onsubmit={submit} aria-busy={busy}>
				<label for="owner-key">Owner access key</label>
				<input
					id="owner-key"
					type="password"
					name="password"
					autocomplete="current-password"
					bind:value={key}
					required
					minlength="43"
					maxlength="43"
					pattern="[A-Za-z0-9_-]{43}"
					aria-describedby="key-help"
					disabled={busy}
				/>
				<p id="key-help">
					Keep this key in your password manager. Sign-in lasts for 30 days after your last use,
					with reauthentication after 180 days.
				</p>
				{#if error}<p class="field-error" role="alert">{error}</p>{/if}
				<button class="button button--primary" type="submit" disabled={busy}
					>{busy ? 'Signing in…' : 'Sign in'}</button
				>
			</form>
		{/if}
	</section>
</main>

<style lang="scss">
	.login-page {
		max-width: 32rem;
		margin: 3rem auto;
		padding: 1.5rem;
	}
	.login-card {
		margin-top: 1.5rem;
		padding: 1.5rem;
		border: 1px solid var(--color-line);
		border-radius: 1.375rem;
		background: white;
	}
	h1 {
		margin-block: 0.5rem 1rem;
		font-size: 1.75rem;
	}
	p {
		margin-block: 0.75rem;
		color: var(--color-muted);
		line-height: 1.6;
	}
	.eyebrow {
		color: #6250d5;
		font-size: 0.75rem;
		text-transform: uppercase;
		font-weight: 600;
	}
	form {
		display: grid;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	label {
		font-weight: 600;
	}
	input {
		min-width: 0;
		width: 100%;
		min-height: 2.75rem;
		border: 1px solid #b8beca;
		border-radius: 0.75rem;
		padding: 0.75rem;
	}
	#key-help {
		font-size: 0.8125rem;
	}
</style>
