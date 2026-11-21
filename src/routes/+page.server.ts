import type { PageServerLoad } from './$types';
import { loadSnapshot } from '../lib/server/db';
import { isConfigured } from '../lib/server/auth';
import { getEnvironment } from '../lib/server/environment';

export const load: PageServerLoad = async ({ platform, locals, depends }) => {
	depends('notebook:data');
	const env = await getEnvironment(platform);
	const db = env.DB;
	try {
		return {
			snapshot: db ? await loadSnapshot(db) : null,
			isOwner: locals.isOwner,
			authConfigured: isConfigured(env.OWNER_KEY_HASH),
			loadError: db ? '' : 'The cloud notebook is not connected yet. Please try again later.'
		};
	} catch {
		return {
			snapshot: null,
			isOwner: locals.isOwner,
			authConfigured: isConfigured(env.OWNER_KEY_HASH),
			loadError: 'We could not load the cloud notebook. Please try again.'
		};
	}
};
