<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';
	import Flashcards from '../lib/components/Flashcards.svelte';
	import Conversations from '../lib/components/Conversations.svelte';
	import { mutate } from '../lib/client/api';
	import type { NotebookSnapshot } from '../lib/types/notebook';

	let { data }: PageProps = $props();
	let view = $state<'flashcards' | 'conversations'>('flashcards');
	let current = $state<NotebookSnapshot | null>(null);
	let snapshot = $derived(current ?? data.snapshot);
	let flashcards: Flashcards | undefined = $state();
	let conversations: Conversations | undefined = $state();
	let busy = $state(false);
	let notice = $state('');
	onMount(() => {
		let lastCheck = Date.now();
		async function activity() {
			if (
				!data.isOwner ||
				document.visibilityState !== 'visible' ||
				Date.now() - lastCheck < 300000
			)
				return;
			lastCheck = Date.now();
			try {
				const response = await fetch('/api/auth/session', { cache: 'no-store' });
				const state: unknown = await response.json();
				if (
					response.ok &&
					state &&
					typeof state === 'object' &&
					'isOwner' in state &&
					state.isOwner === false
				)
					notice = 'Your session expired. Open Renew sign-in in a new tab, then retry saving.';
			} catch {
				/* A later action will report a connection error without discarding input. */
			}
		}
		window.addEventListener('pointerdown', activity, { passive: true });
		window.addEventListener('keydown', activity);
		window.addEventListener('focus', activity);
		return () => {
			window.removeEventListener('pointerdown', activity);
			window.removeEventListener('keydown', activity);
			window.removeEventListener('focus', activity);
		};
	});

	async function refresh() {
		const response = await fetch('/api/data', { cache: 'no-store' });
		if (!response.ok)
			throw new Error('Unable to refresh the notebook. Check your connection and try again.');
		current = await response.json();
	}
	function mayLeave() {
		return (
			(flashcards?.confirmNavigation() ?? true) && (conversations?.confirmNavigation() ?? true)
		);
	}
	async function manualRefresh() {
		if (!mayLeave()) return;
		busy = true;
		notice = '';
		try {
			await refresh();
			flashcards?.discardDraft();
			conversations?.discardDraft();
			await invalidate('notebook:data');
			notice = 'Notebook refreshed.';
		} catch (error) {
			notice = error instanceof Error ? error.message : 'Unable to refresh.';
		} finally {
			busy = false;
		}
	}
	async function logout() {
		if (!mayLeave()) return;
		busy = true;
		notice = '';
		try {
			await mutate('/api/auth/logout', 'POST', {});
			window.location.assign('/');
		} catch (error) {
			notice = error instanceof Error ? error.message : 'Unable to sign out.';
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Improve Tracker — Your English Notebook</title>
	<meta
		name="description"
		content="A personal English notebook with organized flashcards and conversation practice. Explore the owner's real notebook in read-only demo mode."
	/>
</svelte:head>

<div class="notebook">
	<a class="skip-link" href="#learning-content">Skip to notebook</a>
	<header class="notebook-header">
		<p class="eyebrow">Daily English Notebook</p>
		<h1>Improve Tracker</h1>
		<p class="subtitle">Build your English, one word and conversation at a time.</p>
		<div class="mode-row">
			<span class="mode-badge">{data.isOwner ? 'Owner mode' : 'Read-only demo'}</span>
			{#if data.isOwner}
				<button class="text-button" disabled={busy} onclick={logout}>Sign out</button>
				<a href="/login" target="_blank" rel="noopener">Renew sign-in</a>
			{:else if data.authConfigured}
				<a href="/login">Owner sign-in</a>
			{/if}
		</div>
		<p class="mode-help">
			{data.isOwner
				? 'Your changes are saved to your cloud notebook.'
				: 'Explore the owner’s real flashcards and conversations. This demo is view only.'}
		</p>
	</header>
	<nav class="learning-nav" aria-label="Learning areas">
		<button
			type="button"
			aria-current={view === 'flashcards' ? 'page' : undefined}
			onclick={() => (view = 'flashcards')}>Flashcards</button
		>
		<button
			type="button"
			aria-current={view === 'conversations' ? 'page' : undefined}
			onclick={() => (view = 'conversations')}>Conversations</button
		>
	</nav>
	<main id="learning-content" tabindex="-1" class="notebook-content" aria-busy={busy}>
		<div class="refresh-row">
			<button class="text-button" disabled={busy} onclick={manualRefresh}
				>{busy ? 'Please wait…' : 'Refresh notebook'}</button
			>
		</div>
		<p role="status" class="notice">{notice}</p>
		{#if snapshot}
			<section hidden={view !== 'flashcards'} inert={busy} aria-label="Flashcards">
				<Flashcards bind:this={flashcards} {snapshot} canEdit={data.isOwner} onRefresh={refresh} />
			</section>
			<section hidden={view !== 'conversations'} inert={busy} aria-label="Conversations">
				<Conversations
					bind:this={conversations}
					{snapshot}
					canEdit={data.isOwner}
					onRefresh={refresh}
				/>
			</section>
		{:else}
			<div class="empty-state" role="alert">
				<h2>Notebook unavailable</h2>
				<p>{data.loadError}</p>
				<p>The notebook will appear here when the cloud connection is ready.</p>
			</div>
		{/if}
	</main>
</div>

<style lang="scss">
	.notebook {
		width: 100%;
		max-width: 60rem;
		margin-inline: auto;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	.notebook-header {
		padding: 2.75rem 1.5rem 1.25rem;
	}
	h1 {
		margin-top: 0.375rem;
		font-size: clamp(1.875rem, 5vw, 2.25rem);
		letter-spacing: -0.035em;
	}
	.eyebrow {
		color: #6250d5;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	.subtitle,
	.mode-help {
		margin-top: 0.5rem;
		color: var(--color-muted);
		line-height: 1.6;
	}
	.mode-help {
		font-size: 0.8125rem;
	}
	.mode-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
		font-size: 0.8125rem;
	}
	.mode-badge {
		background: #eeeafe;
		color: #6250d5;
		padding: 0.4rem 0.7rem;
		border-radius: 1rem;
		font-weight: 600;
	}
	.learning-nav {
		display: flex;
		gap: 0.5rem;
		margin: 0 1.5rem 1rem;
		padding: 0.375rem;
		border-radius: 1.125rem;
		background: #eae6fb;
	}
	.learning-nav button {
		appearance: none;
		-webkit-tap-highlight-color: transparent;
		flex: 1;
		min-height: 2.75rem;
		border: 0;
		border-radius: 0.875rem;
		color: var(--color-muted);
		background: transparent;
		cursor: pointer;
		font-weight: 600;

		&:focus:not(:focus-visible) {
			outline: none;
		}
	}
	.learning-nav button[aria-current='page'] {
		background: var(--color-surface);
		color: #6250d5;
		box-shadow: 0 2px 6px #17203312;
	}
	.notebook-content {
		padding: 0 1.5rem 2.5rem;
		min-width: 0;
	}
	.refresh-row {
		display: flex;
		justify-content: flex-end;
	}
	.notice:empty {
		display: none;
	}
</style>
