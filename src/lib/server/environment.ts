/** SvelteKit 3's Cloudflare adapter exposes bindings through cloudflare:workers. */
export async function getEnvironment(platform?: App.Platform): Promise<App.Platform['env']> {
	// Explicitly injected bindings keep Node-based route tests and SSR previews isolated.
	if (platform?.env) return platform.env;
	const { env } = await import('cloudflare:workers');
	return env;
}
