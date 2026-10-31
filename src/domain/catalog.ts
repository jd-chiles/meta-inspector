/**
 * Versioned illustrative catalog contracts (REQ-001, REQ-004).
 *
 * The app ships mock-unit demo media and fixture model output. The project
 * owner has confirmed that LAHSA Form 1083 is the form used and submitted in
 * this workflow. That confirms the form identity, not exact source wording,
 * provider acceptance of this app's exports, or an HMIS connection. Every
 * demo surface keeps that distinction visible.
 *
 * Validation is strict and dependency-free so it runs identically in the app,
 * the API route, and unit tests: unknown keys, verdict-like fields, bad
 * structure, and oversized strings are rejected with named errors instead of
 * being silently trimmed.
 */

export const CATALOG_SCHEMA_VERSION = 1;

export const DEMO_CATALOG_ID = "demo-habitability-walkthrough";

/** Verbatim label required on every demo surface (UI, export, fixtures). */
export const DEMO_NOTICE =
  "Project owner confirms this workflow uses LAHSA Form 1083. This local app prepares a draft; it does not submit to HMIS.";

export type CatalogMode = "demo" | "confirmed";

export interface CatalogManualCheck {
  id: string;
  instruction: string;
  requiresPhysicalTest: boolean;
  photoCannotEstablish: boolean;
}

export interface CatalogItem {
  id: string;
  label: string;
  captureGuidance: string;
  manualChecks: CatalogManualCheck[];
}

export interface CatalogSourceConfirmation {
  status: "unconfirmed" | "owner-attested" | "confirmed";
  suppliedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  notes: string;
}

/** Versioned catalog snapshot. Sessions embed a snapshot so later catalog
 * edits cannot reinterpret already-captured evidence (REQ-006). */
export interface Catalog {
  schemaVersion: number;
  catalogId: string;
  version: string;
  mode: CatalogMode;
  demoNotice: string;
  sourceConfirmation: CatalogSourceConfirmation;
  items: CatalogItem[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const CATALOG_KEYS = new Set([
  "schemaVersion",
  "catalogId",
  "version",
  "mode",
  "demoNotice",
  "sourceConfirmation",
  "items",
]);

const ITEM_KEYS = new Set([
  "id",
  "label",
  "captureGuidance",
  "manualChecks",
]);

const MANUAL_CHECK_KEYS = new Set([
  "id",
  "instruction",
  "requiresPhysicalTest",
  "photoCannotEstablish",
]);

const SOURCE_CONFIRMATION_KEYS = new Set([
  "status",
  "suppliedBy",
  "verifiedBy",
  "verifiedAt",
  "notes",
]);

/**
 * Fields that assert an inspection verdict or a provider-confirmed mapping.
 * Demo catalogs must never carry them: a verdict field would let illustrative
 * content pose as a judgment (REQ-004), and a mapping field would let an
 * unconfirmed item pose as a verified Form 1083 reference (REQ-001).
 */
const DEMO_FORBIDDEN_ITEM_KEYS = new Set([
  "form1083Reference",
  "form1083ItemNumber",
  "officialItemNumber",
  "officialWording",
  "providerMapping",
  "mappedField",
  "verdict",
  "confidence",
  "approved",
  "deficient",
  "habitabilityVerdict",
]);

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const DEMO_ITEM_ID_PATTERN = /^demo-[a-z0-9-]+$/;
const CHECK_ID_PATTERN = /^[a-z0-9-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  errors: string[],
  where: string,
  value: Record<string, unknown>,
  allowed: Set<string>,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${where}: unexpected field "${key}"`);
    }
  }
}

function isNonEmptyString(value: unknown, maxLength: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function validateManualCheck(
  errors: string[],
  where: string,
  value: unknown,
): CatalogManualCheck | null {
  if (!isRecord(value)) {
    errors.push(`${where}: manual check must be an object`);
    return null;
  }
  rejectUnknown(errors, where, value, MANUAL_CHECK_KEYS);
  const { id, instruction, requiresPhysicalTest, photoCannotEstablish } = value;
  let valid = true;
  if (typeof id !== "string" || !CHECK_ID_PATTERN.test(id)) {
    errors.push(
      `${where}: "id" must be a lowercase slug (letters, digits, hyphens)`,
    );
    valid = false;
  }
  if (!isNonEmptyString(instruction, 300)) {
    errors.push(
      `${where}: "instruction" must be 1–300 characters of worker guidance`,
    );
    valid = false;
  }
  if (
    typeof requiresPhysicalTest !== "boolean" ||
    typeof photoCannotEstablish !== "boolean"
  ) {
    errors.push(
      `${where}: "requiresPhysicalTest" and "photoCannotEstablish" must be booleans`,
    );
    valid = false;
  }
  if (!valid) return null;
  return {
    id: id as string,
    instruction: instruction as string,
    requiresPhysicalTest: requiresPhysicalTest as boolean,
    photoCannotEstablish: photoCannotEstablish as boolean,
  };
}

function validateItem(
  errors: string[],
  where: string,
  value: unknown,
  mode: CatalogMode,
): CatalogItem | null {
  if (!isRecord(value)) {
    errors.push(`${where}: item must be an object`);
    return null;
  }
  rejectUnknown(errors, where, value, ITEM_KEYS);
  if (mode === "demo") {
    for (const key of Object.keys(value)) {
      if (DEMO_FORBIDDEN_ITEM_KEYS.has(key)) {
        errors.push(
          `${where}: demo catalogs must not carry "${key}" (no verdict or provider mapping without confirmation)`,
        );
      }
    }
  }
  const { id, label, captureGuidance, manualChecks } = value;
  let valid = true;
  if (typeof id !== "string" || id.trim().length === 0) {
    errors.push(`${where}: "id" must be a non-empty stable identifier`);
    valid = false;
  } else if (mode === "demo" && !DEMO_ITEM_ID_PATTERN.test(id)) {
    errors.push(
      `${where}: demo item "id" must use the "demo-" prefix (illustrative placeholders only)`,
    );
    valid = false;
  }
  if (!isNonEmptyString(label, 120)) {
    errors.push(`${where}: "label" must be 1–120 characters`);
    valid = false;
  }
  if (!isNonEmptyString(captureGuidance, 500)) {
    errors.push(`${where}: "captureGuidance" must be 1–500 characters`);
    valid = false;
  }
  if (!Array.isArray(manualChecks) || manualChecks.length === 0) {
    errors.push(`${where}: "manualChecks" must list at least one human check`);
    valid = false;
  }
  const checks: CatalogManualCheck[] = [];
  const checkIds = new Set<string>();
  if (Array.isArray(manualChecks)) {
    if (manualChecks.length > 10) {
      errors.push(`${where}: "manualChecks" must list at most 10 checks`);
      valid = false;
    }
    manualChecks.forEach((check, index) => {
      const parsed = validateManualCheck(
        errors,
        `${where}.manualChecks[${index}]`,
        check,
      );
      if (parsed) {
        if (checkIds.has(parsed.id)) {
          errors.push(`${where}: duplicate manual check id "${parsed.id}"`);
          valid = false;
        }
        checkIds.add(parsed.id);
        checks.push(parsed);
      } else {
        valid = false;
      }
    });
  }
  if (!valid) return null;
  return {
    id: id as string,
    label: label as string,
    captureGuidance: captureGuidance as string,
    manualChecks: checks,
  };
}

/** Strictly validate an unknown value as a versioned catalog. */
export function validateCatalog(value: unknown): ValidationResult<Catalog> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["catalog: must be an object"] };
  }
  rejectUnknown(errors, "catalog", value, CATALOG_KEYS);
  const {
    schemaVersion,
    catalogId,
    version,
    mode,
    demoNotice,
    sourceConfirmation,
    items,
  } = value;

  if (schemaVersion !== CATALOG_SCHEMA_VERSION) {
    errors.push(
      `catalog: "schemaVersion" must be ${CATALOG_SCHEMA_VERSION} (recovery/reset required for anything else)`,
    );
  }
  if (!isNonEmptyString(catalogId, 120)) {
    errors.push(`catalog: "catalogId" must be a 1–120 character identifier`);
  }
  if (
    typeof version !== "string" ||
    !VERSION_PATTERN.test(version)
  ) {
    errors.push(
      `catalog: "version" must look like "1.2.3" with an optional "-suffix"`,
    );
  }
  if (mode !== "demo" && mode !== "confirmed") {
    errors.push(`catalog: "mode" must be "demo" or "confirmed"`);
  }
  const catalogMode: CatalogMode = mode === "confirmed" ? "confirmed" : "demo";
  if (catalogMode === "demo" && demoNotice !== DEMO_NOTICE) {
    errors.push(
      `catalog: demo catalogs must carry the verbatim demo notice`,
    );
  }
  if (catalogMode === "confirmed" && typeof demoNotice !== "string") {
    errors.push(`catalog: "demoNotice" must be a string`);
  }

  let confirmation: CatalogSourceConfirmation | null = null;
  if (!isRecord(sourceConfirmation)) {
    errors.push(`catalog: "sourceConfirmation" must be an object`);
  } else {
    rejectUnknown(
      errors,
      "catalog.sourceConfirmation",
      sourceConfirmation,
      SOURCE_CONFIRMATION_KEYS,
    );
    const { status, suppliedBy, verifiedBy, verifiedAt, notes } =
      sourceConfirmation;
    if (
      status !== "unconfirmed" &&
      status !== "owner-attested" &&
      status !== "confirmed"
    ) {
      errors.push(
        `catalog.sourceConfirmation: "status" must be "unconfirmed", "owner-attested", or "confirmed"`,
      );
    } else if (
      catalogMode === "demo" &&
      status !== "unconfirmed" &&
      status !== "owner-attested"
    ) {
      errors.push(
        `catalog.sourceConfirmation: demo catalogs can only be "unconfirmed" or "owner-attested"; provider confirmation is a separate mode`,
      );
    } else if (
      catalogMode === "confirmed" &&
      status !== "confirmed"
    ) {
      errors.push(
        `catalog.sourceConfirmation: confirmed catalogs must record status "confirmed" with verifier and date`,
      );
    }
    for (const [key, val] of [
      ["suppliedBy", suppliedBy],
      ["verifiedBy", verifiedBy],
      ["verifiedAt", verifiedAt],
    ] as const) {
      if (val !== null && typeof val !== "string") {
        errors.push(
          `catalog.sourceConfirmation: "${key}" must be a string or null`,
        );
      }
    }
    if (typeof verifiedAt === "string" && Number.isNaN(Date.parse(verifiedAt))) {
      errors.push(
        `catalog.sourceConfirmation: "verifiedAt" must be a parseable date or null`,
      );
    }
    if (typeof notes !== "string" || notes.trim().length === 0) {
      errors.push(
        `catalog.sourceConfirmation: "notes" must explain confirmation state`,
      );
    }
    if (catalogMode === "confirmed") {
      // The provider-confirmation gate (REQ-001): a confirmed claim without
      // a named verifier and date is fake confirmation and never promotes.
      if (typeof verifiedBy !== "string" || verifiedBy.trim().length === 0) {
        errors.push(
          `catalog.sourceConfirmation: confirmed catalogs must record "verifiedBy"`,
        );
      }
      if (
        typeof verifiedAt !== "string" ||
        Number.isNaN(Date.parse(verifiedAt))
      ) {
        errors.push(
          `catalog.sourceConfirmation: confirmed catalogs must record a parseable "verifiedAt"`,
        );
      }
    }
    if (
      status === "unconfirmed" ||
      status === "owner-attested" ||
      status === "confirmed"
    ) {
      confirmation = {
        status,
        suppliedBy: (suppliedBy as string | null) ?? null,
        verifiedBy: (verifiedBy as string | null) ?? null,
        verifiedAt: (verifiedAt as string | null) ?? null,
        notes: notes as string,
      };
    }
  }

  const parsedItems: CatalogItem[] = [];
  if (!Array.isArray(items)) {
    errors.push(`catalog: "items" must be an array`);
  } else {
    if (items.length !== 11) {
      errors.push(
        `catalog: "items" must hold exactly 11 items (found ${items.length})`,
      );
    }
    const ids = new Set<string>();
    items.forEach((item, index) => {
      const parsed = validateItem(
        errors,
        `catalog.items[${index}]`,
        item,
        catalogMode,
      );
      if (parsed) {
        if (ids.has(parsed.id)) {
          errors.push(`catalog: duplicate item id "${parsed.id}"`);
        }
        ids.add(parsed.id);
        parsedItems.push(parsed);
      }
    });
    const hasPhotoGapCheck = parsedItems.some((item) =>
      item.manualChecks.some(
        (check) => check.photoCannotEstablish && check.requiresPhysicalTest,
      ),
    );
    if (!hasPhotoGapCheck) {
      errors.push(
        `catalog: at least one required manual check must cover what a photograph cannot establish`,
      );
    }
    for (const item of parsedItems) {
      const itemHasPhysicalPhotoGap = item.manualChecks.some(
        (check) => check.photoCannotEstablish && check.requiresPhysicalTest,
      );
      if (!itemHasPhysicalPhotoGap) {
        errors.push(
          `catalog.items: item "${item.id}" must list at least one manual check with photoCannotEstablish=true and requiresPhysicalTest=true (a photograph cannot replace a physical test)`,
        );
      }
    }
  }

  if (errors.length > 0 || !confirmation) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId: catalogId as string,
      version: version as string,
      mode: catalogMode,
      demoNotice: demoNotice as string,
      sourceConfirmation: confirmation,
      items: parsedItems,
    },
  };
}

/** Throw on invalid catalogs; prefer {@link validateCatalog} in UI paths. */
export function assertValidCatalog(value: unknown): Catalog {
  const result = validateCatalog(value);
  if (!result.ok) {
    throw new Error(`Invalid catalog: ${result.errors.join("; ")}`);
  }
  return result.value;
}

/** Look up an item by stable ID; returns null instead of throwing. */
export function getCatalogItem(
  catalog: Catalog,
  itemId: string,
): CatalogItem | null {
  return catalog.items.find((item) => item.id === itemId) ?? null;
}

/** Required human checks for an item. AI output can never remove these. */
export function getRequiredChecks(item: CatalogItem): CatalogManualCheck[] {
  return [...item.manualChecks];
}

export interface EffectiveManualCheck {
  id: string;
  instruction: string;
  /** Required catalog checks always win; model text can only add. */
  source: "required" | "model-suggestion";
}

/**
 * Display union of catalog checks and model suggestions (REQ-004/REQ-005).
 * Required checks come first and are never dropped or overridden, even when
 * the model claims they are unnecessary. Model suggestions that duplicate a
 * required check (case-insensitive instruction match) are folded in.
 */
export function effectiveManualChecks(
  item: CatalogItem,
  suggestedManualChecks: string[],
): EffectiveManualCheck[] {
  const effective: EffectiveManualCheck[] = item.manualChecks.map((check) => ({
    id: check.id,
    instruction: check.instruction,
    source: "required" as const,
  }));
  const known = new Set(
    item.manualChecks.map((check) => check.instruction.trim().toLowerCase()),
  );
  let suggestionIndex = 0;
  for (const suggestion of suggestedManualChecks) {
    suggestionIndex += 1;
    if (typeof suggestion !== "string") continue;
    const trimmed = suggestion.trim();
    if (trimmed.length === 0) continue;
    if (known.has(trimmed.toLowerCase())) continue;
    known.add(trimmed.toLowerCase());
    effective.push({
      id: `model-suggestion-${suggestionIndex}`,
      instruction: trimmed,
      source: "model-suggestion",
    });
  }
  return effective;
}

/** True when the value is the mock-media / fixture-analysis catalog. */
export function isDemoCatalog(catalog: Catalog): boolean {
  return (
    catalog.mode === "demo" &&
    (catalog.sourceConfirmation.status === "unconfirmed" ||
      catalog.sourceConfirmation.status === "owner-attested") &&
    catalog.demoNotice === DEMO_NOTICE
  );
}

/**
 * Guard exact provider-mapping claims: owner confirmation establishes the
 * form identity but does not verify exact field wording or provider approval
 * of this app's output. Only a separately reviewed catalog with recorded
 * verifier/date may claim that level of mapping.
 */
export function canClaimFormMapping(catalog: Catalog): boolean {
  const confirmation = catalog.sourceConfirmation;
  return (
    catalog.mode === "confirmed" &&
    confirmation.status === "confirmed" &&
    typeof confirmation.verifiedBy === "string" &&
    confirmation.verifiedBy.trim().length > 0 &&
    typeof confirmation.verifiedAt === "string" &&
    !Number.isNaN(Date.parse(confirmation.verifiedAt))
  );
}
