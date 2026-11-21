import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { authenticate, COOKIE_NAME, isConfigured } from './lib/server/auth.ts';
import { assertSameOrigin, errorResponse } from './lib/server/http.ts';
import { getEnvironment } from './lib/server/environment.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.isOwner = false;
	event.locals.sessionId = null;
	if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
		try {
			assertSameOrigin(event.request);
		} catch (error) {
			return errorResponse(error);
		}
	}
	const env = await getEnvironment(event.platform);
	const cookie = event.cookies.get(COOKIE_NAME);
	if (env?.DB && isConfigured(env.OWNER_KEY_HASH) && cookie) {
		const session = await authenticate(env.DB, cookie, env.OWNER_KEY_HASH);
		if (session) {
			event.locals.isOwner = true;
			event.locals.sessionId = session.id;
			if (session.cookie)
				event.cookies.set(COOKIE_NAME, session.cookie, {
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'strict',
					maxAge: session.maxAge
				});
		}
		// An invalid stale request must not clear a newer cookie set by another response.
	}
	const response = await resolve(event);
	response.headers.set('Cache-Control', 'no-store');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};

export const handleError: HandleServerError = () => {
	console.error(JSON.stringify({ event: 'request_failed' }));
	return { message: 'Unable to open the notebook. Please try again.' };
};
