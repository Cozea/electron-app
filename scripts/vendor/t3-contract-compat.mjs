/** Explicit schema syntax adaptation for Cozea's pinned Effect RC release.
 * Upstream t3code uses Schema.TaggedErrorClass from beta.78, which is Schema.TaggedError in rc.112.
 */
export function adaptT3Contract(name, source) {
  return source.replaceAll("Schema.TaggedErrorClass", "Schema.TaggedError");
}
