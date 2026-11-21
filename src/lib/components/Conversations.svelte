<script lang="ts">
	import { tick } from 'svelte';
	import { mutate } from '../client/api';
	import type { Conversation, Message, NotebookSnapshot } from '../types/notebook';

	interface Props {
		snapshot: NotebookSnapshot;
		canEdit: boolean;
		onRefresh: () => Promise<void>;
	}

	interface RoomEditor {
		id: string | null;
		version?: number;
		title: string;
		description: string;
		originalTitle: string;
		originalDescription: string;
	}

	let { snapshot, canEdit, onRefresh }: Props = $props();
	let selectedId = $state<string | null>(null);
	let roomEditor = $state<RoomEditor | null>(null);
	let messageEditor = $state<Message | null>(null);
	let speaker = $state<'me' | 'partner'>('me');
	let content = $state('');
	let destinationId = $state('');
	let busy = $state(false);
	let refreshPending = $state(false);
	let error = $state('');
	let titleError = $state('');
	let contentError = $state('');
	let announcement = $state('');
	let completeRefresh: (() => Promise<void>) | null = null;

	const activeRoom = $derived(
		selectedId === null
			? (snapshot.conversations[0] ?? null)
			: (snapshot.conversations.find((room) => room.id === selectedId) ?? null)
	);
	const messages = $derived(
		snapshot.messages
			.filter((message) => message.conversation_id === activeRoom?.id)
			.sort(
				(a, b) =>
					a.sort_order - b.sort_order || a.created_at - b.created_at || a.id.localeCompare(b.id)
			)
	);
	const locked = $derived(busy || refreshPending);

	$effect(() => {
		if (!canEdit) {
			roomEditor = null;
			messageEditor = null;
			speaker = 'me';
			content = '';
			destinationId = '';
		}
	});

	function roomIsDirty() {
		return Boolean(
			roomEditor &&
			(roomEditor.title !== roomEditor.originalTitle ||
				roomEditor.description !== roomEditor.originalDescription)
		);
	}

	function messageIsDirty() {
		return messageEditor
			? content !== messageEditor.content ||
					speaker !== messageEditor.speaker ||
					destinationId !== messageEditor.conversation_id
			: content !== '';
	}

	export function confirmNavigation(): boolean {
		if (locked) return false;
		return (
			!canEdit ||
			(!roomIsDirty() && !messageIsDirty()) ||
			window.confirm('You have unsaved changes. Discard them and continue?')
		);
	}

	export function discardDraft(): void {
		if (locked) return;
		roomEditor = null;
		clearComposer();
		error = '';
		titleError = '';
	}

	function protectUnload(event: BeforeUnloadEvent) {
		if (busy || refreshPending || (canEdit && (roomIsDirty() || messageIsDirty()))) {
			event.preventDefault();
			event.returnValue = '';
		}
	}

	async function focusElement(id: string) {
		await tick();
		document.getElementById(id)?.focus();
	}

	function clearComposer() {
		messageEditor = null;
		content = '';
		destinationId = '';
		contentError = '';
	}

	async function selectRoom(id: string) {
		if (activeRoom?.id === id && !roomEditor) return;
		if (!confirmNavigation()) return;
		selectedId = id;
		roomEditor = null;
		clearComposer();
		error = '';
		await focusElement('conversation-panel-title');
	}

	async function openRoomEditor(room?: Conversation) {
		if (!canEdit || !confirmNavigation()) return;
		clearComposer();
		roomEditor = {
			id: room?.id ?? null,
			version: room?.version,
			title: room?.title ?? '',
			description: room?.description ?? '',
			originalTitle: room?.title ?? '',
			originalDescription: room?.description ?? ''
		};
		titleError = '';
		error = '';
		await focusElement('conversation-title-input');
	}

	async function cancelRoomEditor() {
		if (locked || (roomIsDirty() && !window.confirm('Discard the changes to this room?'))) return;
		roomEditor = null;
		titleError = '';
		error = '';
		await focusElement(activeRoom ? 'conversation-panel-title' : 'new-conversation-button');
	}

	async function finishRefresh() {
		await onRefresh();
		refreshPending = false;
		const finish = completeRefresh;
		completeRefresh = null;
		if (finish) await finish();
	}

	async function write<T>(
		path: string,
		method: 'POST' | 'PATCH' | 'DELETE',
		body: Record<string, unknown>,
		onComplete: (result: T) => Promise<void>
	) {
		if (!canEdit || locked) return;
		busy = true;
		error = '';
		announcement = '';
		try {
			const result = await mutate<T>(path, method, body);
			refreshPending = true;
			completeRefresh = () => onComplete(result);
			await finishRefresh();
		} catch (cause) {
			error = refreshPending
				? 'The server received your change, but the notebook could not reload. Retry loading before making another change.'
				: cause instanceof Error
					? cause.message
					: 'Your change could not be saved. Please try again.';
			if (!refreshPending && /another (tab|session|device)/i.test(error)) {
				error += ' Copy any draft you want to keep before refreshing, then reopen Edit.';
			}
		} finally {
			busy = false;
		}
	}

	async function retryRefresh() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await finishRefresh();
		} catch {
			error = 'The notebook still could not reload. Your submitted change will not be sent again.';
		} finally {
			busy = false;
		}
	}

	async function saveRoom(event: SubmitEvent) {
		event.preventDefault();
		if (!roomEditor || locked || !canEdit) return;
		const editor = roomEditor;
		const title = editor.title.trim();
		if (!title) {
			titleError = 'Enter a room title, using more than spaces.';
			await focusElement('conversation-title-input');
			return;
		}
		titleError = '';
		const body: Record<string, unknown> = { title, description: editor.description.trim() };
		if (editor.id) body.version = editor.version;
		await write<{ item: Conversation }>(
			'/api/data/conversations' + (editor.id ? '/' + encodeURIComponent(editor.id) : ''),
			editor.id ? 'PATCH' : 'POST',
			body,
			async ({ item }) => {
				selectedId = item.id;
				roomEditor = null;
				announcement = editor.id ? 'Room updated.' : 'Room created.';
				await focusElement('conversation-panel-title');
			}
		);
	}

	async function deleteRoom(room: Conversation) {
		if (!canEdit || locked) return;
		if (
			!window.confirm(
				`Delete “${room.title}” and all ${room.message_count} messages permanently? Any unsaved message in this room will also be discarded.`
			)
		)
			return;
		await write<void>(
			'/api/data/conversations/' + encodeURIComponent(room.id),
			'DELETE',
			{ version: room.version },
			async () => {
				selectedId = null;
				roomEditor = null;
				clearComposer();
				announcement = 'Room and its messages deleted.';
				await focusElement(
					snapshot.conversations.length ? 'conversation-panel-title' : 'new-conversation-button'
				);
			}
		);
	}

	async function editMessage(message: Message) {
		if (!canEdit || !confirmNavigation()) return;
		messageEditor = { ...message };
		speaker = message.speaker;
		content = message.content;
		destinationId = message.conversation_id;
		contentError = '';
		error = '';
		await focusElement('message-content');
	}

	async function cancelMessageEditor() {
		if (locked || (messageIsDirty() && !window.confirm('Discard the unsaved message changes?')))
			return;
		const id = messageEditor?.id;
		clearComposer();
		error = '';
		await focusElement(id ? 'message-' + id : 'message-content');
	}

	async function saveMessage(event: SubmitEvent) {
		event.preventDefault();
		if (!activeRoom || locked || !canEdit) return;
		const text = content.trim();
		if (!text) {
			contentError = 'Enter a message, using more than spaces.';
			await focusElement('message-content');
			return;
		}
		contentError = '';
		const editing = messageEditor;
		const roomId = editing ? destinationId : activeRoom.id;
		const body: Record<string, unknown> = {
			conversation_id: roomId,
			speaker,
			content: text
		};
		if (editing) body.version = editing.version;
		await write<{ item: Message }>(
			'/api/data/messages' + (editing ? '/' + encodeURIComponent(editing.id) : ''),
			editing ? 'PATCH' : 'POST',
			body,
			async () => {
				selectedId = roomId;
				clearComposer();
				announcement = editing ? 'Message updated.' : 'Message added.';
				await focusElement('message-content');
			}
		);
	}

	async function deleteMessage(message: Message) {
		if (!canEdit || locked) return;
		if (!window.confirm('Delete this message permanently?')) return;
		await write<void>(
			'/api/data/messages/' + encodeURIComponent(message.id),
			'DELETE',
			{ version: message.version },
			async () => {
				if (messageEditor?.id === message.id) clearComposer();
				announcement = 'Message deleted.';
				await focusElement('conversation-panel-title');
			}
		);
	}
</script>

<svelte:window onbeforeunload={protectUnload} />

<section class="conversations" aria-labelledby="conversations-title" aria-busy={busy}>
	<div class="section-heading">
		<div>
			<h2 id="conversations-title">Conversations</h2>
			<p>Practice both sides of everyday conversations, in your own words.</p>
		</div>
		{#if canEdit}
			<button
				id="new-conversation-button"
				class="button button--primary"
				type="button"
				disabled={locked}
				onclick={() => openRoomEditor()}>+ New room</button
			>
		{/if}
	</div>

	{#if error}
		<div class="error-notice" role="alert">
			<p>{error}</p>
			{#if refreshPending}
				<button class="button button--secondary" disabled={busy} onclick={retryRefresh}>
					{busy ? 'Loading…' : 'Retry loading'}
				</button>
			{/if}
		</div>
	{/if}
	{#if busy}<p class="working" role="status">Saving your notebook…</p>{/if}

	<div class="conversation-layout">
		<nav class="room-list" aria-label="Conversation rooms">
			<h3>Talk rooms <span>{snapshot.conversations.length}</span></h3>
			{#if snapshot.conversations.length === 0}
				<p class="list-empty">No rooms yet. Each room is a place to practice a situation.</p>
			{:else}
				<ul>
					{#each snapshot.conversations as room (room.id)}
						<li>
							<button
								type="button"
								class:active={activeRoom?.id === room.id && !roomEditor}
								aria-current={activeRoom?.id === room.id && !roomEditor ? 'true' : undefined}
								disabled={locked}
								onclick={() => selectRoom(room.id)}
							>
								<strong>{room.title}</strong>
								<span>{room.message_count} {room.message_count === 1 ? 'message' : 'messages'}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</nav>

		<div class="room-panel">
			{#if canEdit && roomEditor}
				<form class="room-form" onsubmit={saveRoom} aria-labelledby="room-form-title" novalidate>
					<h3 id="room-form-title">{roomEditor.id ? 'Edit room' : 'Create a talk room'}</h3>
					<p>Choose any situation you would like to practice.</p>
					<fieldset disabled={locked}>
						<div class="field">
							<label for="conversation-title-input">Title <span>Required</span></label>
							<input
								id="conversation-title-input"
								name="title"
								type="text"
								bind:value={roomEditor.title}
								maxlength="120"
								required
								aria-invalid={Boolean(titleError)}
								aria-describedby={titleError ? 'room-title-error' : undefined}
								oninput={() => (titleError = '')}
							/>
							{#if titleError}<p class="field-error" id="room-title-error" role="alert">
									{titleError}
								</p>{/if}
						</div>
						<div class="field">
							<label for="conversation-description">Description <span>Optional</span></label>
							<textarea
								id="conversation-description"
								name="description"
								bind:value={roomEditor.description}
								maxlength="2000"
								rows="3"></textarea>
						</div>
						<div class="form-actions">
							<button class="button button--primary" type="submit">Save room</button>
							<button class="button button--secondary" type="button" onclick={cancelRoomEditor}
								>Cancel</button
							>
						</div>
					</fieldset>
				</form>
			{:else if activeRoom}
				<header class="room-heading">
					<div>
						<h3 id="conversation-panel-title" tabindex="-1">{activeRoom.title}</h3>
						{#if activeRoom.description}<p>{activeRoom.description}</p>{/if}
						<span class="message-count"
							>{activeRoom.message_count}
							{activeRoom.message_count === 1 ? 'message' : 'messages'}</span
						>
					</div>
					{#if canEdit}
						<div class="room-actions">
							<button
								class="text-button"
								disabled={locked}
								onclick={() => openRoomEditor(activeRoom)}>Edit room</button
							>
							<button
								class="text-button danger"
								disabled={locked}
								onclick={() => deleteRoom(activeRoom)}>Delete room</button
							>
						</div>
					{/if}
				</header>

				{#if messages.length === 0}
					<div class="empty-chat">
						<p class="empty-title">Every conversation starts with a word.</p>
						<p>
							{canEdit
								? 'Choose Me or Partner below and write the first message.'
								: 'There are no messages in this room yet.'}
						</p>
					</div>
				{:else}
					<ol class="messages" aria-label={'Messages in ' + activeRoom.title}>
						{#each messages as message (message.id)}
							<li class:from-me={message.speaker === 'me'}>
								<article
									class="message"
									class:editing={messageEditor?.id === message.id}
									aria-label={(message.speaker === 'me' ? 'Me' : 'Partner') + ' message'}
								>
									<p class="speaker">{message.speaker === 'me' ? 'Me' : 'Partner'}</p>
									<p class="message-content" id={'message-' + message.id} tabindex="-1">
										{message.content}
									</p>
									{#if canEdit}
										<div class="message-actions">
											<button
												class="text-button"
												disabled={locked}
												aria-label={'Edit message from ' +
													(message.speaker === 'me' ? 'Me' : 'Partner')}
												onclick={() => editMessage(message)}>Edit</button
											>
											<button
												class="text-button danger"
												disabled={locked}
												aria-label={'Delete message from ' +
													(message.speaker === 'me' ? 'Me' : 'Partner')}
												onclick={() => deleteMessage(message)}>Delete</button
											>
										</div>
									{/if}
								</article>
							</li>
						{/each}
					</ol>
				{/if}

				{#if canEdit}
					<form
						class="message-form"
						onsubmit={saveMessage}
						aria-labelledby="message-form-title"
						novalidate
					>
						<h4 id="message-form-title">{messageEditor ? 'Edit message' : 'Add a message'}</h4>
						<p class="composer-hint">
							You write both sides. Keep the same speaker or switch whenever you like.
						</p>
						<fieldset disabled={locked}>
							<fieldset class="speaker-picker">
								<legend>Speaker</legend>
								<label class:selected={speaker === 'me'}
									><input type="radio" name="speaker" value="me" bind:group={speaker} /> Me</label
								>
								<label class:selected={speaker === 'partner'}
									><input type="radio" name="speaker" value="partner" bind:group={speaker} /> Partner</label
								>
							</fieldset>
							{#if messageEditor}
								<div class="field">
									<label for="message-room">Talk room</label>
									<select id="message-room" bind:value={destinationId}>
										{#each snapshot.conversations as room (room.id)}<option value={room.id}
												>{room.title}</option
											>{/each}
									</select>
								</div>
							{/if}
							<div class="field">
								<label for="message-content">Message <span>Required</span></label>
								<textarea
									id="message-content"
									name="content"
									bind:value={content}
									maxlength="10000"
									rows="3"
									required
									aria-invalid={Boolean(contentError)}
									aria-describedby={contentError ? 'message-content-error' : undefined}
									oninput={() => (contentError = '')}></textarea>
								{#if contentError}<p class="field-error" id="message-content-error" role="alert">
										{contentError}
									</p>{/if}
							</div>
							<div class="form-actions">
								<button class="button button--primary" type="submit"
									>{messageEditor ? 'Save message' : 'Add message'}</button
								>
								{#if messageEditor || content}
									<button
										class="button button--secondary"
										type="button"
										onclick={cancelMessageEditor}>{messageEditor ? 'Cancel' : 'Clear'}</button
									>
								{/if}
							</div>
						</fieldset>
					</form>
				{/if}
			{:else}
				<div class="empty-chat empty-room">
					{#if snapshot.conversations.length}
						<h3>Choose a talk room.</h3>
						<p>
							The previous room is no longer available. Select a room from the list to continue.
						</p>
					{:else}
						<h3>Your next conversation starts here.</h3>
						<p>
							{canEdit
								? 'Create a room for a situation you want to practice, then write both sides of the conversation.'
								: 'Saved conversations will appear here when the owner creates a room.'}
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</div>
	<p class="sr-only" role="status">{announcement}</p>
</section>

<style lang="scss">
	.conversations {
		min-width: 0;
	}
	.section-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	.section-heading h2 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
		letter-spacing: -0.025em;
	}
	.section-heading p,
	.room-form > p,
	.composer-hint {
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.conversation-layout {
		display: grid;
		grid-template-columns: minmax(11rem, 0.8fr) minmax(0, 2fr);
		align-items: start;
		gap: 1.25rem;
	}
	.room-list {
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--color-line);
		border-radius: 1.25rem;
		background: var(--color-surface);
	}
	.room-list h3 {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		font-size: 0.875rem;
	}
	.room-list h3 span {
		color: var(--color-muted);
		font-weight: 400;
	}
	.room-list ul {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.room-list button {
		display: flex;
		width: 100%;
		min-height: 2.75rem;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.875rem;
		border: 1px solid transparent;
		border-radius: 0.875rem;
		color: var(--color-ink);
		background: transparent;
		text-align: left;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.room-list button:hover,
	.room-list button.active {
		border-color: #c9c1f5;
		background: #eeeafe;
	}
	.room-list button strong {
		font-size: 0.875rem;
		line-height: 1.4;
	}
	.room-list button span,
	.list-empty,
	.message-count {
		color: var(--color-muted);
		font-size: 0.75rem;
		line-height: 1.5;
	}
	.room-panel {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--color-line);
		border-radius: 1.375rem;
		background: var(--color-surface);
		box-shadow: 0 6px 18px rgb(16 24 40 / 5%);
	}
	.room-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1.25rem;
		border-bottom: 1px solid var(--color-line);
	}
	.room-heading > div:first-child {
		min-width: 0;
		flex: 1 1 12rem;
	}
	.room-heading h3 {
		margin: 0 0 0.5rem;
		border-radius: 0.25rem;
		font-size: 1.125rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.room-heading p {
		margin-bottom: 0.5rem;
		color: var(--color-text);
		font-size: 0.8125rem;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.room-actions,
	.message-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.text-button {
		min-height: 2.75rem;
		padding: 0.5rem 0.625rem;
		border: 0;
		border-radius: 0.625rem;
		color: #6250d5;
		background: transparent;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}
	.text-button:hover {
		background: #eeeafe;
	}
	.text-button.danger {
		color: var(--color-danger);
	}
	.text-button.danger:hover {
		background: #fff0ee;
	}
	.messages {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin: 0;
		padding: 1.25rem;
		list-style: none;
		background: #f9faff;
	}
	.messages li {
		display: flex;
		justify-content: flex-start;
		min-width: 0;
	}
	.messages li.from-me {
		justify-content: flex-end;
	}
	.message {
		max-width: 88%;
		min-width: 0;
		padding: 0.875rem 1rem 0.375rem;
		border: 1px solid #e4e7ec;
		border-radius: 1rem 1rem 1rem 0.25rem;
		background: #fff;
	}
	.from-me .message {
		border-color: #ded7ff;
		border-radius: 1rem 1rem 0.25rem 1rem;
		background: #eeeafe;
	}
	.message.editing {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.speaker {
		margin-bottom: 0.375rem;
		color: #6250d5;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1.4;
	}
	.message-content {
		padding-bottom: 0.5rem;
		border-radius: 0.25rem;
		color: var(--color-text);
		font-size: 0.9375rem;
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.message-actions {
		justify-content: flex-end;
		margin-right: -0.5rem;
	}
	.empty-chat {
		padding: 2rem 1.25rem;
		color: var(--color-muted);
		font-size: 0.875rem;
		line-height: 1.6;
		text-align: center;
	}
	.empty-title {
		margin-bottom: 0.5rem;
		color: var(--color-ink);
		font-weight: 600;
	}
	.empty-room h3 {
		margin: 0 0 0.75rem;
		color: var(--color-ink);
		font-size: 1.125rem;
	}
	.room-form,
	.message-form {
		padding: 1.25rem;
	}
	.room-form h3,
	.message-form h4 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.message-form {
		border-top: 1px solid var(--color-line);
	}
	fieldset {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
		margin: 1rem 0 0;
		padding: 0;
		border: 0;
	}
	.field {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;
	}
	.field label,
	.speaker-picker legend {
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1.5;
	}
	.field label span {
		margin-left: 0.375rem;
		color: var(--color-muted);
		font-size: 0.75rem;
		font-weight: 400;
	}
	input[type='text'],
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
		font: inherit;
		font-size: 1rem;
		line-height: 1.5;
	}
	textarea {
		resize: vertical;
	}
	[aria-invalid='true'] {
		border-color: var(--color-danger);
	}
	.speaker-picker {
		display: flex;
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
	}
	.speaker-picker legend {
		margin-bottom: 0.5rem;
	}
	.speaker-picker label {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--color-line);
		border-radius: 999px;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.speaker-picker label.selected {
		border-color: #c9c1f5;
		color: #6250d5;
		background: #eeeafe;
	}
	input[type='radio'] {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--color-accent);
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.form-actions .button {
		flex: 1 1 auto;
	}
	.error-notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 1rem;
		border: 1px solid #f5b5af;
		border-radius: 0.875rem;
		color: var(--color-danger);
		background: #fff5f4;
		font-size: 0.875rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.field-error {
		color: var(--color-danger);
		font-size: 0.8125rem;
		line-height: 1.5;
	}
	.working {
		margin-bottom: 1rem;
		color: var(--color-muted);
		font-size: 0.8125rem;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	@media (max-width: 640px) {
		.conversation-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 1rem;
		}
		.room-list {
			padding: 0.875rem;
		}
		.room-list ul {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			max-height: 15rem;
			overflow-y: auto;
			padding: 0.25rem;
		}
		.room-list button {
			height: 100%;
			padding: 0.75rem;
		}
		.section-heading .button {
			width: 100%;
		}
		.room-heading,
		.room-form,
		.message-form {
			padding: 1rem;
		}
		.messages {
			padding: 1rem;
		}
		.message {
			max-width: 92%;
			padding-inline: 0.75rem;
		}
	}
</style>
