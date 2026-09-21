import { z } from 'zod';
import { GeofenceModeSchema, GeofenceRadiusSchema, SiteStatusSchema } from './project.js';

/**
 * Every column the importer understands, in template order.
 *
 * The list is also the contract for the missing-column rule: `columns` on a
 * commit says which columns the uploaded sheet actually declared, and any
 * column absent from it is left untouched on an update. A blank cell in a
 * column that IS present clears the field.
 */
export const IMPORT_COLUMNS = [
  'site_code', 'name', 'region', 'latitude', 'longitude', 'geofence',
  'address', 'city', 'area', 'scope_variant', 'status',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const IMPORT_ROW_LIMIT = 2000;
export const IMPORT_FILE_BYTES = 5_242_880;

export const SiteImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  siteCode: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
  regionName: z.string().trim().max(150).nullable().optional(),
  latitude: z.number().gte(-90).lte(90).nullable().optional(),
  longitude: z.number().gte(-180).lte(180).nullable().optional(),
  geofenceMode: GeofenceModeSchema.optional(),
  geofenceRadiusM: GeofenceRadiusSchema.nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  area: z.string().trim().max(100).nullable().optional(),
  scopeVariant: z.string().trim().max(100).nullable().optional(),
  status: SiteStatusSchema.optional(),
}).strip();
export type SiteImportRowDto = z.infer<typeof SiteImportRowSchema>;

export const SiteImportCommitSchema = z.object({
  columns: z.array(z.enum(IMPORT_COLUMNS)).min(1),
  rows: z.array(SiteImportRowSchema).min(1).max(IMPORT_ROW_LIMIT),
}).strip();
export type SiteImportCommitDto = z.infer<typeof SiteImportCommitSchema>;

export type SiteImportAction = 'CREATE' | 'UPDATE' | 'INVALID';

export interface SiteImportFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface SiteImportRowReport {
  rowNumber: number;
  action: SiteImportAction;
  siteCode: string | null;
  errors: string[];
  /** Populated only for UPDATE rows: exactly what a commit would overwrite. */
  changes: SiteImportFieldChange[];
}

export interface SiteImportPreviewDto {
  columns: ImportColumn[];
  summary: { created: number; updated: number; invalid: number };
  rows: SiteImportRowReport[];
  /** The payload to POST to commit, or null when any row is invalid. */
  importable: SiteImportCommitDto | null;
}
