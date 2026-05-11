/**
 * Sequelize model for individual question variants (question text, difficulty, answer, review status).
 * Links back to `Question_Metadata`, optional assessments/sections, and tracks AI/draft flags.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const Variants = sequelize.define('Variants', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  questionText: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'question_text',
    validate: {
      notEmpty: true
    }
  },
  difficulty: {
    type: DataTypes.ENUM('easy', 'medium', 'hard'),
    allowNull: false,
    defaultValue: 'medium'
  },
  reasoningLevel: {
    type: DataTypes.ENUM('factual', 'analytical', 'application'),
    allowNull: false,
    defaultValue: 'factual',
    field: 'reasoning_level'
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
  assessmentId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'assessment_id',
    references: {
      model: 'assessments',
      key: 'id'
    }
  },
  secondaryTopicsId: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: true,
    defaultValue: [],
    field: 'secondary_topics_id'
  },
  referenceId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'reference_id',
    references: {
      model: 'variants',
      key: 'id'
    }
  },
  isAiGenerated: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_ai_generated',
    comment: 'Indicates if this variant was generated using AI'
  },
  isDraft: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_draft',
    comment: 'Indicates if this variant is a draft and needs review before being added to assessments. All new variants start as drafts.'
  },
  answer: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  choices: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null,
    field: 'choices',
    comment: 'Array of choice objects for MCQ questions: [{letter: "A", text: "Option A"}, ...]'
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
  tableName: 'variants',
  timestamps: true,
  underscored: true
});
