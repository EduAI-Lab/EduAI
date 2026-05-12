/**
 * Sequelize model that maps a local course to a Canvas course for export tracking.
 * Provides quick lookup for which Canvas course was used per user/course combination.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const CanvasCourseMapping = sequelize.define('CanvasCourseMapping', {
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
  localCourseId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'local_course_id',
    references: {
      model: 'courses',
      key: 'id'
    }
  },
  canvasCourseId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'canvas_course_id'
  },
  canvasCourseName: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'canvas_course_name'
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
  tableName: 'canvas_course_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['user_id', 'local_course_id']
    }
  ]
});
