import { beforeEach, describe, expect, it } from "vitest";

import { parseStreetAddress, streetPrefixFor } from "../../../src/server/prescreen/address";
import { fixturePrescreen, handlePrescreenRequest, runPrescreen } from "../../../src/server/prescreen/pipeline";
import {
  clearSamResponseCache,
  querySamEntity,
  querySamExclusion,
  type FetchLike,
} from "../../../src/server/prescreen/sources";

function request(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://walkthrough.test/api/prescreen",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const QUERY = { street: "200 N Spring St", city: "Los Angeles", state: "CA", zip: "90012" };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function liveFetch(responses: Record<string, unknown>): FetchLike {
  return async (input: string) => {
    for (const [host, value] of Object.entries(responses)) {
      if (input.includes(host)) {
        if (value instanceof Error) throw value;
        return jsonResponse(value);
      }
    }
    return jsonResponse(null, 404);
  };
}

const GEOCODE_OK = {
  result: {
    addressMatches: [{
      coordinates: { x: -118.2456, y: 34.0516 },
      matchedAddress: "200 N SPRING ST, LOS ANGELES, CA, 90012",
      geographies: {
        "Census Tracts": [{ GEOID: "06037207306" }],
        Counties: [{ NAME: "Los Angeles County" }],
        States: [{ STUSAB: "CA" }],
      },
    }],
  },
};

const NFHL_OK = { features: [{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" } }] };
const DPI_OK = { features: [{ attributes: { GEOID: "06037207306", Percent_: 12.5, AGE_ALL: 2000, AGE_0_5: 140 } }] };
const LADBS_OK = [{ stno: "200", predir: "N", stname: "SPRING", suffix: "ST", aptype: "HAB", stat: "O", adddttm: "2024-05-01T00:00:00.000" }];
const LAHD_OK = [{
  address: "200 N SPRING ST, LOS ANGELES, CA 90012",
  violationtype: "PEELING PAINT",
  violations_cited: "2024-05-01T00:00:00.000",
  violations_cleared: "0",
  criscase: "123",
}];
const DISASTERS_OK = {
  DisasterDeclarationsSummaries: [{
    femaDeclarationString: "DR-1-CA",
    incidentType: "Fire",
    declarationTitle: "TEST FIRE",
    declarationDate: "2024-01-01T00:00:00.000Z",
    designatedArea: "Los Angeles (County)",
  }],
};

const HUD_OK = {
  features: [{
    attributes: {
      PROPERTY_NAME_TEXT: "Angelus Plaza",
      STD_ADDR: "245 S Hill St",
      STD_CITY: "Los Angeles",
      STD_ST: "CA",
      STD_ZIP5: "90012",
      TOTAL_ASSISTED_UNIT_COUNT: 757,
      TOTAL_UNIT_COUNT: 761,
      REAC_LAST_INSPECTION_SCORE: "92",
      TROUBLED_CODE: "N",
      OPIIS_RISK_CATEGORY: "Low",
      PROGRAM_TYPE1: "Sec 8 NC",
      HAS_ACTIVE_ASSISTANCE_IND: "Y",
    },
  }],
};
const TRI_OK = [{ facility_name: "WESTERN BRASS WORKS", tri_facility_id: "90012WSTRN1440N" }];
const SAM_OK = {
  totalRecords: 1,
  excludedEntity: [{ name: "SMITH CONSTRUCTION", exclusionType: "Ineligible (Proceedings Completed)", effectiveDate: "2024-01-15" }],
};

function fullLiveFetch(): FetchLike {
  return liveFetch({
    "geocoding.geo.census.gov": GEOCODE_OK,
    "hazards.fema.gov": NFHL_OK,
    "Deteriorated_Paint_Index_Tract": DPI_OK,
    "u82d-eh7z": LADBS_OK,
    "cr8f-uc4j": LAHD_OK,
    "www.fema.gov/api/open": DISASTERS_OK,
    "MULTIFAMILY_PROPERTIES_ASSISTED": HUD_OK,
    "data.epa.gov/dmapservice": TRI_OK,
    "api.sam.gov": SAM_OK,
  });
}

describe("street parser", () => {
  it("splits number, direction, name, and suffix", () => {
    expect(parseStreetAddress("200 N Spring St")).toEqual({
      number: "200",
      predir: "N",
      name: "SPRING",
      suffix: "ST",
      postdir: null,
    });
    expect(parseStreetAddress("9035 N Topanga Canyon Blvd")).toEqual({
      number: "9035",
      predir: "N",
      name: "TOPANGA CANYON",
      suffix: "BLVD",
      postdir: null,
    });
  });

  it("normalizes long directions and suffixes and strips units", () => {
    expect(parseStreetAddress("1015 South La Brea Avenue, Apt 4")).toEqual({
      number: "1015",
      predir: "S",
      name: "LA BREA",
      suffix: "AVE",
      postdir: null,
    });
    expect(streetPrefixFor(parseStreetAddress("9035 N Topanga Canyon Blvd")!)).toBe("9035 N TOPANGA CANYON BLVD");
  });

  it("rejects unparseable input instead of guessing", () => {
    expect(parseStreetAddress("")).toBeNull();
    expect(parseStreetAddress("Spring Street")).toBeNull();
    expect(parseStreetAddress("200")).toBeNull();
  });
});

describe("prescreen pipeline", () => {
  it("fans out to every source after one geocode", async () => {
    const seen: string[] = [];
    const counting: FetchLike = async (input: string) => {
      seen.push(input);
      return fullLiveFetch()(input);
    };
    const report = await runPrescreen(QUERY, { fetchImpl: counting });
    expect(report.mode).toBe("live");
    expect(report.matchedAddress).toContain("200 N SPRING ST");
    expect(report.tract).toBe("06037207306");
    expect(report.sources.ladbs.status).toBe("ok");
    expect(report.sources.lahd.status).toBe("ok");
    expect(report.sources.flood.status).toBe("ok");
    expect(report.sources.lead.status).toBe("ok");
    expect(report.sources.disasters.status).toBe("ok");
    expect(report.sources.hudAssisted.status).toBe("ok");
    expect(report.sources.hudAssisted.summary).toContain("none flagged troubled");
    expect(report.sources.epaTri.status).toBe("ok");
    expect(report.sources.sam.status).toBe("skipped");
    expect(seen.filter((url) => url.includes("geocoding.geo.census.gov"))).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("flags troubled assisted properties and gates SAM on key plus owner", async () => {
    const troubledFetch = liveFetch({
      "geocoding.geo.census.gov": GEOCODE_OK,
      "MULTIFAMILY_PROPERTIES_ASSISTED": {
        features: [{ attributes: { PROPERTY_NAME_TEXT: "X", TROUBLED_CODE: "Y", OPIIS_RISK_CATEGORY: "High" } }],
      },
      "data.epa.gov/dmapservice": [],
      "api.sam.gov": SAM_OK,
    });
    const noKey = await runPrescreen(QUERY, { fetchImpl: troubledFetch, samApiKey: null });
    expect(noKey.sources.hudAssisted.summary).toContain("1 flagged troubled");
    expect(noKey.sources.epaTri.status).toBe("empty");
    expect(noKey.sources.sam.status).toBe("skipped");
    expect(noKey.sources.sam.detail).toContain("SAM_API_KEY");

    const noOwner = await runPrescreen(QUERY, { fetchImpl: troubledFetch, samApiKey: "free-key" });
    expect(noOwner.sources.sam.status).toBe("skipped");
    expect(noOwner.sources.sam.detail).toContain("assessor");

    const keyed = await runPrescreen(QUERY, { fetchImpl: troubledFetch, samApiKey: "free-key", ownerName: "Smith Construction" });
    expect(keyed.sources.sam.status).toBe("ok");
    expect(keyed.sources.sam.summary).toContain("1 federal exclusion record");
  });

  it("degrades one dead source without failing the report", async () => {
    const fetchImpl = liveFetch({
      "geocoding.geo.census.gov": GEOCODE_OK,
      "hazards.fema.gov": new Error("socket hang up"),
      "Deteriorated_Paint_Index_Tract": DPI_OK,
      "u82d-eh7z": [],
      "cr8f-uc4j": LAHD_OK,
      "www.fema.gov/api/open": DISASTERS_OK,
    });
    const report = await runPrescreen(QUERY, { fetchImpl });
    expect(report.sources.flood.status).toBe("unavailable");
    expect(report.sources.flood.detail).toMatch(/did not answer/);
    expect(report.sources.ladbs.status).toBe("empty");
    expect(report.sources.lahd.status).toBe("ok");
    expect(report.sources.lead.status).toBe("ok");
    expect(report.sources.disasters.status).toBe("ok");
  });

  it("skips every source when the address cannot be located", async () => {
    const report = await runPrescreen(QUERY, {
      fetchImpl: liveFetch({ "geocoding.geo.census.gov": { result: { addressMatches: [] } } }),
    });
    expect(report.coords).toBeNull();
    for (const source of Object.values(report.sources)) {
      expect(source.status).toBe("skipped");
    }
  });

  it("rejects malformed upstream shapes per source", async () => {
    const report = await runPrescreen(QUERY, {
      fetchImpl: liveFetch({
        "geocoding.geo.census.gov": GEOCODE_OK,
        "hazards.fema.gov": { features: "not-an-array" },
        "Deteriorated_Paint_Index_Tract": DPI_OK,
        "u82d-eh7z": LADBS_OK,
        "cr8f-uc4j": LAHD_OK,
        "www.fema.gov/api/open": DISASTERS_OK,
      }),
    });
    expect(report.sources.flood.status).toBe("unavailable");
    expect(report.sources.lead.status).toBe("ok");
  });
});

describe("SAM owner checks", () => {
  beforeEach(() => {
    clearSamResponseCache();
  });

  function entityRow(name: string, line1: string | null, zip: string | null) {
    return {
      entityRegistration: {
        legalBusinessName: name,
        ueiSAM: "TESTUEI1234",
        registrationStatus: "Active",
        registrationExpirationDate: "2027-01-01",
        exclusionStatusFlag: "N",
      },
      coreData: {
        physicalAddress: line1 === null
          ? {}
          : { addressLine1: line1, city: "LOS ANGELES", stateOrProvinceCode: "CA", zipCode: zip },
      },
    };
  }

  function samFetch(exclusions: unknown, entities: unknown, seen: string[] = []): FetchLike {
    const answer = (value: unknown): Response => {
      if (value instanceof Error) throw value;
      if (typeof value === "number") return jsonResponse(null, value);
      return jsonResponse(value);
    };
    return async (input: string) => {
      seen.push(input);
      if (input.includes("geocoding.geo.census.gov")) return jsonResponse(GEOCODE_OK);
      if (input.includes("/exclusions")) return answer(exclusions);
      if (input.includes("/entities")) return answer(entities);
      return jsonResponse(null, 404);
    };
  }

  const EXCLUSIONS_EMPTY = { totalRecords: 0, excludedEntity: [] };

  it("verifies owner identity with registration status and address match", async () => {
    const report = await runPrescreen({ ...QUERY, owner: "Spring Street Holdings" }, {
      fetchImpl: samFetch(EXCLUSIONS_EMPTY, {
        totalRecords: 1,
        entityData: [entityRow("SPRING STREET HOLDINGS LLC", "200 N SPRING ST", "90012")],
      }),
      samApiKey: "free-key",
    });
    expect(report.sources.sam.status).toBe("empty");
    expect(report.sources.samEntity.status).toBe("ok");
    expect(report.sources.samEntity.summary).toContain("matches this property");
    expect(report.sources.samEntity.records[0]).toMatchObject({ uei: "TESTUEI1234", status: "Active", address: "match" });
  });

  it("picks the address-matching registration among same-name entities", async () => {
    const report = await runPrescreen({ ...QUERY, owner: "Common Name Corp" }, {
      fetchImpl: samFetch(EXCLUSIONS_EMPTY, {
        totalRecords: 2,
        entityData: [
          entityRow("COMMON NAME CORP", "8700 HOUSTON RD", "78521"),
          entityRow("COMMON NAME CORP", "200 N SPRING ST", "90012"),
        ],
      }),
      samApiKey: "free-key",
    });
    expect(report.sources.samEntity.status).toBe("ok");
    expect(report.sources.samEntity.summary).toContain("2 registrations match this name, closest shown");
    expect(report.sources.samEntity.records[0].address).toBe("match");
  });

  it("reports unknown instead of guessing when the registration has no usable address", async () => {
    const report = await runPrescreen({ ...QUERY, owner: "No Address Inc" }, {
      fetchImpl: samFetch(EXCLUSIONS_EMPTY, {
        totalRecords: 1,
        entityData: [entityRow("NO ADDRESS INC", null, null)],
      }),
      samApiKey: "free-key",
    });
    expect(report.sources.samEntity.status).toBe("ok");
    expect(report.sources.samEntity.summary).toContain("address comparison unavailable");
    expect(report.sources.samEntity.records[0].address).toBe("unknown");
  });

  it("degrades a rejected key and exhausted quota with exact remedies", async () => {
    const keyRejected = await querySamExclusion("Key Test LLC", "stale-key", samFetch(401, EXCLUSIONS_EMPTY));
    expect(keyRejected.status).toBe("unavailable");
    expect(keyRejected.summary).toContain("key was rejected");
    expect(keyRejected.detail).toContain("SAM_API_KEY");

    const quotaOut = await querySamEntity("Quota Test LLC", "free-key", { street: QUERY.street, zip: QUERY.zip }, samFetch(EXCLUSIONS_EMPTY, 429));
    expect(quotaOut.status).toBe("unavailable");
    expect(quotaOut.summary).toContain("daily request limit");
  });

  it("serves repeat owner screens from cache without refetching either leg twice", async () => {
    const seen: string[] = [];
    const fetchImpl = samFetch(EXCLUSIONS_EMPTY, {
      totalRecords: 0,
      entityData: [],
    }, seen);
    await querySamExclusion("Cache Test LLC", "free-key", fetchImpl);
    await querySamExclusion("Cache Test LLC", "free-key", fetchImpl);
    await querySamEntity("Cache Test LLC", "free-key", { street: QUERY.street, zip: QUERY.zip }, fetchImpl);
    await querySamEntity("Cache Test LLC", "free-key", { street: QUERY.street, zip: QUERY.zip }, fetchImpl);
    expect(seen.filter((url) => url.includes("/exclusions"))).toHaveLength(1);
    expect(seen.filter((url) => url.includes("/entities"))).toHaveLength(1);
  });

  it("passes the request owner through to the SAM legs and rejects an overlong owner", async () => {
    const fetchImpl = samFetch(SAM_OK, { totalRecords: 0, entityData: [] });
    const live = await handlePrescreenRequest(request({ ...QUERY, owner: "Smith Construction" }), {
      mode: "live",
      fetchImpl,
      samApiKey: "free-key",
    });
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ sources: { sam: { status: "ok" }, samEntity: { status: "empty" } } });

    const overlong = await handlePrescreenRequest(request({ ...QUERY, owner: "x".repeat(101) }), { mode: "live", fetchImpl });
    expect(overlong.status).toBe(400);
  });
});

describe("prescreen fixture", () => {
  it("returns a deterministic labeled report without network", () => {
    const first = fixturePrescreen(QUERY);
    const second = fixturePrescreen(QUERY);
    expect(first).toEqual(second);
    expect(first.mode).toBe("fixture");
    expect(first.fixtureNotice).toBe("Sample pre-screen — not live public records.");
    expect(first.sources.flood.status).toBe("ok");
    expect(first.sources.lahd.status).toBe("empty");
    expect(first.sources.samEntity.status).toBe("skipped");
  });
});

describe("prescreen handler", () => {
  it("serves fixture mode without fetching", async () => {
    let calls = 0;
    const result = await handlePrescreenRequest(request(QUERY), {
      mode: "fixture",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(null, 500);
      },
    });
    expect(result.status).toBe(200);
    expect(calls).toBe(0);
    expect(result.body).toMatchObject({ mode: "fixture", tract: "06037207306" });
  });

  it("runs the live pipeline with injected fetch", async () => {
    const result = await handlePrescreenRequest(request(QUERY), { mode: "live", fetchImpl: fullLiveFetch() });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ mode: "live", tract: "06037207306" });
  });

  it("rejects cross-origin, unknown keys, missing street, and oversized bodies", async () => {
    expect((await handlePrescreenRequest(request(QUERY, { origin: "https://other.test" }), { mode: "fixture" })).status).toBe(403);
    expect((await handlePrescreenRequest(request({ ...QUERY, url: "https://evil.test" }), { mode: "fixture" })).status).toBe(400);
    expect((await handlePrescreenRequest(request({ city: "LA" }), { mode: "fixture" })).status).toBe(400);
    expect((await handlePrescreenRequest(request({ street: "   " }), { mode: "fixture" })).status).toBe(400);
    expect((await handlePrescreenRequest(request("x".repeat(5000)), { mode: "fixture" })).status).toBe(413);
  });

  it("fails closed when the analysis mode is missing", async () => {
    const result = await handlePrescreenRequest(request(QUERY), { analysisModeEnv: "bogus" });
    expect(result.status).toBe(503);
  });

  it("accepts the public origin behind managed ingress", async () => {
    const publicOrigin = "https://metainspect-dev.test";
    const viaIngress = request(
      QUERY,
      { origin: publicOrigin },
      "http://10.0.0.5:3000/api/prescreen",
    );
    const allowed = await handlePrescreenRequest(viaIngress, { mode: "fixture", appPublicOrigin: publicOrigin });
    expect(allowed.status).toBe(200);
    const denied = await handlePrescreenRequest(
      request(QUERY, { origin: "https://evil.test" }, "http://10.0.0.5:3000/api/prescreen"),
      { mode: "fixture", appPublicOrigin: publicOrigin },
    );
    expect(denied.status).toBe(403);
    const misconfigured = await handlePrescreenRequest(viaIngress, { mode: "fixture", appPublicOrigin: "not-a-url" });
    expect(misconfigured.status).toBe(503);
  });
});
