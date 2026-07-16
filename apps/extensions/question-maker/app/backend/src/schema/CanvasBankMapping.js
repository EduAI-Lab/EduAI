/**
 * Maps a local question bank to a Canvas Assessment Question Bank for sync.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const CanvasBankMapping = sequelize.define('CanvasBankMapping', {
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
  // Core QuestionBank id (cuid string) — banks live in EduAI Core
  localBankId: {
    type: DataTypes.STRING(64),
    allowNull: false,
    field: 'local_bank_id'
  },
  canvasCourseId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'canvas_course_id'
  },
  canvasBankId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'canvas_bank_id'
  },
  lastSyncedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_synced_at'
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
  tableName: 'canvas_bank_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      name: 'cbm_user_canvas_bank_uq',
      fields: ['user_id', 'canvas_bank_id']
    }
  ]
});
