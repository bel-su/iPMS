import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma-clients/project';
import type { AuthzScope } from '@ipms/authz';
import { visibleProject } from '../../scope/project-scope.js';
import {
  uuidv7, type ImportColumn, type SiteImportCommitDto, type SiteImportFieldChange,
  type SiteImportPreviewDto, type SiteImportRowDto, type SiteImportRowReport,
} from '@ipms/contracts';
import { parseRows } from './parse.js';
import { readSheet } from './workbook.js';

/** Which sheet column carries each site field, for the missing-column rule. */
const FIELD_COLUMNS: Array<[keyof SiteImportRowDto, ImportColumn, string]> = [
  ['name', 'name', 'name'],
  ['regionName', 'region', 'region'],
  ['latitude', 'latitude', 'latitude'],
  ['longitude', 'longitude', 'longitude'],
  ['address', 'address', 'address'],
  ['city', 'city', 'city'],
  ['area', 'area', 'area'],
  ['scopeVariant', 'scope_variant', 'scopeVariant'],
  ['status', 'status', 'status'],
];

const show = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

export interface ExistingSite {
  siteCode: string; name: string; city: string | null; address: string | null;
  area: string | null; scopeVariant: string | null; status: string;
  latitude: unknown; longitude: unknown;
  geofenceMode: string; geofenceRadiusM: number | null;
  region: { name: string } | null;
}

/**
 * What a commit would overwrite on an existing site.
 *
 * Only columns the sheet declared are considered: a manager who exports just
 * site_code, latitude and longitude to fix coordinates must not be shown — or
 * dealt — a clear of every address in the project.
 */
export function diffSite(existing: ExistingSite, row: SiteImportRowDto, columns: ImportColumn[]): SiteImportFieldChange[] {
  const changes: SiteImportFieldChange[] = [];
  for (const [field, column, label] of FIELD_COLUMNS) {
    if (!columns.includes(column)) continue;
    const next = row[field];
    if (next === undefined) continue;
    const before = label === 'region' ? (existing.region?.name ?? null) : show(existing[label as keyof ExistingSite]);
    const after = show(next);
    if (before !== after) changes.push({ field: label, from: before, to: after });
  }
  if (columns.includes('geofence') && row.geofenceMode !== undefined) {
    const before = existing.geofenceMode === 'CUSTOM' ? String(existing.geofenceRadiusM) : existing.geofenceMode;
    const after = row.geofenceMode === 'CUSTOM' ? String(row.geofenceRadiusM) : row.geofenceMode;
    if (before !== after) changes.push({ field: 'geofence', from: before, to: after });
  }
  return changes;
}

@Injectable()
export class SiteImportService {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(scope: AuthzScope, projectId: string, file: Buffer): Promise<SiteImportPreviewDto> {
    await this.requireProject(scope, projectId);
    const sheet = await readSheet(file);
    const parsed = parseRows(sheet);

    const codes = parsed.flatMap((entry) => (entry.row ? [entry.row.siteCode] : []));
    const existing = new Map(
      (await this.prisma.site.findMany({ where: { projectId, siteCode: { in: codes } }, include: { region: true } }))
        .map((site) => [site.siteCode, site as unknown as ExistingSite]),
    );

    const rows: SiteImportRowReport[] = parsed.map((entry) => {
      if (!entry.row) return { rowNumber: entry.rowNumber, action: 'INVALID', siteCode: null, errors: entry.errors, changes: [] };
      const match = existing.get(entry.row.siteCode);
      return {
        rowNumber: entry.rowNumber,
        action: match ? 'UPDATE' : 'CREATE',
        siteCode: entry.row.siteCode,
        errors: [],
        changes: match ? diffSite(match, entry.row, sheet.columns) : [],
      };
    });

    const summary = {
      created: rows.filter((row) => row.action === 'CREATE').length,
      updated: rows.filter((row) => row.action === 'UPDATE').length,
      invalid: rows.filter((row) => row.action === 'INVALID').length,
    };

    return {
      columns: sheet.columns,
      summary,
      rows,
      // All-or-nothing: one bad row and there is nothing to confirm.
      importable: summary.invalid > 0 ? null : { columns: sheet.columns, rows: parsed.flatMap((e) => (e.row ? [e.row] : [])) },
    };
  }

  /**
   * Applies the whole file or none of it.
   *
   * Re-validates against the database rather than trusting the preview: rows
   * arrive as JSON from the client, and the project may have changed since.
   */
  async commit(scope: AuthzScope, projectId: string, dto: SiteImportCommitDto): Promise<{ created: number; updated: number }> {
    await this.requireProject(scope, projectId);

    const duplicates = dto.rows.map((row) => row.siteCode).filter((code, index, all) => all.indexOf(code) !== index);
    if (duplicates.length > 0) throw new BadRequestException(`Duplicate site codes in this import: ${[...new Set(duplicates)].join(', ')}`);

    const existing = new Map(
      (await this.prisma.site.findMany({ where: { projectId, siteCode: { in: dto.rows.map((row) => row.siteCode) } } }))
        .map((site) => [site.siteCode, site.id]),
    );

    return this.prisma.$transaction(async (tx) => {
      const names = [...new Set(dto.rows.flatMap((row) => (row.regionName ? [row.regionName] : [])))];
      const regions = new Map<string, string>();
      for (const name of names) {
        const region = await tx.region.upsert({
          where: { projectId_name: { projectId, name } },
          update: {},
          create: { id: uuidv7(), projectId, name },
        });
        regions.set(name, region.id);
      }

      const regionFor = (row: SiteImportRowDto): string | null =>
        row.regionName ? (regions.get(row.regionName) ?? null) : null;

      const fields = (row: SiteImportRowDto): Record<string, unknown> => ({
        ...(row.name === undefined ? {} : { name: row.name }),
        ...(row.latitude === undefined ? {} : { latitude: row.latitude }),
        ...(row.longitude === undefined ? {} : { longitude: row.longitude }),
        ...(row.address === undefined ? {} : { address: row.address }),
        ...(row.city === undefined ? {} : { city: row.city }),
        ...(row.area === undefined ? {} : { area: row.area }),
        ...(row.scopeVariant === undefined ? {} : { scopeVariant: row.scopeVariant }),
        ...(row.status === undefined ? {} : { status: row.status }),
        ...(row.geofenceMode === undefined ? {} : { geofenceMode: row.geofenceMode, geofenceRadiusM: row.geofenceRadiusM ?? null }),
        ...(dto.columns.includes('region') ? { regionId: regionFor(row) } : {}),
      });

      const creates = dto.rows.filter((row) => !existing.has(row.siteCode));
      const updates = dto.rows.filter((row) => existing.has(row.siteCode));

      if (creates.length > 0) {
        await tx.site.createMany({
          data: creates.map((row) => ({
            id: uuidv7(), projectId, siteCode: row.siteCode, name: row.name,
            regionId: regionFor(row),
            latitude: row.latitude ?? null, longitude: row.longitude ?? null,
            geofenceMode: row.geofenceMode ?? 'INHERIT', geofenceRadiusM: row.geofenceRadiusM ?? null,
            address: row.address ?? null, city: row.city ?? null, area: row.area ?? null,
            scopeVariant: row.scopeVariant ?? null, status: row.status ?? 'PLANNED',
          })),
        });
      }

      // Prisma has no bulk update for differing values, which is why the row
      // cap in the contracts keeps this loop bounded.
      for (const row of updates) {
        const id = existing.get(row.siteCode);
        if (id) await tx.site.update({ where: { id }, data: fields(row) });
      }

      return { created: creates.length, updated: updates.length };
    });
  }

  /**
   * NotFound for a project outside the caller's scope, indistinguishably from
   * one that does not exist. Bulk import writes sites in quantity, so an
   * unscoped parent check here is the widest write in the service.
   */
  private async requireProject(scope: AuthzScope, id: string): Promise<void> {
    if (!(await this.prisma.project.findFirst({ where: visibleProject(scope, id), select: { id: true } }))) {
      throw new NotFoundException('Project not found');
    }
  }
}
