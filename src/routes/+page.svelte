<script lang="ts">
	import { onMount, tick } from 'svelte';
	import VocabularyCard from '../lib/components/VocabularyCard.svelte';
	import VocabularyForm from '../lib/components/VocabularyForm.svelte';
	import {
		createSampleVocabulary,
		parseStoredVocabulary,
		STORAGE_KEY
	} from '../lib/data/vocabulary';
	import type { VocabularyDraft, VocabularyItem } from '../lib/types/vocabulary';

	interface Editor {
		id: string | null;
		values?: VocabularyDraft;
	}

	let vocabulary = $state<VocabularyItem[]>([]);
	let ready = $state(false);
	let editor = $state<Editor | null>(null);
	let storageNotice = $state('');
	let announcement = $state('');
	let addWordButton: HTMLButtonElement;
	let returnFocusTo: HTMLButtonElement | undefined;

	onMount(() => {
		try {
			vocabulary = parseStoredVocabulary(window.localStorage.getItem(STORAGE_KEY));
		} catch {
			vocabulary = createSampleVocabulary();
			storageNotice =
				'We couldn’t open your saved notebook. Starter words are shown. Browser saving may be unavailable.';
		}
		ready = true;
	});

	function persist(next: VocabularyItem[]) {
		vocabulary = next;
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			storageNotice = '';
		} catch {
			storageNotice =
				'Your changes are kept in this tab, but couldn’t be saved. They may be lost when you refresh.';
		}
	}

	function openAdd(trigger: HTMLButtonElement) {
		if (editor?.id === null) {
			document.getElementById('vocabulary-word')?.focus();
			return;
		}
		returnFocusTo = trigger;
		editor = { id: null };
	}

	function openEdit(item: VocabularyItem, trigger: HTMLButtonElement) {
		const { id, ...values } = item;
		returnFocusTo = trigger;
		editor = { id, values };
	}

	async function closeEditor() {
		editor = null;
		await tick();
		if (returnFocusTo?.isConnected) returnFocusTo.focus();
		else addWordButton.focus();
		returnFocusTo = undefined;
	}

	async function saveWord(values: VocabularyDraft) {
		if (!editor) return;
		const editingId = editor.id;
		const item: VocabularyItem = {
			id: editingId ?? crypto.randomUUID(),
			...values
		};

		persist(
			editingId
				? vocabulary.map((existing) => (existing.id === editingId ? item : existing))
				: [...vocabulary, item]
		);
		editor = null;
		returnFocusTo = undefined;
		announcement = (editingId ? 'Updated ' : 'Added ') + item.word + '.';
		await tick();
		document.getElementById('word-' + item.id)?.focus();
	}

	async function deleteWord(item: VocabularyItem) {
		const index = vocabulary.findIndex((existing) => existing.id === item.id);
		const next = vocabulary.filter((existing) => existing.id !== item.id);
		const nextFocus = next[index] ?? next[index - 1];
		if (editor?.id === item.id) {
			editor = null;
			returnFocusTo = undefined;
		}
		persist(next);
		announcement = 'Deleted ' + item.word + '.';
		await tick();
		if (nextFocus) document.getElementById('word-' + nextFocus.id)?.focus();
		else addWordButton.focus();
	}
</script>

<svelte:head>
	<title>Improve Tracker — Your English Notebook</title>
	<meta
		name="description"
		content="Build your English, one word at a time. Keep vocabulary, examples, Japanese meanings, translations, and notes in your own English notebook."
	/>
</svelte:head>

<div class="notebook">
	<header class="notebook-header">
		<p class="eyebrow">Daily English Notebook</p>
		<h1>Improve Tracker</h1>
		<p class="subtitle">Build your English, one word at a time.</p>
	</header>

	<div class="add-word-action">
		<button
			bind:this={addWordButton}
			class="button button--primary add-word-button"
			type="button"
			disabled={!ready}
			aria-expanded={editor !== null}
			aria-controls={editor ? 'vocabulary-editor' : undefined}
			onclick={(event) => openAdd(event.currentTarget)}
		>
			<span class="plus" aria-hidden="true">+</span> Add Word
		</button>
		{#if storageNotice}
			<p class="storage-notice" role="status">{storageNotice}</p>
		{/if}
	</div>

	<main class="notebook-content" aria-busy={!ready} aria-label="Vocabulary notebook">
		{#if editor}
			{#key editor}
				<div id="vocabulary-editor" class="editor">
					<VocabularyForm
						initialValues={editor.values}
						editing={editor.id !== null}
						onSave={saveWord}
						onCancel={closeEditor}
					/>
				</div>
			{/key}
		{/if}

		{#if !ready}
			<p class="loading" role="status">Opening your notebook…</p>
		{:else if vocabulary.length === 0}
			<section class="empty-state" aria-labelledby="empty-title">
				<div class="empty-mark" aria-hidden="true">Aa</div>
				<h2 id="empty-title">Your next word starts here.</h2>
				<p>Add a word, write what it means, and make it yours.</p>
				<button
					class="button button--primary"
					type="button"
					onclick={(event) => openAdd(event.currentTarget)}
				>
					<span aria-hidden="true">+</span> Add your first word
				</button>
			</section>
		{:else}
			<ol class="vocabulary-list" aria-label="Saved words">
				{#each vocabulary as item, index (item.id)}
					<li>
						<VocabularyCard {item} {index} onEdit={openEdit} onDelete={deleteWord} />
					</li>
				{/each}
			</ol>
		{/if}
	</main>

	<p class="sr-only" role="status">{announcement}</p>
</div>

<style lang="scss">
	.notebook {
		width: 100%;
		max-width: 45rem;
		margin-inline: auto;
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}

	.notebook-header {
		padding: 2.75rem 1.5rem 1.125rem;

		h1 {
			margin-top: 0.375rem;
			font-size: 1.875rem;
			font-weight: 700;
			letter-spacing: -0.035em;
			line-height: 1.2;
			overflow-wrap: anywhere;
		}
	}

	.eyebrow {
		color: #6250d5;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.25;
		text-transform: uppercase;
	}

	.subtitle {
		margin-top: 0.375rem;
		color: var(--color-muted);
		font-size: 0.9375rem;
		line-height: 1.2;
	}

	.add-word-action {
		padding: 0.25rem 1.5rem 1.125rem;
		background: var(--color-surface);
	}

	.add-word-button {
		width: 100%;
		min-height: 3.125rem;
		justify-content: flex-start;
	}

	.plus {
		font-size: 1.25rem;
		font-weight: 700;
		line-height: 1;
	}

	.storage-notice {
		margin-top: 0.875rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	.notebook-content {
		min-width: 0;
		padding: 0 1.5rem 2.5rem;
	}

	.editor {
		margin-bottom: 1rem;
		scroll-margin-block: 1rem;
	}

	.vocabulary-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			min-width: 0;
		}
	}

	.loading {
		padding-block: 2.5rem;
		color: var(--color-muted);
		font-size: 0.875rem;
		text-align: center;
	}

	.empty-state {
		padding: 2.5rem 1.5rem;
		border: 1px dashed #c9c1f5;
		border-radius: 1.375rem;
		background: var(--color-surface);
		text-align: center;

		h2 {
			margin-block: 1rem 0.625rem;
			font-size: 1.375rem;
			letter-spacing: -0.025em;
			line-height: 1.3;
		}

		p {
			margin-bottom: 1.5rem;
			color: var(--color-muted);
			font-size: 0.9375rem;
			line-height: 1.6;
		}
	}

	.empty-mark {
		display: inline-grid;
		width: 3.5rem;
		height: 3.5rem;
		place-items: center;
		border-radius: 1.125rem;
		color: #6250d5;
		background: #eeeafe;
		font-size: 1.5rem;
		font-weight: 600;
	}
</style>
