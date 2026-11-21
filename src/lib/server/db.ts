import type { NotebookSnapshot } from '../types/notebook';

export const FOLDER_SELECT = `SELECT f.*,
    (SELECT COUNT(*) FROM vocabulary v WHERE v.folder_id = f.id) AS word_count
    FROM folders f`;
export const CONVERSATION_SELECT = `SELECT c.*,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c`;

export async function loadSnapshot(db: D1Database): Promise<NotebookSnapshot> {
	// A batch provides one consistent read transaction across all four collections.
	const [folders, vocabulary, conversations, messages] = await db.batch([
		db.prepare(`${FOLDER_SELECT} ORDER BY f.sort_order, f.id`),
		db.prepare('SELECT * FROM vocabulary ORDER BY folder_id, sort_order, id'),
		db.prepare(`${CONVERSATION_SELECT} ORDER BY c.sort_order, c.id`),
		db.prepare('SELECT * FROM messages ORDER BY conversation_id, sort_order, id')
	]);
	return {
		folders: folders.results as NotebookSnapshot['folders'],
		vocabulary: vocabulary.results as NotebookSnapshot['vocabulary'],
		conversations: conversations.results as NotebookSnapshot['conversations'],
		messages: messages.results as NotebookSnapshot['messages']
	};
}
