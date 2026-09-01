const SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"])
const SCHEMA_KEYS = new Set([
  "type", "title", "description", "default", "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "minProperties", "maxProperties", "enum", "const",
  "anyOf", "oneOf", "allOf",
])
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_INPUT_NODES = 16_384
const MAX_INPUT_DEPTH = 32

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function schemas(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16
}

function validateSchemaNode(value: unknown, depth: number, top: boolean): boolean {
  if (!isObject(value) || depth > 12) return false
  if (Object.keys(value).some((key) => !SCHEMA_KEYS.has(key))) return false
  if (typeof value.type !== "string" || !SCHEMA_TYPES.has(value.type)) return false
  if (top && value.type !== "object") return false
  if (value.title !== undefined && typeof value.title !== "string") return false
  if (value.description !== undefined && typeof value.description !== "string") return false
  if (value.properties !== undefined) {
    if (!isObject(value.properties) || Object.keys(value.properties).length > 128) return false
    if (Object.values(value.properties).some((entry) => !validateSchemaNode(entry, depth + 1, false))) {
      return false
    }
  }
  if (value.required !== undefined) {
    if (
      !Array.isArray(value.required) ||
      value.required.length > 128 ||
      new Set(value.required).size !== value.required.length ||
      value.required.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > 256)
    ) return false
  }
  if (value.additionalProperties !== undefined && typeof value.additionalProperties !== "boolean") {
    return false
  }
  if (value.items !== undefined && !validateSchemaNode(value.items, depth + 1, false)) return false
  for (const key of ["minItems", "maxItems", "minLength", "maxLength", "minProperties", "maxProperties"]) {
    if (value[key] !== undefined && !isNonNegativeInteger(value[key])) return false
  }
  for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) return false
  }
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.length === 0 || value.enum.length > 128)) {
    return false
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const alternatives = value[key]
    if (alternatives === undefined) continue
    if (!schemas(alternatives) || alternatives.some((entry) => !validateSchemaNode(entry, depth + 1, false))) {
      return false
    }
  }
  return true
}

/** The exact JSON-Schema subset Cozea can enforce before invoking a worker. */
export function isSupportedDevAppToolInputSchema(value: unknown): value is Record<string, unknown> {
  return validateSchemaNode(value, 0, true)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "null") return value === null
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isObject(value)
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value)
  return typeof value === type
}

function matchSchema(schema: Record<string, unknown>, value: unknown, path: string): string | null {
  if (!matchesType(schema.type as string, value)) return `${path} must be ${schema.type as string}.`
  if (schema.const !== undefined && !jsonEqual(value, schema.const)) return `${path} does not match const.`
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(entry, value))) {
    return `${path} is not an allowed value.`
  }
  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf as Record<string, unknown>[]) {
      const error = matchSchema(child, value, path)
      if (error) return error
    }
  }
  if (Array.isArray(schema.anyOf)) {
    if (!(schema.anyOf as Record<string, unknown>[]).some((child) => !matchSchema(child, value, path))) {
      return `${path} does not match any allowed shape.`
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Record<string, unknown>[]).filter((child) => !matchSchema(child, value, path))
    if (matches.length !== 1) return `${path} must match exactly one allowed shape.`
  }
  if (typeof value === "string") {
    if (isNonNegativeInteger(schema.minLength) && value.length < schema.minLength) return `${path} is too short.`
    if (isNonNegativeInteger(schema.maxLength) && value.length > schema.maxLength) return `${path} is too long.`
  }
  if (typeof value === "number") {
    if (isFiniteNumber(schema.minimum) && value < schema.minimum) return `${path} is below minimum.`
    if (isFiniteNumber(schema.maximum) && value > schema.maximum) return `${path} is above maximum.`
    if (isFiniteNumber(schema.exclusiveMinimum) && value <= schema.exclusiveMinimum) return `${path} is below exclusive minimum.`
    if (isFiniteNumber(schema.exclusiveMaximum) && value >= schema.exclusiveMaximum) return `${path} is above exclusive maximum.`
  }
  if (Array.isArray(value)) {
    if (isNonNegativeInteger(schema.minItems) && value.length < schema.minItems) return `${path} has too few items.`
    if (isNonNegativeInteger(schema.maxItems) && value.length > schema.maxItems) return `${path} has too many items.`
    if (isObject(schema.items)) {
      for (const [index, entry] of value.entries()) {
        const error = matchSchema(schema.items, entry, `${path}[${index}]`)
        if (error) return error
      }
    }
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (isNonNegativeInteger(schema.minProperties) && entries.length < schema.minProperties) return `${path} has too few properties.`
    if (isNonNegativeInteger(schema.maxProperties) && entries.length > schema.maxProperties) return `${path} has too many properties.`
    const properties = isObject(schema.properties) ? schema.properties : {}
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.prototype.hasOwnProperty.call(value, required as string)) return `${path}.${required as string} is required.`
    }
    for (const [key, entry] of entries) {
      const child = properties[key]
      if (!child) {
        if (schema.additionalProperties === false) return `${path}.${key} is not allowed.`
        continue
      }
      const error = matchSchema(child as Record<string, unknown>, entry, `${path}.${key}`)
      if (error) return error
    }
  }
  return null
}

function inputBudgetError(value: unknown): string | null {
  let nodes = 0
  let bytes = 0
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > MAX_INPUT_NODES || current.depth > MAX_INPUT_DEPTH) return "Tool input is too complex."
    if (typeof current.value === "string") bytes += current.value.length * 2
    else if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return "Tool input must contain finite numbers."
      bytes += 8
    } else if (typeof current.value === "boolean" || current.value === null) bytes += 4
    else if (typeof current.value === "object" && current.value) {
      if (seen.has(current.value)) return "Tool input must not contain cycles."
      seen.add(current.value)
      if (Array.isArray(current.value)) {
        for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 })
      } else if (isObject(current.value)) {
        for (const [key, entry] of Object.entries(current.value)) {
          bytes += key.length * 2
          stack.push({ value: entry, depth: current.depth + 1 })
        }
      } else return "Tool input must contain only JSON values."
    } else return "Tool input must contain only JSON values."
    if (bytes > MAX_INPUT_BYTES) return "Tool input exceeds 1 MiB."
  }
  return null
}

export function validateDevAppToolInput(schema: unknown, input: unknown): string | null {
  if (!isSupportedDevAppToolInputSchema(schema)) return "The tool has an unsupported input schema."
  return inputBudgetError(input) ?? matchSchema(schema, input, "input")
}
