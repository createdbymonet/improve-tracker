declare global {
	namespace App {
		interface Locals {
			isOwner: boolean;
			sessionId: string | null;
		}
		interface Platform {
			env: Cloudflare.Env & { OWNER_KEY_HASH?: string };
			context: ExecutionContext;
		}
	}
}

export {};
