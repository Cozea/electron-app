const fs = require('fs');
const glob = require('glob');
const path = require('path');

function replaceAll(str, search, replacement) {
  return str.split(search).join(replacement);
}

const files = glob.sync('shared/t3-contracts/**/*.ts');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix Literals -> Literal
  content = replaceAll(content, 'Schema.Literals', 'Schema.Literal');

  // Fix String length/pattern constraints
  content = replaceAll(content, '.isMaxLength', '.pipe(Schema.maxLength');
  content = replaceAll(content, '.isMinLength', '.pipe(Schema.minLength');
  content = replaceAll(content, '.isPattern', '.pipe(Schema.pattern');
  content = replaceAll(content, '.isGreaterThanOrEqualTo', '.pipe(Schema.greaterThanOrEqualTo');
  content = replaceAll(content, '.isLessThanOrEqualTo', '.pipe(Schema.lessThanOrEqualTo');

  // Fix the closing parentheses for the pipe
  // Since .isMaxLength(100) becomes .pipe(Schema.maxLength(100)
  // We need to add a closing parenthesis. This is tricky with simple replace.
  // Let's use regex.
  content = content.replace(/\.pipe\(Schema\.maxLength\(([^)]+)\)/g, '.pipe(Schema.maxLength($1))');
  content = content.replace(/\.pipe\(Schema\.minLength\(([^)]+)\)/g, '.pipe(Schema.minLength($1))');
  content = content.replace(/\.pipe\(Schema\.pattern\(([^)]+)\)/g, '.pipe(Schema.pattern($1))');
  content = content.replace(/\.pipe\(Schema\.greaterThanOrEqualTo\(([^)]+)\)/g, '.pipe(Schema.greaterThanOrEqualTo($1))');
  content = content.replace(/\.pipe\(Schema\.lessThanOrEqualTo\(([^)]+)\)/g, '.pipe(Schema.lessThanOrEqualTo($1))');

  // Schema.optionalKey -> Schema.optional
  content = replaceAll(content, 'Schema.optionalKey', 'Schema.optional');

  // TrimmedString.check(...) -> Schema.decodeUnknownSync(TrimmedString)(...)
  content = content.replace(/([A-Za-z0-9_]+)\.check\(/g, 'Schema.decodeUnknownSync($1)(');

  // Schema.makeFilter -> Schema.filter
  content = replaceAll(content, 'Schema.makeFilter', 'Schema.filter');

  // Struct.assign -> Schema.extend
  content = replaceAll(content, 'Struct.assign', 'Schema.extend');

  // Schema.decodeTo -> Schema.decode
  content = replaceAll(content, 'Schema.decodeTo', 'Schema.decode');

  // Some schemas like NonEmptyString might need `.check` replacement too, regex handled it.
  
  // SchemaIssue import is missing in stable effect sometimes, or renamed to ParseIssue.
  content = replaceAll(content, 'import { Schema, SchemaIssue }', 'import { Schema, ParseResult }');
  content = replaceAll(content, 'SchemaIssue', 'ParseResult.ParseIssue');

  fs.writeFileSync(file, content);
}
console.log('Done upgrading effect syntax.');
