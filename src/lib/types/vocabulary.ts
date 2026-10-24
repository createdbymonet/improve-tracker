export interface VocabularyItem {
	id: string;
	word: string;
	example: string;
	meaning: string;
	translation: string;
	notes: string;
}

export type VocabularyDraft = Omit<VocabularyItem, 'id'>;
