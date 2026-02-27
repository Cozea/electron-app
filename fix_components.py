import os
import glob
import re

components = [
    "src/components/assistant/AIConversation.tsx",
    "src/components/wizard/WizardConversation.tsx",
    "src/components/builder/BuilderConversation.tsx",
    "src/components/wizard/EntryChoice.tsx"
]

for filepath in components:
    if not os.path.exists(filepath):
        continue
    with open(filepath, "r") as f:
        content = f.read()

    # Drop explicit initialGlobalModelSettings.variantId ?? 'medium' in favor of letting undefined pass through when undefined is appropriate.
    # Note: For non-reasoning models we DO NOT want to set 'medium'.
    # We will relax state to accept undefined gracefully.
    content = re.sub(
        r"const \[variantId, setVariantId\] = useState<StoredModelSettings\['variantId'\]>\(\s*initialGlobalModelSettings\.variantId \?\? 'medium'\s*\)",
        "const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(initialGlobalModelSettings.variantId)",
        content
    )
    content = re.sub(
        r"const \[variantId, setVariantId\] = useState<StoredModelSettings\['variantId'\]>\(\s*initialGlobalModelSettings\.variantId \?\? promptSettings\.variantId \?\? 'medium'\s*\)",
        "const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(initialGlobalModelSettings.variantId ?? promptSettings?.variantId)",
        content
    )

    with open(filepath, "w") as f:
        f.write(content)

