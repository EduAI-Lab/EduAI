# Encryption Documentation

This document explains how encryption is implemented in Question Maker to protect sensitive data, specifically Canvas API keys stored in the database.

## Table of Contents

- [How Our Encryption Works](#how-our-encryption-works)
- [Implementation Details](#implementation-details)
- [Configuration](#configuration)
- [How It Works in Practice](#how-it-works-in-practice)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

## How Our Encryption Works

Question Maker uses **AES-256-GCM** 
### The Encryption Process

When a Canvas API key is saved:

1. **Generate Random Components**: Create random "salt" and "initialization vector" (IV)
   - Think of salt as adding randomness to make each encryption unique
   - Think of IV as a starting point that makes the same key encrypt differently each time

2. **Derive Encryption Key**: Use PBKDF2 (a secure key derivation function) to create a unique key
   - This adds an extra layer of security
   - Uses 100,000 iterations (computationally expensive, making brute-force attacks impractical)

3. **Encrypt the Data**: Use AES-256-GCM to encrypt the API key
   - The plaintext API key is converted to ciphertext
   - An authentication tag is created to detect tampering

4. **Store Encrypted Data**: Save the encrypted key in the database
   - Format: `salt:iv:tag:encryptedData` (all base64 encoded)

### The Decryption Process

When the API key is needed (e.g., to make a Canvas API request):

1. **Retrieve Encrypted Data**: Get the encrypted key from the database
2. **Extract Components**: Separate salt, IV, tag, and encrypted data
3. **Derive Key**: Use the same PBKDF2 process with the stored salt
4. **Decrypt**: Use AES-256-GCM to decrypt back to plaintext
5. **Verify**: Check the authentication tag to ensure data wasn't tampered with
6. **Use**: The decrypted API key is now available for API requests

## Implementation Details

### File Structure

```
app/backend/src/
├── utils/
│   └── encryption.js          # Encryption/decryption functions
├── config/
│   └── settings.js             # Configuration (includes encryption key)
└── schema/
    └── CanvasIntegration.js    # Database model with encryption hooks
```

### Key Components

#### 1. Encryption Utility (`utils/encryption.js`)

This file contains two main functions:

- **`encrypt(plaintext)`**: Takes plaintext and returns encrypted string
- **`decrypt(encryptedData)`**: Takes encrypted string and returns plaintext

Both functions handle edge cases like empty values and backward compatibility.

#### 2. Database Model (`schema/CanvasIntegration.js`)

The CanvasIntegration model automatically handles encryption/decryption:

- **Getter Function**: Automatically decrypts when you access `integration.apiKey`
- **Setter Function**: Automatically encrypts when you set `integration.apiKey`
- **Hooks**: Backup encryption before database operations

This means your code doesn't need to manually encrypt/decrypt - it happens automatically!

#### 3. Configuration (`config/settings.js`)

The encryption key is stored in environment variables:

- **Development**: Uses a temporary key (with warning)
- **Production**: Requires `ENCRYPTION_KEY` to be set (throws error if missing)

## Configuration

### Setting Up the Encryption Key

The encryption key is a critical security component. It must be:

1. **Strong**: At least 32 characters, random and unpredictable
2. **Secret**: Never commit to version control
3. **Unique**: Different for each environment (dev, staging, production)
4. **Backed Up Securely**: Store in a secure password manager or secret management system

### Generating a Secure Key

**Option 1: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option 2: Using OpenSSL**
```bash
openssl rand -hex 32
```

**Option 3: Using Python**
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Environment Variable Setup

Add to your `.env` file:

```env
# Encryption Key (REQUIRED in production)
# Generate using: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your-generated-64-character-hex-string-here
```

**⚠️ Important:**
- Never share this key
- Never commit it to version control
- Use different keys for development and production
- If the key is lost, encrypted data cannot be recovered

### Production Checklist

- [ ] `ENCRYPTION_KEY` is set in production environment
- [ ] Key is stored securely (e.g., environment variables, secret manager)
- [ ] Key is different from development/staging keys
- [ ] Key is backed up securely
- [ ] Team members know where to find the key (but don't have it in plain text)

## How It Works in Practice

### Example: Saving a Canvas API Key

```javascript
// User provides their Canvas API key
const apiKey = "1234~abcdefghijklmnopqrstuvwxyz";

// When you save it (automatic encryption happens)
const integration = await CanvasIntegration.create({
  userId: 1,
  canvasUrl: "https://canvas.instructure.com",
  apiKey: apiKey  // ← Automatically encrypted before saving
});

// In the database, it's stored as:
// "aGVsbG8gd29ybGQ6MTIzNDU2Nzg5MA==:YWJjZGVmZ2hpams=:bW5vcHFyc3Q=:dXZ3eHl6MTIzNDU2Nzg5MA=="
```

### Example: Using a Canvas API Key

```javascript
// Retrieve the integration
const integration = await CanvasIntegration.findOne({
  where: { userId: 1 }
});

// Access the API key (automatic decryption happens)
const apiKey = integration.apiKey;  // ← Automatically decrypted
// apiKey is now: "1234~abcdefghijklmnopqrstuvwxyz"

// Use it for API requests
const response = await axios.get('https://canvas.instructure.com/api/v1/courses', {
  headers: {
    'Authorization': `Bearer ${apiKey}`  // Uses decrypted key
  }
});
```

### What Developers See

**In the database:**
```
api_key: "aGVsbG8gd29ybGQ6MTIzNDU2Nzg5MA==:YWJjZGVmZ2hpams=:bW5vcHFyc3Q=:dXZ3eHl6MTIzNDU2Nzg5MA=="
```

**In the code:**
```javascript
console.log(integration.apiKey);
// Output: "1234~abcdefghijklmnopqrstuvwxyz"
```

The encryption/decryption is completely transparent to developers!

## Security Best Practices

### 1. Key Management

- ✅ Store encryption key in environment variables
- ✅ Use a secret management service in production (AWS Secrets Manager, HashiCorp Vault, etc.)
- ✅ Rotate keys periodically (requires re-encrypting all data)
- ❌ Never hardcode keys in source code
- ❌ Never commit keys to version control
- ❌ Never share keys in plain text

### 2. Access Control

- ✅ Limit database access to authorized personnel only
- ✅ Use database encryption at rest (PostgreSQL TDE)
- ✅ Use encrypted connections (SSL/TLS) for database connections
- ✅ Implement proper authentication and authorization

### 3. Monitoring

- ✅ Log encryption/decryption errors (but not the keys themselves)
- ✅ Monitor for unusual access patterns
- ✅ Set up alerts for decryption failures

### 4. Backup and Recovery

- ✅ Back up encryption keys securely
- ✅ Document key rotation procedures
- ✅ Test decryption with backups
- ⚠️ **Warning**: If you lose the encryption key, encrypted data cannot be recovered

## Troubleshooting

### Error: "ENCRYPTION_KEY is not set in environment variables"

**Problem**: The encryption key is missing from your environment.

**Solution**:
1. Add `ENCRYPTION_KEY` to your `.env` file
2. Generate a key using one of the methods in [Configuration](#configuration)
3. Restart your application

### Error: "Decryption failed"

**Possible Causes**:
1. **Wrong encryption key**: The key used to encrypt doesn't match the key used to decrypt
   - **Solution**: Ensure `ENCRYPTION_KEY` matches the key used when data was encrypted

2. **Corrupted data**: The encrypted data in the database is corrupted
   - **Solution**: User will need to re-enter their Canvas API key

3. **Format mismatch**: Data might be in an old format
   - **Solution**: The system handles backward compatibility automatically

### API Key Not Working After Encryption

**Problem**: Canvas API requests fail after implementing encryption.

**Possible Causes**:
1. **Key not being decrypted**: Check that the getter function is working
   - **Solution**: Verify `integration.apiKey` returns plaintext, not encrypted string

2. **Key was encrypted incorrectly**: The key might have been double-encrypted
   - **Solution**: Check database - if it contains multiple colons, it might be double-encrypted
   - **Fix**: User needs to re-enter their API key

### Testing Encryption

To verify encryption is working:

```javascript
// Test encryption
const { encrypt, decrypt } = require('./utils/encryption.js');
const original = "test-api-key-123";
const encrypted = encrypt(original);
const decrypted = decrypt(encrypted);

console.log("Original:", original);
console.log("Encrypted:", encrypted);
console.log("Decrypted:", decrypted);
console.log("Match:", original === decrypted); // Should be true
```

### Migration from Unencrypted Data

If you have existing unencrypted API keys in the database:

1. **Automatic Migration**: The system automatically detects plaintext and encrypts it on the next save
2. **Manual Migration**: Users can update their Canvas integration, which will encrypt the key
3. **Bulk Migration**: Write a migration script to encrypt all existing keys

Example migration script:
```javascript
const { CanvasIntegration } = require('./schema/index.js');
const { encrypt } = require('./utils/encryption.js');

async function migrateApiKeys() {
  const integrations = await CanvasIntegration.findAll();
  
  for (const integration of integrations) {
    const rawKey = integration.getDataValue('apiKey');
    // Check if already encrypted (contains colons)
    if (rawKey && !rawKey.includes(':')) {
      integration.setDataValue('apiKey', encrypt(rawKey));
      await integration.save({ fields: ['apiKey'] });
      console.log(`Migrated integration ${integration.id}`);
    }
  }
}
```

## Technical Details

### Encryption Algorithm: AES-256-GCM

- **Key Size**: 256 bits (32 bytes)
- **Block Size**: 128 bits (16 bytes)
- **Mode**: GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2 with SHA-512, 100,000 iterations
- **Salt Size**: 64 bytes
- **IV Size**: 16 bytes
- **Tag Size**: 16 bytes

### Security Properties

1. **Confidentiality**: Encrypted data cannot be read without the key
2. **Integrity**: Authentication tag detects tampering
3. **Uniqueness**: Each encryption uses unique salt and IV
4. **Forward Secrecy**: Compromising one key doesn't affect others (due to unique salts)

### Performance Considerations

- **Encryption/Decryption**: Very fast (< 1ms per operation)
- **Key Derivation**: Slower (~10-50ms) but only happens during encryption
- **Database Impact**: Minimal - encrypted strings are slightly longer but still efficient

## Additional Resources

- [AES Encryption (Wikipedia)](https://en.wikipedia.org/wiki/Advanced_Encryption_Standard)
- [Node.js Crypto Documentation](https://nodejs.org/api/crypto.html)
- [OWASP Encryption Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Questions?

If you have questions about encryption implementation:
1. Check this documentation first
2. Review the code in `utils/encryption.js` and `schema/CanvasIntegration.js`
3. Consult with the development team
4. Consider security best practices for your specific use case

---

**Last Updated**: 2024
**Maintained By**: Question Maker Development Team

