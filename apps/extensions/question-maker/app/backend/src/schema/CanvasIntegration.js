/**
 * Sequelize model storing per-user Canvas integration details with encrypted API keys and test-mode flag.
 * Automatically encrypts/decrypts the API key and ensures a unique integration per user.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export const CanvasIntegration = sequelize.define('CanvasIntegration', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  canvasUrl: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'canvas_url',
    validate: {
      isUrl: true
    }
  },
  apiKey: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'api_key',
    comment: 'Encrypted Canvas API key',
    get() {
      const rawValue = this.getDataValue('apiKey');
      if (!rawValue) return rawValue;
      // Decrypt when accessing the value
      return decrypt(rawValue);
    },
    set(value) {
      if (!value) {
        this.setDataValue('apiKey', value);
        return;
      }
      // Only encrypt if it's not already encrypted (doesn't contain colons)
      // This allows for backward compatibility and test mode
      if (value.includes(':')) {
        // Already encrypted, store as-is
        this.setDataValue('apiKey', value);
      } else {
        // Plaintext, encrypt it
        this.setDataValue('apiKey', encrypt(value));
      }
    }
  },
  isTestMode: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_test_mode',
    comment: 'Enable test mode to simulate Canvas API without actual connection'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'canvas_integrations',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id']
    }
  ],
  hooks: {
    /**
     * Ensure API key is encrypted before saving (backup to setter)
     * This handles cases where the API key might be set directly via dataValues
     */
    beforeSave: async (integration) => {
      const rawValue = integration.getDataValue('apiKey');
      if (rawValue && !rawValue.includes(':')) {
        // Plaintext detected, encrypt it
        integration.setDataValue('apiKey', encrypt(rawValue));
      }
    },
    /**
     * Ensure API key is encrypted before creating (backup to setter)
     */
    beforeCreate: async (integration) => {
      const rawValue = integration.getDataValue('apiKey');
      if (rawValue && !rawValue.includes(':')) {
        // Plaintext detected, encrypt it
        integration.setDataValue('apiKey', encrypt(rawValue));
      }
    },
    /**
     * Ensure API key is encrypted before updating (backup to setter)
     */
    beforeUpdate: async (integration) => {
      const rawValue = integration.getDataValue('apiKey');
      if (rawValue && !rawValue.includes(':')) {
        // Plaintext detected, encrypt it
        integration.setDataValue('apiKey', encrypt(rawValue));
      }
    }
  }
});
