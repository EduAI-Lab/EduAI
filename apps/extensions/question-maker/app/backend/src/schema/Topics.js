/**
 * Sequelize model for course topics used to classify questions and variants.
 * `id` is a VARCHAR UUID (changed from INTEGER autoincrement in schema-unification).
 * `coreTopicId` links to Core's CourseTopic.id; null until synced with Core.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const Topics = sequelize.define('Topics', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
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
  coreTopicId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
    field: 'core_topic_id',
    comment: 'Core CourseTopic CUID; null until synced with Core'
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
  tableName: 'topics',
  timestamps: true,
  underscored: true
});
