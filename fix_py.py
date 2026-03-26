import re

def fix(f):
    c = open(f).read()
    c = re.sub(r'useQuery\("dummy" as any, \{\}\)', 'undefined', c)
    c = re.sub(r'useQuery\(undefined\)', 'undefined', c)
    open(f, 'w').write(c)

fix('src/hooks/useScopedBillingData.ts')
fix('src/hooks/useScopedMemberDetailsData.ts')

f = 'src/components/app-sidebar.tsx'
c = open(f).read()
c = re.sub(r'undefined', '', c)
# be careful not to remove valid undefineds
# wait, there are valid undefineds
