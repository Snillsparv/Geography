#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, '..');
const assetsDir = path.join(projectDir, 'assets');
const outputDir = path.join(assetsDir, 'globe');

const regionOrder = [
  'afrika',
  'asien',
  'europa',
  'nordamerika',
  'oceanien',
  'sydamerika',
  'vastindien'
];

const mapUnitsUrl =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson';
const countryNamesUrl =
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';

const manualCodeByName = {
  sudan: 'SDN',
  'kongo brazaville': 'COG',
  indoneien: 'IDN',
  nordirland: 'NIR',
  england: 'ENG',
  skottland: 'SCT',
  wales: 'WLS',
  makedonien: 'MKD',
  'bosnien hercegovina': 'BIH',
  marshaloarna: 'MHL',
  guyana: 'GUY',
  vitryssland: 'BLR',
  vitoryssland: 'BLR',
  vastsahara: 'ESH',
  'forenade arabemiraten': 'ARE',
  'saint vincent och grenadinerna': 'VCT',
  'saint kitts och nevis': 'KNA',
  'antigua och barbuda': 'ATG',
  'trinidad och tobago': 'TTO',
  'demokratiska republiken kongo': 'COD',
  ekvatorialguinea: 'GNQ',
  elfenbenskusten: 'CIV',
  mocambique: 'MOZ',
  nordmakedonien: 'MKD',
  sydkorea: 'KOR',
  sydsudan: 'SSD',
  tjeckien: 'CZE',
  osttimor: 'TLS',
  'papua nya guinea': 'PNG',
  'mikronesiens federerade stater': 'FSM',
  mikronesien: 'FSM',
  solomonoarna: 'SLB',
  'franska guyana': 'GUF',
  kosovo: 'KOS',
  palestina: 'PSX',
  irak: 'IRQ',
  georgien: 'GEO'
};

function normalizeName(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' och ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeArray(values) {
  return [...new Set(values.filter(Boolean))];
}

function addAlias(map, alias, code) {
  if (!alias || !code) return;
  const normalized = normalizeName(alias);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, new Set());
  map.get(normalized).add(code);
}

function listValidCodes(properties) {
  return [properties.ISO_A3, properties.GU_A3, properties.SU_A3].filter(
    code => code && code !== '-99'
  );
}

function toMultiPolygon(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    throw new Error('Invalid geometry');
  }
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function mergedGeometry(features) {
  const polygons = [];
  for (const feature of features) {
    polygons.push(...toMultiPolygon(feature.geometry));
  }
  return {
    type: 'MultiPolygon',
    coordinates: polygons
  };
}

function ringArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringCentroid(ring) {
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return {
      lon: sx / ring.length,
      lat: sy / ring.length
    };
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const factor = 1 / (6 * area);
  return {
    lon: cx * factor,
    lat: cy * factor
  };
}

function geometryCentroid(geometry) {
  const polygons = toMultiPolygon(geometry);
  let bestRing = null;
  let bestAbsArea = -1;

  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer || outer.length < 3) continue;
    const area = Math.abs(ringArea(outer));
    if (area > bestAbsArea) {
      bestAbsArea = area;
      bestRing = outer;
    }
  }

  if (!bestRing) return { lon: 0, lat: 0 };
  return ringCentroid(bestRing);
}

function featureLabel(feature) {
  const p = feature.properties || {};
  return p.NAME_LONG || p.NAME || p.ADMIN || p.SOVEREIGNT || 'Unknown';
}

function featureStableCode(feature) {
  const p = feature.properties || {};
  const exact = listValidCodes(p);
  if (exact.length > 0) return exact[0];
  if (p.ADM0_A3 && p.ADM0_A3 !== '-99') return `ADM0:${p.ADM0_A3}`;
  return `NAME:${normalizeName(featureLabel(feature))}`;
}

function chooseSingleCode(codeSet) {
  if (!codeSet || codeSet.size !== 1) return null;
  return [...codeSet][0];
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`GET ${url} failed with ${res.statusCode}`));
          res.resume();
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
}

async function readRegionConfig(regionSlug) {
  const regionPath = path.join(assetsDir, regionSlug, 'config.json');
  const raw = await fs.readFile(regionPath, 'utf8');
  return JSON.parse(raw);
}

async function build() {
  const [mapUnits, countryNames] = await Promise.all([
    fetchJson(mapUnitsUrl),
    fetchJson(countryNamesUrl)
  ]);

  const featureByExactCode = new Map();
  const featuresByAdm0 = new Map();
  const aliasToMapCodes = new Map();
  const aliasToCountryCodes = new Map();

  for (const feature of mapUnits.features) {
    const p = feature.properties;
    const exactCodes = listValidCodes(p);

    for (const code of exactCodes) {
      if (!featureByExactCode.has(code)) {
        featureByExactCode.set(code, feature);
      }
    }

    if (p.ADM0_A3 && p.ADM0_A3 !== '-99') {
      if (!featuresByAdm0.has(p.ADM0_A3)) featuresByAdm0.set(p.ADM0_A3, []);
      featuresByAdm0.get(p.ADM0_A3).push(feature);
    }

    const lookupCodes = dedupeArray([
      ...exactCodes,
      p.ADM0_A3 && p.ADM0_A3 !== '-99' ? p.ADM0_A3 : null
    ]);

    for (const code of lookupCodes) {
      addAlias(aliasToMapCodes, p.NAME, code);
      addAlias(aliasToMapCodes, p.NAME_LONG, code);
      addAlias(aliasToMapCodes, p.ADMIN, code);
      addAlias(aliasToMapCodes, p.GEOUNIT, code);
      addAlias(aliasToMapCodes, p.SOVEREIGNT, code);
      addAlias(aliasToMapCodes, p.SUBUNIT, code);
      addAlias(aliasToMapCodes, p.BRK_NAME, code);
    }
  }

  for (const country of countryNames) {
    const code = country.cca3;
    if (!code) continue;

    addAlias(aliasToCountryCodes, country.name?.common, code);
    addAlias(aliasToCountryCodes, country.name?.official, code);

    if (country.altSpellings) {
      for (const alt of country.altSpellings) addAlias(aliasToCountryCodes, alt, code);
    }

    if (country.translations) {
      for (const translation of Object.values(country.translations)) {
        addAlias(aliasToCountryCodes, translation.common, code);
        addAlias(aliasToCountryCodes, translation.official, code);
      }
    }

    if (country.name?.native) {
      for (const nativeName of Object.values(country.name.native)) {
        addAlias(aliasToCountryCodes, nativeName.common, code);
        addAlias(aliasToCountryCodes, nativeName.official, code);
      }
    }
  }

  const unresolved = [];
  const duplicateTargets = [];
  const countriesByFeatureKey = new Map();

  for (const regionSlug of regionOrder) {
    const config = await readRegionConfig(regionSlug);

    for (const country of config.countries || []) {
      const sourceFilename =
        country.filename || String(country.file || '').replace('countries/', '').replace('.webp', '');
      const normalizedName = normalizeName(country.name);

      let code = manualCodeByName[normalizedName] || null;

      if (!code) {
        code = chooseSingleCode(aliasToMapCodes.get(normalizedName));
      }
      if (!code) {
        code = chooseSingleCode(aliasToCountryCodes.get(normalizedName));
      }

      let featureKey = null;
      let geometry = null;
      let sourceFeatures = null;
      let mapLabel = null;

      if (code && featureByExactCode.has(code)) {
        const feature = featureByExactCode.get(code);
        featureKey = code;
        geometry = {
          type: feature.geometry.type,
          coordinates: feature.geometry.coordinates
        };
        sourceFeatures = [feature];
        mapLabel = featureLabel(feature);
      } else if (code && featuresByAdm0.has(code)) {
        const group = featuresByAdm0.get(code);
        featureKey = `ADM0:${code}`;
        geometry = mergedGeometry(group);
        sourceFeatures = group;
        mapLabel = group[0] ? featureLabel(group[0]) : code;
      } else if (code) {
        const fallbackFeature = mapUnits.features.find(feature => {
          const p = feature.properties;
          return (
            p.ADM0_A3 === code ||
            p.ISO_A3 === code ||
            p.GU_A3 === code ||
            p.SU_A3 === code
          );
        });
        if (fallbackFeature) {
          const fallbackCode = featureStableCode(fallbackFeature);
          featureKey = fallbackCode;
          geometry = {
            type: fallbackFeature.geometry.type,
            coordinates: fallbackFeature.geometry.coordinates
          };
          sourceFeatures = [fallbackFeature];
          mapLabel = featureLabel(fallbackFeature);
        }
      }

      if (!featureKey || !geometry) {
        unresolved.push({
          region: regionSlug,
          country: country.name,
          normalizedName,
          code: code || '(none)'
        });
        continue;
      }

      const center = geometryCentroid(geometry);
      const entry = {
        name: country.name,
        filename: sourceFilename,
        featureKey,
        mapCode: code || '',
        mapName: mapLabel || country.name,
        imageFile: `assets/${regionSlug}/countries/${sourceFilename}.webp`,
        desc: country.desc || '',
        imageAssociation: country.imageAssociation || '',
        sourceRegion: regionSlug,
        centerLon: Number(center.lon.toFixed(6)),
        centerLat: Number(center.lat.toFixed(6))
      };

      if (!countriesByFeatureKey.has(featureKey)) {
        countriesByFeatureKey.set(featureKey, {
          ...entry,
          sourceFeatures
        });
      } else {
        duplicateTargets.push({
          featureKey,
          kept: countriesByFeatureKey.get(featureKey).name,
          dropped: country.name,
          region: regionSlug
        });
      }
    }
  }

  if (unresolved.length > 0) {
    const msg = unresolved
      .map(
        item =>
          `${item.region}: ${item.country} (normalized="${item.normalizedName}", code=${item.code})`
      )
      .join('\n');
    throw new Error(`Unresolved countries:\n${msg}`);
  }

  const worldCountries = [...countriesByFeatureKey.values()].map(country => {
    const {
      sourceFeatures: _sourceFeatures,
      ...clean
    } = country;
    return clean;
  });

  const worldFeatures = [...countriesByFeatureKey.values()].map(country => ({
    type: 'Feature',
    properties: {
      key: country.featureKey,
      code: country.mapCode || country.featureKey,
      name: country.name,
      mapName: country.mapName,
      sourceRegion: country.sourceRegion
    },
    geometry:
      country.sourceFeatures.length === 1
        ? country.sourceFeatures[0].geometry
        : mergedGeometry(country.sourceFeatures)
  }));

  const worldConfig = {
    name: 'Världen',
    slug: 'globe',
    hsKey: 'globe-highscores',
    isGlobe: true,
    countries: worldCountries
  };

  const worldGeo = {
    type: 'FeatureCollection',
    name: 'globe_map_units',
    features: worldFeatures
  };

  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(outputDir, 'config.json'),
      JSON.stringify(worldConfig, null, 2) + '\n',
      'utf8'
    ),
    fs.writeFile(
      path.join(outputDir, 'world.geojson'),
      JSON.stringify(worldGeo),
      'utf8'
    )
  ]);

  console.log(`Generated ${path.relative(projectDir, path.join(outputDir, 'config.json'))}`);
  console.log(`Generated ${path.relative(projectDir, path.join(outputDir, 'world.geojson'))}`);
  console.log(`Countries: ${worldCountries.length}`);
  console.log(`Dropped duplicates: ${duplicateTargets.length}`);
  if (duplicateTargets.length > 0) {
    for (const d of duplicateTargets) {
      console.log(`  ${d.featureKey}: kept "${d.kept}", dropped "${d.dropped}" (${d.region})`);
    }
  }
}

build().catch(error => {
  console.error(error.stack || String(error));
  process.exit(1);
});
