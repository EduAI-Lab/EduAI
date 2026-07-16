/**
 * Maps a Canvas assessment question id to a local Question_Metadata shell for re-sync.
 * Unique per user + Canvas question so the same remote question upserts one local shell
 * even when membership spans multiple local banks.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const CanvasBankQuestionMapping = sequelize.define('CanvasBankQuestionMapping', {
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
  localQuestionMetadataId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'local_question_metadata_id',
    references: {
      model: 'question_metadata',
      key: 'id'
    }
  },
  canvasAssessmentQuestionId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'canvas_assessment_question_id'
  },
  // Core QuestionBank id (cuid string) — banks live in EduAI Core
  localBankId: {
    type: DataTypes.STRING(64),
    allowNull: true,
    field: 'local_bank_id',
    comment: 'Core bank that last synced this remote question'
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
  tableName: 'canvas_bank_question_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      name: 'cbqm_user_canvas_qid_uq',
      fields: ['user_id', 'canvas_assessment_question_id']
    }
  ]
});
