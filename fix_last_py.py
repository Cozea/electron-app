import re

def p(f, regex, sub):
    c = open(f).read()
    open(f, 'w').write(re.sub(regex, sub, c, flags=re.DOTALL))

p('src/pages/teams/MemberDetails.tsx', r'project =>', '(project: any) =>')
p('src/pages/teams/MemberDetails.tsx', r'\(a, b\) =>', '(a: any, b: any) =>')
p('src/pages/teams/MemberDetails.tsx', r'n =>', '(n: any) =>')
p('src/pages/teams/MemberDetails.tsx', r'\(n\) =>', '(n: any) =>')

p('src/components/settings/SettingsDrawer.tsx', r'<AI[^>]*/>', '<AI />')
p('src/components/settings/SettingsDrawer.tsx', r'onMouseEnter=\{undefined\}', '')
p('src/components/settings/SettingsDrawer.tsx', r'onFocus=\{undefined\}', '')
p('src/components/settings/SettingsDrawer.tsx', r'onClick=\{\(\) => \{\s*undefined\(\);', 'onClick={() => {')

p('src/components/app-sidebar.tsx', r'onMouseEnter=\{undefined\}', '')
p('src/components/app-sidebar.tsx', r'onFocus=\{undefined\}', '')
p('src/components/app-sidebar.tsx', r'onClick=\{\(\) => \{\s*undefined\(\);', 'onClick={() => {')

