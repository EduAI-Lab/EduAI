/**
 * Join table: a question shell may belong to multiple banks in the same course.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const QuestionBankMembership = sequelize.define('QuestionBankMembership', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  questionBankId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'question_bank_id',
    references: {
      model: 'question_banks',
      key: 'id'
    }
  },
  questionMetadataId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'question_metadata_id',
    references: {
      model: 'question_metadata',
      key: 'id'
    }
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
  tableName: 'question_bank_memberships',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      name: 'qbm_bank_question_uq',
      fields: ['question_bank_id', 'question_metadata_id']
    },
    {
      name: 'qbm_question_idx',
      fields: ['question_metadata_id']
    }
  ]
});
