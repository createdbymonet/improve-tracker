import type { PageServerLoad } from './$types';
import { isConfigured } from '../../lib/server/auth';
import { getEnvironment } from '../../lib/server/environment';

export const load: PageServerLoad = async ({ platform, locals }) => {
	const env = await getEnvironment(platform);
	return {
		configured: Boolean(env.DB) && isConfigured(env.OWNER_KEY_HASH),
		isOwner: locals.isOwner
	};
};
