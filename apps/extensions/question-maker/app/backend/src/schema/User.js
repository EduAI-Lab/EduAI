/**
 * Thin local user record keyed on Core's CUID. Exists only for FK integrity
 * within QM — all identity and auth decisions go through Core.
 * Created on first login when Core authenticates the user.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const User = sequelize.define('User', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: true
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  coursesSeededAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
    field: 'courses_seeded_at',
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
  tableName: 'users',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['email'] }]
});
