import type { VocabularyDraft, VocabularyItem } from '../types/vocabulary';

export const STORAGE_KEY = 'improve-tracker:vocabulary:v1';

const sampleVocabulary: readonly VocabularyItem[] = [
	{
		id: 'sample-versatile',
		word: 'Versatile',
		example: 'She is a versatile developer who can work with several frontend frameworks.',
		meaning: '多才な、用途の広い',
		translation: '彼女は複数のフロントエンドフレームワークを扱える、多才な開発者です。',
		notes:
			'Adjective. Can describe a person, skill, tool, or product that can adapt to many purposes.'
	},
	{
		id: 'sample-colleague',
		word: 'Colleague',
		example: 'I asked my colleague to review my code.',
		meaning: '同僚',
		translation: '同僚にコードをレビューしてもらいました。',
		notes: 'Noun. A person you work with.'
	},
	{
		id: 'sample-improve',
		word: 'Improve',
		example: 'I want to improve my English speaking skills.',
		meaning: '改善する、上達する',
		translation: '英語のスピーキング力を向上させたいです。',
		notes: 'Verb. Used when something becomes better.'
	}
];

export function createSampleVocabulary(): VocabularyItem[] {
	return sampleVocabulary.map((item) => ({ ...item }));
}

export function normalizeVocabularyDraft(draft: VocabularyDraft): VocabularyDraft {
	return {
		word: draft.word.trim(),
		example: draft.example.trim(),
		meaning: draft.meaning.trim(),
		translation: draft.translation.trim(),
		notes: draft.notes.trim()
	};
}

function isVocabularyItem(value: unknown): value is VocabularyItem {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

	const item = value as Record<string, unknown>;
	return ['id', 'word', 'example', 'meaning', 'translation', 'notes'].every(
		(field) => typeof item[field] === 'string'
	);
}

export function parseStoredVocabulary(raw: string | null): VocabularyItem[] {
	if (raw === null) return createSampleVocabulary();

	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) throw new Error('Saved vocabulary must be a list.');

	const candidates: unknown[] = parsed;
	const ids = new Set<string>();

	return candidates.map((candidate) => {
		if (!isVocabularyItem(candidate)) {
			throw new Error('Saved vocabulary contains an invalid item.');
		}

		const id = candidate.id.trim();
		const draft = normalizeVocabularyDraft(candidate);
		if (!id || !draft.word || !draft.meaning) {
			throw new Error('Saved vocabulary contains blank required fields.');
		}
		if (ids.has(id)) throw new Error('Saved vocabulary contains duplicate IDs.');
		ids.add(id);

		return { id, ...draft };
	});
}
