# Encryption Documentation

> **As of #1084, Canvas API keys are no longer stored by Question Maker.** They are stored and
> encrypted by EduAI Core; Question Maker proxies every Canvas call through Core instead of holding
> its own credential. This document originally described QM's own Canvas-credential encryption at
> rest — that model no longer exists here (there is no `CanvasIntegration` Prisma model and no
> `schema/CanvasIntegration.js`; the old Sequelize `schema/` directory doesn't exist at all anymore).
> What's below reflects what's actually still in this codebase today.

## What still lives here

`app/backend/src/utils/encryption.js` still exists, unchanged in algorithm (AES-256-GCM,
PBKDF2-SHA512 key derivation, `salt:iv:tag:data` base64 format — see "Technical Details" below), but
its only remaining caller in this repository is its own unit test
(`app/backend/tests/unit/encryption.test.js`) — it is genuinely dead code in production. The one-time
Canvas-credential migration script does **not** import it: it has its own separate, algorithmically
identical implementation in `scripts/lib/canvasCredentialReencrypt.js` (`decryptWithKey`/
`encryptWithKey`/`reencryptCanvasApiKey`), used only by that script. `utils/encryption.js` is kept
around only because nothing has removed it yet, not because the migration script depends on it.

### The Canvas-credential migration (`scripts/migrate-canvas-integrations-to-core.mjs`)

Run automatically as part of `npm run db:migrate:deploy` (and therefore `npm run dev`/`npm start`),
**before** `prisma migrate deploy` applies the migration that renames the old `canvas_integrations`
table to `canvas_integrations_pre_core_backup`:

1. Reads any rows still in `canvas_integrations` (a deployment that never connected Canvas from QM has
   none, and the script no-ops).
2. Decrypts each token with QM's `ENCRYPTION_KEY` / `QM_ENCRYPTION_KEY`.
3. Re-encrypts it with Core's own key (`CORE_ENCRYPTION_KEY`) and inserts it into Core's database
   (`CORE_DATABASE_URL`) — only when Core has no row for that user yet (Core wins on conflict).
4. If rows exist but `CORE_DATABASE_URL`/`CORE_ENCRYPTION_KEY` are unset, the script **exits
   non-zero** and the container fails to start, rather than silently proceeding to rename the table
   out from under un-migrated tokens.

A dry run is available: `npm run db:migrate:canvas-to-core -w question-maker-backend -- --dry-run`.
See [`docs/deployment/README.md`](../deployment/README.md) for the full deploy-time procedure.

## How the algorithm works (background, still accurate for `utils/encryption.js` itself)

### The Encryption Process

1. **Generate Random Components**: a random salt (64 bytes) and IV (16 bytes) per value.
2. **Derive Encryption Key**: PBKDF2-SHA512, 100,000 iterations, from `config.encryptionKey` + salt.
3. **Encrypt**: AES-256-GCM; produces ciphertext plus a 16-byte authentication tag.
4. **Store**: `salt:iv:tag:encryptedData`, all four segments base64-encoded.

### The Decryption Process

`decrypt()` treats anything that isn't exactly four `:`-separated segments as legacy plaintext and
returns it unchanged (so it's safe to call on a value that was never encrypted). A four-segment value
is treated as ciphertext and **fails closed**: a malformed segment or a GCM authentication failure
throws `CredentialDecryptError` rather than returning corrupted data.

## Configuration

`ENCRYPTION_KEY` is required in production (`config/settings.js` throws at startup if unset outside
development) and used only by `utils/encryption.js`. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or: openssl rand -hex 32
```

**⚠️ Important:**
- Never share this key or commit it to version control.
- Use a different key per environment.
- Losing the key means any remaining ciphertext this utility produced elsewhere in the platform is
  unrecoverable.

## Testing

```javascript
// This codebase is ESM — import, not require.
import { encrypt, decrypt } from "./utils/encryption.js";
const original = "test-value-123";
const encrypted = encrypt(original);
console.log(decrypt(encrypted) === original); // true
```

## Technical Details

### Encryption Algorithm: AES-256-GCM

- **Key Size**: 256 bits (32 bytes)
- **Mode**: GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-512, 100,000 iterations
- **Salt Size**: 64 bytes
- **IV Size**: 16 bytes
- **Tag Size**: 16 bytes

### Security Properties

1. **Confidentiality**: ciphertext is unreadable without the key.
2. **Integrity**: the GCM authentication tag detects tampering.
3. **Uniqueness**: a fresh random salt and IV per encryption call.

## If you're looking for Canvas credential handling today

See [`docs/DEVELOPER_GUIDE.md`](../DEVELOPER_GUIDE.md) ("Canvas integration") and
`app/backend/src/services/canvasService.js` / `app/backend/src/services/coreApiService.js` — every
Canvas HTTP call, including connect/disconnect, is a proxy to Core's `/api/canvas/*` routes.
