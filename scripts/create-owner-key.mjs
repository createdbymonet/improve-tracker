import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Intentionally write only to an ignored local directory. Never print credentials.
const directory = resolve('.owner-setup');
mkdirSync(directory, { recursive: true });
const key = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(key).digest('hex');
writeFileSync(join(directory, 'owner-key.txt'), key + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(join(directory, 'owner-key-hash.txt'), hash + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(
	join(directory, 'production-secrets.json'),
	JSON.stringify({ OWNER_KEY_HASH: hash }) + '\n',
	{ flag: 'wx', mode: 0o600 }
);
console.log(
	'Created owner-key.txt, owner-key-hash.txt, and production-secrets.json in .owner-setup/. Keep the key in a password manager.'
);
