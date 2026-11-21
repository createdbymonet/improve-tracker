import type { RequestHandler } from './$types';
import { getEnvironment } from '../../../../lib/server/environment.ts';
import {
	COOKIE_NAME,
	consumeLoginAttempt,
	createSession,
	equalHashes,
	hashToken,
	isConfigured
} from '../../../../lib/server/auth.ts';
import {
	assertSameOrigin,
	errorResponse,
	readJson,
	RequestError
} from '../../../../lib/server/http.ts';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	try {
		assertSameOrigin(request);
		const env = await getEnvironment(platform);
		if (!env?.DB || !isConfigured(env.OWNER_KEY_HASH))
			throw new RequestError(503, 'Owner sign-in is not configured yet.');
		await consumeLoginAttempt(
			env.DB,
			env.OWNER_KEY_HASH,
			request.headers.get('CF-Connecting-IP') ?? 'local'
		);
		const body = await readJson(request);
		const key = body.key;
		const validShape = typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key);
		const digest = await hashToken(validShape ? key : 'invalid');
		if (!validShape || !(await equalHashes(digest, env.OWNER_KEY_HASH)))
			throw new RequestError(401, 'The access key is not valid.');
		const session = await createSession(env.DB, env.OWNER_KEY_HASH);
		cookies.set(COOKIE_NAME, session.cookie, {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: session.maxAge
		});
		return Response.json({ ok: true });
	} catch (error) {
		return errorResponse(error);
	}
};
