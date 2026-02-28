import re

with open("src/components/wizard/WizardConversation.tsx", "r") as f:
    content = f.read()

# Fix the missing extraBody that was deleted
content = content.replace(
    "      enableWebSearch: true,\n      providerAuthHeader,\n      api: chatApi,\n    },",
    "      enableWebSearch: true,\n      extraBody: {\n        projectContext: {\n          name: projectId || 'wizard-project',\n          slug: (projectId || 'wizard-project').toLowerCase(),\n          runtime: 'local',\n        },\n      },\n      providerAuthHeader,\n      api: chatApi,\n    },"
)

# Fix the messages dependency in cancelPendingToolOutputs
content = content.replace("  }, [messages])", "  }, [dedupedMessages])")

with open("src/components/wizard/WizardConversation.tsx", "w") as f:
    f.write(content)
