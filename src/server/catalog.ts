/**
 * Server-only bundled catalog loader (REQ-001, REQ-004).
 *
 * The versioned demo catalog is validated once and cached. Throws when
 * corrupt (fail closed). Kept outside the /api/analyze route module so the
 * route exports only HTTP handlers (Next.js route type constraint).
 */
import catalogJson from "../data/catalog.demo.json";
import { validateCatalog, type Catalog } from "../domain/catalog";

let cachedCatalog: Catalog | null = null;

/** Bundled versioned catalog, validated once and frozen. Throws when corrupt (fail closed). */
export function getServerCatalog(): Catalog {
  if (!cachedCatalog) {
    const parsed = validateCatalog(catalogJson);
    if (!parsed.ok) {
      throw new Error(`Server catalog invalid: ${parsed.errors.join("; ")}`);
    }
    cachedCatalog = parsed.value;
  }
  return cachedCatalog;
}
