from pathlib import Path
import json
import re
import subprocess

# One-shot, branch-only migration. Compare every modified input to the reviewed
# commit before writing anything; concurrent branch edits must never be lost.
BASE = 'e75818a9fc8e298c0ee5ef8c39e64c6d86ff39ad'
ROOT = Path.cwd()
CORE = 'native/computer-use-runtime/Sources/CozeaComputerUseCore/'
RUNTIME = 'native/computer-use-runtime/Sources/CozeaComputerUseRuntime/'
pending = {}

def read(name):
    if name not in pending:
        expected = subprocess.check_output(['git', 'show', f'{BASE}:{name}'])
        actual = (ROOT / name).read_bytes()
        if actual != expected:
            raise RuntimeError(f'Reviewed source changed: {name}')
        pending[name] = actual.decode('utf-8')
    return pending[name]

def replace(name, old, new):
    text = read(name)
    if text.count(old) != 1:
        raise RuntimeError(f'Expected exactly one patch anchor in {name}: {old[:80]}')
    pending[name] = text.replace(old, new, 1)

def replace_function(name, start, end, replacement):
    text = read(name)
    if text.count(start) != 1 or text.count(end) != 1:
        raise RuntimeError(f'Function boundaries changed in {name}: {start}')
    left = text.index(start)
    right = text.index(end, left)
    pending[name] = text[:left] + replacement + '\n\n' + text[right:]

agents = read('AGENTS.md')
old = next(line for line in agents.splitlines() if line.startswith('Computer Use v2 lives in'))
replace('AGENTS.md', old, 'Read `docs/computer-use-v2.md` before changing Computer Use input, observations, cursor, policy, packaging, or release validation.')

catalogue_path = CORE + 'Resources/tools.json'
catalogue = json.loads(read(catalogue_path))
click = next(tool for tool in catalogue['tools'] if tool['name'] == 'click')
assert 'oneOf' not in click['inputSchema']
click['inputSchema']['oneOf'] = [
    {'required': ['element_index'], 'not': {'anyOf': [{'required': ['x']}, {'required': ['y']}]}},
    {'required': ['x', 'y'], 'not': {'required': ['element_index']}},
]
pending[catalogue_path] = json.dumps(catalogue, indent=2, ensure_ascii=False) + '\n'
replace(CORE + 'ToolRequest.swift',
    '            guard hasIndex != hasPoint else { throw RuntimeFailure(.invalidArguments, "Use either element_index or x/y, not both.") }',
    '''            guard hasIndex || hasPoint else {
                throw RuntimeFailure(.invalidArguments, "Provide either element_index or both x and y.")
            }
            guard hasIndex != hasPoint else {
                throw RuntimeFailure(.invalidArguments, "Use either element_index or x/y, not both.")
            }
            if hasPoint && (arguments["x"] == nil || arguments["y"] == nil) {
                throw RuntimeFailure(.invalidArguments, "Coordinate targets require both x and y.")
            }''')

tree = RUNTIME + 'Accessibility/AccessibilityTree.swift'
replace_function(tree, 'private func copyElement(', 'private func copyArray(', '''private func copyElement(_ element: AXUIElement, attribute: String) -> AXUIElement? {
    AXAccess.element(element, attribute)
}''')
replace_function(tree, 'private func copyArray(', 'private func copyActions(', '''private func copyArray(_ element: AXUIElement, attribute: String) -> [AXUIElement]? {
    AXAccess.value(element, attribute) as? [AXUIElement]
}''')
replace_function(tree, 'private func copyActions(', 'private func attributeValue(', '''private func copyActions(_ element: AXUIElement) -> [String]? {
    AXAccess.actions(element)
}''')
replace_function(tree, 'private func attributeValue(', 'private func stringValue(', '''private func attributeValue(of element: AXUIElement, attribute: String) -> CFTypeRef? {
    AXAccess.value(element, attribute)
}''')
replace_function(tree, 'private func isSettable(', 'private func sanitizedValue(', '''private func isSettable(of element: AXUIElement, attribute: String) -> Bool {
    AXAccess.settable(element, attribute)
}''')
replace(tree, '''    var positionValue: CFTypeRef?
    var sizeValue: CFTypeRef?
    let positionError = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
    let sizeError = AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue)
    guard
        positionError == .success,
        sizeError == .success,
        let positionValue,
        let sizeValue''', '''    guard
        let positionValue = AXAccess.value(element, kAXPositionAttribute),
        let sizeValue = AXAccess.value(element, kAXSizeAttribute)''')
assert not re.search(r'AXUIElement(?:CopyAttributeValue|CopyActionNames|IsAttributeSettable)\(', read(tree))
replace(RUNTIME + 'Accessibility/AccessibilityRuntime.swift',
    '''            renderer.render(window.element)
            if let menu = AXAccess.element(window.application, kAXMenuBarAttribute) { renderer.render(menu) }''',
    '''            let readBudget = AXReadBudget(cancellation: control.cancellation, deadline: renderer.context.deadline)
            readBudget.withScope {
                renderer.render(window.element)
                if let menu = AXAccess.element(window.application, kAXMenuBarAttribute) { renderer.render(menu) }
            }
            renderer.truncated = renderer.truncated || readBudget.exhausted''')

apps = RUNTIME + 'Windowing/AppDirectory.swift'
text = read(apps)
left = text.index('    private let blocked: Set<String> = [')
right = text.index('\n    ]', left) + len('\n    ]')
pending[apps] = text[:left] + text[right:]
replace_function(apps, '    func resolve(_ query: String)', '    func isCurrent(', '''    func resolve(_ query: String) throws -> AppDescriptor {
        if updatedAt.duration(to: .now) > .seconds(2) { refresh() }
        return try ApplicationExclusions.resolve(query, candidates: Array(apps.values))
    }''')
replace(apps, 'apps.values.filter { !blocked.contains($0.bundleID?.lowercased() ?? "") }', 'ApplicationExclusions.visible(Array(apps.values))')

provenance_path = 'native/computer-use-runtime/UPSTREAM.json'
provenance = json.loads(read(provenance_path))
assert provenance['license'] == 'AGPL-3.0-or-later'
provenance['license'] = 'MIT'
pending[provenance_path] = json.dumps(provenance, indent=2) + '\n'
assert (ROOT / 'native/computer-use-runtime/LICENSE.upstream.txt').read_text().startswith('MIT License\n')
for name in provenance['files']:
    replace(RUNTIME + name, '// AGPL-3.0-or-later; see ', '// MIT; see ')

preparation = 'scripts/prepare-t3-runtime.mjs'
replace(preparation, '''export function patchT3ComputerUseSource() {
  const sourcePath = path.join(serverRoot, "src", "mcp", "toolkits", "computerUse.ts");
  if (!fs.existsSync(sourcePath)) return false;''', '''export function patchT3ComputerUseSource({
  checkOnly = false,
  sourcePath = path.join(serverRoot, "src", "mcp", "toolkits", "computerUse.ts"),
} = {}) {
  if (!fs.existsSync(sourcePath)) {
    if (checkOnly) fail("Computer Use source is missing; prepare the pinned T3 checkout first.");
    return false;
  }''')
replace(preparation, '''  if (code === originalCode) return false;
  fs.writeFileSync(sourcePath, code);''', '''  if (code === originalCode) return false;
  if (checkOnly) fail("Computer Use source is stale; run preparation without --check to apply the v2 contract.");
  fs.writeFileSync(sourcePath, code);''')
replace(preparation, '  patchT3ComputerUseSource();', '  patchT3ComputerUseSource({ checkOnly: options.checkOnly });')

replace(CORE + 'ToolResult.swift', '    public func jsonText() throws -> String {', '''    /// Keep only small text results for duplicate-request replay. Reject image
    /// payloads before encoding; observations may contain megabytes of PNG/base64.
    /// The size measurement is injectable to test the no-image-encoding invariant.
    public func replayCacheEntry(
        maximumBytes: Int = 8192,
        measureEncodedBytes: (ComputerResult) throws -> Int = { try $0.jsonText().utf8.count }
    ) -> ComputerResult? {
        guard maximumBytes >= 0,
              content.allSatisfy({ $0.type == "text" && $0.data == nil }),
              let size = try? measureEncodedBytes(self), size >= 0, size <= maximumBytes else { return nil }
        return self
    }

    public func jsonText() throws -> String {''')
replace(RUNTIME + 'Runtime/MacComputerRuntime.swift',
    'let cache = (try? result.jsonText().utf8.count).map { $0 <= 8192 } == true ? result : nil',
    'let cache = result.replayCacheEntry()')

doc = 'docs/computer-use-v2.md'
pending[doc] = read(doc).rstrip() + '''

## Application-exclusion identifier provenance

`ApplicationExclusions` is the shared exact, case-normalized native bundle-ID guard
for discovery and name/PID/bundle-ID resolution. The review fixes add Dashlane's
legacy `com.dashlane.Dashlane` and `com.dashlane.mac.Dashlane`, and LastPass's
`com.lastpass.lastpassmacdesktop`, while retaining the existing known IDs.
Sources checked on 2026-09-08:

- Dashlane's own legacy-app detector: https://github.com/Dashlane/apple-apps/blob/039446070e55aee0c7c710095dd49f745808e710/AppKitBridgeBundle/InstalledApplication.swift
- LastPass package metadata: https://github.com/Homebrew/homebrew-cask/blob/main/Casks/l/lastpass.rb
- NordPass package metadata identifies `com.nordsec.nordpass`: https://github.com/Homebrew/homebrew-cask/blob/main/Casks/n/nordpass.rb
- Proton's own packaging identifies `me.proton.pass.electron`: https://github.com/ProtonMail/WebClients/blob/a37f752deb623ae05a8e6859ae90d87afb74e0d0/applications/pass-desktop/electron-builder.config.js

The suggested replacement IDs `com.nordpass.desktop` and
`ch.protonmail.pass.desktop` were not supported by these sources and are not
substituted for the verified IDs. Tests cover every retained ID across discovery
and all target aliases, including case normalization and exact-match boundaries.
This list is defense in depth, not comprehensive detection of credential UI in
browsers or applications with unknown bundle identifiers.
'''

for name, text in pending.items():
    (ROOT / name).write_text(text)
print(f'Applied reviewed corrections to {len(pending)} files.')
