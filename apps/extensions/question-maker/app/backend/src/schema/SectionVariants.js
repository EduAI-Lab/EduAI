/**
 * Join model linking question variants to assessment sections with display order and metadata.
 * Enforces uniqueness per section/variant pair to avoid duplicate placements.
 */
import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

export const SectionVariants = sequelize.define('SectionVariants', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sectionId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'section_id',
    references: {
      model: 'assessment_sections',
      key: 'id'
    }
  },
  variantId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'variant_id',
    references: {
      model: 'variants',
      key: 'id'
    }
  },
  displayOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'display_order'
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
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
  tableName: 'section_variants',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['section_id', 'variant_id']
    }
  ]
});
