/**
 * Sequelize model representing the question shell (metadata) that owns variants.
 * Stores course/topic relationships, type, and per-assessment ordering for the question.
 * `primaryTopicId` is a VARCHAR UUID referencing topics.id (changed from INTEGER in schema-unification).
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const Question_Metadata = sequelize.define('Question_Metadata', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('MCQ', 'SA', 'LA'),
    allowNull: false
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
  primaryTopicId: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'primary_topic_id',
    references: {
      model: 'topics',
      key: 'id'
    }
  },
  questionOrder: {
    type: DataTypes.JSON,
    allowNull: true,
    field: 'question_order',
    comment: 'Dictionary mapping assessment IDs to order numbers: {assessmentId: orderNumber}'
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'users.id of the creator (RBAC §16/§19 TA own-only). Null = no owner → instructor-and-up only.'
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
  tableName: 'question_metadata',
  timestamps: true,
  underscored: true
});
