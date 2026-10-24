import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createSampleVocabulary,
	normalizeVocabularyDraft,
	parseStoredVocabulary,
	STORAGE_KEY
} from '../src/lib/data/vocabulary.ts';

test('first launch uses the three requested sample words with isolated copies', () => {
	const first = parseStoredVocabulary(null);
	assert.deepEqual(
		first.map(({ id, word }) => ({ id, word })),
		[
			{ id: 'sample-versatile', word: 'Versatile' },
			{ id: 'sample-colleague', word: 'Colleague' },
			{ id: 'sample-improve', word: 'Improve' }
		]
	);
	first[0].word = 'Changed';
	first.pop();
	const second = createSampleVocabulary();
	assert.equal(second.length, 3);
	assert.equal(second[0].word, 'Versatile');
	assert.equal(STORAGE_KEY, 'improve-tracker:vocabulary:v1');
});

test('stored vocabulary and an intentionally empty notebook survive a reload', () => {
	const words = createSampleVocabulary();
	assert.deepEqual(parseStoredVocabulary(JSON.stringify(words)), words);
	assert.deepEqual(parseStoredVocabulary('[]'), []);
});

test('all fields are trimmed while Japanese text and internal whitespace are preserved', () => {
	const draft = {
		word: '  Get  better\n',
		example: '\nI get better every day.  ',
		meaning: '　上達する　',
		translation: '  私は毎日上達しています。\n',
		notes: '\n\t '
	};
	const normalized = {
		word: 'Get  better',
		example: 'I get better every day.',
		meaning: '上達する',
		translation: '私は毎日上達しています。',
		notes: ''
	};
	assert.deepEqual(normalizeVocabularyDraft(draft), normalized);
	assert.equal(draft.word, '  Get  better\n');
	assert.deepEqual(parseStoredVocabulary(JSON.stringify([{ id: ' word-1 ', ...draft }])), [
		{ id: 'word-1', ...normalized }
	]);
});

test('optional fields may all be empty', () => {
	const word = {
		id: 'minimal',
		word: 'Improve',
		example: '',
		meaning: '上達する',
		translation: '',
		notes: ''
	};
	assert.deepEqual(parseStoredVocabulary(JSON.stringify([word])), [word]);
});

test('malformed JSON and non-array storage values are rejected', () => {
	for (const raw of ['', '{broken', 'null', '{}', 'true', '42', '"word"']) {
		assert.throws(() => parseStoredVocabulary(raw));
	}
});

test('invalid item shapes and non-string fields are rejected', () => {
	const word = createSampleVocabulary()[0];
	for (const item of [null, [], 42, 'word', {}, { ...word, notes: undefined }]) {
		assert.throws(() => parseStoredVocabulary(JSON.stringify([item])));
	}
	for (const field of ['id', 'word', 'example', 'meaning', 'translation', 'notes']) {
		for (const value of [null, 42, true, [], {}]) {
			assert.throws(() => parseStoredVocabulary(JSON.stringify([{ ...word, [field]: value }])));
		}
	}
});

test('blank IDs, words, and meanings are rejected, including Unicode whitespace', () => {
	const word = createSampleVocabulary()[0];
	for (const field of ['id', 'word', 'meaning']) {
		for (const value of ['', '  ', '\n\t', '　']) {
			assert.throws(() => parseStoredVocabulary(JSON.stringify([{ ...word, [field]: value }])));
		}
	}
});

test('duplicate IDs are rejected after trimming to keep keyed cards safe', () => {
	const words = createSampleVocabulary();
	words[1].id = ` ${words[0].id} `;
	assert.throws(() => parseStoredVocabulary(JSON.stringify(words)), /duplicate IDs/);
});

test('one invalid entry rejects the whole notebook rather than silently dropping words', () => {
	const words = createSampleVocabulary();
	assert.throws(() => parseStoredVocabulary(JSON.stringify([...words, { word: 'Incomplete' }])));
});
