// A small JSON Schema validator for the subset the teachback schemas use:
// type, required, properties, additionalProperties, items, enum, const,
// minimum, maximum, minLength, minItems, pattern, anyOf, $ref to #/$defs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');
const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8')));
  return cache.get(name);
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

export function validate(value, schema, root = schema, at = '') {
  const errors = [];
  const here = at || '(root)';
  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    return validate(value, root.$defs[name], root, at);
  }
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validate(value, s, root, at).length === 0);
    if (!ok) errors.push({ path: here, message: schema.anyOfMessage ?? 'does not match any allowed shape' });
    if (!ok) return errors;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push({ path: here, message: `must be ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.includes(value)) errors.push({ path: here, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ path: here, message: `must be ${types.join(' or ')}, found ${typeOf(value)}` });
      return errors;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path: here, message: schema.minLength === 1 ? 'must not be empty' : `must be at least ${schema.minLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path: here, message: `must match ${schema.pattern}` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: here, message: `must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: here, message: `must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: here, message: `must have at least ${schema.minItems} entr${schema.minItems === 1 ? 'y' : 'ies'}` });
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, root, `${at}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push({ path: here, message: `is missing required field "${key}"` });
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      const child = at ? `${at}.${k}` : k;
      if (props[k]) errors.push(...validate(v, props[k], root, child));
      else if (schema.additionalProperties === false) errors.push({ path: child, message: 'is not a known field' });
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(v, schema.additionalProperties, root, child));
    }
  }
  return errors;
}

export function validateFile(value, name) {
  return validate(value, loadSchema(name));
}
