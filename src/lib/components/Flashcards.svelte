<script lang="ts">
	import { tick } from 'svelte';
	import { mutate } from '../client/api';
	import type { Folder, NotebookSnapshot, VocabularyRecord } from '../types/notebook';
	import type { VocabularyDraft } from '../types/vocabulary';
	import VocabularyCard from './VocabularyCard.svelte';
	import VocabularyForm from './VocabularyForm.svelte';

	interface Props {
		snapshot: NotebookSnapshot;
		canEdit: boolean;
		onRefresh: () => Promise<void>;
	}

	interface WordEditor {
		id: string | null;
		version?: number;
		values?: VocabularyDraft;
		folderId: string;
	}

	let { snapshot, canEdit, onRefresh }: Props = $props();
	let selectedFolderId = $state<string | null>(null);
	let query = $state('');
	let editor = $state<WordEditor | null>(null);
	let wordDirty = $state(false);
	let wordError = $state('');
	let folderEditor = $state<{ id: string | null; version?: number; original: string } | null>(null);
	let folderName = $state('');
	let folderError = $state('');
	let busy = $state(false);
	let refreshPending = $state(false);
	let completeRefresh: (() => Promise<void>) | null = null;
	let operationError = $state('');
	let announcement = $state('');
	let returnFocusTo: HTMLButtonElement | undefined;
	let addButton = $state<HTMLButtonElement>();
	let newFolderButton = $state<HTMLButtonElement>();

	const folders = $derived(
		[...snapshot.folders].sort((left, right) => left.sort_order - right.sort_order)
	);
	const selectedFolder = $derived(folders.find((folder) => folder.id === selectedFolderId));
	const folderDirty = $derived(folderEditor !== null && folderName !== folderEditor.original);
	const dirty = $derived(wordDirty || folderDirty);
	const locked = $derived(busy || refreshPending);
	const visibleWords = $derived.by(() => {
		const search = query.trim().toLocaleLowerCase();
		return snapshot.vocabulary.filter((item) => {
			if (selectedFolder && item.folder_id !== selectedFolder.id) return false;
			return (
				!search ||
				[item.word, item.meaning, item.example, item.translation, item.notes].some((value) =>
					value.toLocaleLowerCase().includes(search)
				)
			);
		});
	});

	export function confirmNavigation(): boolean {
		if (locked) return false;
		return !dirty || window.confirm('Discard your unsaved changes?');
	}

	export function discardDraft(): void {
		if (!locked) clearEditors();
	}

	function protectDraft(event: BeforeUnloadEvent) {
		if (!dirty && !locked) return;
		event.preventDefault();
		event.returnValue = '';
	}

	function clearEditors() {
		editor = null;
		wordDirty = false;
		wordError = '';
		folderEditor = null;
		folderError = '';
		operationError = '';
	}

	function selectFolder(id: string | null) {
		if (!confirmNavigation()) return;
		clearEditors();
		selectedFolderId = id;
		operationError = '';
	}

	async function openAdd(trigger: HTMLButtonElement) {
		if (!canEdit || !confirmNavigation()) return;
		clearEditors();
		returnFocusTo = trigger;
		editor = { id: null, folderId: selectedFolder?.id ?? folders[0]?.id ?? '' };
		if (!folders.length) {
			folderName = '';
			folderEditor = { id: null, original: '' };
			await tick();
			document.getElementById('folder-name')?.focus();
		}
	}

	function openEdit(id: string, trigger: HTMLButtonElement) {
		if (!canEdit || !confirmNavigation()) return;
		const item = snapshot.vocabulary.find((word) => word.id === id);
		if (!item) return;
		clearEditors();
		returnFocusTo = trigger;
		const { word, example, meaning, translation, notes } = item;
		editor = {
			id: item.id,
			version: item.version,
			folderId: item.folder_id,
			values: { word, example, meaning, translation, notes }
		};
	}

	async function cancelWord() {
		if (!confirmNavigation()) return;
		clearEditors();
		await tick();
		if (returnFocusTo?.isConnected) returnFocusTo.focus();
		else addButton?.focus();
	}

	async function finishRefresh() {
		await onRefresh();
		refreshPending = false;
		busy = false;
		const finish = completeRefresh;
		completeRefresh = null;
		if (finish) await finish();
	}

	async function write<T>(
		path: string,
		method: 'POST' | 'PATCH' | 'DELETE',
		body: Record<string, unknown>,
		onComplete: (result: T) => Promise<void>,
		errorTarget: 'word' | 'folder' | 'general' = 'general'
	) {
		if (!canEdit || locked) return;
		busy = true;
		wordError = '';
		folderError = '';
		operationError = '';
		announcement = '';
		try {
			const result = await mutate<T>(path, method, body);
			// Once accepted, only reload may be retried; never resend an accepted mutation.
			refreshPending = true;
			completeRefresh = () => onComplete(result);
			await finishRefresh();
		} catch (cause) {
			if (refreshPending) {
				operationError =
					'The server received your change, but the notebook could not reload. Retry loading before making another change.';
			} else {
				let message =
					cause instanceof Error
						? cause.message
						: 'Your change could not be saved. Your draft is still here.';
				if (message.includes('another tab or device')) {
					message +=
						' Copy any changes you want to keep before refreshing, then reopen Edit to use the latest saved version.';
				}
				if (errorTarget === 'word') wordError = message;
				else if (errorTarget === 'folder') folderError = message;
				else operationError = message;
			}
		} finally {
			busy = false;
		}
	}

	async function retryRefresh() {
		if (busy || !refreshPending) return;
		busy = true;
		operationError = '';
		try {
			await finishRefresh();
		} catch {
			operationError =
				'The notebook still could not reload. Your submitted change will not be sent again.';
		} finally {
			busy = false;
		}
	}

	async function saveWord(values: VocabularyDraft, folderId?: string) {
		if (!canEdit || !editor || locked) return;
		if (!folderId || !folders.some((folder) => folder.id === folderId)) {
			wordError = 'Choose an existing folder before saving.';
			return;
		}
		const currentEditor = editor;
		const wasEditing = currentEditor.id !== null;
		await write<{ item: VocabularyRecord }>(
			currentEditor.id
				? '/api/data/vocabulary/' + encodeURIComponent(currentEditor.id)
				: '/api/data/vocabulary',
			currentEditor.id ? 'PATCH' : 'POST',
			{
				...values,
				folder_id: folderId,
				...(currentEditor.id ? { version: currentEditor.version } : {})
			},
			async ({ item }) => {
				selectedFolderId = folderId;
				query = '';
				clearEditors();
				announcement = (wasEditing ? 'Updated ' : 'Added ') + values.word + '.';
				await tick();
				document.getElementById('word-' + item.id)?.focus();
			},
			'word'
		);
	}

	async function deleteWord(id: string) {
		if (!canEdit || !confirmNavigation()) return;
		const item = snapshot.vocabulary.find((word) => word.id === id);
		if (!item || !window.confirm('Delete “' + item.word + '”? This cannot be undone.')) return;
		const index = visibleWords.findIndex((word) => word.id === id);
		const nextFocus = visibleWords[index + 1] ?? visibleWords[index - 1];
		await write(
			'/api/data/vocabulary/' + encodeURIComponent(id),
			'DELETE',
			{
				version: item.version
			},
			async () => {
				clearEditors();
				announcement = 'Deleted ' + item.word + '.';
				await tick();
				if (nextFocus) document.getElementById('word-' + nextFocus.id)?.focus();
				else addButton?.focus();
			}
		);
	}

	async function openFolderEditor(folder?: Folder) {
		if (!canEdit || !confirmNavigation()) return;
		clearEditors();
		folderName = folder?.name ?? '';
		folderEditor = { id: folder?.id ?? null, version: folder?.version, original: folderName };
		await tick();
		document.getElementById('folder-name')?.focus();
	}

	async function cancelFolder() {
		if (!confirmNavigation()) return;
		clearEditors();
		await tick();
		newFolderButton?.focus();
	}

	async function saveFolder(event: SubmitEvent) {
		event.preventDefault();
		if (!canEdit || !folderEditor || locked) return;
		const name = folderName.trim();
		if (!name) {
			folderError = 'Enter a folder name, using more than spaces.';
			document.getElementById('folder-name')?.focus();
			return;
		}
		const currentEditor = folderEditor;
		const wasEditing = currentEditor.id !== null;
		const continueAddingWord = editor?.id === null && folders.length === 0;
		await write<{ item: Folder }>(
			currentEditor.id
				? '/api/data/folders/' + encodeURIComponent(currentEditor.id)
				: '/api/data/folders',
			currentEditor.id ? 'PATCH' : 'POST',
			{ name, ...(currentEditor.id ? { version: currentEditor.version } : {}) },
			async ({ item }) => {
				selectedFolderId = item.id;
				if (continueAddingWord && editor) {
					folderEditor = null;
					folderError = '';
					editor.folderId = item.id;
				} else clearEditors();
				announcement = (wasEditing ? 'Renamed folder to ' : 'Created folder ') + name + '.';
				await tick();
				document
					.getElementById(continueAddingWord ? 'vocabulary-word' : 'folder-' + item.id)
					?.focus();
			},
			'folder'
		);
	}

	async function deleteFolder(folder: Folder) {
		if (!canEdit || !confirmNavigation()) return;
		const count = snapshot.vocabulary.filter((word) => word.folder_id === folder.id).length;
		if (
			!window.confirm(
				'Delete folder “' +
					folder.name +
					'” and all ' +
					count +
					' words inside it? This cannot be undone.'
			)
		)
			return;
		await write(
			'/api/data/folders/' + encodeURIComponent(folder.id),
			'DELETE',
			{
				version: folder.version
			},
			async () => {
				selectedFolderId = null;
				clearEditors();
				announcement = 'Deleted folder ' + folder.name + ' and its words.';
				await tick();
				document.getElementById('all-words')?.focus();
			}
		);
	}
</script>

<svelte:window onbeforeunload={protectDraft} />

<div class="flashcards-layout" aria-busy={busy}>
	<aside class="folder-panel" aria-label="Word folders">
		<div class="panel-heading">
			<h2>Folders</h2>
			<span class="folder-total">{folders.length}</span>
		</div>
		<p class="panel-description">A little order for everything you learn.</p>
		<nav aria-label="Choose a vocabulary folder">
			<button
				id="all-words"
				class:active={!selectedFolder}
				class="folder-button"
				type="button"
				disabled={locked}
				aria-current={!selectedFolder ? 'true' : undefined}
				onclick={() => selectFolder(null)}
			>
				<span>All words</span><span class="count">{snapshot.vocabulary.length}</span>
			</button>
			{#each folders as folder (folder.id)}
				<button
					id={'folder-' + folder.id}
					class:active={selectedFolder?.id === folder.id}
					class="folder-button"
					type="button"
					disabled={locked}
					aria-current={selectedFolder?.id === folder.id ? 'true' : undefined}
					onclick={() => selectFolder(folder.id)}
				>
					<span class="folder-name">{folder.name}</span><span class="count"
						>{folder.word_count}</span
					>
				</button>
			{/each}
		</nav>
		{#if canEdit}
			<button
				bind:this={newFolderButton}
				class="new-folder"
				type="button"
				disabled={locked}
				onclick={() => openFolderEditor()}>+ New folder</button
			>
		{/if}
		{#if !folders.length}
			<p class="panel-description">
				{canEdit ? 'Create a folder to start collecting words.' : 'No folders to explore yet.'}
			</p>
		{/if}
	</aside>

	<section class="word-panel" aria-labelledby="words-title">
		<header class="words-heading">
			<div>
				<p class="section-eyebrow">Your vocabulary collection</p>
				<h2 id="words-title">{selectedFolder?.name ?? 'All words'}</h2>
				<p class="word-count">
					{visibleWords.length}
					{visibleWords.length === 1 ? 'word' : 'words'}{query.trim() ? ' found' : ''}
				</p>
			</div>
			{#if canEdit}
				<button
					bind:this={addButton}
					class="button button--primary"
					type="button"
					disabled={locked}
					aria-expanded={editor !== null}
					aria-controls={editor ? 'word-editor' : undefined}
					onclick={(event) => openAdd(event.currentTarget)}>+ Add Word</button
				>
			{/if}
		</header>

		{#if canEdit && selectedFolder}
			<div class="folder-actions">
				<button
					class="text-button"
					type="button"
					disabled={locked}
					onclick={() => openFolderEditor(selectedFolder)}>Rename folder</button
				>
				<button
					class="text-button danger"
					type="button"
					disabled={locked}
					onclick={() => selectedFolder && deleteFolder(selectedFolder)}>Delete folder</button
				>
			</div>
		{/if}

		<div class="search-field">
			<label for="word-search">Search words</label>
			<input
				id="word-search"
				type="search"
				bind:value={query}
				placeholder="Word, meaning, example, or note…"
			/>
		</div>

		{#if operationError}
			<div class="error-notice" role="alert">
				<p>{operationError}</p>
				{#if refreshPending}
					<button
						class="button button--secondary"
						type="button"
						disabled={busy}
						onclick={retryRefresh}>{busy ? 'Loading…' : 'Retry loading'}</button
					>
				{/if}
			</div>
		{/if}
		{#if busy}<p class="operation-status" role="status">Updating your notebook…</p>{/if}

		{#if canEdit && folderEditor}
			<form
				class="folder-form"
				onsubmit={saveFolder}
				aria-labelledby="folder-form-title"
				novalidate
			>
				<h3 id="folder-form-title">{folderEditor.id ? 'Rename folder' : 'Create a folder'}</h3>
				<fieldset disabled={locked}>
					<label for="folder-name">Folder name</label>
					<input
						id="folder-name"
						bind:value={folderName}
						type="text"
						required
						maxlength="120"
						aria-invalid={Boolean(folderError)}
						aria-describedby={folderError ? 'folder-error' : undefined}
					/>
					{#if folderError}<p id="folder-error" class="error-notice" role="alert">
							{folderError}
						</p>{/if}
					<div class="form-actions">
						<button class="button button--primary" type="submit"
							>{busy ? 'Saving…' : 'Save folder'}</button
						>
						<button class="button button--secondary" type="button" onclick={cancelFolder}
							>Cancel</button
						>
					</div>
				</fieldset>
			</form>
		{/if}

		{#if canEdit && editor}
			{#key editor}
				<div id="word-editor" class="word-editor">
					{#if !folders.length}
						<p class="panel-description" role="status">
							Create your first folder above, then save your word. Your word draft will stay here.
						</p>
					{/if}
					<VocabularyForm
						initialValues={editor.values}
						editing={editor.id !== null}
						{folders}
						initialFolderId={editor.folderId}
						busy={locked}
						error={wordError}
						onDirtyChange={(value) => (wordDirty = value)}
						onSave={saveWord}
						onCancel={cancelWord}
					/>
				</div>
			{/key}
		{/if}

		{#if visibleWords.length > 0}
			<ol class="word-grid" aria-label="Saved vocabulary">
				{#each visibleWords as item, index (item.id)}
					<li>
						<VocabularyCard
							{item}
							{index}
							editable={canEdit}
							busy={locked}
							onEdit={(word, trigger) => openEdit(word.id, trigger)}
							onDelete={(word) => deleteWord(word.id)}
						/>
					</li>
				{/each}
			</ol>
		{:else}
			<div class="empty-state">
				<div class="empty-mark" aria-hidden="true">Aa</div>
				<h3>{query.trim() ? 'No words found.' : 'Your next word starts here.'}</h3>
				<p>
					{query.trim()
						? 'Try another word or search a different folder.'
						: canEdit
							? 'Add a word, write what it means, and make it yours.'
							: 'There are no words in this folder yet.'}
				</p>
				{#if query.trim()}<button
						class="button button--secondary"
						type="button"
						onclick={() => (query = '')}>Clear search</button
					>{/if}
			</div>
		{/if}
	</section>
</div>
<p class="sr-only" role="status">{announcement}</p>

<style lang="scss">
	.flashcards-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	.folder-panel {
		min-width: 0;
		padding: 1.25rem;
		border: 1px solid var(--color-line);
		border-radius: 1.375rem;
		background: var(--color-surface);
	}
	.panel-heading {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		h2 {
			font-size: 1rem;
			letter-spacing: -0.02em;
		}
	}
	.folder-total,
	.count {
		color: var(--color-muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
	}
	.panel-description {
		margin-block: 0.5rem 1rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
		line-height: 1.6;
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.folder-button {
		display: flex;
		min-height: 2.75rem;
		max-width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 0.75rem;
		color: var(--color-text);
		background: var(--color-background);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}
	.folder-button.active {
		border-color: #c9c1f5;
		color: #6250d5;
		background: #eeeafe;
		font-weight: 600;
	}
	.folder-name {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.new-folder {
		min-height: 2.75rem;
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 0;
		border-radius: 0.75rem;
		color: #6250d5;
		background: transparent;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}
	.word-panel {
		min-width: 0;
	}
	.words-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		h2 {
			margin-top: 0.375rem;
			font-size: 1.625rem;
			letter-spacing: -0.035em;
			overflow-wrap: anywhere;
		}
	}
	.section-eyebrow {
		color: #6250d5;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.word-count {
		margin-top: 0.375rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
	}
	.folder-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.375rem;
	}
	.text-button {
		min-height: 2.75rem;
		padding: 0.375rem 0;
		border: 0;
		border-radius: 0.25rem;
		color: #6250d5;
		background: transparent;
		font-size: 0.8125rem;
		cursor: pointer;
	}
	.danger {
		color: var(--color-danger);
	}
	.search-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-block: 1.25rem;
	}
	label {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	input {
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid #b8beca;
		border-radius: 0.875rem;
		color: var(--color-ink);
		background: var(--color-surface);
		font-size: 1rem;
	}
	input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}
	.word-editor,
	.folder-form {
		margin-bottom: 1.25rem;
	}
	.folder-form {
		padding: 1.25rem;
		border: 1px solid #c9c1f5;
		border-radius: 1.375rem;
		background: var(--color-surface);
		h3 {
			margin: 0 0 1rem;
			font-size: 1.125rem;
		}
	}
	fieldset {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.error-notice {
		margin-bottom: 1rem;
		color: var(--color-danger);
		font-size: 0.875rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.error-notice .button {
		margin-top: 0.75rem;
	}
	.operation-status {
		margin-bottom: 1rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
	}
	.word-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
		li {
			min-width: 0;
		}
	}
	.empty-state {
		padding: 2.5rem 1.5rem;
		border: 1px dashed #c9c1f5;
		border-radius: 1.375rem;
		background: var(--color-surface);
		text-align: center;
		h3 {
			margin-block: 1rem 0.625rem;
			font-size: 1.25rem;
		}
		p {
			margin-bottom: 1rem;
			color: var(--color-muted);
			font-size: 0.875rem;
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
	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	@media (min-width: 52rem) {
		.flashcards-layout {
			grid-template-columns: 14rem minmax(0, 1fr);
			gap: 2rem;
		}
		.folder-panel {
			position: sticky;
			top: 1rem;
		}
		nav {
			flex-direction: column;
		}
		.folder-button {
			width: 100%;
		}
	}
	@media (min-width: 72rem) {
		.word-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
