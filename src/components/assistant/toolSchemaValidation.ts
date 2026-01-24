type ToolValidationResult = { valid: true } | { valid: false; error: string }

export function validateInputAgainstSchema(
  schema: Record<string, any>,
  value: unknown
): ToolValidationResult {
  if (!schema || typeof schema !== 'object') {
    return { valid: true }
  }

  const validation = validateSchemaNode(schema, value, 'input')
  return validation.valid ? { valid: true } : validation
}

function validateSchemaNode(
  schema: Record<string, any>,
  value: unknown,
  path: string
): ToolValidationResult {
  const alternates = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null

  if (alternates) {
    for (const option of alternates) {
      const result = validateSchemaNode(option, value, path)
      if (result.valid) {
        return result
      }
    }
    return { valid: false, error: `${path} does not match any allowed schema` }
  }

  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : []

  if (expectedTypes.length > 0 && !expectedTypes.some((type) => matchesSchemaType(type, value))) {
    return { valid: false, error: `${path} should be ${expectedTypes.join(' or ')}` }
  }

  if (schema.type === 'object' || (!schema.type && schema.properties)) {
    if (!isPlainObject(value)) {
      return { valid: false, error: `${path} should be an object` }
    }

    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if ((value as Record<string, unknown>)[key] === undefined) {
        return { valid: false, error: `${path}.${key} is required` }
      }
    }

    const properties = schema.properties || {}
    for (const [key, propSchema] of Object.entries(properties)) {
      const propValue = (value as Record<string, unknown>)[key]
      if (propValue !== undefined && propSchema) {
        const propResult = validateSchemaNode(propSchema as Record<string, any>, propValue, `${path}.${key}`)
        if (!propResult.valid) {
          return propResult
        }
      }
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${path} should be an array` }
    }

    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return { valid: false, error: `${path} must contain at least ${schema.minItems} items` }
    }

    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const itemResult = validateSchemaNode(schema.items as Record<string, any>, value[index], `${path}[${index}]`)
        if (!itemResult.valid) {
          return itemResult
        }
      }
    }
  }

  return { valid: true }
}

function matchesSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
