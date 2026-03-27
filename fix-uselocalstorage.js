const fs = require('fs');
let file = fs.readFileSync('src/hooks/useLocalStorage.ts', 'utf8');

file = file.replace(/Schema\.Codec<T, E>/g, 'Schema.Schema<T, any, never>');
file = file.replace(/<T, E>/g, '<T>');

// Schema.decodeSync(Schema.fromJsonString(schema))(value) doesn't exist anymore in effect v3
// It's Schema.decodeUnknownSync(Schema.parseJson(schema))(value)
file = file.replace(/Schema\.decodeSync\(Schema\.fromJsonString\(schema\)\)\(value\)/g, 'Schema.decodeUnknownSync(Schema.parseJson(schema))(value)');
file = file.replace(/Schema\.encodeSync\(Schema\.fromJsonString\(schema\)\)\(value\)/g, 'Schema.encodeSync(Schema.parseJson(schema))(value)');

fs.writeFileSync('src/hooks/useLocalStorage.ts', file);
