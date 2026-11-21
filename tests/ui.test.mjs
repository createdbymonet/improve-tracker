import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

let server;
let Flashcards;
let Conversations;
let Notebook;
let render;
const cacheRoot = resolve(tmpdir());
let cacheDir;

// Compile the real components in memory. No browser, database, or network mutation is involved.
before(async () => {
	cacheDir = await mkdtemp(join(cacheRoot, 'improve-tracker-ui-'));
	server = await createServer({
		configFile: false,
		cacheDir,
		logLevel: 'silent',
		plugins: [
			{
				name: 'test-navigation',
				resolveId(id) {
					if (id === '$app/navigation') return '\0test-navigation';
				},
				load(id) {
					if (id === '\0test-navigation') return 'export async function invalidate() {}';
				}
			},
			svelte({ configFile: false, preprocess: vitePreprocess() })
		],
		server: { middlewareMode: true },
		optimizeDeps: { noDiscovery: true, include: [] }
	});
	({ render } = await server.ssrLoadModule('svelte/server'));
	Flashcards = (await server.ssrLoadModule('/src/lib/components/Flashcards.svelte')).default;
	Conversations = (await server.ssrLoadModule('/src/lib/components/Conversations.svelte')).default;
	Notebook = (await server.ssrLoadModule('/src/routes/+page.svelte')).default;
});

after(async () => {
	await server?.close();
	if (cacheDir) {
		assert.equal(dirname(cacheDir), cacheRoot);
		assert.ok(basename(cacheDir).startsWith('improve-tracker-ui-'));
		await rm(cacheDir, { recursive: true, force: true });
	}
});

function snapshot() {
	const common = { sort_order: 0, created_at: 1000, updated_at: 1000, version: 1 };
	return {
		folders: [{ id: 'folder-one', name: 'Everyday words', word_count: 1, ...common }],
		vocabulary: [
			{
				id: 'word-one',
				folder_id: 'folder-one',
				word: 'Improve',
				meaning: '上達する',
				example: 'I improve every day.',
				translation: '毎日上達する。',
				notes: 'A useful verb.',
				...common
			}
		],
		conversations: [
			{
				id: 'room-one',
				title: 'At a cafe',
				description: 'Practice ordering.',
				message_count: 2,
				...common
			}
		],
		messages: [
			{
				id: 'message-one',
				conversation_id: 'room-one',
				speaker: 'me',
				content: 'A coffee, please.',
				...common
			},
			{
				id: 'message-two',
				conversation_id: 'room-one',
				speaker: 'partner',
				content: 'Of course!',
				...common,
				sort_order: 1
			}
		]
	};
}

function html(Component, canEdit, data = snapshot()) {
	return render(Component, { props: { snapshot: data, canEdit, onRefresh: async () => {} } }).body;
}

test('demo flashcards contain readable real fields and search, with no edit controls or form', () => {
	const body = html(Flashcards, false);
	assert.match(body, /Everyday words/);
	assert.match(body, /Improve/);
	assert.match(body, /上達する/);
	assert.match(body, /I improve every day\./);
	assert.match(body, /A useful verb\./);
	assert.match(body, /type="search"/);
	assert.doesNotMatch(body, /<form\b/);
	assert.doesNotMatch(
		body,
		/Add Word|New folder|Rename folder|Delete folder|aria-label="(?:Edit|Delete) /
	);
});

test('owner flashcards expose their mutation controls', () => {
	const body = html(Flashcards, true);
	assert.match(body, /Add Word/);
	assert.match(body, /New folder/);
	assert.match(body, /aria-label="Edit Improve"/);
	assert.match(body, /aria-label="Delete Improve"/);
});

test('owners can start Add Word from All words before their first folder exists', () => {
	for (const data of [
		snapshot(),
		{ folders: [], vocabulary: [], conversations: [], messages: [] }
	]) {
		const body = html(Flashcards, true, data);
		assert.match(body, /id="all-words"[^>]*aria-current="true"/);
		const addWord = body.match(/<button\b[^>]*>\s*\+ Add Word<\/button>/)?.[0];
		assert.ok(addWord, 'The owner must have an Add Word button.');
		assert.doesNotMatch(addWord, /\bdisabled(?:\s|=|>)/);
		assert.match(addWord, /type="button"/);
		assert.match(addWord, /aria-expanded="false"/);
	}
});

test('demo conversations expose rooms and both speakers, with no composer or edit controls', () => {
	const body = html(Conversations, false);
	assert.match(body, /At a cafe/);
	assert.match(body, /A coffee, please\./);
	assert.match(body, /Of course!/);
	assert.match(body, /aria-label="Me message"/);
	assert.match(body, /aria-label="Partner message"/);
	assert.doesNotMatch(body, /<form\b|<textarea\b|type="radio"/);
	assert.doesNotMatch(
		body,
		/New room|Edit room|Delete room|Edit message from|Delete message from|Add message/
	);
});

test('owner conversations include the composer and editing controls', () => {
	const body = html(Conversations, true);
	assert.match(body, /New room/);
	assert.match(body, /Edit room/);
	assert.match(body, /Delete room/);
	assert.match(body, /aria-label="Edit message from Me"/);
	assert.match(body, /<textarea\b/);
	assert.match(body, /name="speaker"/);
});

test('the integrated demo renders both learning areas without hidden mutation controls', () => {
	const body = render(Notebook, {
		props: {
			data: {
				isOwner: false,
				authConfigured: true,
				snapshot: snapshot(),
				loadError: ''
			}
		}
	}).body;
	assert.match(body, /Read-only demo/);
	assert.match(body, /Flashcards/);
	assert.match(body, /Conversations/);
	assert.match(body, /Improve/);
	assert.match(body, /At a cafe/);
	assert.match(body, /Owner sign-in/);
	assert.doesNotMatch(
		body,
		/<form\b|<textarea\b|Add Word|New room|New folder|Delete room|Edit message from/
	);
});

test('stored vocabulary and conversation text is escaped instead of interpreted as HTML', () => {
	const data = snapshot();
	const payload = '<img src=x onerror="alert(1)">';
	data.folders[0].name = payload;
	data.vocabulary[0].word = payload;
	data.vocabulary[0].notes = payload;
	data.conversations[0].title = payload;
	data.messages[0].content = payload;
	for (const component of [Flashcards, Conversations]) {
		const body = html(component, false, data);
		assert.match(body, /&lt;img/);
		assert.doesNotMatch(body, /<img\b|<script\b/);
	}
});

test('empty demo snapshots retain browsing context without creation controls', () => {
	const empty = { folders: [], vocabulary: [], conversations: [], messages: [] };
	assert.match(html(Flashcards, false, empty), /No folders to explore yet\./);
	assert.doesNotMatch(html(Conversations, false, empty), /New room|<form\b/);
});

test('a missing cloud snapshot is shown as unavailable without falling back to starter words', () => {
	const body = render(Notebook, {
		props: {
			data: {
				isOwner: false,
				authConfigured: true,
				snapshot: null,
				loadError: 'Connection unavailable.'
			}
		}
	}).body;
	assert.match(body, /Notebook unavailable/);
	assert.match(body, /Connection unavailable\./);
	assert.doesNotMatch(body, /Versatile|Colleague|Add Word|<form\b/);
});
