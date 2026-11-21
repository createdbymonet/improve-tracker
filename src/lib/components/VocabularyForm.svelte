<script lang="ts">
	import { onMount } from 'svelte';
	import { normalizeVocabularyDraft } from '../data/vocabulary';
	import type { VocabularyDraft } from '../types/vocabulary';

	interface Props {
		initialValues?: VocabularyDraft;
		editing?: boolean;
		folders?: { id: string; name: string }[];
		initialFolderId?: string;
		busy?: boolean;
		error?: string;
		onDirtyChange?: (dirty: boolean) => void;
		onSave: (draft: VocabularyDraft, folderId?: string) => void | Promise<void>;
		onCancel: () => void;
	}

	let {
		initialValues,
		editing = false,
		folders = [],
		initialFolderId = '',
		busy = false,
		error = '',
		onDirtyChange,
		onSave,
		onCancel
	}: Props = $props();
	let draft = $state<VocabularyDraft>({
		word: '',
		example: '',
		meaning: '',
		translation: '',
		notes: ''
	});
	let errors = $state<Partial<Record<'word' | 'meaning', string>>>({});
	let folderId = $state('');
	let original = $state('');
	let mounted = $state(false);
	const dirty = $derived(mounted && JSON.stringify({ draft, folderId }) !== original);
	let wordInput: HTMLInputElement;
	let meaningInput: HTMLTextAreaElement;

	onMount(() => {
		if (initialValues) draft = { ...initialValues };
		folderId = initialFolderId;
		original = JSON.stringify({ draft, folderId });
		mounted = true;
		wordInput.focus();
	});

	$effect(() => {
		// A first folder can be created while this word draft remains open.
		if (mounted && !folderId && folders.some((folder) => folder.id === initialFolderId)) {
			folderId = initialFolderId;
		}
	});

	$effect(() => {
		onDirtyChange?.(dirty);
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		const values = normalizeVocabularyDraft(draft);
		errors = {};
		if (!values.word) errors.word = 'Enter a word, using more than spaces.';
		if (!values.meaning) errors.meaning = 'Enter a meaning, using more than spaces.';

		if (errors.word) {
			wordInput.focus();
			return;
		}
		if (errors.meaning) {
			meaningInput.focus();
			return;
		}

		await onSave(values, folderId || undefined);
	}
</script>

<form
	class="vocabulary-form"
	aria-labelledby="form-title"
	aria-busy={busy}
	onsubmit={handleSubmit}
	novalidate
>
	<div class="form-heading">
		<p class="form-eyebrow">
			{editing ? 'A little fine-tuning' : 'Make it part of your vocabulary'}
		</p>
		<h2 id="form-title">{editing ? 'Edit word' : 'Add a word'}</h2>
		<p>Word and meaning are required. The rest is yours to fill in.</p>
	</div>
	{#if error}
		<p class="field-error" role="alert">{error}</p>
	{/if}

	<fieldset disabled={busy}>
		{#if folders.length > 0}
			<div class="field">
				<label for="vocabulary-folder">Folder</label>
				<select id="vocabulary-folder" name="folder_id" bind:value={folderId} required>
					{#each folders as folder (folder.id)}
						<option value={folder.id}>{folder.name}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="field">
			<label for="vocabulary-word">Word <span aria-hidden="true">*</span></label>
			<input
				bind:this={wordInput}
				bind:value={draft.word}
				id="vocabulary-word"
				name="word"
				type="text"
				maxlength="200"
				required
				autocomplete="off"
				autocapitalize="none"
				aria-invalid={Boolean(errors.word)}
				aria-describedby={errors.word ? 'word-error' : undefined}
				oninput={() => (errors.word = undefined)}
			/>
			{#if errors.word}
				<p class="field-error" id="word-error" role="alert">{errors.word}</p>
			{/if}
		</div>

		<div class="field">
			<label for="vocabulary-example">Example sentence <span>Optional</span></label>
			<textarea
				bind:value={draft.example}
				id="vocabulary-example"
				name="example"
				rows="3"
				maxlength="10000"></textarea>
		</div>

		<div class="field">
			<label for="vocabulary-meaning">Meaning <span aria-hidden="true">*</span></label>
			<textarea
				bind:this={meaningInput}
				bind:value={draft.meaning}
				id="vocabulary-meaning"
				name="meaning"
				lang="ja"
				rows="2"
				maxlength="2000"
				required
				aria-invalid={Boolean(errors.meaning)}
				aria-describedby={errors.meaning ? 'meaning-error' : undefined}
				oninput={() => (errors.meaning = undefined)}></textarea>
			{#if errors.meaning}
				<p class="field-error" id="meaning-error" role="alert">{errors.meaning}</p>
			{/if}
		</div>

		<div class="field">
			<label for="vocabulary-translation">Translation <span>Optional</span></label>
			<textarea
				bind:value={draft.translation}
				id="vocabulary-translation"
				name="translation"
				lang="ja"
				maxlength="10000"
				rows="3"></textarea>
		</div>

		<div class="field">
			<label for="vocabulary-notes">Notes <span>Optional</span></label>
			<textarea
				bind:value={draft.notes}
				id="vocabulary-notes"
				name="notes"
				rows="3"
				maxlength="10000"></textarea>
		</div>

		<div class="form-actions">
			<button class="button button--primary" type="submit">{busy ? 'Saving…' : 'Save'}</button>
			<button class="button button--secondary" type="button" onclick={onCancel}>Cancel</button>
		</div>
	</fieldset>
</form>

<style lang="scss">
	.vocabulary-form {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.25rem;
		border: 1px solid #c9c1f5;
		border-radius: 1.375rem;
		background: var(--color-surface);
		box-shadow: 0 6px 18px rgb(16 24 40 / 6%);
		animation: reveal 160ms ease-out;
	}

	fieldset {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.form-heading {
		h2 {
			margin-block: 0.375rem 0.5rem;
			font-size: 1.375rem;
			letter-spacing: -0.025em;
		}

		p:last-child {
			color: var(--color-muted);
			font-size: 0.8125rem;
			line-height: 1.6;
		}
	}

	.form-eyebrow {
		color: #6250d5;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.5;
		text-transform: uppercase;
	}

	.field {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;

		label {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 0.5rem;
			font-size: 0.875rem;
			font-weight: 600;
			line-height: 1.4;
		}

		span {
			color: var(--color-muted);
			font-size: 0.75rem;
			font-weight: 400;
		}

		input,
		textarea,
		select {
			width: 100%;
			min-width: 0;
			min-height: 2.75rem;
			padding: 0.75rem;
			border: 1px solid #b8beca;
			border-radius: 0.75rem;
			color: var(--color-ink);
			background: var(--color-surface);
			font-size: 1rem;
			line-height: 1.5;
		}

		input[aria-invalid='true'],
		textarea[aria-invalid='true'] {
			border-color: var(--color-danger);
		}

		textarea {
			resize: vertical;
		}
	}

	.field-error {
		color: var(--color-danger);
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;

		button {
			flex: 1;
		}
	}

	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(-0.25rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
