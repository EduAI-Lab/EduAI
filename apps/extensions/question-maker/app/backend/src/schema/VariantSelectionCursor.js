/**
 * Per-course, per-base-question cursor to support fair round-robin variant picks.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const VariantSelectionCursor = sequelize.define('VariantSelectionCursor', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  courseId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'course_id',
    references: {
      model: 'courses',
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
  nextOffset: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'next_offset'
  },
  lastVariantId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'last_variant_id',
    references: {
      model: 'variants',
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
  tableName: 'variant_selection_cursors',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['course_id', 'question_metadata_id']
    }
  ]
});
