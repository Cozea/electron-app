const fs = require('fs');
const glob = require('glob');

const files = glob.sync('shared/t3-contracts/**/*.ts');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix Literals -> Literal
  content = content.replace(/Schema\.Literals/g, 'Schema.Literal');
  
  // Fix .check(Schema.isMaxLength(...)) -> .pipe(Schema.maxLength(...))
  content = content.replace(/\.check\(Schema\.isMaxLength\(([^)]+)\)\)/g, '.pipe(Schema.maxLength($1))');
  content = content.replace(/\.check\(Schema\.isMinLength\(([^)]+)\)\)/g, '.pipe(Schema.minItems($1))');
  content = content.replace(/\.check\(Schema\.isPattern\(([^)]+)\)\)/g, '.pipe(Schema.pattern($1))');
  content = content.replace(/\.check\(Schema\.isLessThanOrEqualTo\(([^)]+)\)\)/g, '.pipe(Schema.lessThanOrEqualTo($1))');
  content = content.replace(/\.check\(Schema\.isGreaterThanOrEqualTo\(([^)]+)\)\)/g, '.pipe(Schema.greaterThanOrEqualTo($1))');

  // Fix String length methods directly on schema
  content = content.replace(/Schema\.isMaxLength/g, 'Schema.maxLength');
  content = content.replace(/Schema\.isMinLength/g, 'Schema.minItems');
  content = content.replace(/Schema\.isPattern/g, 'Schema.pattern');
  content = content.replace(/Schema\.isLessThanOrEqualTo/g, 'Schema.lessThanOrEqualTo');
  content = content.replace(/Schema\.isGreaterThanOrEqualTo/g, 'Schema.greaterThanOrEqualTo');

  // Fix Array type
  // In v0.64, `Schema.Array` was `Schema.Array`. Same in v0.75.
  
  // Fix optionalKey
  content = content.replace(/Schema\.optionalKey/g, 'Schema.optional');

  // Fix isNonEmpty
  content = content.replace(/\.isNonEmpty\(\)/g, '.pipe(Schema.nonEmptyString())');
  
  // Replace SchemaIssue
  content = content.replace(/SchemaIssue/g, 'ParseResult.ParseIssue');

  // Replace check for things that didn't match the regex above
  // like TrimmedString.check(Schema.maxLength(10))
  // .check(Schema.maxLength(10)) -> .pipe(Schema.maxLength(10))
  content = content.replace(/\.check\(Schema\.maxLength\(([^)]+)\)\)/g, '.pipe(Schema.maxLength($1))');
  content = content.replace(/\.check\(Schema\.minItems\(([^)]+)\)\)/g, '.pipe(Schema.minItems($1))');
  content = content.replace(/\.check\(Schema\.pattern\(([^)]+)\)\)/g, '.pipe(Schema.pattern($1))');
  content = content.replace(/\.check\(Schema\.lessThanOrEqualTo\(([^)]+)\)\)/g, '.pipe(Schema.lessThanOrEqualTo($1))');
  content = content.replace(/\.check\(Schema\.greaterThanOrEqualTo\(([^)]+)\)\)/g, '.pipe(Schema.greaterThanOrEqualTo($1))');

  // Fix `typeof Boolean$` -> `typeof Schema.Boolean` if it is an alias
  // Actually, I'll just replace `typeof Boolean` with `typeof Schema.Boolean`
  // Wait, no. `typeof Schema.Boolean` might be valid, but `Boolean` in TS refers to global Boolean. In Effect, `Schema.Boolean`.
  
  // There are some places doing `Struct.assign`. In v0.75 it's `Schema.extend`
  content = content.replace(/Struct\.assign/g, 'Schema.extend');

  fs.writeFileSync(file, content);
}

const baseSchemas = 'shared/t3-contracts/baseSchemas.ts';
if (fs.existsSync(baseSchemas)) {
  let content = fs.readFileSync(baseSchemas, 'utf8');
  content = content.replace(/export const Trim = Schema\.String\.check\(Schema\.Trim\);/g, 'export const Trim = Schema.String.pipe(Schema.trim());');
  content = content.replace(/export const Int = Schema\.Number\.check\(Schema\.Int\);/g, 'export const Int = Schema.Number.pipe(Schema.int());');
  content = content.replace(/export const TrimmedString = Schema\.String\.pipe\(Schema\.trim\(\)\);/g, 'export const TrimmedString = Schema.String.pipe(Schema.trim());');
  content = content.replace(/export const TrimmedNonEmptyStringSchema = TrimmedString\.pipe\(Schema\.nonEmptyString\(\)\);/g, 'export const TrimmedNonEmptyStringSchema = Schema.String.pipe(Schema.trim(), Schema.nonEmptyString());');
  
  // And fix those Int and Trim checks in baseSchemas
  content = content.replace(/Trim\.check\(/g, 'Schema.String.pipe(Schema.trim(), ');
  content = content.replace(/Int\.check\(/g, 'Schema.Number.pipe(Schema.int(), ');
  
  fs.writeFileSync(baseSchemas, content);
}
