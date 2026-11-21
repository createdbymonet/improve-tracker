import type { VocabularyItem } from './vocabulary';

export interface Folder {
	id: string;
	name: string;
	sort_order: number;
	created_at: number;
	updated_at: number;
	version: number;
	word_count: number;
}

export interface VocabularyRecord extends VocabularyItem {
	folder_id: string;
	sort_order: number;
	created_at: number;
	updated_at: number;
	version: number;
}

export interface Conversation {
	id: string;
	title: string;
	description: string;
	sort_order: number;
	created_at: number;
	updated_at: number;
	version: number;
	message_count: number;
}

export interface Message {
	id: string;
	conversation_id: string;
	speaker: 'me' | 'partner';
	content: string;
	sort_order: number;
	created_at: number;
	updated_at: number;
	version: number;
}

export interface NotebookSnapshot {
	folders: Folder[];
	vocabulary: VocabularyRecord[];
	conversations: Conversation[];
	messages: Message[];
}
