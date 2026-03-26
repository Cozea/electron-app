import re

def p(f, regex, sub):
    c = open(f).read()
    open(f, 'w').write(re.sub(regex, sub, c, flags=re.DOTALL))

p('src/pages/teams/MemberDetails.tsx', r'\(project\)\s*=>', '(project: any) =>')
p('src/pages/teams/MemberDetails.tsx', r'project\s*=>', '(project: any) =>')

c1 = open('src/components/app-sidebar.tsx').read()
c1 = 'const prewarmAiSettingsData = () => {};\n' + c1
open('src/components/app-sidebar.tsx', 'w').write(c1)

c2 = open('src/components/settings/SettingsDrawer.tsx').read()
c2 = 'const prewarmAiSettingsData = () => {};\n' + c2
open('src/components/settings/SettingsDrawer.tsx', 'w').write(c2)

