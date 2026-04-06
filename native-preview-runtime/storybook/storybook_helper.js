global.__COZEA_NATIVE_PREVIEW_previews ||= new Map();

async function isStoryIdValid(storyId) {
  const stories = await view._storyIndex.entries;
  return Object.values(stories).some((story) => story.id === storyId);
}

export async function storybookPreview(componentTitle, storyName) {
  try {
    const { view } = require("__COZEA_NATIVE_PREVIEW_STORYBOOK_CONFIG_PATH__/storybook.requires");

    if (view === undefined) {
      throw new Error("Storybook view is undefined.");
    }

    const { toId, storyNameFromExport } = require("./internal-imports/storybook_internals");
    if (toId === undefined || storyNameFromExport === undefined) {
      throw new Error("Storybook CSF tooling is undefined.");
    }

    const preparedStoryName = storyNameFromExport(storyName);
    const storyId = toId(componentTitle, preparedStoryName);
    if (!(await isStoryIdValid(storyId))) {
      throw new Error("Incorrect story id.");
    }

    const preparedStory = await view._preview.storyStore.loadStory({ storyId });
    const story = view._preview.storyStore.getStoryContext(preparedStory);
    view._setStory(story);

    const { unboundStoryFn: StoryComponent } = story;
    if (StoryComponent === undefined) {
      throw new Error("Component is undefined.");
    }

    const key = `sb://${storyId}`;
    global.__COZEA_NATIVE_PREVIEW_previews.set(key, {
      component: <StoryComponent {...story} />,
      name: storyId,
    });
    return key;
  } catch (error) {
    console.error("Failed to select story:", error.message);
  }
}
