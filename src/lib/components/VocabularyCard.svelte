<script lang="ts">
	import type { VocabularyItem } from '../types/vocabulary';

	interface Props {
		item: VocabularyItem;
		index: number;
		onEdit: (item: VocabularyItem, trigger: HTMLButtonElement) => void;
		onDelete: (item: VocabularyItem) => void;
	}

	let { item, index, onEdit, onDelete }: Props = $props();
</script>

<article
	class="vocabulary-card"
	class:teal={index % 3 === 1}
	class:pink={index % 3 === 2}
	aria-labelledby={'word-' + item.id}
>
	<header class="card-header">
		<div class="word-block">
			<p class="card-number">#{String(index + 1).padStart(2, '0')}</p>
			<h2 id={'word-' + item.id} tabindex="-1">{item.word}</h2>
		</div>
		<dl class="meaning">
			<dt>Meaning</dt>
			<dd lang="ja">{item.meaning}</dd>
		</dl>
	</header>

	<dl class="details">
		<div>
			<dt>Example</dt>
			<dd class:empty={!item.example}>{item.example || 'Not added.'}</dd>
		</div>
		<div>
			<dt>Translation</dt>
			<dd
				class="translation"
				class:empty={!item.translation}
				lang={item.translation ? 'ja' : undefined}
			>
				{item.translation || 'Not added.'}
			</dd>
		</div>
		<div>
			<dt>Notes</dt>
			<dd class="notes" class:empty={!item.notes}>{item.notes || 'Not added.'}</dd>
		</div>
	</dl>

	<footer class="card-actions">
		<button
			type="button"
			class="edit-button"
			aria-label={'Edit ' + item.word}
			onclick={(event) => onEdit(item, event.currentTarget)}
		>
			Edit
		</button>
		<button
			type="button"
			class="delete-button"
			aria-label={'Delete ' + item.word}
			onclick={() => onDelete(item)}
		>
			Delete
		</button>
	</footer>
</article>

<style lang="scss">
	.vocabulary-card {
		--card-accent: #6250d5;
		--card-tint: #eeeafe;

		display: flex;
		min-inline-size: 0;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.25rem;
		border: 1px solid #e4e7ec;
		border-radius: 1.375rem;
		background: #fff;
		box-shadow: 0 6px 18px rgb(16 24 40 / 8%);
		scroll-margin-block: 1.5rem;
		overflow-wrap: anywhere;

		&.teal {
			--card-accent: #00747c;
			--card-tint: #e2f7f6;
		}

		&.pink {
			--card-accent: #b6336e;
			--card-tint: #fce7f2;
		}
	}

	.card-header {
		display: flex;
		min-inline-size: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.word-block {
		min-inline-size: 0;
		flex: 1;
	}

	.card-number {
		margin: 0 0 0.25rem;
		color: var(--card-accent);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.25;
	}

	h2 {
		margin: 0;
		border-radius: 0.25rem;
		color: #172033;
		font-size: 1.5625rem;
		font-weight: 700;
		letter-spacing: -0.025em;
		line-height: 1.2;
		scroll-margin-block: 1.5rem;
	}

	dl,
	dd {
		margin: 0;
	}

	dt {
		color: #667085;
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1.4;
		text-transform: uppercase;
	}

	.meaning {
		min-inline-size: 0;
		max-inline-size: 48%;
		flex: 0 1 auto;
		text-align: right;

		dt {
			margin-bottom: 0.25rem;
		}

		dd {
			display: inline-block;
			max-inline-size: 100%;
			padding: 0.375rem 0.625rem;
			border-radius: 999px;
			color: var(--card-accent);
			background: var(--card-tint);
			font-size: 0.75rem;
			font-weight: 600;
			line-height: 1.4;
			white-space: pre-wrap;
		}
	}

	.details {
		display: grid;
		gap: 0.875rem;
		min-inline-size: 0;

		dd {
			margin-top: 0.3125rem;
			color: #344054;
			font-size: 0.875rem;
			line-height: 1.5;
			white-space: pre-wrap;
		}

		.translation {
			color: #475467;
		}

		.notes,
		.empty {
			color: #667085;
		}
	}

	.card-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.25rem;
		margin: -0.25rem -0.625rem -0.625rem;

		button {
			min-block-size: 2.75rem;
			padding: 0.5rem 0.625rem;
			border: 0;
			border-radius: 0.625rem;
			background: transparent;
			font: inherit;
			font-size: 0.8125rem;
			font-weight: 600;
			line-height: 1.4;
			cursor: pointer;
			transition: background-color 120ms ease;
		}

		.edit-button {
			color: var(--card-accent);

			&:hover {
				background: var(--card-tint);
			}
		}

		.delete-button {
			color: #c72b20;

			&:hover {
				background: #fff0ee;
			}
		}
	}
</style>
