/**
 * Sequelize model for assessment sections, which define groupings of variants within an assessment.
 * Captures filters, difficulty settings, metadata, and ordering used by the builder UI.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const AssessmentSections = sequelize.define('AssessmentSections', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  assessmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'assessment_id',
    references: {
      model: 'assessments',
      key: 'id'
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sectionType: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'section_type'
  },
  difficultySettings: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'difficulty_settings'
  },
  topicFilters: {
    type: DataTypes.JSONB,
    allowNull: true,
    field: 'topic_filters'
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  position: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
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
  tableName: 'assessment_sections',
  timestamps: true,
  underscored: true
});
