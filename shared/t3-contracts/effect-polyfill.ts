// @ts-nocheck
import { Schema as OriginalSchema } from "effect";
import { ParseResult } from "effect";

// We create a proxy to intercept calls to the old effect-smol API
export const Schema = new Proxy(OriginalSchema, {
  get(target, prop, receiver) {
    if (prop === 'Literals') {
      return (...args) => {
        if (Array.isArray(args[0])) {
           return OriginalSchema.Literal(...args[0]);
        }
        return OriginalSchema.Literal(...args);
      }
    }
    if (prop === 'isMaxLength') return (n) => OriginalSchema.maxLength(n);
    if (prop === 'isMinLength') return (n) => OriginalSchema.minItems ? OriginalSchema.minItems(n) : OriginalSchema.minLength(n);
    if (prop === 'isPattern') return (r) => OriginalSchema.pattern(r);
    if (prop === 'isLessThanOrEqualTo') return (n) => OriginalSchema.lessThanOrEqualTo(n);
    if (prop === 'isGreaterThanOrEqualTo') return (n) => OriginalSchema.greaterThanOrEqualTo(n);
    if (prop === 'optionalKey') return OriginalSchema.optional;
    if (prop === 'makeFilter') return OriginalSchema.filter;
    if (prop === 'decodeTo') return OriginalSchema.decode;
    
    // Fallback
    return Reflect.get(target, prop, receiver);
  }
});

// Polyfill Struct.assign -> Schema.extend
export const Struct = {
  ...OriginalSchema.Struct,
  assign: (...args) => OriginalSchema.extend(...args)
};

export { ParseResult };
